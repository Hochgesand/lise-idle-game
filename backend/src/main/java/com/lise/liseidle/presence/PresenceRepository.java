package com.lise.liseidle.presence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Minimal {@link JpaRepository} for {@link PlayerPresenceEntity}, bootstrapped
 * in T031 to back the contracts &sect;2 identity-bound ownership rule in
 * {@code com.lise.liseidle.session.SessionController}: the inherited
 * {@link #existsById} lookup answers "has this id been claimed by an identity?".
 *
 * <p>The full presence package (T033) builds the in-memory registry and the
 * remaining query methods on top of this entity and repository; T031 adds no
 * custom query so T033 owns that surface without conflict.
 */
@Repository
public interface PresenceRepository extends JpaRepository<PlayerPresenceEntity, String> {

    /**
     * All durable rows whose {@code lastSeenAt} is older than {@code cutoff}
     * (lexicographic ISO-8601 comparison, approximately chronological). Used by
     * the daily retention sweep (T085) as a <b>coarse pre-filter</b> to offboard
     * colleagues who have aged out of the {@code lastSeenRetentionDays} window;
     * {@code PresenceService#sweepRetainedOut} re-checks each candidate by
     * parsing the {@link Instant} precisely, because variable-width fractional
     * seconds make the string comparison inexact at the sub-second boundary.
     * Rows with a {@code null} {@code lastSeenAt} (never seen) are excluded by
     * SQL NULL semantics &mdash; they have not aged out.
     *
     * @param cutoff the retention cutoff as an ISO-8601 instant string
     * @return every row whose string {@code lastSeenAt} sorts before the cutoff
     */
    java.util.List<PlayerPresenceEntity> findByLastSeenAtLessThan(String cutoff);
}
