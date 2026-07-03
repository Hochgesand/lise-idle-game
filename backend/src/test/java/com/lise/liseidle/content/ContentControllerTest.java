package com.lise.liseidle.content;

import com.lise.liseidle.content.ContentLoader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
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

    @Autowired
    private ObjectMapper objectMapper;

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
            .andExpect(jsonPath("$.contentVersion").value("1.5.0"))
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
            .andExpect(jsonPath("$.milestones.length()").value(4))
            .andExpect(jsonPath("$.milestones[0].id").value("iso_9001_certified"))
            .andExpect(jsonPath("$.milestones[0].reward.type").value("grantResource"))
            // office_2_unlock gates the T082 switch-office affordance (001 FR-014)
            .andExpect(jsonPath("$.milestones[1].id").value("office_2_unlock"))
            .andExpect(jsonPath("$.milestones[1].requirement.threshold").value("50000"))
            .andExpect(jsonPath("$.milestones[2].id").value("ms_gold_partner"))
            .andExpect(jsonPath("$.milestones[3].id").value("ai_design_sprint_facilitator"));
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

    /**
     * T018 — the content envelope carries the additive sixth {@code coop}
     * block (data-model.md "CoopConfig"; contracts §2) alongside the five
     * 001 arrays, with {@code schemaVersion} and {@code contentVersion}
     * intact. {@code contentVersion} bumps to {@code "1.4.0"} as the coop
     * block is additive new content (FR-015). RED until {@code ContentCatalog}
     * serves {@code coop} (T027).
     */
    @Test
    void getContent_carriesAdditiveSixthCoopBlockAlongsideFiveArrays() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            // five 001 arrays + the two scalar envelope fields stay intact
            .andExpect(jsonPath("$.schemaVersion").value(1))
            .andExpect(jsonPath("$.contentVersion").value("1.5.0"))
            .andExpect(jsonPath("$.producers").isArray())
            .andExpect(jsonPath("$.upgrades").isArray())
            .andExpect(jsonPath("$.trainings").isArray())
            .andExpect(jsonPath("$.milestones").isArray())
            .andExpect(jsonPath("$.burners").isArray())
            // additive sixth coop tuning block (FR-015)
            .andExpect(jsonPath("$.coop.perColleagueMultiplier").value(0.10))
            .andExpect(jsonPath("$.coop.maxMultiplier").value(1.5))
            .andExpect(jsonPath("$.coop.leaseSeconds").value(60))
            .andExpect(jsonPath("$.coop.heartbeatSeconds").value(20))
            .andExpect(jsonPath("$.coop.commuteSeconds").value(30))
            .andExpect(jsonPath("$.coop.lastSeenRetentionDays").value(14));
    }

    /**
     * T018 — {@link ContentLoader} fails fast ({@code @PostConstruct}) on a
     * malformed {@code coop.json}: the game must never start with half-parsed
     * co-op tuning data (Constitution Principle II). A syntactically broken
     * stream must surface as an {@link IllegalStateException}. RED until
     * {@code loadCoop} parses + validates (T027).
     */
    @Test
    void loadCoop_failsFast_whenCoopJsonMalformed() {
        ContentLoader loader = new ContentLoader(objectMapper);
        InputStream malformed =
                new ByteArrayInputStream("{not valid json".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadCoop(malformed));
    }

    /**
     * T027 — every required {@code coop} field must be present; a missing field
     * is malformed and fails fast. Guards the narrow gap where a missing
     * {@code perColleagueMultiplier} would otherwise default to {@code 0.0}
     * (which passes the {@code >= 0} bound) and silently boot the game with the
     * co-op bonus disabled (cubic P3).
     */
    @Test
    void loadCoop_failsFast_whenRequiredFieldMissing() {
        ContentLoader loader = new ContentLoader(objectMapper);
        // perColleagueMultiplier deliberately omitted — the only field whose
        // primitive default (0.0) would otherwise sneak past a bounds check.
        InputStream missingField =
                new ByteArrayInputStream((
                        "{\"maxMultiplier\":1.5,\"leaseSeconds\":60,"
                                + "\"heartbeatSeconds\":20,\"commuteSeconds\":30,"
                                + "\"lastSeenRetentionDays\":14}").getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadCoop(missingField));
    }

    // ── (003) T005 — additive `world` block + Training.durationSeconds ──

    /**
     * (003) T005 — the content envelope carries the additive seventh
     * {@code world} block (003 data-model §3; the exact {@code coop.json}
     * pattern) alongside the six 001/002 entries, with {@code schemaVersion}
     * and {@code contentVersion} intact. {@code contentVersion} bumps to
     * {@code "1.5.0"} as the world block is additive new content (FR-021).
     * RED until T008 adds {@code WorldConfig}/{@code world.json}.
     */
    @Test
    void getContent_carriesAdditiveSeventhWorldBlockAlongsideCoopAndFiveArrays() throws Exception {
        mockMvc.perform(get("/api/v1/content"))
            .andExpect(status().isOk())
            // the 001/002 envelope stays intact
            .andExpect(jsonPath("$.schemaVersion").value(1))
            .andExpect(jsonPath("$.contentVersion").value("1.5.0"))
            .andExpect(jsonPath("$.producers").isArray())
            .andExpect(jsonPath("$.upgrades").isArray())
            .andExpect(jsonPath("$.trainings").isArray())
            .andExpect(jsonPath("$.milestones").isArray())
            .andExpect(jsonPath("$.burners").isArray())
            .andExpect(jsonPath("$.coop.commuteSeconds").value(30))
            // additive seventh world tuning block (003 FR-007/021)
            .andExpect(jsonPath("$.world.walkSeconds").value(2.0));
    }

    /**
     * (003) T005 — {@code ContentLoader} fails fast ({@code @PostConstruct})
     * on a malformed {@code world.json}: the game must never start with
     * half-parsed world tuning data (Constitution Principle II). RED until
     * T008 implements {@code loadWorld}.
     */
    @Test
    void loadWorld_failsFast_whenWorldJsonMalformed() {
        ContentLoader loader = new ContentLoader(objectMapper);
        InputStream malformed =
                new ByteArrayInputStream("{not valid json".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadWorld(malformed));
    }

    /**
     * (003) T005 — every required {@code world} field must be present and
     * within bounds; a missing {@code walkSeconds} would otherwise default to
     * {@code 0.0} (a primitive default) and silently disable station walks —
     * the same gap the coop presence check guards (cubic P3 precedent).
     */
    @Test
    void loadWorld_failsFast_whenWalkSecondsMissingOrOutOfBounds() {
        ContentLoader loader = new ContentLoader(objectMapper);

        InputStream missing =
                new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadWorld(missing));

        InputStream zero =
                new ByteArrayInputStream("{\"walkSeconds\":0}".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadWorld(zero));

        InputStream negative =
                new ByteArrayInputStream("{\"walkSeconds\":-2}".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadWorld(negative));

        InputStream notANumber =
                new ByteArrayInputStream("{\"walkSeconds\":\"2\"}".getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalStateException.class, () -> loader.loadWorld(notANumber));
    }

    /**
     * (003) T005 — {@code Training} entries round-trip the optional
     * {@code durationSeconds} (003 data-model §2): a timed training keeps its
     * value through deserialize → serialize, and a pre-003 training without
     * the field stays valid with {@code null} (FR-016 backward compatibility;
     * the frontend loader treats served {@code null} as absent). RED until
     * T008 adds the record component.
     */
    @Test
    void training_roundTripsOptionalDurationSeconds() throws Exception {
        String timedJson = """
                {
                  "id": "agile_master",
                  "name": "Agile Master",
                  "description": "Certified Scrum mastery.",
                  "cost": { "resource": "cash", "amount": "2000" },
                  "permanentMultiplier": 3,
                  "prerequisite": null,
                  "durationSeconds": 90
                }
                """;
        Training timed = objectMapper.readValue(timedJson, Training.class);
        assertThat(timed.durationSeconds()).isEqualTo(90.0);
        Training timedAgain = objectMapper.readValue(
                objectMapper.writeValueAsString(timed), Training.class);
        assertThat(timedAgain.durationSeconds()).isEqualTo(90.0);

        String instantJson = """
                {
                  "id": "iso_9001_course",
                  "name": "ISO 9001 Course",
                  "description": "Quality management fundamentals.",
                  "cost": { "resource": "cash", "amount": "500" },
                  "permanentMultiplier": 2,
                  "prerequisite": null
                }
                """;
        Training instant = objectMapper.readValue(instantJson, Training.class);
        assertThat(instant.durationSeconds()).isNull();
    }
}
