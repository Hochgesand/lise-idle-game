package com.lise.liseidle.state;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Spring Data JPA repository for {@link PlayerStateEntity}, keyed by the
 * client-supplied {@code playerId} ({@code String}).
 *
 * <p>Inherits {@code findById}, {@code save}, {@code deleteById},
 * {@code existsById}, {@code findAll}, etc. from {@link JpaRepository}. No
 * custom queries are needed for the MVP — the session endpoints (T023) load,
 * upsert, and delete single players by id.
 *
 * <p>{@code existsByPlayerId} is provided as a readable derived query alias for
 * the inherited {@code existsById}, for clarity at call sites.
 */
@Repository
public interface PlayerStateRepository extends JpaRepository<PlayerStateEntity, String> {

    /**
     * @param playerId the client-supplied player id
     * @return {@code true} if a saved game exists for this player
     */
    boolean existsByPlayerId(String playerId);
}
