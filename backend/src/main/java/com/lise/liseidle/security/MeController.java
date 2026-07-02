package com.lise.liseidle.security;

import com.lise.liseidle.presence.PlayerPresenceEntity;
import com.lise.liseidle.presence.PresenceRepository;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * {@code GET /api/v1/me} &mdash; the current identity (contracts &sect;2
 * "MeController / identity"). Echoes the JWT {@code sub} as
 * {@code colleagueId}, captures and <b>refreshes</b> the {@code displayName}
 * from the access-token claims on each authenticated request, assigns a
 * <b>deterministic, stable</b> avatar on first sight, and reads the app-side
 * {@code consentGiven}/{@code visible} flags from the {@code player_presence}
 * row.
 *
 * <p><b>Why the row is created here (not on a sign-in event)</b>: the backend
 * is a pure OAuth2 resource server &mdash; it sees no sign-in event, only
 * authenticated requests (contracts &sect;2 "Authentication"). So the first
 * authenticated {@code GET /api/v1/me} is the bootstrap that creates the
 * colleague's {@code player_presence} row (identity + durable last-seen
 * projection, T033). This is also the row the contracts &sect;2 identity-bound
 * ownership rule keys off: once it exists, that {@code colleagueId}
 * (= session {@code playerId} post-adoption) requires a matching bearer on the
 * session endpoints (T031).
 *
 * <p><b>Display name refresh</b>: captured and refreshed on <i>every</i>
 * authenticated request from the access token's {@code name} claim, falling
 * back to {@code preferred_username} (contracts &sect;2; the SPA requests scope
 * {@code openid profile} in T057 and the client's protocol mappers put both
 * claims in the access token per T003). A pure resource server has no other
 * channel for a rename to propagate.
 *
 * <p><b>Avatar assignment</b>: on first sight the avatar is a deterministic
 * stable hash of {@code colleagueId} onto the {@code avatars.png} frame set
 * (data-model PlayerIdentity {@code avatarId}); it is persisted so repeated
 * calls return the same value and a later avatar picker is additive. No avatar
 * picker is in scope for 002.
 *
 * <p><b>Consent / visibility</b>: read app-side from {@code player_presence}
 * (FR-003 &mdash; never delegated to Keycloak). A fresh identity is
 * un-consented and hidden; the consent flow ({@code PUT /api/v1/presence/settings},
 * T059) flips them.
 *
 * <p>Base path {@code /api/v1}; the bearer requirement on {@code /me} is
 * enforced by {@code SecurityConfig} (T030).
 */
@RestController
@RequestMapping("/api/v1")
public class MeController {

    /**
     * Number of distinct colleague frames in the {@code avatars.png} sprite
     * sheet. The avatar id is a 0-based index onto this frame set, assigned via
     * {@link #stableAvatarId(String)}. The sheet itself lands in T041; this
     * constant is the placeholder frame count the hash maps onto and is tuned
     * when the sheet's real distinct-frame count is known (a content-only
     * change &mdash; the wire value is a string, so existing rows' persisted
     * ids stay valid).
     */
    static final int AVATAR_FRAME_COUNT = 16;

    private final PresenceRepository presenceRepository;

    public MeController(PresenceRepository presenceRepository) {
        this.presenceRepository = presenceRepository;
    }

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
     * Returns the caller's current identity, creating the
     * {@code player_presence} row on first sight and refreshing the display
     * name from the access-token claims.
     *
     * @param jwt the bearer-token principal (always present &mdash;
     *            {@code SecurityConfig} requires a bearer on {@code /me})
     * @return the identity snapshot (contracts &sect;2)
     */
    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal Jwt jwt) {
        String colleagueId = jwt.getSubject();
        String claimedName = displayNameFromClaims(jwt);

        // findById-or-create: the first authenticated request bootstraps the
        // row (the resource server sees no sign-in event). The avatar is
        // assigned exactly once here and then persisted, so repeated calls are
        // stable; a fresh identity starts un-consented and hidden.
        Optional<PlayerPresenceEntity> existing = presenceRepository.findById(colleagueId);
        boolean isNewRow = existing.isEmpty();
        PlayerPresenceEntity row;
        if (isNewRow) {
            row = new PlayerPresenceEntity(colleagueId);
            row.setAvatar(stableAvatarId(colleagueId));
            row.setConsentGiven(false);
            row.setVisible(false);
        } else {
            row = existing.get();
        }

        // Refresh the display name from the access-token claims on EVERY
        // authenticated request (a rename has no other propagation channel).
        // Fall back to the previously persisted name (a token whose mapper
        // dropped both claims), then to the sub, so it is never null.
        String displayName = claimedName != null ? claimedName : row.getDisplayName();
        if (displayName == null) {
            displayName = colleagueId;
        }
        boolean nameChanged = !displayName.equals(row.getDisplayName());
        row.setDisplayName(displayName);

        // Write ONLY when something actually changed (new row, or a rename):
        // a steady-state GET then issues no DB write (no write amplification if
        // the SPA ever polls /me), and the read-modify-write window is limited
        // to genuine renames rather than every request. Full row-level
        // concurrency with the heartbeat path (a @Version lock or a targeted
        // single-column UPDATE) is deferred to T059, which wires those
        // concurrent office/activity/lastSeenAt writes onto this same row.
        if (isNewRow || nameChanged) {
            presenceRepository.save(row);
        }

        return new MeResponse(
                colleagueId,
                row.getDisplayName(),
                row.getAvatar(),
                row.isConsentGiven(),
                row.isVisible());
    }

    /**
     * Resolves the display name from the access-token claims, preferring
     * {@code name} and falling back to {@code preferred_username}
     * (contracts &sect;2). Returns {@code null} when neither claim is present
     * (the caller then keeps any previously persisted name).
     *
     * @param jwt the access token
     * @return the claim-derived display name, or {@code null}
     */
    private static String displayNameFromClaims(Jwt jwt) {
        String name = jwt.getClaimAsString("name");
        if (name != null) {
            return name;
        }
        return jwt.getClaimAsString("preferred_username");
    }

    /**
     * Deterministic stable hash of {@code colleagueId} onto the avatar frame
     * set &mdash; a 0-based index string in {@code [0, AVATAR_FRAME_COUNT)}
     * (data-model PlayerIdentity {@code avatarId}). {@link String#hashCode()}
     * is JVM-stable (its contract is specified, not implementation-defined) and
     * {@link Math#floorMod} keeps the index non-negative, so the same
     * {@code colleagueId} always maps to the same frame across runs and
     * processes.
     *
     * @param colleagueId the social key
     * @return the stable avatar frame id
     */
    static String stableAvatarId(String colleagueId) {
        return String.valueOf(Math.floorMod(colleagueId.hashCode(), AVATAR_FRAME_COUNT));
    }
}
