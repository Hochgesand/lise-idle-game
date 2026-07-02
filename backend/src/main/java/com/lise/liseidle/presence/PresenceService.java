package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentLoader;
import com.lise.liseidle.content.CoopConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Presence domain logic (T059; RED tests in T054): the client&rarr;server
 * heartbeat, the {@code @Scheduled} lease-expiry sweep, the snapshot builder,
 * and the consent/visibility settings logic (contracts &sect;2/&sect;3).
 *
 * <p><b>Why {@link Controller} (not {@code @Service})</b>: Spring's
 * {@code SimpAnnotationMethodMessageHandler} only detects {@code @MessageMapping}
 * methods on beans annotated {@link Controller}, so this class hosts the
 * {@code /app/presence.heartbeat} handler here rather than in
 * {@link PresenceController}. It carries no web handler methods (the REST
 * surface is {@link PresenceController}); the stereotype is purely so the STOMP
 * inbound channel routes the heartbeat to {@link #onHeartbeat}. The
 * {@code @Scheduled} sweep is likewise hosted here
 * ({@code @EnableScheduling} lives on the application class).
 *
 * <h2>Heartbeat &rarr; registry upsert + lease extension</h2>
 * {@link #onHeartbeat} guards on the STOMP {@link Principal} &mdash; a tokenless
 * (no-Principal) session is ignored (contracts &sect;3). An authenticated
 * heartbeat upserts the sender's {@link PresenceRecord} keyed by
 * {@code colleagueId}, marks them {@code LIVE}, and extends the lease to
 * {@code serverNow + coop.leaseSeconds}; every timestamp is server-stamped on
 * receipt (no client timestamps accepted). A {@code presence.update} is
 * broadcast <i>only</i> when the record materially changed (office/activity/
 * commute/status) AND the colleague is viewable (consented + visible) &mdash; a
 * steady 20&nbsp;s heartbeat cadence does not spam {@code /topic/presence}, and
 * hidden players contribute to no broadcast (FR-009). <b>The co-op lease
 * segment is issued/extended here (T072)</b> via {@link CoopService}: when &ge; 1
 * other distinct visible colleague shares the sender's office, a server-authored
 * segment is pushed to the sender on {@code /user/queue/coop} (none while
 * commuting); and when the sender's office changed, recomputed segments are
 * proactively pushed to the affected office-mates (SC-006).
 *
 * <h2>Scheduled expiry sweep</h2>
 * {@link #sweepExpiredPresence} expires a {@code LIVE} record whose lease is in
 * the past to {@code LAST_SEEN}: stamps {@code lastSeenAt}, persists office/
 * activity/lastSeenAt to the {@code player_presence} row, and broadcasts the
 * delta. Observers see the transition within {@code leaseSeconds} plus one
 * sweep interval of the final heartbeat (SC-005/006). Records already
 * last-seen are left untouched &mdash; the retention delete is Phase 7 (T085).
 *
 * <h2>Snapshot</h2>
 * {@link #buildSnapshot} returns {@code {serverTime, self, colleagues}}:
 * {@code self} is always echoed (even while hidden), {@code colleagues} lists
 * visible colleagues only (hidden/un-consented filtered server-side, FR-009),
 * self excluded. Hidden players contribute to no snapshot (FR-009).
 *
 * <h2>Settings</h2>
 * {@link #applySettings} stores consent/visibility; {@code visible:true}
 * without consent throws {@link ConsentRequiredException} (&rarr; 409). Hiding
 * (or revoking consent) broadcasts {@code presence.remove} immediately so
 * observers drop the avatar (SC-006) <b>and</b> proactively pushes recomputed
 * <i>downgrade</i> coop segments to the hider's office-mates &mdash; the
 * contribution stops at delta-propagation speed, not at lease expiry; showing
 * surfaces the current live record and pushes recomputed <i>upgrade</i>
 * segments. Segments are driven through {@link CoopService} (T072).
 *
 * <p>All presence side effects are advisory (contracts &sect;4): failures
 * degrade silently and never throw into the messaging channel or touch any
 * save.
 */
@Controller
public class PresenceService {

    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

    /**
     * Avatar frame count used by the defensive fallback when a colleague
     * heartbeats before {@code GET /api/v1/me} has bootstrapped their
     * {@code player_presence} row (the normal frontend flow always calls
     * {@code /me} first). Mirrors {@code MeController.AVATAR_FRAME_COUNT}.
     */
    static final int AVATAR_FRAME_COUNT = 16;

    private final PresenceRegistry registry;
    private final PresenceRepository repository;
    private final PresencePushService pushService;
    private final CoopConfig coop;
    private final CoopService coopService;

    /**
     * @param registry       the in-memory live presence tier
     * @param repository     the durable {@code player_presence} rows
     * @param pushService    the {@code /topic/presence} + {@code /user/queue/coop} push seam
     * @param contentLoader  the content catalog (the co-op tuning is read once at construction;
     *                       content is immutable per version)
     * @param coopService    the co-op multiplier/segment derivation (T071/T072)
     */
    public PresenceService(PresenceRegistry registry, PresenceRepository repository,
                           PresencePushService pushService, ContentLoader contentLoader,
                           CoopService coopService) {
        this.registry = registry;
        this.repository = repository;
        this.pushService = pushService;
        this.coop = contentLoader.getCatalog().coop();
        this.coopService = coopService;
    }

    // ── Heartbeat (client → server) ─────────────────────────────────────

    /**
     * Handle a {@code /app/presence.heartbeat} frame. A tokenless
     * (no-{@link Principal}) session is ignored (contracts &sect;3); an
     * authenticated heartbeat upserts the sender's record, marks them live, and
     * extends the lease. Never throws into the messaging channel (advisory,
     * contracts &sect;4).
     *
     * @param payload   the heartbeat body (office/activity/commute; no timestamps)
     * @param principal the STOMP principal named by the JWT {@code sub}, or {@code null}
     */
    @MessageMapping("/presence.heartbeat")
    public void onHeartbeat(HeartbeatPayload payload, Principal principal) {
        if (principal == null) {
            // tokenless (or invalid-token) session → presence heartbeats require
            // the Principal (contracts §3); ignored, never an ERROR frame.
            return;
        }
        try {
            applyHeartbeat(principal.getName(), payload);
        } catch (RuntimeException e) {
            // advisory: never throw into the messaging channel (contracts §4).
            log.warn("presence heartbeat handling failed for {}", principal.getName(), e);
        }
    }

    /**
     * Apply one authenticated heartbeat: upsert the sender's record, mark them
     * live, extend the lease, and broadcast a {@code presence.update} on a
     * material change (only if viewable). The first heartbeat reporting a
     * commute server-stamps {@code commute.startedAt} (via {@link #resolveCommute});
     * while a commute is reported the record's {@code office} is forced to
     * {@code null} (the &quot;office is null while commuting&quot; record invariant,
     * data-model PresenceRecord) regardless of the client's {@code office} field,
     * and no co-op segment is issued (the bonus is suspended in transit). Package-
     * private so the lease/sweep/commute tests can drive it directly without a
     * STOMP frame.
     *
     * @param colleagueId the sender (JWT {@code sub})
     * @param payload     the heartbeat body
     */
    void applyHeartbeat(String colleagueId, HeartbeatPayload payload) {
        Instant now = Instant.now();
        PlayerPresenceEntity row = repository.findById(colleagueId).orElse(null);
        PresenceRecord existing = registry.get(colleagueId).orElse(null);
        String previousOffice = (existing != null) ? existing.office() : null;
        boolean wasLive = (existing != null && existing.status() == PresenceRecord.Status.LIVE);
        PresenceRecord.Commute commute = resolveCommute(payload.commute(), existing, now);

        // While a commute is reported, the colleague is present in NO office
        // (data-model PresenceRecord: "office is null while commuting"). The
        // server enforces this invariant regardless of the client's `office`
        // field, so a buggy/tampered client cannot claim to be both commuting
        // and seated (which would inflate a co-op bonus, contracts &sect;4).
        String effectiveOffice = (payload.commute() != null) ? null : payload.office();

        PresenceRecord updated = new PresenceRecord(
                colleagueId,
                displayName(colleagueId, row),
                avatar(colleagueId, row),
                effectiveOffice,
                payload.activity(),
                commute,
                PresenceRecord.Status.LIVE,
                now.toString(),
                now.plusSeconds(coop.leaseSeconds()).toString());

        registry.upsert(updated);

        if (materiallyChanged(existing, updated) && isViewable(row)) {
            pushService.broadcastPresenceUpdate(updated, now.toString());
        }

        // Co-op lease segment + proactive recompute (T072; SC-006). Uses the
        // commute-enforced effective office so the bonus stays suspended in
        // transit even if the client misreported a non-null office.
        issueSenderSegmentAndRecompute(colleagueId, effectiveOffice, previousOffice, wasLive, now);
    }

    /**
     * Issue/extend the sender's own coop lease segment (none while commuting or
     * alone &mdash; {@link CoopService#heartbeatSegment}) and, when the sender's
     * <i>live contribution</i> to an office changed, proactively push recomputed
     * segments to that office's other colleagues (SC-006). A contribution
     * change is an office move <b>or</b> a last-seen&rarr;live re-entry into the
     * same office (a last-seen colleague does not count toward the crowd until
     * they heartbeat again). The sender is excluded from the recompute (their
     * own bonus is unaffected by their office move).
     */
    private void issueSenderSegmentAndRecompute(String senderId, String newOffice,
                                                String previousOffice, boolean wasLive, Instant now) {
        coopService.heartbeatSegment(senderId, newOffice, now)
                .ifPresent(segment -> pushService.sendCoopSegment(senderId, segment));
        // A colleague contributes to an office's crowd iff they are LIVE and in it
        // (visibility is unchanged within a heartbeat — flips go through applySettings).
        boolean wasContributingToPrevious = wasLive && previousOffice != null;
        boolean wasContributingToNew = wasLive && previousOffice != null && previousOffice.equals(newOffice);
        if (wasContributingToPrevious && !previousOffice.equals(newOffice)) {
            pushRecompute(previousOffice, now, senderId); // left previousOffice as a live contributor → downgrade
        }
        if (newOffice != null && !wasContributingToNew) {
            pushRecompute(newOffice, now, senderId);      // became a live contributor (new office or re-join) → upgrade
        }
    }

    /**
     * Push {@link CoopService#recomputeOffice} targets to their recipients on
     * {@code /user/queue/coop} (best-effort; advisory, contracts &sect;4).
     */
    private void pushRecompute(String office, Instant now, String excludeId) {
        for (CoopService.CoopTarget target : coopService.recomputeOffice(office, now, excludeId)) {
            pushService.sendCoopSegment(target.colleagueId(), target.segment());
        }
    }

    // ── Scheduled expiry sweep (live → last-seen) ───────────────────────

    /**
     * Expire every {@code LIVE} record whose lease is in the past to
     * {@code LAST_SEEN}: stamp {@code lastSeenAt}, persist office/activity/
     * lastSeenAt to the {@code player_presence} row, and broadcast the delta to
     * visible viewers (contracts &sect;3 "Lease &amp; expiry contract"). Runs on
     * the scheduler (10&nbsp;s); tests invoke it directly for determinism. The
     * expiry decision is atomic per colleague via
     * {@link PresenceRegistry#expireLiveIfPast(String, Instant)} so a concurrent
     * fresh heartbeat is never clobbered by a stale sweep. Each record is handled
     * in its own try/catch so one failure never aborts the whole pass (advisory,
     * contracts &sect;4).
     */
    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    public void sweepExpiredPresence() {
        Instant now = Instant.now();
        for (PresenceRecord record : registry.snapshot()) {
            if (record.status() != PresenceRecord.Status.LIVE) {
                continue;
            }
            try {
                Optional<PresenceRecord> expired = registry.expireLiveIfPast(record.colleagueId(), now);
                if (expired.isEmpty()) {
                    continue;
                }
                PresenceRecord stamped = expired.get();

                PlayerPresenceEntity row = repository.findById(record.colleagueId()).orElse(null);
                if (row != null) {
                    row.setOffice(stamped.office());
                    row.setActivity(stamped.activity());
                    row.setLastSeenAt(now.toString());
                    repository.save(row);
                }

                if (isViewable(row)) {
                    pushService.broadcastPresenceUpdate(stamped, now.toString());
                }
            } catch (RuntimeException e) {
                // advisory: one colleague's failure must not abort the sweep
                log.warn("presence sweep failed for {}", record.colleagueId(), e);
            }
        }
    }

    // ── Daily retention sweep (offboarding; T085) ───────────────────────

    /**
     * Offboard colleagues whose durable last-seen row has aged out of the
     * {@code coop.lastSeenRetentionDays} window (data-model PresenceRecord
     * "Retention &amp; offboarding"). Runs daily (3&nbsp;AM); tests invoke it
     * directly for determinism. For each row strictly older than the cutoff:
     * drop the live registry record (so the colleague disappears from
     * snapshots), delete the durable row, and &mdash; if the colleague was being
     * rendered (viewable and had a registry record) &mdash; broadcast a
     * {@code presence.remove} so observers drop the avatar (the
     * &quot;filtered from broadcasts&quot; half of the retention contract). This is the
     * offboarding path: a disabled/removed Keycloak account simply stops
     * heartbeating and ages out within the window, with no IdP integration.
     *
     * <p><b>LIVE colleagues are never retained out.</b> A live colleague's
     * durable {@code lastSeenAt} is stamped only on lease expiry (not on every
     * heartbeat), so a colleague who re-heartbeats after a long last-seen spell
     * carries a stale row whose {@code lastSeenAt} predates the window. They are
     * actively heartbeating, so they are skipped here &mdash; only LAST_SEEN (or
     * registry-absent) colleagues with an aged-out row are offboarded. Each row
     * is handled in its own try/catch so one failure never aborts the pass
     * (advisory, contracts &sect;4).
     */
    @Scheduled(cron = "0 0 3 * * *")
    public void sweepRetainedOut() {
        Instant cutoff = Instant.now().minus(Duration.ofDays(coop.lastSeenRetentionDays()));
        List<PlayerPresenceEntity> agedOut;
        try {
            agedOut = repository.findByLastSeenAtLessThan(cutoff.toString());
        } catch (RuntimeException e) {
            // advisory: a query failure must not abort the scheduler
            log.warn("retention sweep query failed", e);
            return;
        }
        for (PlayerPresenceEntity row : agedOut) {
            try {
                String colleagueId = row.getColleagueId();
                Optional<PresenceRecord> record = registry.get(colleagueId);
                if (record.isPresent() && record.get().status() == PresenceRecord.Status.LIVE) {
                    // actively heartbeating with a stale row — never offboard
                    continue;
                }
                boolean hadRecord = record.isPresent(); // a LAST_SEEN record being rendered
                boolean viewable = isViewable(row);
                registry.remove(colleagueId);
                repository.delete(row);
                if (viewable && hadRecord) {
                    pushService.broadcastPresenceRemove(colleagueId);
                }
            } catch (RuntimeException e) {
                // advisory: one colleague's failure must not abort the sweep
                log.warn("retention delete failed for {}", row.getColleagueId(), e);
            }
        }
    }

    // ── Snapshot (GET /api/v1/presence) ─────────────────────────────────

    /**
     * Build the presence snapshot for a viewer (contracts &sect;2):
     * {@code {serverTime, self, colleagues}}. {@code self} is always echoed
     * (even while hidden); {@code colleagues} lists visible colleagues only,
     * self excluded, and excludes any colleague whose {@code lastSeenAt} has
     * aged out of the {@code lastSeenRetentionDays} window (data-model
     * PresenceRecord "Retention &amp; offboarding"; T085). Hidden/un-consented
     * players are filtered server-side (FR-009).
     *
     * @param viewerId the viewer (JWT {@code sub})
     * @return the snapshot
     */
    public PresenceSnapshot buildSnapshot(String viewerId) {
        Instant now = Instant.now();
        PlayerPresenceEntity viewerRow = repository.findById(viewerId).orElse(null);
        PresenceRecordView self = buildSelf(viewerId, viewerRow);

        List<PresenceRecordView> colleagues = new ArrayList<>();
        for (PresenceRecord record : registry.snapshot()) {
            if (record.colleagueId().equals(viewerId)) {
                continue; // self excluded
            }
            if (isRetainedOut(record.lastSeenAt())) {
                continue; // aged out of the lastSeenRetentionDays window (T085)
            }
            PlayerPresenceEntity row = repository.findById(record.colleagueId()).orElse(null);
            if (!isViewable(row)) {
                continue; // hidden/un-consented filtered server-side (FR-009)
            }
            colleagues.add(PresenceRecordView.of(record));
        }
        return new PresenceSnapshot(now.toString(), self, colleagues);
    }

    private PresenceRecordView buildSelf(String viewerId, PlayerPresenceEntity row) {
        Optional<PresenceRecord> live = registry.get(viewerId);
        if (live.isPresent()) {
            // own live record, echoed even while hidden (contracts §2)
            return PresenceRecordView.of(live.get());
        }
        if (row != null) {
            // durable last-seen projection
            return PresenceRecordView.of(toLastSeenRecord(viewerId, row));
        }
        // never seen, no row (defensive — /me normally bootstraps it): minimal self
        return new PresenceRecordView(viewerId, viewerId, stableAvatar(viewerId),
                null, null, null, PresenceRecordView.STATUS_LAST_SEEN, null);
    }

    // ── Settings (PUT /api/v1/presence/settings) ────────────────────────

    /**
     * Store the caller's consent/visibility settings (contracts &sect;2).
     * {@code visible:true} without consent throws {@link ConsentRequiredException}
     * (&rarr; 409 {@code consent_required}). Hiding (or revoking consent)
     * broadcasts {@code presence.remove} so observers drop the avatar immediately
     * (SC-006) <b>and</b> proactively pushes recomputed <i>downgrade</i> coop
     * segments to the caller's office-mates (the contribution stops at
     * delta-propagation speed, not lease expiry); showing surfaces the current
     * live record and proactively pushes recomputed <i>upgrade</i> segments.
     * The settings row is created if absent (the normal bootstrap is
     * {@code GET /api/v1/me}, but the consent flow may run first). The coop
     * pushes are driven through {@link CoopService} (T072).
     *
     * @param colleagueId  the caller (JWT {@code sub})
     * @param consentGiven app-side first-run consent (FR-003)
     * @param visible      appear/hide toggle (FR-003)
     * @return the stored result
     * @throws ConsentRequiredException if {@code visible} is requested without consent
     */
    public SettingsResult applySettings(String colleagueId, boolean consentGiven, boolean visible) {
        if (visible && !consentGiven) {
            throw new ConsentRequiredException();
        }
        PlayerPresenceEntity row = repository.findById(colleagueId)
                .orElseGet(() -> new PlayerPresenceEntity(colleagueId));
        boolean wasViewable = row.isConsentGiven() && row.isVisible();
        row.setConsentGiven(consentGiven);
        row.setVisible(visible);
        repository.save(row);

        boolean nowViewable = consentGiven && visible;
        Instant now = Instant.now();
        if (wasViewable && !nowViewable) {
            // hiding / consent-revoke → observers drop the avatar immediately (SC-006) ...
            pushService.broadcastPresenceRemove(colleagueId);
            // ... and the colleague stops counting toward others' bonus immediately:
            // proactively push recomputed downgrade segments to office-mates (SC-006).
            recomputeOfficeMates(colleagueId, now);
        } else if (!wasViewable && nowViewable) {
            // showing → surface the current live record if present
            registry.get(colleagueId).ifPresent(r -> pushService.broadcastPresenceUpdate(r, now.toString()));
            // showing → the colleague now counts toward others' bonus: proactively
            // push recomputed upgrade segments to office-mates (SC-006).
            recomputeOfficeMates(colleagueId, now);
        }
        return new SettingsResult(consentGiven, visible);
    }

    /**
     * Proactively push recomputed coop segments to the live colleagues sharing
     * the given colleague's office, after the colleague's viewability changed
     * (SC-006). The colleague themselves is excluded (their own bonus is
     * unaffected by their own visibility flip). No-op if the colleague has no
     * live record or is commuting.
     */
    private void recomputeOfficeMates(String colleagueId, Instant now) {
        String office = registry.get(colleagueId).map(PresenceRecord::office).orElse(null);
        if (office == null) {
            return;
        }
        pushRecompute(office, now, colleagueId);
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /**
     * Resolve the observer-facing commute projection, preserving an ongoing
     * commute's server-stamped {@code startedAt} so only the <i>first</i>
     * commuting heartbeat stamps the transition time (contracts &sect;3).
     */
    private static PresenceRecord.Commute resolveCommute(
            HeartbeatPayload.CommuteRequest requested, PresenceRecord existing, Instant now) {
        if (requested == null) {
            return null;
        }
        String startedAt = now.toString();
        if (existing != null && existing.commute() != null
                && Objects.equals(existing.commute().fromOffice(), requested.fromOffice())
                && Objects.equals(existing.commute().toOffice(), requested.toOffice())) {
            startedAt = existing.commute().startedAt();
        }
        return new PresenceRecord.Commute(requested.fromOffice(), requested.toOffice(), startedAt);
    }

    /** A material change (new colleague, or office/activity/commute/status difference). */
    private static boolean materiallyChanged(PresenceRecord prev, PresenceRecord next) {
        if (prev == null) {
            return true;
        }
        return !Objects.equals(prev.office(), next.office())
                || !Objects.equals(prev.activity(), next.activity())
                || !Objects.equals(prev.commute(), next.commute())
                || prev.status() != next.status();
    }

    /** A colleague is viewable to others iff their durable row is consented AND visible (FR-009). */
    private static boolean isViewable(PlayerPresenceEntity row) {
        return row != null && row.isConsentGiven() && row.isVisible();
    }

    /**
     * True iff {@code lastSeenAt} is older than the {@code lastSeenRetentionDays}
     * window (a last-seen colleague who has aged out and must no longer render,
     * data-model PresenceRecord). A {@code null} or unparseable timestamp is
     * treated as within window (never filter a live/never-seen colleague on a
     * bad stamp &mdash; advisory, contracts &sect;4). A LIVE colleague carries a
     * fresh {@code lastSeenAt} (every heartbeat stamps it), so this never filters
     * an active colleague.
     */
    private boolean isRetainedOut(String lastSeenAt) {
        if (lastSeenAt == null) {
            return false;
        }
        try {
            return Instant.parse(lastSeenAt)
                    .isBefore(Instant.now().minus(Duration.ofDays(coop.lastSeenRetentionDays())));
        } catch (RuntimeException parseFailure) {
            return false;
        }
    }

    private static String displayName(String colleagueId, PlayerPresenceEntity row) {
        if (row != null && row.getDisplayName() != null) {
            return row.getDisplayName();
        }
        return colleagueId;
    }

    private static String avatar(String colleagueId, PlayerPresenceEntity row) {
        if (row != null && row.getAvatar() != null) {
            return row.getAvatar();
        }
        return stableAvatar(colleagueId);
    }

    private static String stableAvatar(String colleagueId) {
        // mirrors MeController.stableAvatarId (data-model PlayerIdentity avatarId)
        return String.valueOf(Math.floorMod(colleagueId.hashCode(), AVATAR_FRAME_COUNT));
    }

    private static PresenceRecord toLastSeenRecord(String colleagueId, PlayerPresenceEntity row) {
        return new PresenceRecord(
                colleagueId,
                row.getDisplayName(),
                row.getAvatar(),
                row.getOffice(),
                row.getActivity(),
                null,
                PresenceRecord.Status.LAST_SEEN,
                row.getLastSeenAt(),
                null);
    }
}
