package com.lise.liseidle.state;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Optional;

/**
 * Bridge between the {@link GameState} DTO and the persisted
 * {@link PlayerStateEntity}.
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>{@link #loadState(String)} — find a saved game and deserialize its
 *       JSON column back into a typed {@link GameState} (the same record shape
 *       proven by the T011 round-trip test); returns empty when no save
 *       exists.</li>
 *   <li>{@link #saveState(String, GameState)} — serialize the state to JSON,
 *       upsert the entity (create or update), stamp {@code lastSavedAt} with
 *       the server wall-clock, and return the saved state.</li>
 * </ul>
 *
 * <p><b>Wall-clock is allowed here:</b> this is server-side persistence and
 * sync, not the pure client-side simulation. The pure {@code advance(state,
 * dt)} function (Constitution Principle I) is the only thing that must be
 * deterministic and free of {@code Date.now()}; using {@link Instant#now()}
 * here to stamp a save timestamp is correct and expected.
 *
 * <p><b>Corruption policy (Constitution IV — never silently wipe progress):</b>
 * a row whose JSON cannot be deserialized is treated as a hard error — it is
 * logged and rethrown as an {@link IllegalStateException} with a clear message
 * rather than being silently overwritten. The caller (a sync/merge step or
 * REST endpoint) decides how to surface it; this service never destroys the
 * persisted document on its own.
 */
@Service
public class PlayerStateService {

    private static final Logger log = LoggerFactory.getLogger(PlayerStateService.class);

    private final PlayerStateRepository repository;
    private final ObjectMapper objectMapper;

    public PlayerStateService(PlayerStateRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    /**
     * Loads a player's saved {@link GameState}, deserializing the JSON column.
     *
     * @param playerId the client-supplied player id
     * @return the deserialized state, or empty if no save exists
     * @throws IllegalStateException if a save exists but its JSON is corrupt
     */
    public Optional<GameState> loadState(String playerId) {
        return repository.findById(playerId).map(entity -> {
            try {
                return objectMapper.readValue(entity.getStateJson(), GameState.class);
            } catch (JacksonException e) {
                log.error("Corrupt save JSON for playerId={} — refusing to wipe; "
                        + "returning error to caller", playerId, e);
                throw new IllegalStateException(
                        "Failed to deserialize saved state for playerId=" + playerId
                                + " (corrupt row in player_state) — the save was NOT modified", e);
            }
        });
    }

    /**
     * Serializes and upserts a player's {@link GameState}.
     *
     * <p>Creates a new {@link PlayerStateEntity} if none exists for the player,
     * otherwise updates the existing row in place (upsert). {@code lastSavedAt}
     * is stamped with the current server time.
     *
     * @param playerId the client-supplied player id
     * @param state    the state to persist
     * @return the same state that was persisted
     */
    public GameState saveState(String playerId, GameState state) {
        String json;
        try {
            json = objectMapper.writeValueAsString(state);
        } catch (JacksonException e) {
            throw new IllegalStateException(
                    "Failed to serialize GameState for playerId=" + playerId, e);
        }

        PlayerStateEntity entity = repository.findById(playerId)
                .orElseGet(PlayerStateEntity::new);
        entity.setPlayerId(playerId);
        entity.setStateJson(json);
        entity.setLastSavedAt(Instant.now().toString());
        entity.setSchemaVersion(state.schemaVersion());
        repository.save(entity);

        return state;
    }
}
