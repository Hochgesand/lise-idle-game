package com.lise.liseidle.presence;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T066 &mdash; dev-profile slice test for {@link DevPresenceSeeder}. Activates
 * the {@code dev} profile so the {@code @Profile("dev")} seeder bean exists and
 * {@code SecurityConfig} permits {@code /api/v1/dev/**} without a token
 * (contracts &sect;2; T030). Exercises the seeder through the real filter chain
 * (MockMvc + {@code springSecurity()}) and verifies the synthetic colleagues
 * land in the registry and surface in the {@code GET /api/v1/presence} snapshot.
 *
 * <p>Seeded {@code LIVE} entries carry a fresh lease and age out via the normal
 * sweep, so the test does not assert their later expiry (that path is covered by
 * {@code PresenceServiceTest}); it only asserts the seed/clear surface and the
 * snapshot visibility.
 */
@SpringBootTest
@ActiveProfiles("dev")
class DevPresenceSeederTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PresenceRegistry registry;

    @Autowired
    private PresenceRepository presenceRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        registry.clear();
        presenceRepository.deleteAll();
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @AfterEach
    void tearDown() {
        // Best-effort reset of the live tier + rows between tests.
        registry.clear();
        presenceRepository.deleteAll();
    }

    /**
     * {@code POST /api/v1/dev/presence/seed} is callable without a bearer under
     * the dev profile and populates the registry; the seeded (consented +
     * visible) colleagues then surface in {@code GET /api/v1/presence}.
     */
    @Test
    void postSeed_withoutToken_populatesRegistryAndSnapshot() throws Exception {
        mockMvc.perform(post("/api/v1/dev/presence/seed")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"live\":3,\"lastSeen\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.live").value(3))
            .andExpect(jsonPath("$.lastSeen").value(2))
            .andExpect(jsonPath("$.seeded", hasSize(5)));

        org.assertj.core.api.Assertions.assertThat(registry.snapshot()).hasSize(5);

        mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("viewer-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.colleagues", hasSize(5)));
    }

    /**
     * When {@code office} is given, every seeded colleague is placed there
     * (single-building) rather than distributed.
     */
    @Test
    void postSeed_placesAllInRequestedOffice_whenOfficeGiven() throws Exception {
        mockMvc.perform(post("/api/v1/dev/presence/seed")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"live\":2,\"office\":\"office_2\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.office").value("office_2"));

        mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("viewer-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.colleagues[*].office", everyItem(is("office_2"))));
    }

    /**
     * {@code commuting} entries seed as live commuters ({@code office=null},
     * commute set).
     */
    @Test
    void postSeed_seedsCommutersWithNullOffice() throws Exception {
        mockMvc.perform(post("/api/v1/dev/presence/seed")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"commuting\":1}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.commuting").value(1));

        mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("viewer-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.colleagues", hasSize(1)))
            .andExpect(jsonPath("$.colleagues[0].status").value("live"))
            .andExpect(jsonPath("$.colleagues[0].commute.fromOffice").exists());
    }

    /**
     * {@code DELETE /api/v1/dev/presence/seed} clears every synthetic colleague.
     */
    @Test
    void deleteSeed_clearsSyntheticColleagues() throws Exception {
        mockMvc.perform(post("/api/v1/dev/presence/seed")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"live\":2,\"lastSeen\":1}"))
            .andExpect(status().isOk());

        mockMvc.perform(delete("/api/v1/dev/presence/seed"))
            .andExpect(status().isOk());

        org.assertj.core.api.Assertions.assertThat(registry.snapshot()).isEmpty();
    }

    /**
     * {@code POST /api/v1/dev/presence/seed} with no body defaults to seeding
     * nothing (all counts 0) and still returns 200.
     */
    @Test
    void postSeed_withEmptyBody_seedsNothing() throws Exception {
        mockMvc.perform(post("/api/v1/dev/presence/seed"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.live").value(0))
            .andExpect(jsonPath("$.seeded", hasSize(0)));
    }
}
