package com.lise.liseidle.session;

import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerSettings;
import com.lise.liseidle.state.ResourceSet;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.Set;

import static org.hamcrest.Matchers.hasItems;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T028 — RED integration test for the REST session endpoints (TDD).
 * <p>
 * Covers the contract surface in {@code contracts.md} §2 for
 * {@code POST /api/v1/session} and {@code PUT /api/v1/session/{playerId}/state}.
 * The {@code SessionController} does NOT exist yet (implemented in T023), so
 * these tests fail with {@code 404} (no handler) — the correct TDD RED state
 * per Constitution Principle III. Spring Boot 4.x removed
 * {@code @AutoConfigureMockMvc}, so MockMvc is built manually from the
 * {@link WebApplicationContext} (same pattern as {@code ContentControllerTest}).
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

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(context).build();
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** A minimal GameState with the given loc + owned producers (schema v1). */
    private static GameState stateWith(String loc, Set<String> producers) {
        return new GameState(
                new ResourceSet(loc, "0", "0"),
                producers,
                Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1,
                new PlayerSettings(false, false));
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
                new PlayerSettings(false, false));
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
}
