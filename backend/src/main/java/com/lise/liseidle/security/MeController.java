package com.lise.liseidle.security;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * <b>T016 RED stub</b> for {@code GET /api/v1/me} (contracts &sect;2
 * "MeController / identity"). Exists only so the {@code MeControllerTest}
 * contract test compiles and reaches the handler (and is therefore RED);
 * T034 implements the real behaviour. Returns an all-null identity so the
 * {@code colleagueId}/{@code displayName}/{@code avatar} assertions fail.
 *
 * <p>Base path {@code /api/v1}; the bearer requirement on {@code /me} is
 * enforced by {@code SecurityConfig} (T030), so the 401-without-token
 * assertion already passes at this stage.
 */
@RestController
@RequestMapping("/api/v1")
public class MeController {

    /**
     * The contracts &sect;2 {@code GET /api/v1/me} response body.
     *
     * @param colleagueId  the JWT {@code sub} (the stable social key)
     * @param displayName  from the access-token {@code name}/{@code preferred_username}
     * @param avatar       assigned avatar sprite id (stable hash of colleagueId)
     * @param consentGiven app-side first-run consent (FR-003)
     * @param visible      appear/hide toggle (FR-003)
     */
    record MeResponse(String colleagueId, String displayName, String avatar,
                      boolean consentGiven, boolean visible) {
    }

    /**
     * T016 RED stub &mdash; returns nulls so the contract test fails.
     *
     * @return a placeholder response (real impl in T034)
     */
    @GetMapping("/me")
    public MeResponse me() {
        return new MeResponse(null, null, null, false, false);
    }
}
