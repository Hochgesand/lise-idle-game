package com.lise.liseidle.session;

import com.lise.liseidle.presence.PresenceRepository;
import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerStateService;
import com.lise.liseidle.sync.StateMerger;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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
 * <p><b>(002 T031) Principal-derived identity + identity-bound ownership</b>
 * (contracts &sect;2): when a request carries a valid bearer, the save identity is
 * the JWT {@code sub}; a path/body {@code playerId} that does not match it is
 * rejected with {@code 403} {@code player_mismatch}. Once an id has been
 * bootstrapped/written under a matching bearer (a {@code player_presence} row
 * exists for it), <b>all</b> session endpoints for that id REQUIRE a matching
 * bearer &mdash; an unauthenticated request to an identity-bound id is rejected
 * with {@code 401} {@code not_authenticated}. The 001 anonymous UUID path stays
 * open <b>only</b> for ids never claimed by an identity (FR-002). The rule is
 * load-bearing because presence broadcasts every signed-in colleague's
 * {@code sub} as {@code colleagueId}, so without it any colleague could read or
 * inflate a victim's server-side save (FR-004/008/014). It is enforced here in
 * the controller (not in {@code SecurityConfig}, which permits the anonymous
 * surface for never-claimed ids) via a {@link PresenceRepository} lookup.
 *
 * <p>Two endpoints:
 * <ul>
 *   <li>{@code POST /api/v1/session} &mdash; register/load a player. Returns the
 *       persisted {@link GameState} for a client-supplied {@code playerId}, or
 *       {@code 404} (with the error envelope) when no save exists (the client
 *       then starts fresh at zero).</li>
 *   <li>{@code PUT /api/v1/session/{playerId}/state} &mdash; save/sync. Rejects
 *       saves whose {@code schemaVersion} is newer than the server supports
 *       ({@code 409}), otherwise loads any existing server state, performs the
 *       deterministic monotonic merge via {@link StateMerger} (or uses the
 *       incoming state as-is when none exists), persists, and returns the
 *       authoritative merged state.</li>
 * </ul>
 *
 * <p>All big-number fields are strings end-to-end (Constitution &mdash; numeric
 * integrity); the merge and persistence are lossless (Constitution Principle
 * IV &mdash; never silently wipe progress). Constructor-injects
 * {@link PlayerStateService} (persistence), {@link StateMerger} (sync), and
 * {@link PresenceRepository} (the identity-bound lookup). The {@code clientTime}
 * field is accepted for contract fidelity but the merge is driven by the
 * state's own {@code lastAdvancedAt} anchor.
 */
@RestController
@RequestMapping("/api/v1")
public class SessionController {

    /**
     * The save-schema version this server build understands (contracts §2).
     * A save whose {@code schemaVersion} exceeds this is rejected with
     * {@code 409} — the client must update. Bumped {@code 1 → 2} by the 002
     * co-op overlay ({@code coopSegments}/{@code activeOffice}/{@code commute},
     * data-model.md "Save migration") and {@code 2 → 3} by the 003
     * living-campus {@code activeTraining} field (003 data-model §8, T013);
     * the {@code 409} semantics are unchanged.
     */
    private static final int CURRENT_SCHEMA_VERSION = 3;

    private final PlayerStateService playerStateService;
    private final StateMerger stateMerger;
    private final PresenceRepository presenceRepository;

    public SessionController(PlayerStateService playerStateService,
                             StateMerger stateMerger,
                             PresenceRepository presenceRepository) {
        this.playerStateService = playerStateService;
        this.stateMerger = stateMerger;
        this.presenceRepository = presenceRepository;
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
     * envelope) when no save exists. Enforces the (002 T031) principal-derived
     * identity + identity-bound ownership rule before touching persistence.
     *
     * @param request {@code { "playerId": "..." }}
     * @param jwt     the bearer-token principal ({@code null} when anonymous)
     * @return 200 {@code { playerId, state }}, 404 {@code { error: { code, message } }},
     *         403 {@code player_mismatch} (authenticated, sub ≠ playerId), or
     *         401 {@code not_authenticated} (anonymous, identity-bound id)
     */
    @PostMapping("/session")
    public ResponseEntity<?> registerOrLoad(
            @RequestBody SessionRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        String playerId = request.playerId();

        Optional<ResponseEntity<?>> rejected = enforceIdentity(playerId, jwt);
        if (rejected.isPresent()) {
            return rejected.get();
        }

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
     * union), persists, and returns the authoritative merged state. Enforces
     * the (002 T031) principal-derived identity + identity-bound ownership rule
     * before the schema check.
     *
     * @param playerId the path-variable player id
     * @param request  {@code { state, clientTime }}
     * @param jwt      the bearer-token principal ({@code null} when anonymous)
     * @return 200 {@code { state }}, 409 {@code { error: { code, message } }},
     *         403 {@code player_mismatch} (authenticated, sub ≠ playerId), or
     *         401 {@code not_authenticated} (anonymous, identity-bound id)
     */
    @PutMapping("/session/{playerId}/state")
    public ResponseEntity<?> saveState(
            @PathVariable String playerId,
            @RequestBody SaveStateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        Optional<ResponseEntity<?>> rejected = enforceIdentity(playerId, jwt);
        if (rejected.isPresent()) {
            return rejected.get();
        }

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

    // ── (002 T031) Identity enforcement (contracts §2) ───────────────────

    /**
     * Enforces the principal-derived identity and identity-bound ownership
     * rules (contracts &sect;2) on both session endpoints. Returns a non-empty
     * error {@link ResponseEntity} when the request must be rejected, or empty
     * when it may proceed.
     *
     * <p><b>Authenticated</b> (a valid bearer is present, {@code jwt != null}):
     * the save identity is the JWT {@code sub}; a path/body {@code playerId}
     * that does not match it is rejected with {@code 403}
     * {@code player_mismatch}. A matching owner is always allowed &mdash; the
     * owner may bootstrap their own id <i>before</i> a {@code player_presence}
     * row exists (the row is first created by {@code GET /api/v1/me} in T034).
     *
     * <p><b>Anonymous</b> (no bearer, {@code jwt == null}): an id that has
     * already been claimed by an identity (a {@code player_presence} row exists)
     * REQUIRES a matching bearer &rarr; {@code 401} {@code not_authenticated};
     * a never-claimed id keeps the 001 anonymous path (FR-002).
     *
     * @param playerId the path/body player id under check
     * @param jwt      the bearer principal ({@code null} when anonymous)
     * @return the rejection response, or empty to proceed
     */
    private Optional<ResponseEntity<?>> enforceIdentity(String playerId, Jwt jwt) {
        // A null/blank playerId (malformed body, e.g. POST /session `{}`) is a
        // 400 bad_request rather than a crash-to-500: both branches below would
        // otherwise throw (null.equals(sub) / existsById(null)). PUT's
        // @PathVariable is never blank, so this only materializes on POST.
        if (playerId == null || playerId.isBlank()) {
            return Optional.of(ResponseEntity.status(400)
                    .body(new ErrorResponse(new ErrorBody(
                            "bad_request",
                            "A non-empty playerId is required."))));
        }
        if (jwt != null) {
            String sub = jwt.getSubject();
            if (!playerId.equals(sub)) {
                return Optional.of(ResponseEntity.status(403)
                        .body(new ErrorResponse(new ErrorBody(
                                "player_mismatch",
                                "The path/body playerId=" + playerId
                                        + " does not match the authenticated identity"
                                        + " (sub=" + sub + ")"))));
            }
            // Authenticated owner — proceed (the presence row need not exist yet).
            return Optional.empty();
        }

        // Anonymous — the identity-bound ownership rule (contracts §2):
        // an id with a player_presence row is bound to an identity and
        // requires a matching bearer; a never-claimed id stays anonymous.
        if (presenceRepository.existsById(playerId)) {
            return Optional.of(ResponseEntity.status(401)
                    .body(new ErrorResponse(new ErrorBody(
                            "not_authenticated",
                            "playerId=" + playerId + " is bound to an identity; "
                                    + "a matching bearer token is required."))));
        }
        return Optional.empty();
    }
}
