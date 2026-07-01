package com.lise.liseidle.session;

import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerStateService;
import com.lise.liseidle.sync.StateMerger;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * REST session endpoints for player registration, loading, and save/sync
 * (contracts.md §2, base path {@code /api/v1}).
 *
 * <p>Two endpoints:
 * <ul>
 *   <li>{@code POST /api/v1/session} — register/load a player. Returns the
 *       persisted {@link GameState} for an anonymous client-supplied
 *       {@code playerId}, or {@code 404} (with the error envelope) when no
 *       save exists (the client then starts fresh at zero).</li>
 *   <li>{@code PUT /api/v1/session/{playerId}/state} — save/sync. Rejects
 *       saves whose {@code schemaVersion} is newer than the server supports
 *       ({@code 409}), otherwise loads any existing server state, performs the
 *       deterministic monotonic merge via {@link StateMerger} (or uses the
 *       incoming state as-is when none exists), persists, and returns the
 *       authoritative merged state.</li>
 * </ul>
 *
 * <p>All big-number fields are strings end-to-end (Constitution — numeric
 * integrity); the merge and persistence are lossless (Constitution Principle
 * IV — never silently wipe progress). Constructor-injects
 * {@link PlayerStateService} (persistence) and {@link StateMerger} (sync).
 * The {@code clientTime} field is accepted for contract fidelity but the merge
 * is driven by the state's own {@code lastAdvancedAt} anchor.
 */
@RestController
@RequestMapping("/api/v1")
public class SessionController {

    /**
     * The save-schema version this server build understands (contracts §2).
     * A save whose {@code schemaVersion} exceeds this is rejected with
     * {@code 409} — the client must update.
     */
    private static final int CURRENT_SCHEMA_VERSION = 1;

    private final PlayerStateService playerStateService;
    private final StateMerger stateMerger;

    public SessionController(PlayerStateService playerStateService, StateMerger stateMerger) {
        this.playerStateService = playerStateService;
        this.stateMerger = stateMerger;
    }

    // ── Request / response DTOs (records; Jackson 3 serializes/deserializes
    //    via the canonical constructor + record accessors) ─────────────────

    /** {@code POST /api/v1/session} request body. */
    record SessionRequest(String playerId) {
    }

    /** {@code POST /api/v1/session} 200 response body. */
    record SessionResponse(String playerId, GameState state) {
    }

    /** {@code PUT .../state} request body. */
    record SaveStateRequest(GameState state, String clientTime) {
    }

    /** {@code PUT .../state} 200 response body. */
    record SaveStateResponse(GameState state) {
    }

    /** Standard error envelope (contracts §2 "Error envelope"). */
    record ErrorResponse(ErrorBody error) {
    }

    record ErrorBody(String code, String message) {
    }

    // ── Endpoints ────────────────────────────────────────────────────────

    /**
     * Register / load a player. Returns the saved state, or 404 (error
     * envelope) when no save exists.
     *
     * @param request {@code { "playerId": "..." }}
     * @return 200 {@code { playerId, state }} or 404 {@code { error: { code, message } }}
     */
    @PostMapping("/session")
    public ResponseEntity<?> registerOrLoad(@RequestBody SessionRequest request) {
        String playerId = request.playerId();
        Optional<GameState> loaded = playerStateService.loadState(playerId);
        if (loaded.isEmpty()) {
            return ResponseEntity.status(404)
                    .body(new ErrorResponse(new ErrorBody(
                            "no_save",
                            "No saved game exists for playerId=" + playerId)));
        }
        return ResponseEntity.ok(new SessionResponse(playerId, loaded.get()));
    }

    /**
     * Save / sync a player's state. Rejects a save whose {@code schemaVersion}
     * is newer than {@link #CURRENT_SCHEMA_VERSION} with 409. Otherwise merges
     * the incoming client state with any existing server state (monotonic max +
     * union), persists, and returns the authoritative merged state.
     *
     * @param playerId the path-variable player id
     * @param request  {@code { state, clientTime }}
     * @return 200 {@code { state }} or 409 {@code { error: { code, message } }}
     */
    @PutMapping("/session/{playerId}/state")
    public ResponseEntity<?> saveState(
            @PathVariable String playerId,
            @RequestBody SaveStateRequest request) {
        GameState clientState = request.state();

        // 409: client save format is newer than this server build understands.
        if (clientState.schemaVersion() > CURRENT_SCHEMA_VERSION) {
            return ResponseEntity.status(409)
                    .body(new ErrorResponse(new ErrorBody(
                            "schema_too_new",
                            "Save schemaVersion=" + clientState.schemaVersion()
                                    + " is newer than server CURRENT_SCHEMA_VERSION="
                                    + CURRENT_SCHEMA_VERSION + "; client must update")));
        }

        // Merge with any existing server state; the incoming state is
        // authoritative on its own when none exists (first save).
        GameState authoritative = playerStateService.loadState(playerId)
                .map(server -> stateMerger.merge(clientState, server))
                .orElse(clientState);

        GameState saved = playerStateService.saveState(playerId, authoritative);
        return ResponseEntity.ok(new SaveStateResponse(saved));
    }
}
