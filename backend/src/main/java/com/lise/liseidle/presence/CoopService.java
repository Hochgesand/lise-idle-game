package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentLoader;
import com.lise.liseidle.content.CoopConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Co-operative production-bonus derivation (T071; RED tests in T068; wired into
 * the heartbeat/settings paths in T072). Owns the pure, capped multiplier
 * formula and the server-authored lease-segment construction, plus the
 * per-colleague "lease epoch" that makes a steady heartbeat cadence extend one
 * stable segment instead of proliferating entries (contracts &sect;1
 * {@code applyCoopPresence} upsert-by-{@code from}; data-model.md
 * "CoopSegment").
 *
 * <h2>The multiplier (FR-010/011/014)</h2>
 * For a sender in office {@code O}:
 * <pre>
 *   n        = #{ distinct, LIVE, visible colleagueIds in O, self excluded }
 *   mult     = min( 1 + n &times; perColleagueMultiplier , maxMultiplier )
 * </pre>
 * {@code n} counts <i>distinct colleagueIds</i> &mdash; the registry collapses
 * any number of sessions per colleague to one record, so a second tab can
 * neither ghost an avatar nor double-count toward a bonus (contracts &sect;3
 * "Duplicate-session collapse"). Hidden ({@code visible=false}) and
 * un-consented colleagues are excluded server-side (FR-009); colleagues in a
 * different office do not contribute (the bonus is per active office). The cap
 * is enforced here at issuance (defense in depth &mdash; the client clamps again
 * in {@code advance}).
 *
 * <h2>Lease epochs &amp; the stable {@code from}</h2>
 * Each colleague has at most one tracked {@link Epoch} ({@code from},
 * {@code multiplier}). On the sender's heartbeat:
 * <ul>
 *   <li>commuting ({@code office = null}) or alone ({@code n = 0}) &rarr; no
 *       segment, and the epoch is cleared (the bonus is suspended in transit /
 *       the residual lease simply runs out within one lease, SC-005);</li>
 *   <li>otherwise, if the recomputed multiplier <b>equals</b> the epoch's, the
 *       segment reuses the epoch's {@code from} and only extends {@code until}
 *       &mdash; a <i>stable extension</i> (the client upserts by {@code from},
 *       so a 20&nbsp;s cadence does not grow the segment list);</li>
 *   <li>if the multiplier <b>changed</b>, a fresh {@code from = serverNow}
 *       starts a new epoch &mdash; the client's latest-{@code from}-wins overlap
 *       rule makes the new value effective from that instant (contracts &sect;1
 *       Overlap rule).</li>
 * </ul>
 *
 * <h2>Proactive downgrade (SC-006)</h2>
 * {@link #recomputeOffice} returns the recomputed (colleague, segment) pushes
 * for every other LIVE colleague in an office after a crowd change (a
 * colleague joins, leaves, hides, or revokes consent). Each push carries a
 * fresh {@code from = serverNow} and the recomputed, capped multiplier &mdash;
 * including a baseline {@code 1.0} when the recipient is now alone, which
 * overrides the residual higher lease via latest-{@code from}-wins so the
 * contribution stops at delta-propagation speed, not at lease expiry. A
 * recipient whose multiplier is unchanged (e.g. already at the cap) yields no
 * push, avoiding redundant traffic. {@link PresenceService} drives this on
 * join/leave/hide/consent-revoke (T072); the scheduled lease-expiry sweep does
 * <b>not</b> (SC-005 &mdash; closed leases simply run out).
 *
 * <h2>Performance</h2>
 * {@link #recomputeOffice} resolves the office's visible-live colleague set
 * <b>once</b> per pass (one repository lookup per in-office colleague), then
 * computes every recipient's count in O(1) against that set &mdash; avoiding the
 * O(n&sup2;) lookups a per-recipient full scan would issue on every crowd
 * change.
 *
 * <p>All co-op side effects are advisory (contracts &sect;4): a dropped push is
 * re-converged by the next heartbeat / snapshot, and nothing here touches any
 * save.
 */
@Service
public class CoopService {

    private static final Logger log = LoggerFactory.getLogger(CoopService.class);

    private final PresenceRegistry registry;
    private final PresenceRepository repository;
    private final CoopConfig coop;

    /**
     * Per-colleague lease epoch: the {@code from} and multiplier of the segment
     * most recently issued to that colleague, so extensions reuse the same
     * {@code from} and multiplier changes start a fresh epoch.
     *
     * <p><b>Bounded growth, self-healing</b>: the map is keyed by
     * {@code colleagueId}, so it is bounded by the count of distinct colleagues
     * ever seen &mdash; not an unbounded leak. An epoch is cleared whenever a
     * heartbeat finds the colleague commuting or alone; a colleague who simply
     * stops heartbeating leaves a stale epoch that is harmlessly overwritten on
     * their next visit (the residual lease runs out via SC-005 regardless). The
     * scheduled sweep deliberately does not touch this map (SC-005).
     */
    private final ConcurrentHashMap<String, Epoch> epochs = new ConcurrentHashMap<>();

    /**
     * @param registry       the in-memory live presence tier (the colleague set)
     * @param repository     the durable {@code player_presence} rows (consent/visibility filter)
     * @param contentLoader  the content catalog (the co-op tuning is read once at construction;
     *                       content is immutable per version)
     */
    public CoopService(PresenceRegistry registry, PresenceRepository repository,
                       ContentLoader contentLoader) {
        this.registry = registry;
        this.repository = repository;
        this.coop = contentLoader.getCatalog().coop();
    }

    /**
     * The capped production multiplier for a given distinct-visible-colleague
     * count: {@code min(1 + n &times; perColleagueMultiplier, maxMultiplier)}
     * (FR-010/011). {@code n = 0} is baseline {@code 1.0}.
     *
     * @param colleagues the distinct-visible-colleague count (self excluded)
     * @return the capped multiplier, {@code 1 &le; m &le; maxMultiplier}
     */
    public double multiplier(int colleagues) {
        if (colleagues < 0) {
            colleagues = 0;
        }
        return Math.min(1.0 + colleagues * coop.perColleagueMultiplier(), coop.maxMultiplier());
    }

    /**
     * Count the <b>distinct, LIVE, visible</b> colleagues sharing {@code office}
     * with {@code senderId}, self excluded (FR-009/014). Hidden and
     * un-consented colleagues (per their durable row) are excluded; colleagues
     * in a different office do not contribute. The registry is keyed by
     * {@code colleagueId}, so the count is over distinct colleagueIds &mdash;
     * duplicate sessions collapse to one (contracts &sect;3). A {@code null}
     * office (the sender is commuting) short-circuits to zero before any
     * repository lookup.
     *
     * @param senderId the viewer/bonus recipient (excluded from the count)
     * @param office   the office id, or {@code null} while commuting
     * @return the distinct-visible-colleague count in that office
     */
    public int countVisibleColleagues(String senderId, String office) {
        Set<String> visibleLive = visibleLiveColleagues(office);
        return visibleLive.contains(senderId) ? visibleLive.size() - 1 : visibleLive.size();
    }

    /**
     * Build the sender's own lease segment from a heartbeat (T072 heartbeat
     * path). Stable {@code from} on a pure extension (same multiplier); a fresh
     * {@code from = now} on the first issuance or a multiplier change. Returns
     * empty &mdash; and clears the epoch &mdash; while the sender is commuting
     * ({@code office = null}) or alone ({@code n = 0}); the residual lease then
     * simply runs out within one lease (SC-005).
     *
     * @param senderId the heartbeating colleague (JWT {@code sub})
     * @param office   the sender's active office, or {@code null} while commuting
     * @param now      the server instant stamping the heartbeat
     * @return the server-authored lease segment, or empty if none applies
     */
    public Optional<CoopSegmentMessage.Segment> heartbeatSegment(String senderId, String office, Instant now) {
        if (office == null) {
            epochs.remove(senderId); // commuting: bonus suspended, epoch cleared
            return Optional.empty();
        }
        int n = countVisibleColleagues(senderId, office);
        if (n == 0) {
            epochs.remove(senderId); // alone: no segment; residual lease runs out (SC-005)
            return Optional.empty();
        }
        double mult = multiplier(n);
        String from = epochFrom(senderId, mult, now);
        String until = now.plusSeconds(coop.leaseSeconds()).toString();
        return Optional.of(new CoopSegmentMessage.Segment(from, until, mult));
    }

    /**
     * After a crowd change in {@code office} (a colleague joined, left, hid, or
     * revoked consent), return the recomputed {@code coop.segment} pushes for
     * every other LIVE colleague in that office (SC-006 proactive downgrade).
     * Each push carries a fresh {@code from = now} and the recipient's
     * recomputed, capped multiplier; a recipient whose multiplier is unchanged
     * yields no push. {@code excludeId} is the colleague whose change triggered
     * the recompute (their own bonus is unaffected by their visibility/presence
     * flip, so they are not recomputed here). A {@code null} office yields no
     * pushes.
     *
     * <p>Recipients are <b>not</b> filtered by their own visibility: a hidden
     * colleague still receives their own bonus segments (contracts &sect;2 &mdash;
     * hiding gates being seen/counted, not receiving). Only the colleagues
     * <i>counted toward</i> a recipient's bonus are visibility-filtered (inside
     * {@link #visibleLiveColleagues}).
     *
     * @param office    the office whose crowd changed
     * @param now       the server instant stamping the change
     * @param excludeId the colleague whose change triggered the recompute (may be {@code null})
     * @return the per-recipient segment pushes (never {@code null})
     */
    public List<CoopTarget> recomputeOffice(String office, Instant now, String excludeId) {
        List<CoopTarget> targets = new ArrayList<>();
        if (office == null) {
            return targets;
        }
        // Resolve the office's visible-live set ONCE (one lookup per in-office colleague);
        // every recipient's count is then an O(1) set query against it.
        Set<String> visibleLive = visibleLiveColleagues(office);
        for (PresenceRecord record : registry.snapshot()) {
            String colleagueId = record.colleagueId();
            if (colleagueId.equals(excludeId)) {
                continue; // the colleague whose change triggered this is not recomputed
            }
            if (!office.equals(record.office())) {
                continue;
            }
            if (record.status() != PresenceRecord.Status.LIVE) {
                continue;
            }
            // recipient's distinct-visible count, self excluded (O(1) on the precomputed set)
            int n = visibleLive.contains(colleagueId) ? visibleLive.size() - 1 : visibleLive.size();
            try {
                recomputeWithCount(colleagueId, n, now)
                        .ifPresent(segment -> targets.add(new CoopTarget(colleagueId, segment)));
            } catch (RuntimeException e) {
                // advisory: one colleague's recompute must not abort the pass
                log.warn("coop recompute failed for {}", colleagueId, e);
            }
        }
        return targets;
    }

    /**
     * The distinct set of LIVE, visible (consented + visible) colleagueIds in
     * {@code office} &mdash; the population counted toward a bonus. One
     * repository lookup per in-office colleague. A {@code null} office yields
     * the empty set.
     */
    private Set<String> visibleLiveColleagues(String office) {
        if (office == null) {
            return Set.of();
        }
        Set<String> visible = new HashSet<>();
        for (PresenceRecord record : registry.snapshot()) {
            if (!office.equals(record.office())) {
                continue;
            }
            if (record.status() != PresenceRecord.Status.LIVE) {
                continue;
            }
            if (isViewable(record.colleagueId())) {
                visible.add(record.colleagueId());
            }
        }
        return visible;
    }

    /**
     * Resolve the {@code from} for a heartbeat segment <b>atomically</b>: the
     * existing epoch's {@code from} when the multiplier is unchanged (a stable
     * extension), or a fresh {@code now} on the first issuance / a multiplier
     * change (new epoch). {@link ConcurrentHashMap#compute} closes the
     * read-modify-write window so two concurrent heartbeats for one colleague
     * cannot interleave (mirrors {@link PresenceRegistry#expireLiveIfPast}).
     */
    private String epochFrom(String colleagueId, double mult, Instant now) {
        AtomicReference<String> fromRef = new AtomicReference<>();
        epochs.compute(colleagueId, (key, current) -> {
            String from = (current != null && current.multiplier() == mult)
                    ? current.from()           // stable extension: reuse the epoch's from
                    : now.toString();          // new epoch: first issuance or multiplier change
            fromRef.set(from);
            return new Epoch(from, mult);
        });
        return fromRef.get();
    }

    /**
     * Recompute one recipient's segment after a crowd change, <b>atomically</b>:
     * a fresh {@code from = now} with the recomputed, capped multiplier (baseline
     * {@code 1.0} when now alone &rarr; forces an immediate stop via
     * latest-{@code from}-wins, SC-006). Returns empty if the multiplier is
     * unchanged since the recipient's last push (no redundant traffic).
     */
    private Optional<CoopSegmentMessage.Segment> recomputeWithCount(String colleagueId, int n, Instant now) {
        double mult = multiplier(n); // n == 0 → 1.0 (baseline) → immediate stop
        AtomicReference<CoopSegmentMessage.Segment> result = new AtomicReference<>();
        epochs.compute(colleagueId, (key, current) -> {
            // A colleague with no epoch is implicitly at baseline (1.0) — they have
            // never been issued a bonus — so a recomputed baseline is "unchanged".
            double currentEffective = (current != null) ? current.multiplier() : 1.0;
            if (currentEffective == mult) {
                result.set(null); // unchanged (incl. never-had-a-bonus → baseline) → no push
                return current;   // keep the epoch as-is (null stays null)
            }
            String from = now.toString();
            result.set(new CoopSegmentMessage.Segment(
                    from, now.plusSeconds(coop.leaseSeconds()).toString(), mult));
            return new Epoch(from, mult);
        });
        return Optional.ofNullable(result.get());
    }

    /** A colleague is counted toward others' bonus iff their row is consented AND visible (FR-009). */
    private boolean isViewable(String colleagueId) {
        PlayerPresenceEntity row = repository.findById(colleagueId).orElse(null);
        return row != null && row.isConsentGiven() && row.isVisible();
    }

    /** Per-colleague lease epoch: the {@code from} and multiplier last pushed. */
    private record Epoch(String from, double multiplier) {
    }

    /**
     * One recomputed push target: a recipient colleagueId and the
     * server-authored lease segment to push to them on {@code /user/queue/coop}.
     *
     * @param colleagueId the recipient (Spring user name = JWT {@code sub})
     * @param segment     the recomputed, server-authored lease segment
     */
    public record CoopTarget(String colleagueId, CoopSegmentMessage.Segment segment) {
    }
}
