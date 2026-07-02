package com.lise.liseidle.security;

import com.jayway.jsonpath.JsonPath;
import com.lise.liseidle.presence.PresenceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T016 &mdash; RED contract test for {@code GET /api/v1/me} (TDD; T034 makes it
 * GREEN). Proves the contracts &sect;2 {@code MeController} / identity surface:
 * the JWT {@code sub} is echoed as {@code colleagueId}, the
 * {@code displayName} is captured and <b>refreshed</b> from the access-token
 * claims on each authenticated request (a pure resource server sees no
 * sign-in event, so the first authenticated write creates the
 * {@code player_presence} row and later requests refresh it),
 * {@code consentGiven}/{@code visible} are read app-side from that row (a
 * fresh identity is un-consented), a fresh identity receives a
 * <b>deterministic, stable</b> {@code avatarId} (stable hash of
 * {@code colleagueId} onto the avatar frame set &mdash; same value on repeated
 * calls), and a tokenless request yields {@code 401 not_authenticated}.
 *
 * <p><b>No network to Keycloak</b>: authentication uses spring-security-test
 * MOCK JWTs via the {@link jwt} post-processor (same harness as
 * {@code SecurityConfigTest} / {@code SessionControllerTest}), which installs a
 * {@code BearerTokenAuthentication} directly and bypasses real JWK-set
 * validation. MockMvc is built with {@code .apply(springSecurity())} so the
 * real {@code SecurityConfig} filter chain runs and resolves the {@link
 * org.springframework.security.oauth2.jwt.Jwt} principal the controller reads.
 *
 * <p><b>Test isolation</b>: the shared in-memory H2 is wiped in
 * {@link #setUp()} ({@code presenceRepository.deleteAll()}) so every test
 * starts from a fresh {@code player_presence} table &mdash; the "fresh identity"
 * assertions never collide with a row a sibling test created. No
 * {@code @DirtiesContext}.
 *
 * <p><b>RED against the T016 stub</b>: the stub returns all-null identity
 * fields, so the {@code colleagueId}/{@code displayName}/{@code avatar}
 * assertions FAIL (the {@code consentGiven}/{@code visible} defaults and the
 * security-level 401 are regression guards and already GREEN).
 */
@SpringBootTest
class MeControllerTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PresenceRepository presenceRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        // Fresh player_presence table per test — the "fresh identity" cases
        // never see a row a sibling test created.
        presenceRepository.deleteAll();
        // springSecurity() wires the real SecurityConfig filter chain so the
        // controller sees the resolved Jwt principal; jwt() installs it.
        this.mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    // ── colleagueId = sub ────────────────────────────────────────────────

    /**
     * {@code colleagueId} equals the JWT {@code sub} claim (contracts &sect;2;
     * the social key everywhere = the session {@code playerId} post-adoption).
     */
    @Test
    void getMe_echoesSubClaimAsColleagueId() throws Exception {
        mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("alice-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.colleagueId").value("alice-uuid"));
    }

    // ── displayName captured + refreshed from access-token claims ────────

    /**
     * {@code displayName} is captured from the access-token {@code name} claim
     * on the first authenticated request (the row is created here) and
     * <b>refreshed</b> on the next (contracts &sect;2: a pure resource server
     * sees no sign-in event).
     */
    @Test
    void getMe_capturesAndRefreshesDisplayNameFromNameClaim() throws Exception {
        // First request — displayName captured from the name claim.
        mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("alice-uuid")
                        .claim("name", "Alice Lise"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.displayName").value("Alice Lise"));

        // Second request — displayName REFRESHED from the updated claim.
        mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("alice-uuid")
                        .claim("name", "Alice Renamed"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.displayName").value("Alice Renamed"));
    }

    /**
     * When the access token carries no {@code name} claim, {@code displayName}
     * falls back to {@code preferred_username} (contracts &sect;2:
     * {@code name}/{@code preferred_username}; tasks.md T003 protocol mappers).
     */
    @Test
    void getMe_fallsBackToPreferredUsernameWhenNameClaimAbsent() throws Exception {
        mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("bob-uuid")
                        .claim("preferred_username", "bob"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.displayName").value("bob"));
    }

    // ── consentGiven / visible from player_presence (app-side) ───────────

    /**
     * A fresh identity is un-consented and hidden: {@code consentGiven=false}
     * and {@code visible=false}, read app-side from the just-created
     * {@code player_presence} row (FR-003 — never delegated to Keycloak).
     */
    @Test
    void getMe_freshIdentityIsUnconsentedAndHidden() throws Exception {
        mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("fresh-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.consentGiven").value(false))
            .andExpect(jsonPath("$.visible").value(false));
    }

    // ── deterministic, stable avatarId (stable hash onto frame set) ──────

    /**
     * A fresh identity receives a <b>deterministic, stable</b> {@code avatarId}
     * &mdash; a stable hash of {@code colleagueId} onto the avatar frame set,
     * persisted on first sight (data-model PlayerIdentity {@code avatarId}).
     * Repeated calls for the same identity return the same value. This test
     * pins the <i>wire</i> contract (the avatar is assigned, non-blank, and
     * stable for one identity); it deliberately does <b>not</b> constrain the
     * id's format (contracts &sect;2 allows any sprite id / url), so a later
     * named-sprite or URL form still satisfies the contract. The bounded-hash
     * &ldquo;onto the frame set&rdquo; property is an implementation concern
     * of T034, not this contract assertion.
     */
    @Test
    void getMe_assignsDeterministicStableAvatar_forFreshIdentity() throws Exception {
        // First sight — avatar assigned (row created) and persisted.
        String firstBody = mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("stable-uuid"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.avatar").exists())
            .andReturn().getResponse().getContentAsString();
        String avatarFirst = JsonPath.read(firstBody, "$.avatar");

        // Second call — the persisted avatar is echoed unchanged (stable).
        String secondBody = mockMvc.perform(get("/api/v1/me")
                .with(jwt().jwt(j -> j.subject("stable-uuid"))))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        String avatarSecond = JsonPath.read(secondBody, "$.avatar");

        assertThat(avatarFirst)
                .as("avatar must be assigned (non-blank sprite id)")
                .isNotBlank();
        assertThat(avatarSecond)
                .as("avatar must be stable across repeated calls for one identity")
                .isEqualTo(avatarFirst);
    }

    // ── 401 without a token (security-level regression guard) ────────────

    /**
     * {@code GET /api/v1/me} without a bearer token &rarr; 401
     * {@code not_authenticated} (contracts &sect;2; enforced by
     * {@code SecurityConfig}, so GREEN even at the stub stage &mdash; kept as a
     * regression guard so the controller never accidentally widens access).
     */
    @Test
    void getMe_returns401WithoutToken() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("not_authenticated"));
    }
}
