package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentLoader;
import com.lise.liseidle.content.CoopConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Controller;

import java.security.Principal;
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
 * hidden players contribute to no broadcast (FR-009). <b>No coop segment is
 * issued here</b> &mdash; that is Phase 5 (T072).
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
 * broadcasts {@code presence.remove} immediately so observers drop the avatar
 * (SC-006); showing surfaces the current live record. <b>No coop downgrade
 * segment is pushed here</b> &mdash; that is Phase 5 (T072).
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

    /**
     * @param registry       the in-memory live presence tier
     * @param repository     the durable {@code player_presence} rows
     * @param pushService    the {@code /topic/presence} + {@code /user/queue/coop} push seam
     * @param contentLoader  the content catalog (the co-op tuning is read once at construction;
     *                       content is immutable per version)
     */
    public PresenceService(PresenceRegistry registry, PresenceRepository repository,
                           PresencePushService pushService, ContentLoader contentLoader) {
        this.registry = registry;
        this.repository = repository;
        this.pushService = pushService;
        this.coop = contentLoader.getCatalog().coop();
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
     * material change (only if viewable). Package-private so the lease/sweep
     * tests can drive it directly without a STOMP frame.
     *
     * @param colleagueId the sender (JWT {@code sub})
     * @param payload     the heartbeat body
     */
    void applyHeartbeat(String colleagueId, HeartbeatPayload payload) {
        Instant now = Instant.now();
        PlayerPresenceEntity row = repository.findById(colleagueId).orElse(null);
        PresenceRecord existing = registry.get(colleagueId).orElse(null);
        PresenceRecord.Commute commute = resolveCommute(payload.commute(), existing, now);

        PresenceRecord updated = new PresenceRecord(
                colleagueId,
                displayName(colleagueId, row),
                avatar(colleagueId, row),
                payload.office(),
                payload.activity(),
                commute,
                PresenceRecord.Status.LIVE,
                now.toString(),
                now.plusSeconds(coop.leaseSeconds()).toString());

        registry.upsert(updated);

        if (materiallyChanged(existing, updated) && isViewable(row)) {
            pushService.broadcastPresenceUpdate(updated, now.toString());
        }
    }

    // ── Scheduled expiry sweep (live → last-seen) ───────────────────────

    /**
     * Expire every {@code LIVE} record whose lease is in the past to
     * {@code LAST_SEEN}: stamp {@code lastSeenAt}, persist office/activity/
     * lastSeenAt to the {@code player_presence} row, and broadcast the delta to
     * visible viewers (contracts &sect;3 "Lease &amp; expiry contract"). Runs on
     * the scheduler (10&nbsp;s); tests invoke it directly for determinism. A
     * record already last-seen, or a live record with a future lease, is left
     * untouched.
     */
    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    public void sweepExpiredPresence() {
        Instant now = Instant.now();
        for (PresenceRecord record : registry.snapshot()) {
            if (record.status() != PresenceRecord.Status.LIVE || record.leaseExpiresAt() == null) {
                continue;
            }
            if (!Instant.parse(record.leaseExpiresAt()).isBefore(now)) {
                continue; // lease still in the future
            }
            PresenceRecord expired = new PresenceRecord(
                    record.colleagueId(),
                    record.displayName(),
                    record.avatar(),
                    record.office(),
                    record.activity(),
                    record.commute(),
                    PresenceRecord.Status.LAST_SEEN,
                    now.toString(),
                    null);
            registry.upsert(expired);

            PlayerPresenceEntity row = repository.findById(record.colleagueId()).orElse(null);
            if (row != null) {
                row.setOffice(record.office());
                row.setActivity(record.activity());
                row.setLastSeenAt(now.toString());
                repository.save(row);
            }

            if (isViewable(row)) {
                pushService.broadcastPresenceUpdate(expired, now.toString());
            }
        }
    }

    // ── Snapshot (GET /api/v1/presence) ─────────────────────────────────

    /**
     * Build the presence snapshot for a viewer (contracts &sect;2):
     * {@code {serverTime, self, colleagues}}. {@code self} is always echoed
     * (even while hidden); {@code colleagues} lists visible colleagues only,
     * self excluded. Hidden/un-consented players are filtered server-side
     * (FR-009).
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
     * (&rarr; 409 {@code consent_required}). Hiding broadcasts
     * {@code presence.remove} so observers drop the avatar immediately (SC-006);
     * showing surfaces the current live record. The settings row is created if
     * absent (the normal bootstrap is {@code GET /api/v1/me}, but the consent
     * flow may run first).
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
        String now = Instant.now().toString();
        if (wasViewable && !nowViewable) {
            // hiding → observers drop the avatar immediately (SC-006)
            pushService.broadcastPresenceRemove(colleagueId);
        } else if (!wasViewable && nowViewable) {
            // showing → surface the current live record if present
            registry.get(colleagueId).ifPresent(r -> pushService.broadcastPresenceUpdate(r, now));
        }
        return new SettingsResult(consentGiven, visible);
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
