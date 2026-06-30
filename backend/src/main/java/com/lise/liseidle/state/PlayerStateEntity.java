package com.lise.liseidle.state;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * JPA entity representing one player's saved game, keyed by {@code playerId}
 * (the anonymous UUID generated client-side for the MVP, per contracts §2).
 *
 * <p><b>Persistence strategy — JSON column:</b> the {@link GameState} is stored
 * as a serialized JSON string in {@link #stateJson} rather than being flattened
 * into one column per field. This is deliberate (Constitution Principle IV —
 * integrity):
 * <ul>
 *   <li>it preserves the exact "big numbers as strings" wire format losslessly
 *       (no {@code double} precision loss);</li>
 *   <li>it makes nested sets ({@code Set<String>}) and nullable nested objects
 *       ({@code activeBurner}) trivial to round-trip;</li>
 *   <li>it keeps the deterministic monotonic merge (T022) simple — load JSON,
 *       merge, save JSON;</li>
 *   <li>save-migration (T054) operates on the same JSON document.</li>
 * </ul>
 *
 * <p>The {@code playerId} is supplied by the client (NOT auto-generated) and
 * {@code lastSavedAt} is an ISO-8601 server-side timestamp for sync/debugging.
 * With {@code ddl-auto: update} Hibernate 7 creates the {@code player_state}
 * table at startup.
 */
@Entity
@Table(name = "player_state")
public class PlayerStateEntity {

    /** Client-supplied anonymous UUID — the natural key (not auto-generated). */
    @Id
    @Column(name = "player_id")
    private String playerId;

    /** The serialized {@link GameState} JSON document (lossless). */
    @Column(name = "state_json", columnDefinition = "TEXT", nullable = false)
    private String stateJson;

    /** ISO-8601 server timestamp of the last successful save (sync/debugging). */
    @Column(name = "last_saved_at")
    private String lastSavedAt;

    /** Save-format version mirrored from {@link GameState#schemaVersion()}. */
    @Column(name = "schema_version")
    private int schemaVersion;

    /** No-arg constructor required by JPA. */
    public PlayerStateEntity() {
    }

    /**
     * Convenience constructor for a fully-specified entity.
     *
     * @param playerId      the client-supplied player id
     * @param stateJson     the serialized GameState JSON
     * @param lastSavedAt   ISO-8601 timestamp of the save
     * @param schemaVersion the save schema version
     */
    public PlayerStateEntity(String playerId, String stateJson, String lastSavedAt, int schemaVersion) {
        this.playerId = playerId;
        this.stateJson = stateJson;
        this.lastSavedAt = lastSavedAt;
        this.schemaVersion = schemaVersion;
    }

    public String getPlayerId() {
        return playerId;
    }

    public void setPlayerId(String playerId) {
        this.playerId = playerId;
    }

    public String getStateJson() {
        return stateJson;
    }

    public void setStateJson(String stateJson) {
        this.stateJson = stateJson;
    }

    public String getLastSavedAt() {
        return lastSavedAt;
    }

    public void setLastSavedAt(String lastSavedAt) {
        this.lastSavedAt = lastSavedAt;
    }

    public int getSchemaVersion() {
        return schemaVersion;
    }

    public void setSchemaVersion(int schemaVersion) {
        this.schemaVersion = schemaVersion;
    }
}
