package com.lise.liseidle.presence;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T053 &mdash; RED contract tests for the presence REST surface (TDD; T059
 * controller half makes them GREEN). Pins contracts &sect;2
 * "GET /api/v1/presence" + "PUT /api/v1/presence/settings".
 *
 * <p><b>No network to Keycloak</b>: spring-security-test MOCK JWTs via the
 * {@link jwt} post-processor install a {@code BearerTokenAuthentication}
 * directly (same harness as {@code MeControllerTest}/{@code SecurityConfigTest});
 * MockMvc is built with {@code .apply(springSecurity())} so the real
 * {@code SecurityConfig} filter chain runs and the controller sees the resolved
 * {@link org.springframework.security.oauth2.jwt.Jwt} principal.
 *
 * <p><b>What is asserted</b>:
 * <ul>
 *   <li>{@code GET /api/v1/presence} returns {@code {serverTime, self, colleagues}}
 *       with the contracts &sect;2 {@code PresenceRecord} shape;</li>
 *   <li>hidden/un-consented colleagues are filtered server-side (FR-009);</li>
 *   <li>{@code self} is echoed even while hidden;</li>
 *   <li><b>only</b> the FR-004 field allowlist is exposed (no
 *       {@code leaseExpiresAt}, no email/tokens/save data);</li>
 *   <li>401 {@code not_authenticated} without a token;</li>
 *   <li>{@code PUT /api/v1/presence/settings} stores consent/visibility;</li>
 *   <li>409 {@code consent_required} when {@code visible:true} without consent.</li>
 * </ul>
 *
 * <p><b>RED state</b>: {@link PresenceController} does not exist yet
 * (implemented in the T059 controller half), so {@code GET /api/v1/presence}
 * resolves to 404 and the snapshot/settings assertions fail &mdash; the correct
 * TDD RED state per Constitution Principle III.
 */
@SpringBootTest
class PresenceControllerTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PresenceRepository presenceRepository;

    @Autowired
    private PresenceRegistry registry;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        // Fresh live tier + player_presence table per test.
        registry.clear();
        presenceRepository.deleteAll();
        this.mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    // ── GET /api/v1/presence snapshot ───────────────────────────────────

    /**
     * The snapshot is {@code {serverTime, self, colleagues}} with the contracts
     * &sect;2 {@code PresenceRecord} shape: {@code self} carries the viewer's own
     * record, {@code colleagues} lists a visible live colleague.
     */
    @Test
    void getPresence_returnsSnapshotWithSelfAndVisibleColleagues() throws Exception {
        presenceRepository.save(row("alice-uuid", "Alice", true, true));
        // carol: visible + consented + live → appears in colleagues.
        presenceRepository.save(row("carol-uuid", "Carol", true, true));
        registry.upsert(live("carol-uuid", "Carol", "office_1", "coding"));

        mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("alice-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.serverTime").exists())
            .andExpect(jsonPath("$.self.colleagueId").value("alice-uuid"))
            .andExpect(jsonPath("$.colleagues[0].colleagueId").value("carol-uuid"))
            .andExpect(jsonPath("$.colleagues[0].status").value("live"));
    }

    /**
     * Only the FR-004 field allowlist is exposed on a {@code PresenceRecord}:
     * {@code colleagueId, displayName, avatar, office, activity, commute,
     * status, lastSeenAt} &mdash; never {@code leaseExpiresAt}, email, tokens,
     * or save data.
     */
    @Test
    void getPresence_exposesOnlyTheFr004FieldAllowlist() throws Exception {
        presenceRepository.save(row("alice-uuid", "Alice", true, true));
        presenceRepository.save(row("carol-uuid", "Carol", true, true));
        registry.upsert(live("carol-uuid", "Carol", "office_1", "coding"));

        MvcResult result = mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("alice-uuid"))))
            .andExpect(status().isOk())
            .andReturn();

        @SuppressWarnings("unchecked")
        Map<String, Object> carol = JsonPath.read(result.getResponse().getContentAsString(),
                "$.colleagues[0]");
        assertThat(carol.keySet())
                .as("PresenceRecord exposes exactly the FR-004 allowlist (no leaseExpiresAt)")
                .containsExactlyInAnyOrder(
                        "colleagueId", "displayName", "avatar",
                        "office", "activity", "commute", "status", "lastSeenAt");
    }

    /**
     * Hidden and un-consented colleagues are filtered server-side (FR-009): only
     * the visible + consented colleague appears in {@code colleagues}.
     */
    @Test
    void getPresence_filtersHiddenAndUnconsentedColleaguesServerSide() throws Exception {
        presenceRepository.save(row("alice-uuid", "Alice", true, true));
        // visible + consented → appears.
        presenceRepository.save(row("carol-uuid", "Carol", true, true));
        registry.upsert(live("carol-uuid", "Carol", "office_1", "coding"));
        // hidden (visible=false) → filtered.
        presenceRepository.save(row("hidden-uuid", "Hidden", true, false));
        registry.upsert(live("hidden-uuid", "Hidden", "office_1", "coding"));
        // un-consented (consent=false) → filtered.
        presenceRepository.save(row("unconsented-uuid", "Unconsented", false, true));
        registry.upsert(live("unconsented-uuid", "Unconsented", "office_1", "coding"));

        mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("alice-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.colleagues", org.hamcrest.Matchers.hasSize(1)))
            .andExpect(jsonPath("$.colleagues[0].colleagueId").value("carol-uuid"));
    }

    /**
     * {@code self} is echoed even while the viewer is hidden: a hidden viewer
     * (who has heartbeated, so is live) still receives their own record so the
     * UI can show own status (contracts &sect;2).
     */
    @Test
    void getPresence_echoesSelfEvenWhileHidden() throws Exception {
        presenceRepository.save(row("alice-uuid", "Alice", true, false)); // hidden
        registry.upsert(live("alice-uuid", "Alice", "office_1", "coding")); // but live

        mockMvc.perform(get("/api/v1/presence")
                .with(jwt().jwt(j -> j.subject("alice-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.self.colleagueId").value("alice-uuid"))
            .andExpect(jsonPath("$.self.status").value("live"))
            .andExpect(jsonPath("$.colleagues", org.hamcrest.Matchers.hasSize(0)));
    }

    /**
     * {@code GET /api/v1/presence} without a bearer token &rarr; 401
     * {@code not_authenticated} (contracts &sect;2; enforced by
     * {@code SecurityConfig}).
     */
    @Test
    void getPresence_returns401WithoutToken() throws Exception {
        mockMvc.perform(get("/api/v1/presence"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("not_authenticated"));
    }

    // ── PUT /api/v1/presence/settings ───────────────────────────────────

    /**
     * {@code PUT /api/v1/presence/settings} with consent + visible stores both
     * and echoes the stored result (contracts &sect;2).
     */
    @Test
    void putSettings_storesConsentAndVisibility() throws Exception {
        presenceRepository.save(row("alice-uuid", "Alice", false, false)); // fresh identity

        mockMvc.perform(put("/api/v1/presence/settings")
                .with(jwt().jwt(j -> j.subject("alice-uuid")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"consentGiven\":true,\"visible\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.consentGiven").value(true))
            .andExpect(jsonPath("$.visible").value(true));

        // Persisted to the durable row.
        PlayerPresenceEntity stored = presenceRepository.findById("alice-uuid").orElseThrow();
        assertThat(stored.isConsentGiven()).isTrue();
        assertThat(stored.isVisible()).isTrue();
    }

    /**
     * {@code visible:true} without consent &rarr; 409 {@code consent_required}
     * (contracts &sect;2; FR-003).
     */
    @Test
    void putSettings_returns409ConsentRequired_whenVisibleWithoutConsent() throws Exception {
        mockMvc.perform(put("/api/v1/presence/settings")
                .with(jwt().jwt(j -> j.subject("alice-uuid")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"consentGiven\":false,\"visible\":true}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("consent_required"));
    }

    /**
     * {@code PUT /api/v1/presence/settings} without a bearer token &rarr; 401
     * {@code not_authenticated}.
     */
    @Test
    void putSettings_returns401WithoutToken() throws Exception {
        mockMvc.perform(put("/api/v1/presence/settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"consentGiven\":true,\"visible\":true}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("not_authenticated"));
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private static PlayerPresenceEntity row(String colleagueId, String displayName,
                                            boolean consent, boolean visible) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(displayName);
        e.setAvatar("0");
        e.setConsentGiven(consent);
        e.setVisible(visible);
        return e;
    }

    private static PresenceRecord live(String colleagueId, String displayName,
                                       String office, String activity) {
        return new PresenceRecord(
                colleagueId, displayName, "0", office, activity, null,
                PresenceRecord.Status.LIVE, Instant.now().toString(),
                Instant.now().plusSeconds(60).toString());
    }
}
