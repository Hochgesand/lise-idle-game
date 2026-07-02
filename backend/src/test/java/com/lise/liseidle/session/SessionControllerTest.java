package com.lise.liseidle.session;

import com.lise.liseidle.presence.PlayerPresenceEntity;
import com.lise.liseidle.presence.PresenceRepository;
import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerSettings;
import com.lise.liseidle.state.PlayerStateEntity;
import com.lise.liseidle.state.PlayerStateRepository;
import com.lise.liseidle.state.ResourceSet;
import com.lise.liseidle.state.SampleStates;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItems;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration test for the REST session endpoints (TDD; T023 RED, T031
 * extends with the principal-derived identity + identity-bound ownership
 * rules).
 * <p>
 * Covers the contract surface in {@code contracts.md} §2 for
 * {@code POST /api/v1/session} and {@code PUT /api/v1/session/{playerId}/state}:
 * the 001 load/merge/save round-trip, the {@code 409 schema_too_new} guard, the
 * v1→v2 bootstrap null-leak leniency, and the (002 T031) identity rules —
 * {@code 403 player_mismatch} for an authenticated request whose body/path
 * {@code playerId} does not match the JWT {@code sub}, {@code 401
 * not_authenticated} for a tokenless request to an identity-bound id (a
 * {@code player_presence} row exists), and the open 001 anonymous path for
 * never-claimed ids.
 *
 * <p>MockMvc is built with {@code .apply(springSecurity())} so the real Spring
 * Security filter chain runs (the identity rules are enforced by
 * {@code SessionController} reading the resolved {@link
 * org.springframework.security.oauth2.jwt.Jwt} principal, which only the
 * security configurer populates). The (002 T031) tests use spring-security-test
 * MOCK JWTs ({@link jwt}) — no network to Keycloak.
 *
 * <p>Test isolation: each test uses a unique {@code playerId} (no
 * {@code @DirtiesContext}), matching the {@code PlayerStateRepositoryTest}
 * pattern. Request bodies are built as plain JSON via Jackson so the test
 * asserts the HTTP contract, not the controller's Java types.
 */
@SpringBootTest
class SessionControllerTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PlayerStateRepository playerStateRepository;

    @Autowired
    private PresenceRepository presenceRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        // springSecurity() wires the real SecurityConfig filter chain so the
        // (002 T031) identity rules see the resolved Jwt principal and the
        // mock-JWT post-processor (jwt()) installs an authentication.
        this.mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** A minimal GameState with the given loc + owned producers (schema v1). */
    private static GameState stateWith(String loc, Set<String> producers) {
        return new GameState(
                new ResourceSet(loc, "0", "0"),
                producers,
                Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1,
                new PlayerSettings(false, false),
                /* coopSegments */ List.of(),
                /* activeOffice */ "office_1",
                /* commute */ null);
    }

    /** Serialize a POST /api/v1/session request body. */
    private String sessionBody(String playerId) throws Exception {
        return objectMapper.writeValueAsString(Map.of("playerId", playerId));
    }

    /** Serialize a PUT /api/v1/session/{id}/state request body. */
    private String putBody(GameState state, String clientTime) throws Exception {
        return objectMapper.writeValueAsString(Map.of("state", state, "clientTime", clientTime));
    }

    // ── Tests ────────────────────────────────────────────────────────────

    /** 1. POST /api/v1/session for a player with NO save → 404 + error envelope. */
    @Test
    void postSession_returns404WithErrorEnvelope_whenNoSaveExists() throws Exception {
        mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("no-save-player")))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").exists());
    }

    /** 2. POST /api/v1/session after a save → 200 with playerId + state round-trip. */
    @Test
    void postSession_returns200WithState_afterSaveViaPut() throws Exception {
        GameState state = stateWith("1000", Set.of("manual_typing"));
        mockMvc.perform(put("/api/v1/session/load-after-save-player/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(state, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("load-after-save-player")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.playerId").value("load-after-save-player"))
            .andExpect(jsonPath("$.state.resources.loc").value("1000"));
    }

    /** 3. PUT a valid new state (no server save) → 200, persisted (confirmed by POST). */
    @Test
    void putState_returns200AndPersists_whenNoExistingServerSave() throws Exception {
        GameState state = stateWith("500", Set.of("copilot"));
        mockMvc.perform(put("/api/v1/session/new-save-player/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(state, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state.resources.loc").value("500"));

        // Persistence confirmed via a subsequent POST.
        mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("new-save-player")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state.resources.loc").value("500"));
    }

    /** 4. PUT with schemaVersion newer than the server supports → 409 + error envelope. */
    @Test
    void putState_returns409_whenSchemaVersionTooNew() throws Exception {
        GameState futureState = new GameState(
                new ResourceSet("1", "0", "0"),
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 999,
                new PlayerSettings(false, false),
                /* coopSegments */ List.of(),
                /* activeOffice */ "office_1",
                /* commute */ null);
        mockMvc.perform(put("/api/v1/session/future-player/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(futureState, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").exists());
    }

    /**
     * 5. PUT with an existing server save then a different client state → the
     * response reflects the deterministic monotonic merge (max resources, union
     * ownership sets). Proves StateMerger is wired into the PUT handler.
     */
    @Test
    void putState_mergesMonotonically_whenExistingServerSave() throws Exception {
        // Server state: loc=100, producers={manual_typing}.
        GameState serverState = stateWith("100", Set.of("manual_typing"));
        mockMvc.perform(put("/api/v1/session/merge-player/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(serverState, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isOk());

        // Client state: loc=50, producers={stack_overflow}.
        GameState clientState = stateWith("50", Set.of("stack_overflow"));
        mockMvc.perform(put("/api/v1/session/merge-player/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(clientState, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isOk())
            // max(100, 50) = 100
            .andExpect(jsonPath("$.state.resources.loc").value("100"))
            // union of {manual_typing} and {stack_overflow}
            .andExpect(jsonPath("$.state.ownedProducers", hasItems("manual_typing", "stack_overflow")));
    }

    /**
     * 6. Full value-identity round-trip (T028): PUT a fully-populated state to a
     * FRESH player (no server save, so no merge happens) → POST returns that
     * state IDENTICALLY across every field. Proves the save/load path is
     * lossless (Constitution Principle IV) and that big-number values beyond
     * {@code MAX_SAFE_INTEGER} survive the JSON serialize → persist →
     * deserialize hop with no {@code double}-precision loss (numeric
     * integrity constraint). Merge semantics are already isolated by test 5.
     */
    @Test
    void putThenPost_returnsIdenticalState_forFullyPopulatedSave() throws Exception {
        GameState original = SampleStates.populated();
        String playerId = "identity-roundtrip-player";

        // First PUT on a fresh player stores the state as-is (no merge).
        mockMvc.perform(put("/api/v1/session/" + playerId + "/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(original, original.lastAdvancedAt())))
            .andExpect(status().isOk());

        // POST reloads the persisted state from the DB.
        MvcResult result = mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody(playerId)))
            .andExpect(status().isOk())
            .andReturn();

        JsonNode stateNode = objectMapper.readTree(result.getResponse().getContentAsString()).get("state");
        GameState returned = objectMapper.treeToValue(stateNode, GameState.class);

        // Strongest correct assertion: recursive comparison handles the
        // concrete Set type difference (Jackson deserializes to a HashSet,
        // the fixture uses Set.of) and is order-independent for the sets.
        assertThat(returned).usingRecursiveComparison().isEqualTo(original);

        // Explicit spot-checks on the highest-risk fields (big-number precision,
        // nested burner object, settings) — redundant with the recursive
        // compare above but documents intent for reviewers.
        assertThat(returned.resources().loc()).isEqualTo("9007199254740993");
        assertThat(returned.ownedProducers()).containsExactlyInAnyOrder("manual_typing", "copilot");
        assertThat(returned.activeBurner()).isNotNull();
        assertThat(returned.activeBurner().definitionId()).isEqualTo("burner1");
        assertThat(returned.activeBurner().fuelRemaining()).isEqualTo("100");
        assertThat(returned.settings().muted()).isTrue();
        assertThat(returned.settings().reducedMotion()).isFalse();
        assertThat(returned.schemaVersion()).isEqualTo(1);
    }

    /**
     * 7. (002 T017) Bootstrap null-leak (the PlayerStateService half of the
     * leniency rule, data-model "Save migration"): a stored v1-shaped
     * {@code player_state} row — JSON with NO {@code coopSegments}/
     * {@code activeOffice}/{@code commute} fields, exactly what a pre-002 build
     * persisted — loaded via {@code POST /api/v1/session} must respond with the
     * normalized defaults ({@code []} / {@code "office_1"} / {@code null}),
     * never {@code null} fields that would NPE a v2 client or the
     * segment-union merge. The v1 scalar fields survive untouched.
     */
    @Test
    void postSession_normalizesNullOverlayFields_forV1ShapedRow() throws Exception {
        // A raw v1 JSON document — the three (002) overlay fields absent.
        String v1Json = """
                {
                  "resources": {"loc": "777", "cash": "0", "aiTokens": "0"},
                  "ownedProducers": [],
                  "ownedUpgrades": [],
                  "ownedTrainings": [],
                  "activeBurner": null,
                  "earnedMilestones": [],
                  "lastAdvancedAt": "2026-06-30T12:00:00.000Z",
                  "schemaVersion": 1,
                  "settings": {"reducedMotion": false, "muted": false}
                }
                """;
        // Persist it directly as a v1-shaped row (bypassing GameState round-trip).
        playerStateRepository.save(new PlayerStateEntity(
                "v1-bootstrap-player", v1Json, "2026-06-30T12:00:00.000Z", 1));

        MvcResult result = mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("v1-bootstrap-player")))
            .andExpect(status().isOk())
            .andReturn();

        JsonNode stateNode = objectMapper.readTree(result.getResponse().getContentAsString()).get("state");
        GameState returned = objectMapper.treeToValue(stateNode, GameState.class);

        // The (002) overlay fields are normalized — never null leaks.
        assertThat(returned.getCoopSegments()).isEmpty();
        assertThat(returned.getActiveOffice()).isEqualTo("office_1");
        assertThat(returned.getCommute()).isNull();
        // The v1 scalar content survives untouched (leniency, not wipe).
        assertThat(returned.resources().loc()).isEqualTo("777");
        assertThat(returned.schemaVersion()).isEqualTo(1);
    }

    // ── (002 T031) Principal-derived identity + identity-bound ownership ─

    /**
     * 8. (002 T031) Authenticated {@code POST /api/v1/session} whose body
     * {@code playerId} does NOT match the JWT {@code sub} → 403
     * {@code player_mismatch}. Proves the controller derives the save identity
     * from the bearer and rejects a cross-identity body (contracts §2).
     */
    @Test
    void postSession_returns403PlayerMismatch_whenBodyPlayerIdDoesNotMatchSub() throws Exception {
        mockMvc.perform(post("/api/v1/session")
                .with(jwt().jwt(j -> j.subject("alice-uuid")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("not-alice")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("player_mismatch"));
    }

    /**
     * 9. (002 T031) Authenticated {@code PUT /api/v1/session/{id}/state} whose
     * path {@code playerId} does NOT match the JWT {@code sub} → 403
     * {@code player_mismatch}. Same rule as the POST, applied to the path
     * variable (the identity the client MUST adopt after sign-in).
     */
    @Test
    void putState_returns403PlayerMismatch_whenPathPlayerIdDoesNotMatchSub() throws Exception {
        GameState state = stateWith("1", Set.of());
        mockMvc.perform(put("/api/v1/session/not-alice/state")
                .with(jwt().jwt(j -> j.subject("alice-uuid")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(state, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("player_mismatch"));
    }

    /**
     * 10. (002 T031) Authenticated {@code POST /api/v1/session} whose body
     * {@code playerId} EQUALS the JWT {@code sub} → the owner is allowed (here
     * 404 no_save, since no server save exists). Proves the matching owner path
     * proceeds even before a {@code player_presence} row exists (the row is
     * created by {@code GET /api/v1/me} in T034, not by the session endpoint).
     */
    @Test
    void postSession_allowsOwner_whenBodyPlayerIdEqualsSub() throws Exception {
        mockMvc.perform(post("/api/v1/session")
                .with(jwt().jwt(j -> j.subject("owner-uuid")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("owner-uuid")))
            .andExpect(status().isNotFound());
    }

    /**
     * 11. (002 T031) Identity-bound ownership rule: a tokenless
     * {@code POST /api/v1/session} for an id that HAS a {@code player_presence}
     * row → 401 {@code not_authenticated}. The presence row simulates an id
     * claimed by a signed-in identity; once claimed it requires a matching
     * bearer (contracts §2 binding rule — protects a broadcast {@code sub} from
     * anonymous reads/writes).
     */
    @Test
    void postSession_returns401NotAuthenticated_forIdentityBoundIdWithoutToken() throws Exception {
        presenceRepository.save(new PlayerPresenceEntity("bound-post-uuid"));
        mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody("bound-post-uuid")))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("not_authenticated"));
    }

    /**
     * 12. (002 T031) Same identity-bound rule on the PUT path: a tokenless
     * {@code PUT /api/v1/session/{id}/state} for an identity-bound id → 401
     * {@code not_authenticated}. Without this, a colleague could PUT an
     * inflated state that the monotonic max-merge would fold into the victim's
     * real save (FR-014).
     */
    @Test
    void putState_returns401NotAuthenticated_forIdentityBoundIdWithoutToken() throws Exception {
        presenceRepository.save(new PlayerPresenceEntity("bound-put-uuid"));
        GameState state = stateWith("1", Set.of());
        mockMvc.perform(put("/api/v1/session/bound-put-uuid/state")
                .contentType(MediaType.APPLICATION_JSON)
                .content(putBody(state, "2026-06-30T12:00:00.000Z")))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("not_authenticated"));
    }

    /**
     * 13. (002 T031) Never-claimed anonymous UUID stays open (FR-002): a
     * tokenless {@code POST /api/v1/session} for an id with NO
     * {@code player_presence} row keeps the 001 anonymous path (here 404
     * no_save, proving the request reached the handler, not a security 401/403).
     */
    @Test
    void postSession_staysOpen_forNeverClaimedAnonymousUuidWithoutToken() throws Exception {
        String anonId = "anon-never-claimed-" + UUID.randomUUID();
        mockMvc.perform(post("/api/v1/session")
                .contentType(MediaType.APPLICATION_JSON)
                .content(sessionBody(anonId)))
            .andExpect(status().isNotFound());
    }
}
