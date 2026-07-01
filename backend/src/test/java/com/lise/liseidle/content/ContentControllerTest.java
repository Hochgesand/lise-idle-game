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
            .andExpect(jsonPath("$.schemaVersion").value(1))
            .andExpect(jsonPath("$.contentVersion").value("1.2.0"))
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

    /**
     * Value-level assertions proving the seeded content deserializes with
     * correct ids and field values — not just that the arrays exist. Guards
     * against silent content-shape drift (Constitution Principle II).
     */
    @Test
    void getContent_returnsSeededProducersWithCorrectValues() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.producers.length()").value(3))
            .andExpect(jsonPath("$.producers[0].id").value("manual_typing"))
            .andExpect(jsonPath("$.producers[0].baseRate").value("1"))
            .andExpect(jsonPath("$.producers[1].id").value("stack_overflow"))
            .andExpect(jsonPath("$.producers[2].id").value("copilot"));
    }

    @Test
    void getContent_returnsSeededUpgradesWithCorrectValues() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.upgrades.length()").value(2))
            .andExpect(jsonPath("$.upgrades[0].id").value("better_keyboards"))
            .andExpect(jsonPath("$.upgrades[0].effect.type").value("globalMultiplier"))
            .andExpect(jsonPath("$.upgrades[1].id").value("mechanical_switches"));
    }

    @Test
    void getContent_returnsSeededTrainingsWithCorrectValues() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.trainings.length()").value(2))
            .andExpect(jsonPath("$.trainings[0].id").value("iso_9001_course"))
            .andExpect(jsonPath("$.trainings[0].permanentMultiplier").value(2.0))
            .andExpect(jsonPath("$.trainings[1].id").value("agile_master"));
    }

    @Test
    void getContent_returnsSeededMilestonesWithCorrectValues() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.milestones.length()").value(3))
            .andExpect(jsonPath("$.milestones[0].id").value("iso_9001_certified"))
            .andExpect(jsonPath("$.milestones[0].reward.type").value("grantResource"))
            .andExpect(jsonPath("$.milestones[1].id").value("ms_gold_partner"))
            .andExpect(jsonPath("$.milestones[2].id").value("ai_design_sprint_facilitator"));
    }

    @Test
    void getContent_returnsSeededBurnersWithCorrectValues() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.burners.length()").value(1))
            .andExpect(jsonPath("$.burners[0].id").value("gpu_cluster"))
            .andExpect(jsonPath("$.burners[0].fuelCostToActivate").value("100"))
            .andExpect(jsonPath("$.burners[0].burnRate").value("10"))
            .andExpect(jsonPath("$.burners[0].productionMultiplier").value(3.0));
    }
}
