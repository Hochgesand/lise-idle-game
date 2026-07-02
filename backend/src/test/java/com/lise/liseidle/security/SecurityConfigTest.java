package com.lise.liseidle.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsStringIgnoringCase;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T015 &mdash; RED integration test for the real {@code SecurityConfig} (TDD;
 * T030 makes it GREEN). Tests the {@code SecurityConfig}-LEVEL behaviour that
 * the contracts &sect;2 "Security configuration" block binds (the anonymous
 * 001 surface, the bearer-required routes, the {@code dev}-profile carve-out,
 * CORS, and CSRF disabled for the stateless API).
 *
 * <p><b>Scope</b> (per the T015+T030 workflow note): the identity-bound
 * ownership rule and the {@code player_mismatch} 403 are enforced inside
 * {@code SessionController} (T031) and tested there &mdash; NOT here. This
 * class only proves {@code SecurityConfig} authenticates the bearer where
 * required and permits the anonymous surface.
 *
 * <p><b>Why {@code .apply(springSecurity())}</b>: every other backend test
 * builds MockMvc with {@code webAppContextSetup(context).build()} and so never
 * runs the Spring Security filter chain &mdash; that would bypass every rule
 * asserted here. Applying {@link springSecurity()} wires the real filter chain
 * (resource server + authorization) into the MockMvc request.
 *
 * <p><b>No network to Keycloak</b>: authentication uses spring-security-test
 * MOCK JWTs via the {@link jwt} post-processor, which installs a
 * {@code BearerTokenAuthentication} directly and bypasses real JWK-set
 * validation. The tokenless assertions are the anonymous-surface / RED ones.
 *
 * <p><b>RED against the provisional permit-all config</b>: the bearer-required
 * routes ({@code /api/v1/me}, {@code /api/v1/presence/**} &rarr; 401), the
 * {@code anyRequest().authenticated()} default, the CORS preflight headers,
 * and the prod-profile {@code /api/v1/dev/**} 401 all FAIL. The anonymous-
 * surface + CSRF-disabled + valid-mock-JWT + dev-profile-permit tests are
 * regression guards (already GREEN under the provisional config).
 */
class SecurityConfigTest {

    /** The three origins the contract's CORS allowlist permits (&sect;2 CORS). */
    private static final List<String> ALLOWED_ORIGINS = List.of(
            "https://lise-game.schmitz.gg",
            "http://localhost:5173",
            "http://localhost:8087");

    /** Minimal valid v2-shaped {@code GameState} JSON for {@code PUT .../state}. */
    private static final String MINIMAL_STATE_JSON = """
            {"resources":{"loc":"0","cash":"0","aiTokens":"0"},
             "ownedProducers":[],"ownedUpgrades":[],"ownedTrainings":[],
             "activeBurner":null,"earnedMilestones":[],
             "lastAdvancedAt":"2026-06-30T12:00:00.000Z","schemaVersion":1,
             "settings":{"reducedMotion":false,"muted":false},
             "coopSegments":[],"activeOffice":"office_1","commute":null}
            """;

    /** {@code PUT /api/v1/session/{id}/state} request body wrapping the state. */
    private static final String SAVE_BODY =
            "{\"state\":" + MINIMAL_STATE_JSON
                    + ",\"clientTime\":\"2026-06-30T12:00:00.000Z\"}";

    /**
     * Assert a request was NOT rejected by security (permitted through to the
     * handler layer). Used where the exact handler status is incidental to the
     * security assertion (e.g. the {@code /ws} handshake, or a {@code /dev}
     * route whose handler does not exist yet) &mdash; what matters is that the
     * filter chain let it past (anything but 401/403).
     */
    private static final ResultMatcher PERMITTED = result -> {
        int status = result.getResponse().getStatus();
        assertThat(status)
                .as("request must be permitted by security (not 401/403); got " + status)
                .isNotIn(401, 403);
    };

    // ─────────────────────────────────────────────────────────────────────
    //  Default (prod-like) profile
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Default-profile assertions: the anonymous surface, the bearer-required
     * routes, the {@code anyRequest().authenticated()} default, CORS, and CSRF
     * disabled.
     */
    @SpringBootTest
    @Nested
    class DefaultProfile {

        @Autowired
        private WebApplicationContext context;

        private MockMvc mockMvc;

        @BeforeEach
        void setUp() {
            this.mockMvc = MockMvcBuilders.webAppContextSetup(context)
                    .apply(springSecurity())
                    .build();
        }

        // ── (a) anonymous 001 surface stays open (FR-002) ─────────────────

        /** {@code GET /api/v1/content} is open without a token. */
        @Test
        void getContent_isOpenWithoutToken() throws Exception {
            mockMvc.perform(get("/api/v1/content"))
                .andExpect(status().isOk());
        }

        /** {@code POST /api/v1/session} for a never-claimed id is open (404 = no save). */
        @Test
        void postSession_isOpenForNeverClaimedId_withoutToken() throws Exception {
            mockMvc.perform(post("/api/v1/session")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"playerId\":\"anon-" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isNotFound());
        }

        /** {@code PUT /api/v1/session/{id}/state} for a never-claimed id is open (200 = saved). */
        @Test
        void putState_isOpenForNeverClaimedId_withoutToken() throws Exception {
            mockMvc.perform(put("/api/v1/session/anon-put-" + UUID.randomUUID() + "/state")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(SAVE_BODY))
                .andExpect(status().isOk());
        }

        /** The {@code /ws} STOMP handshake is permitted without a token. */
        @Test
        void wsHandshake_isPermittedWithoutToken() throws Exception {
            mockMvc.perform(get("/ws"))
                .andExpect(PERMITTED);
        }

        // ── (b) bearer required on /me and /presence/** (401 not_authenticated) ──

        /** {@code GET /api/v1/me} &rarr; 401 {@code not_authenticated} without a token. */
        @Test
        void getMe_returns401WithoutToken() throws Exception {
            mockMvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("not_authenticated"));
        }

        /** {@code GET /api/v1/presence} &rarr; 401 {@code not_authenticated} without a token. */
        @Test
        void getPresence_returns401WithoutToken() throws Exception {
            mockMvc.perform(get("/api/v1/presence"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("not_authenticated"));
        }

        /** {@code PUT /api/v1/presence/settings} &rarr; 401 {@code not_authenticated} without a token. */
        @Test
        void putPresenceSettings_returns401WithoutToken() throws Exception {
            mockMvc.perform(put("/api/v1/presence/settings")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"consentGiven\":true,\"visible\":true}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("not_authenticated"));
        }

        /**
         * A valid mock JWT passes authorization on the bearer-required route
         * (reaches the handler layer; {@code /api/v1/me} itself lands in T034,
         * so the dispatcher answer is incidental &mdash; the assertion is that
         * security did NOT reject). Proves the resource server accepts JWTs
         * with no network to Keycloak.
         */
        @Test
        void getMe_passesAuthz_withValidMockJwt() throws Exception {
            mockMvc.perform(get("/api/v1/me")
                    .with(jwt().jwt(j -> j.subject("alice-uuid"))))
                .andExpect(PERMITTED);
        }

        // ── (c) anyRequest().authenticated() default ──────────────────────

        /** An unlisted path defaults to authenticated() &rarr; 401 without a token. */
        @Test
        void unlistedPath_returns401WithoutToken() throws Exception {
            mockMvc.perform(get("/api/v1/totally-unlisted-" + UUID.randomUUID()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("not_authenticated"));
        }

        /**
         * Outside the {@code dev} profile, {@code /api/v1/dev/**} is NOT
         * permitted &mdash; it falls through to {@code anyRequest().authenticated()}
         * &rarr; 401 without a token (the dev endpoints are {@code @Profile("dev")}
         * and do not exist in prod).
         */
        @Test
        void devEndpoints_requireToken_outsideDevProfile() throws Exception {
            mockMvc.perform(post("/api/v1/dev/presence/seed")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"live\":1}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("not_authenticated"));
        }

        // ── (d) CORS allows the Authorization header for the three origins ──

        /**
         * A CORS preflight from each allowlisted origin is answered with that
         * origin echoed and the {@code Authorization} header permitted
         * (contracts &sect;2 CORS). Covers the prod frontend, the Vite dev
         * server, and the local compose frontend.
         */
        @Test
        void cors_preflightAllowsAuthorizationHeaderForConfiguredOrigins() throws Exception {
            for (String origin : ALLOWED_ORIGINS) {
                mockMvc.perform(options("/api/v1/me")
                        .header("Origin", origin)
                        .header("Access-Control-Request-Method", "PUT")
                        .header("Access-Control-Request-Headers", "authorization"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Access-Control-Allow-Origin", origin))
                    .andExpect(header().string("Access-Control-Allow-Headers",
                            containsStringIgnoringCase("Authorization")));
            }
        }

        // ── (e) CSRF disabled for the stateless API ───────────────────────

        /**
         * A state-changing {@code PUT} without a CSRF token is not blocked by
         * CSRF (would be 403 if CSRF were enabled). The request still has to
         * be permitted by authorization, so this also re-asserts the anonymous
         * {@code PUT .../state} surface end-to-end.
         */
        @Test
        void csrfDisabled_stateChangingPutNotBlocked() throws Exception {
            mockMvc.perform(put("/api/v1/session/csrf-check-" + UUID.randomUUID() + "/state")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(SAVE_BODY))
                .andExpect(status().isOk());
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Dev profile
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Under the {@code dev} profile {@code /api/v1/dev/**} is permitted
     * WITHOUT a token (contracts &sect;2). A separate Spring context is spun
     * up for this nested class via {@code @ActiveProfiles("dev")}.
     */
    @SpringBootTest
    @ActiveProfiles("dev")
    @Nested
    class DevProfile {

        @Autowired
        private WebApplicationContext context;

        private MockMvc mockMvc;

        @BeforeEach
        void setUp() {
            this.mockMvc = MockMvcBuilders.webAppContextSetup(context)
                    .apply(springSecurity())
                    .build();
        }

        /**
         * {@code POST /api/v1/dev/presence/seed} is permitted without a token
         * under the {@code dev} profile (the seeder itself lands in T066, so
         * the dispatcher answer is incidental &mdash; the assertion is that
         * security did NOT reject).
         */
        @Test
        void devEndpoints_permittedWithoutToken_underDevProfile() throws Exception {
            mockMvc.perform(post("/api/v1/dev/presence/seed")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"live\":1}"))
                .andExpect(PERMITTED);
        }
    }
}
