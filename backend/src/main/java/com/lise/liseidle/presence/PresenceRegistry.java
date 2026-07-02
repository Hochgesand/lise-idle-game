package com.lise.liseidle.presence;

import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * In-memory live presence tier (T033; RED tests in T019). Holds the ephemeral
 * per-colleague {@link PresenceRecord}s keyed by {@code colleagueId} &mdash;
 * the structural key that collapses duplicate sessions to one record
 * (data-model "Duplicate-session collapse"; contracts &sect;3). Live records
 * are ephemeral: after a backend restart every connected client re-heartbeats
 * within one interval and this tier rebuilds itself, while the durable
 * last-seen projection lives in {@link PlayerPresenceEntity}.
 *
 * <p><b>STUB (T019 RED).</b> The methods are intentionally empty so the T019
 * collapse tests fail; T033 replaces the body with a
 * {@code ConcurrentHashMap<String, PresenceRecord>} cached-singleton
 * implementation (upsert keyed by {@code colleagueId}). The bean is a Spring
 * singleton ({@code @Component}); tests construct isolated
 * {@code new PresenceRegistry()} instances for the pure collapse cases.
 */
@Component
public class PresenceRegistry {

    /**
     * Returns the live record for one colleague, or empty if none.
     *
     * @param colleagueId the social key
     * @return the record, or empty
     */
    public Optional<PresenceRecord> get(String colleagueId) {
        // STUB — T033 implements the colleagueId-keyed lookup.
        return Optional.empty();
    }

    /**
     * Upsert a colleague's record keyed by {@code record.colleagueId()} &mdash;
     * the structural collapse: any number of sessions refresh the same record.
     *
     * @param record the (server-stamped) presence record
     */
    public void upsert(PresenceRecord record) {
        // STUB — T033 implements the colleagueId-keyed upsert.
    }

    /**
     * Returns a snapshot of all live records (one per colleagueId).
     *
     * @return all records
     */
    public Collection<PresenceRecord> snapshot() {
        // STUB — T033 returns the map values.
        return List.of();
    }

    /**
     * Drops one colleague's live record (hide / offboard).
     *
     * @param colleagueId the social key
     */
    public void remove(String colleagueId) {
        // STUB — T033.
    }

    /**
     * Clears every live record (test support / reset).
     */
    public void clear() {
        // STUB — T033.
    }
}
