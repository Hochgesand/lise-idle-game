// T057 — unit tests for the auth wrapper (oidc-client-ts is mocked; NO real
// Keycloak network — the net layer is jsdom-testable per the task contract).
//
// The UserManager from `oidc-client-ts` is replaced with a hand-written fake
// (built with `vi.hoisted` so it is in scope for the hoisted `vi.mock` factory).
// The fake captures the constructor config + the `events.addUserLoaded`/
// `addUserUnloaded` callbacks and lets each test drive the async methods and
// the token-lifecycle events deterministically. auth.ts's module-level state is
// reset per test via `vi.resetModules()` + a fresh dynamic import.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock oidc-client-ts
// ---------------------------------------------------------------------------

const oidc = vi.hoisted(() => {
  // A mutable handle the factory binds the fake UserManager to and each test
  // drives. Persisted across the hoisted boundary; reset per test in beforeEach.
  const handle = {
    // The most recently constructed fake manager (so tests can inspect config).
    manager: null as MockUserManagerShape | null,
    // Captured event callbacks (auth.ts wires these in initAuth).
    userLoaded: null as ((user: unknown) => void) | null,
    userUnloaded: null as (() => void) | null,
    // Overridable async method behaviors.
    signinRedirect: vi.fn(async () => {}),
    signinRedirectCallback: vi.fn(async () => null as unknown as FakeUser),
    removeUser: vi.fn(async () => {}),
    getUser: vi.fn(async () => null as unknown as FakeUser | null),
    // Throw from the constructor to simulate a broken environment.
    constructorShouldThrow: false,
  };

  interface MockUserManagerShape {
    settings: { authority?: string; client_id?: string; scope?: string; redirect_uri?: string };
    events: {
      addUserLoaded(cb: (user: unknown) => void): void;
      removeUserLoaded(): void;
      addUserUnloaded(cb: () => void): void;
      removeUserUnloaded(): void;
    };
  }

  class FakeUserManager implements MockUserManagerShape {
    settings: MockUserManagerShape['settings'];
    events = {
      addUserLoaded: (cb: (user: unknown) => void) => {
        handle.userLoaded = cb;
      },
      removeUserLoaded: () => {},
      addUserUnloaded: (cb: () => void) => {
        handle.userUnloaded = cb;
      },
      removeUserUnloaded: () => {},
    };

    constructor(settings: MockUserManagerShape['settings']) {
      this.settings = settings;
      handle.manager = this;
      if (handle.constructorShouldThrow) {
        throw new Error('UserManager construction failed');
      }
    }

    async signinRedirect(): Promise<void> {
      await handle.signinRedirect();
    }
    async signinRedirectCallback(): Promise<FakeUser> {
      return await handle.signinRedirectCallback();
    }
    async removeUser(): Promise<void> {
      await handle.removeUser();
    }
    async getUser(): Promise<FakeUser | null> {
      return await handle.getUser();
    }
  }

  return { FakeUserManager, handle };
});

vi.mock('oidc-client-ts', () => ({ UserManager: oidc.FakeUserManager }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FakeUser {
  access_token: string;
  id_token?: string;
  token_type: string;
  session_state: string | null;
  profile: { sub?: string; name?: string; preferred_username?: string };
  expires_at?: number; // epoch SECONDS
}

/** A signed-in user whose token expires ~1h in the future (not expired). */
function freshUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    access_token: 'access-token-123',
    id_token: 'id-token',
    token_type: 'Bearer',
    session_state: null,
    profile: { sub: 'keycloak-sub-uuid', name: 'Ada Example', preferred_username: 'ada' },
    expires_at: Math.floor((Date.now() + 3_600_000) / 1000), // +1h, in seconds
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness: reset auth's module state + the mock handle per test.
// ---------------------------------------------------------------------------

// auth is re-imported fresh per test (vi.resetModules clears its module-level
// currentUser/userManager state). Declared `any`-ish via typeof after import.
let auth: typeof import('./auth');

beforeEach(async () => {
  vi.resetModules();
  auth = await import('./auth');

  oidc.handle.manager = null;
  oidc.handle.userLoaded = null;
  oidc.handle.userUnloaded = null;
  oidc.handle.constructorShouldThrow = false;
  oidc.handle.signinRedirect = vi.fn(async () => {});
  oidc.handle.signinRedirectCallback = vi.fn(async () => null as unknown as FakeUser);
  oidc.handle.removeUser = vi.fn(async () => {});
  oidc.handle.getUser = vi.fn(async () => null as unknown as FakeUser | null);
  // jsdom default: clean URL (no callback params).
  window.history.replaceState({}, '', '/');
});

// ---------------------------------------------------------------------------
// initAuth — UserManager config + event wiring
// ---------------------------------------------------------------------------

describe('initAuth', () => {
  it('constructs the UserManager with the LiseIdler realm + public client config', () => {
    auth.initAuth();

    expect(oidc.handle.manager).not.toBeNull();
    expect(oidc.handle.manager!.settings.authority).toBe(
      'https://keycloak.novitasoft.de/realms/LiseIdler',
    );
    expect(oidc.handle.manager!.settings.client_id).toBe('lise-idler-frontend');
    expect(oidc.handle.manager!.settings.scope).toBe('openid profile');
    expect(oidc.handle.manager!.settings.redirect_uri).toContain('/'); // SPA root on origin
  });

  it('wires the userLoaded / userUnloaded event callbacks', () => {
    auth.initAuth();
    expect(oidc.handle.userLoaded).toBeInstanceOf(Function);
    expect(oidc.handle.userUnloaded).toBeInstanceOf(Function);
  });

  it('is idempotent: a second call does not construct a second UserManager', () => {
    auth.initAuth();
    const first = oidc.handle.manager;
    auth.initAuth();
    expect(oidc.handle.manager).toBe(first);
  });

  it('degrades to signed-out (no throw) if UserManager construction fails', () => {
    oidc.handle.constructorShouldThrow = true;
    expect(() => auth.initAuth()).not.toThrow();
    expect(auth.isSignedIn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Token source — the seam the REST/STOMP clients consume
// ---------------------------------------------------------------------------

describe('authTokenSource', () => {
  it('yields null while signed out', () => {
    auth.initAuth();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });

  it('yields the access token once a user is loaded', () => {
    auth.initAuth();
    oidc.handle.userLoaded?.(freshUser());

    const token = auth.authTokenSource.getToken();
    expect(token).not.toBeNull();
    expect(token!.token).toBe('access-token-123');
  });

  it('yields null again after the user is unloaded (signout)', () => {
    auth.initAuth();
    oidc.handle.userLoaded?.(freshUser());
    expect(auth.authTokenSource.getToken()).not.toBeNull();

    oidc.handle.userUnloaded?.();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });

  it('yields null when the held token is expired', () => {
    auth.initAuth();
    // A token that expired in the past.
    oidc.handle.userLoaded?.(freshUser({ expires_at: Math.floor(Date.now() / 1000) - 60 }));
    expect(auth.authTokenSource.getToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// login / handleSigninCallback / signOut — every failure degrades (no throw)
// ---------------------------------------------------------------------------

describe('login', () => {
  it('triggers the Keycloak signinRedirect', async () => {
    auth.initAuth();
    await auth.login();
    expect(oidc.handle.signinRedirect).toHaveBeenCalledTimes(1);
  });

  it('degrades (no throw) when signinRedirect fails', async () => {
    auth.initAuth();
    oidc.handle.signinRedirect = vi.fn(async () => {
      throw new Error('redirect blocked');
    });
    await expect(auth.login()).resolves.toBeUndefined();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('is a no-op when auth was never initialized', async () => {
    // No initAuth() → no UserManager → login must not throw.
    await expect(auth.login()).resolves.toBeUndefined();
  });
});

describe('handleSigninCallback', () => {
  it('returns the AuthUser on a successful callback exchange', async () => {
    auth.initAuth();
    // Callback params present in the URL (Keycloak redirected back with code+state).
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    oidc.handle.signinRedirectCallback = vi.fn(async () => freshUser());

    const user = await auth.handleSigninCallback();

    expect(oidc.handle.signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect(user).not.toBeNull();
    expect(user!.colleagueId).toBe('keycloak-sub-uuid');
    expect(user!.displayName).toBe('Ada Example');
    expect(user!.accessToken).toBe('access-token-123');
    // And the token source now yields the access token (currentUser cached).
    expect(auth.authTokenSource.getToken()!.token).toBe('access-token-123');
  });

  it('is a no-op (no exchange, no warning) on an ordinary load without callback params', async () => {
    auth.initAuth();
    // No code/state in the URL — a normal navigation/reload.
    expect(window.location.search).toBe('');

    const user = await auth.handleSigninCallback();

    expect(user).toBeNull();
    expect(oidc.handle.signinRedirectCallback).not.toHaveBeenCalled();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });

  it('returns null (no throw) when the callback exchange fails', async () => {
    auth.initAuth();
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    oidc.handle.signinRedirectCallback = vi.fn(async () => {
      throw new Error('state mismatch');
    });
    await expect(auth.handleSigninCallback()).resolves.toBeNull();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });

  it('degrades to signed-out (no throw) and logs an OIDC error redirect (e.g. consent denied)', async () => {
    auth.initAuth();
    // Keycloak redirected back with an error instead of a code (user denied).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.history.replaceState({}, '', '/?error=access_denied&error_description=user+denied');

    const user = await auth.handleSigninCallback();

    expect(user).toBeNull();
    expect(oidc.handle.signinRedirectCallback).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('OIDC callback returned an error'),
      'access_denied',
      'user denied',
    );
    expect(auth.authTokenSource.getToken()).toBeNull();
    warnSpy.mockRestore();
  });
});

describe('restoreSession', () => {
  it('hydrates the cached user from oidc storage on reload', async () => {
    auth.initAuth();
    // A returning user with a valid stored token — getUser reads it back.
    oidc.handle.getUser = vi.fn(async () => freshUser());

    const user = await auth.restoreSession();

    expect(oidc.handle.getUser).toHaveBeenCalledTimes(1);
    expect(user).not.toBeNull();
    expect(user!.colleagueId).toBe('keycloak-sub-uuid');
    // The token source now yields the restored token (no fresh sign-in needed).
    expect(auth.authTokenSource.getToken()!.token).toBe('access-token-123');
    expect(auth.isSignedIn()).toBe(true);
  });

  it('stays signed out (no throw) when no session is stored', async () => {
    auth.initAuth();
    oidc.handle.getUser = vi.fn(async () => null);
    const user = await auth.restoreSession();
    expect(user).toBeNull();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });

  it('reports signed-out when the stored token is expired (consistent with getToken)', async () => {
    auth.initAuth();
    // A stored user whose token already expired.
    oidc.handle.getUser = vi.fn(async () =>
      freshUser({ expires_at: Math.floor(Date.now() / 1000) - 60 }),
    );
    const user = await auth.restoreSession();
    // restoreSession returns null (expired) — consistent with getToken()/getAuthState.
    expect(user).toBeNull();
    expect(auth.authTokenSource.getToken()).toBeNull();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('degrades to signed-out (no throw) when getUser fails', async () => {
    auth.initAuth();
    oidc.handle.getUser = vi.fn(async () => {
      throw new Error('storage locked');
    });
    await expect(auth.restoreSession()).resolves.toBeNull();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });
});

describe('signOut', () => {
  it('drops the user (removeUser) and clears the cached token', async () => {
    auth.initAuth();
    oidc.handle.userLoaded?.(freshUser());
    expect(auth.authTokenSource.getToken()).not.toBeNull();

    await auth.signOut();

    expect(oidc.handle.removeUser).toHaveBeenCalledTimes(1);
    expect(auth.authTokenSource.getToken()).toBeNull();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('still clears the local user (no throw) when removeUser fails', async () => {
    auth.initAuth();
    oidc.handle.userLoaded?.(freshUser());
    oidc.handle.removeUser = vi.fn(async () => {
      throw new Error('storage locked');
    });
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(auth.authTokenSource.getToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAuthState
// ---------------------------------------------------------------------------

describe('getAuthState', () => {
  it('reports signed-out before any user is loaded', () => {
    auth.initAuth();
    expect(auth.getAuthState()).toEqual({ signedIn: false });
  });

  it('reports signed-in with the projected identity once a user is loaded', () => {
    auth.initAuth();
    oidc.handle.userLoaded?.(freshUser({ profile: { sub: 's1', name: 'Bob' } }));
    const state = auth.getAuthState();
    expect(state.signedIn).toBe(true);
    if (!state.signedIn) throw new Error('expected signed in');
    expect(state.user.colleagueId).toBe('s1');
    expect(state.user.displayName).toBe('Bob');
  });
});
