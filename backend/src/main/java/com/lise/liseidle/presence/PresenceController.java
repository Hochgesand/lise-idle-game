package com.lise.liseidle.presence;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Presence REST surface (T059 controller half; RED tests in T053): the
 * {@code GET /api/v1/presence} snapshot and {@code PUT /api/v1/presence/settings}
 * consent/visibility endpoints (contracts &sect;2). A thin adapter over
 * {@link PresenceService}, which owns the registry/repository/push logic; this
 * controller only derives the viewer id from the bearer and shapes the HTTP
 * responses (including the {@code 409 consent_required} envelope).
 *
 * <p>Base path {@code /api/v1}; the bearer requirement on {@code /presence/**}
 * is enforced by {@code SecurityConfig} (T030), so an authenticated request
 * always carries a non-null {@link Jwt} principal when it reaches these
 * handlers. {@code 401 not_authenticated} without a token is produced by the
 * security layer (not here).
 *
 * <p>The heartbeat ({@code /app/presence.heartbeat}) is <b>not</b> here: it is a
 * STOMP {@code @MessageMapping} hosted on {@link PresenceService} (which carries
 * the {@code @Controller} stereotype Spring requires to detect
 * {@code @MessageMapping} methods).
 */
@RestController
@RequestMapping("/api/v1")
public class PresenceController {

    private final PresenceService presenceService;

    public PresenceController(PresenceService presenceService) {
        this.presenceService = presenceService;
    }

    /**
     * {@code GET /api/v1/presence} &mdash; the presence snapshot (contracts
     * &sect;2): {@code {serverTime, self, colleagues}}, with {@code self} echoed
     * even while hidden and {@code colleagues} listing visible colleagues only
     * (hidden/un-consented filtered server-side, FR-009), self excluded.
     *
     * @param jwt the bearer-token principal (always present &mdash;
     *            {@code SecurityConfig} requires a bearer on {@code /presence/**})
     * @return the snapshot
     */
    @GetMapping("/presence")
    public PresenceSnapshot getPresence(@AuthenticationPrincipal Jwt jwt) {
        return presenceService.buildSnapshot(jwt.getSubject());
    }

    /**
     * {@code PUT /api/v1/presence/settings} &mdash; store consent/visibility
     * (contracts &sect;2; FR-003). {@code visible:true} without consent is
     * rejected with {@code 409 consent_required}; otherwise the stored result is
     * echoed (200). Hiding broadcasts {@code presence.remove} immediately
     * (handled in {@link PresenceService}); the (Phase 5) coop downgrade push
     * is not issued here.
     *
     * @param jwt     the bearer-token principal
     * @param request the {@code {consentGiven, visible}} body
     * @return 200 with the stored {@link SettingsResult}, or 409 consent_required
     */
    @PutMapping("/presence/settings")
    public ResponseEntity<?> putSettings(@AuthenticationPrincipal Jwt jwt,
                                         @RequestBody SettingsRequest request) {
        try {
            SettingsResult result = presenceService.applySettings(
                    jwt.getSubject(), request.consentGiven(), request.visible());
            return ResponseEntity.ok(result);
        } catch (ConsentRequiredException e) {
            return ResponseEntity.status(409)
                    .body(new ErrorResponse(new ErrorBody(
                            "consent_required",
                            "Visibility requires consent (consent_required).")));
        }
    }

    /** {@code PUT /api/v1/presence/settings} request body (contracts &sect;2). */
    record SettingsRequest(boolean consentGiven, boolean visible) {
    }

    /** The contracts error envelope {@code {"error":{"code","message"}}}. */
    record ErrorResponse(ErrorBody error) {
    }

    record ErrorBody(String code, String message) {
    }
}
