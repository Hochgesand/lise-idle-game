// T057 — OIDC (Authorization Code + PKCE) authentication via oidc-client-ts.
//
// The SPA authenticates DIRECTLY against Keycloak (contracts §2
// "Authentication"): realm `LiseIdler`, public client `lise-idler-frontend`
// (PKCE, no client secret), scope `openid profile`. The backend is a stateless
// OAuth2 resource server that only validates the resulting JWTs — it issues no
// browser credential and serves no login/callback/logout endpoint.
//
// oidc-client-ts runs the Authorization Code + PKCE flow and manages the token
// lifecycle in the browser (storage, automatic silent renewal, expiry). This
// module is a thin, defensive wrapper: EVERY failure degrades to signed-out
// solo play (FR-001/002) — no method throws into the game loop.
//
// The exported `authTokenSource` is the `TokenSource` the REST (T058) and STOMP
// (T061) clients consume: it yields the current access token while signed in
// (and not expired), else null (signed-out solo).

import { UserManager, type User, type UserManagerSettings } from 'oidc-client-ts';
// The `TokenSource` contract lives with its primary consumer (restClient.ts);
// importing it here keeps a single source of truth for the seam.
import type { AccessToken, TokenSource } from './restClient';

// Re-export so callers can import the seam types from auth.ts as well.
export type { AccessToken, TokenSource };

// ── Keycloak config (baked; contracts §2 / tasks.md Keycloak reference) ────
//
// These values are the authoritative realm/client config — do not re-derive.
// The authorization, token, and end-session endpoints are Keycloak's,
// discovered by oidc-client-ts from the issuer's well-known config.

const AUTHORITY = 'https://keycloak.novitasoft.de/realms/LiseIdler';
const CLIENT_ID = 'lise-idler-frontend';
const SCOPE = 'openid profile'; // access token must carry name/preferred_username

/**
 * Treat a token as expired slightly early so it is never sent the instant
 * before the server would reject it. Silent renewal starts ~60s before expiry
 * by default, so a fresh token is normally available.
 */
const EXPIRY_SKEW_MS = 5_000;

// ── Types ─────────────────────────────────────────────────────────────────

/** The signed-in colleague identity (a projection of the oidc-client-ts User). */
export interface AuthUser {
  /** The Keycloak `sub` claim — the stable social key (colleagueId). */
  readonly colleagueId: string;
  /** Display name from the access-token name/preferred_username claims. */
  readonly displayName: string;
  /** Current access token (passed to the resource server as a bearer). */
  readonly accessToken: string;
  /** Epoch-ms expiry (0 if the provider did not supply expires_at). */
  readonly expiresAt: number;
}

/** The current auth state — signed in with a user, or signed out (solo play). */
export type AuthState =
  | { signedIn: true; user: AuthUser }
  | { signedIn: false };

// ── Module state ──────────────────────────────────────────────────────────

let userManager: UserManager | null = null;
let currentUser: User | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * The OIDC redirect URI: the SPA root on the current origin. The same page
 * handles the callback (`handleSigninCallback` runs on load and completes the
 * code exchange when callback params are present). Registered redirect URIs
 * (tasks.md T003): https://lise-game.schmitz.gg/*, http://localhost:5173/*,
 * http://localhost:8087/*.
 */
function redirectUri(): string {
  return `${window.location.origin}/`;
}

function buildSettings(): UserManagerSettings {
  return {
    authority: AUTHORITY,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    post_logout_redirect_uri: redirectUri(),
    response_type: 'code', // Authorization Code + PKCE (the SPA default)
    scope: SCOPE,
    // Silent renewal: oidc-client-ts attempts to refresh the access token
    // before it expires. With the spec'd `openid profile` scope (no
    // `offline_access`) there is no refresh token, so renewal runs via a hidden
    // `prompt=none` iframe against the Keycloak origin — a third-party context
    // that third-party-cookie blocking (Safari ITP) can defeat. When renewal
    // fails the held token expires and the client degrades to signed-out solo
    // play (FR-001/002) — the contracted safety net; no path throws. If longer
    // signed-in sessions are wanted later, request `offline_access` (a
    // Keycloak-client + spec decision, T003/T057) so renewal uses the refresh
    // token instead of the iframe.
    automaticSilentRenew: true,
    // Session monitoring via a hidden iframe is not needed (we degrade to
    // signed-out on any failure) and can cause cross-origin friction.
    monitorSession: false,
  };
}

function toAuthUser(user: User): AuthUser {
  const profile = user.profile as {
    sub?: string;
    name?: string;
    preferred_username?: string;
  };
  const sub = profile.sub ?? '';
  return {
    colleagueId: sub,
    displayName: profile.name ?? profile.preferred_username ?? sub,
    accessToken: user.access_token,
    expiresAt: typeof user.expires_at === 'number' ? user.expires_at * 1000 : 0,
  };
}

/** True when the held token is past (or within the skew window of) expiry. */
function isExpired(user: User): boolean {
  if (typeof user.expires_at !== 'number') return false; // unknown → assume valid
  return user.expires_at * 1000 - EXPIRY_SKEW_MS <= Date.now();
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Initialize the UserManager + token-lifecycle event wiring. Idempotent — safe
 * to call on every boot. Failures degrade to signed-out (never throw).
 */
export function initAuth(): void {
  if (userManager !== null) return;
  try {
    const mgr = new UserManager(buildSettings());
    // Keep the cached user in sync with the token lifecycle: silent renewal
    // raises `userLoaded` with the refreshed token; signout raises `userUnloaded`.
    mgr.events.addUserLoaded((user) => {
      currentUser = user;
    });
    mgr.events.addUserUnloaded(() => {
      currentUser = null;
    });
    userManager = mgr;
  } catch (err) {
    console.warn('[auth] UserManager initialization failed — staying signed out.', err);
    userManager = null;
  }
}

/**
 * Trigger the Keycloak login redirect (Authorization Code + PKCE). On success
 * Keycloak redirects back to the SPA root; `handleSigninCallback` completes the
 * exchange. Failures are logged and degrade to signed-out (never throw).
 */
export async function login(): Promise<void> {
  const mgr = userManager;
  if (mgr === null) return;
  try {
    await mgr.signinRedirect();
  } catch (err) {
    console.warn('[auth] signinRedirect failed — staying signed out.', err);
  }
}

/**
 * Process the OIDC redirect callback. Call on app load; completes the code
 * exchange ONLY when OIDC `code` + `state` callback params are present in the
 * URL, returning the signed-in user, then strips the consumed callback params
 * from the address bar (oidc-client-ts does not do this itself). On an ordinary
 * load without callback params it is a no-op and returns null. Failures
 * (malformed/expired state) degrade to null — non-fatal, the game continues
 * solo (never throw).
 */
export async function handleSigninCallback(): Promise<AuthUser | null> {
  const mgr = userManager;
  if (mgr === null) return null;
  // Guard: only attempt the exchange when callback params are present, so an
  // ordinary load/navigation does not hit the rejecting path + warning noise.
  const params = new URLSearchParams(window.location.search);
  // Surface an OIDC error redirect (e.g. the user denied consent → access_denied)
  // as a warning, then degrade to signed-out (never throw). Keycloak redirects
  // back with ?error=... instead of ?code=... when the flow aborts.
  const oidcError = params.get('error');
  if (oidcError !== null) {
    console.warn(
      '[auth] OIDC callback returned an error — staying signed out.',
      oidcError,
      params.get('error_description') ?? '',
    );
    // Strip the error params so a reload does not re-enter this branch / re-warn.
    window.history.replaceState({}, '', window.location.pathname);
    return null;
  }
  if (!params.has('code') || !params.has('state')) {
    return null;
  }
  try {
    const user = await mgr.signinRedirectCallback();
    currentUser = user;
    // Strip the consumed one-time callback params so a reload does not re-enter
    // the exchange path (the code is already consumed → it would fail + warn).
    window.history.replaceState({}, '', window.location.pathname);
    return toAuthUser(user);
  } catch (err) {
    console.warn('[auth] signinRedirectCallback did not complete — staying signed out.', err);
    return null;
  }
}

/**
 * Restore a persisted session from oidc-client-ts storage (call once on boot,
 * after `initAuth`). `getUser()` reads the stored `User` back without a network
 * round-trip and schedules the automatic silent renewal; without this call a
 * genuinely signed-in user would appear signed-out after a page reload (the
 * `userLoaded` event fires only on a fresh sign-in / renewal, not on boot).
 * Failures degrade to signed-out (never throw). Returns the restored identity
 * or null.
 */
export async function restoreSession(): Promise<AuthUser | null> {
  const mgr = userManager;
  if (mgr === null) return null;
  try {
    const user = await mgr.getUser();
    // Cache the user so the scheduled silent renew (userLoaded) can refresh an
    // expired token; but only REPORT signed-in when the stored token is still
    // valid, keeping this accessor consistent with the other expiry-aware ones.
    currentUser = user;
    if (user !== null && !isExpired(user)) {
      return toAuthUser(user);
    }
    return null; // no stored session, or stored token expired (awaiting renew)
  } catch (err) {
    console.warn('[auth] Session restore failed — staying signed out.', err);
    currentUser = null;
    return null;
  }
}

/**
 * Sign out: drop the stored tokens locally (the local save is untouched). This
 * is a client-side action — the caller may additionally redirect through
 * Keycloak's end-session endpoint via `signoutRedirect`. Never throws.
 */
export async function signOut(): Promise<void> {
  const mgr = userManager;
  if (mgr === null) {
    currentUser = null;
    return;
  }
  try {
    await mgr.removeUser();
  } catch (err) {
    console.warn('[auth] signout failed — clearing the local user anyway.', err);
  }
  currentUser = null;
}

/** True if a non-expired access token is currently held. */
export function isSignedIn(): boolean {
  return currentUser !== null && !isExpired(currentUser);
}

/** The current signed-in identity, or signed-out. */
export function getAuthState(): AuthState {
  const user = currentUser;
  if (user !== null && !isExpired(user)) {
    return { signedIn: true, user: toAuthUser(user) };
  }
  return { signedIn: false };
}

/**
 * The token source consumed by the REST (T058) and STOMP (T061) clients: yields
 * the current access token while signed in (and not expired), else null so the
 * clients fall back to signed-out solo behavior. Expiry is checked here (the
 * auth layer is the wall-clock boundary), keeping Date.now() out of the
 * transport clients.
 */
export const authTokenSource: TokenSource = {
  getToken(): AccessToken | null {
    const user = currentUser;
    if (user === null || isExpired(user)) return null;
    return { token: user.access_token };
  },
};
