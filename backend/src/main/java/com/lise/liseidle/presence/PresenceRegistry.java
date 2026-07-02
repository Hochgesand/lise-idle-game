package com.lise.liseidle.presence;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory live presence tier (T033; RED tests in T019). Holds the ephemeral
 * per-colleague {@link PresenceRecord}s keyed by {@code colleagueId} &mdash;
 * the structural key that collapses duplicate sessions to one record
 * (data-model "Duplicate-session collapse"; contracts &sect;3). Live records
 * are ephemeral: after a backend restart every connected client re-heartbeats
 * within one interval and this tier rebuilds itself, while the durable
 * last-seen projection lives in {@link PlayerPresenceEntity}.
 *
 * <p>The bean is a Spring singleton ({@code @Component}); the backing
 * {@link ConcurrentHashMap} is the cache. Upsert is keyed by
 * {@link PresenceRecord#colleagueId()}, so any number of concurrent sessions
 * for one colleague refresh the <i>same</i> record (last write wins) instead of
 * adding a second one &mdash; two sessions, one record, which is what makes a
 * second tab or device render neither a ghost avatar nor a double-counted
 * co-op contribution. The full max-of-heartbeats lease semantics (a colleague
 * goes last-seen only when <i>all</i> sessions stop heartbeating) are layered
 * on top of this single-record-per-colleague foundation by
 * {@code PresenceService} (T054); this registry owns only the keyed store and
 * collapse invariant.
 *
 * <p>Thread-safety: {@link ConcurrentHashMap} makes individual reads/writes
 * atomic; {@link #snapshot()} returns a fresh copy so callers may iterate
 * without {@code ConcurrentModificationException}. Tests construct isolated
 * {@code new PresenceRegistry()} instances for the pure collapse cases.
 */
@Component
public class PresenceRegistry {

    private final ConcurrentHashMap<String, PresenceRecord> recordsByColleagueId = new ConcurrentHashMap<>();

    /**
     * Returns the live record for one colleague, or empty if none.
     *
     * @param colleagueId the social key
     * @return the record, or empty
     */
    public Optional<PresenceRecord> get(String colleagueId) {
        return Optional.ofNullable(recordsByColleagueId.get(colleagueId));
    }

    /**
     * Upsert a colleague's record keyed by {@link PresenceRecord#colleagueId()}
     * &mdash; the structural collapse: any number of sessions refresh the same
     * record (last write wins), so there is never more than one entry per
     * colleague.
     *
     * @param record the (server-stamped) presence record
     */
    public void upsert(PresenceRecord record) {
        recordsByColleagueId.put(record.colleagueId(), record);
    }

    /**
     * Returns a snapshot of all live records (one per colleagueId). The
     * returned collection is a fresh copy; iterating it never throws
     * {@code ConcurrentModificationException}.
     *
     * @return a copy of all records
     */
    public Collection<PresenceRecord> snapshot() {
        return new ArrayList<>(recordsByColleagueId.values());
    }

    /**
     * Drops one colleague's live record (hide / offboard).
     *
     * @param colleagueId the social key
     */
    public void remove(String colleagueId) {
        recordsByColleagueId.remove(colleagueId);
    }

    /**
     * Clears every live record (test support / reset).
     */
    public void clear() {
        recordsByColleagueId.clear();
    }
}
