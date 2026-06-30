package com.lise.liseidle.content;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T010 — RED integration test for {@code GET /api/v1/content} (TDD).
 * <p>
 * References the contract surface defined in
 * {@code specs/001-dev-idle-game/contracts/contracts.md} §2. The
 * {@code ContentController} and the {@code /api/v1/content} endpoint do NOT
 * exist yet (implemented in T019/T020), so this test is expected to fail with
 * a {@code 404} (endpoint missing) — the correct TDD RED state per
 * Constitution Principle III. The controller must NOT be implemented here.
 * <p>
 * Note: MockMvc is built manually from the {@link WebApplicationContext}
 * because Spring Boot 4.x removed {@code @AutoConfigureMockMvc} in favor of
 * explicit setup.
 */
@SpringBootTest
class ContentControllerTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        this.mockMvc = MockMvcBuilders.webAppContextSetup(context).build();
    }

    /**
     * The endpoint must return 200 and the full content envelope structure:
     * {@code schemaVersion}, {@code contentVersion}, and the five content
     * arrays (producers, upgrades, trainings, milestones, burners).
     */
    @Test
    void getContent_returns200WithEnvelopeStructure() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.schemaVersion").exists())
            .andExpect(jsonPath("$.contentVersion").exists())
            .andExpect(jsonPath("$.producers").isArray())
            .andExpect(jsonPath("$.upgrades").isArray())
            .andExpect(jsonPath("$.trainings").isArray())
            .andExpect(jsonPath("$.milestones").isArray())
            .andExpect(jsonPath("$.burners").isArray());
    }

    /**
     * Even with empty placeholder arrays (current state — T006), the
     * {@code producers} field must be an array. When content is seeded
     * (T037/T043/T050), each producer must have {@code id} (string) and
     * {@code baseRate} (string — big number, never {@code double}). This
     * asserts the array contract today; shape assertions are tightened after
     * seeding.
     */
    @Test
    void getContent_producersAreArray_whenEmpty() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.producers").isArray());
    }

    /**
     * The response body must be served as {@code application/json} (contract
     * §2 — "All bodies are JSON").
     */
    @Test
    void getContent_isJsonContentType() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON));
    }
}
