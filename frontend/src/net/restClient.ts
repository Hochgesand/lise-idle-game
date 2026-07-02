// T030 — REST client for the backend (contracts §2).
//
// A thin transport layer over the standard `fetch` API. It does NOT own domain
// semantics: content is returned as the raw envelope for `loadContent`
// (content.ts) to validate, and GameState Set↔array (de)serialization is done
// locally only because JSON has no Set (see "Wire conversion" below). The base
// URL is injected so tests pass a throwaway host; the default instance is wired
// to a build-time env var.
//
// ## Endpoints (base path `/api/v1`)
//   GET  /api/v1/content                       -> 200 ContentEnvelope
//   POST /api/v1/session        { playerId }   -> 200 { playerId, state } | 404 error envelope
//   PUT  /api/v1/session/{id}/state { state, clientTime }
//                                              -> 200 { state } (merged) | 409 error envelope
//
// ## Error envelope (all non-2xx)
//   { "error": { "code": "string", "message": "string" } }
// Parsed into a typed error; 409 specifically becomes `SchemaTooNewError`.
//
// ## Configuration seam (build-time injection)
// The frontend and backend run on DIFFERENT hosts (frontend lise-game.schmitz.gg,
// backend lise-game-api.schmitz.gg), so the API base URL must not be hardcoded.
// It is injected at build time via the Vite env var `VITE_API_BASE_URL`
// (set in the Docker build / `frontend/.env.production`). Defaults to
// `http://localhost:8080` for local dev. `import.meta.env` is typed by
// `vite/client` (its ImportMetaEnv carries an index signature, so custom
// `VITE_*` keys need no extra declaration).

import type { ContentEnvelope, GameState, CoopSegment, CommuteState } from '../sim/types';

// ── Errors ───────────────────────────────────────────────────────────────

/** A non-success response from the backend, carrying the HTTP status + error code. */
export class RestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Thrown by `saveState` on 409 — the client's `schemaVersion` is newer than the
 * server supports (contracts §2). The UI should prompt the user to reload/update
 * rather than silently retry. Extends `RestError` (status 409).
 */
export class SchemaTooNewError extends RestError {
  constructor(code: string, message: string) {
    super(409, code, message);
    this.name = 'SchemaTooNewError';
  }
}

// ── Wire conversion (Set <-> array) ──────────────────────────────────────
//
// JSON has no Set: the backend serializes its `Set<String>` ownership fields as
// JSON arrays. Conversely, JSON.stringify of a live JS `Set` yields `"{}"`
// (losing contents). The client therefore converts at the transport boundary.
// This mirrors the Set<->array conversion in save/localStorage.ts; the two
// share a concern that a future refactor could centralize into one helper.

/**
 * GameState with ownership sets flattened to arrays — the JSON wire shape.
 *
 * (002) The co-op overlay fields ride the session-sync wire as-is (ms numbers
 * for `coopSegments`/`commute` timestamps, a string office id) — no ISO<->ms
 * conversion happens here; the backend GameState (T028) mirrors this shape.
 * They are OPTIONAL on the wire so a v1/anonymous server response that omits
 * them is accepted leniently; `fromWire` normalizes absent/null to the
 * Spec 001 baseline (`[]`/`"office_1"`/`null`).
 */
interface WireGameState {
  schemaVersion: number;
  resources: GameState['resources'];
  ownedProducers: string[];
  ownedUpgrades: string[];
  ownedTrainings: string[];
  activeBurner: GameState['activeBurner'];
  earnedMilestones: string[];
  lastAdvancedAt: string;
  settings: GameState['settings'];
  coopSegments?: CoopSegment[] | null;
  activeOffice?: string | null;
  commute?: CommuteState | null;
}

/** Live GameState -> wire object (Sets become arrays). Pure. */
function toWire(state: GameState): WireGameState {
  return {
    schemaVersion: state.schemaVersion,
    resources: state.resources,
    ownedProducers: [...state.ownedProducers],
    ownedUpgrades: [...state.ownedUpgrades],
    ownedTrainings: [...state.ownedTrainings],
    activeBurner: state.activeBurner,
    earnedMilestones: [...state.earnedMilestones],
    lastAdvancedAt: state.lastAdvancedAt,
    settings: state.settings,
    // (002) T035: serialize the co-op overlay fields (same ms/string shape as
    // the live state — the sim keeps ms numbers, no conversion here).
    coopSegments: state.coopSegments,
    activeOffice: state.activeOffice,
    commute: state.commute,
  };
}

/** Wire object -> live GameState (arrays become Sets). Pure. */
function fromWire(wire: WireGameState): GameState {
  return {
    schemaVersion: wire.schemaVersion,
    resources: wire.resources,
    ownedProducers: new Set(wire.ownedProducers),
    ownedUpgrades: new Set(wire.ownedUpgrades),
    ownedTrainings: new Set(wire.ownedTrainings),
    activeBurner: wire.activeBurner,
    earnedMilestones: new Set(wire.earnedMilestones),
    lastAdvancedAt: wire.lastAdvancedAt,
    settings: wire.settings,
    // (002) T035: normalize absent/null wire values to the Spec 001 baseline so
    // a v1/anonymous server response (fields omitted or null) never NPEs the
    // co-op overlay. Present values pass through unchanged (leniency rule,
    // contracts §2 / data-model.md "Save migration").
    coopSegments: wire.coopSegments ?? [],
    activeOffice: wire.activeOffice ?? 'office_1',
    commute: wire.commute ?? null,
  };
}

// ── Auth token source (002 T058) ─────────────────────────────────────
//
// The RestClient consumes a `TokenSource` (provided by auth.ts) and attaches
// `Authorization: Bearer <access_token>` to authenticated calls whenever a
// token is held. When no token source is configured (signed-out / 001 anonymous
// play) the header is omitted and the anonymous-UUID path works as before
// (contracts §2 bearer-token contract). The same interface is consumed by the
// STOMP client for its CONNECT-frame token (T061).

/** A bearer access token held by the auth layer. */
export interface AccessToken {
  readonly token: string;
}

/** Provides the current access token for authenticated calls, or null when signed out. */
export interface TokenSource {
  getToken(): AccessToken | null;
}

/**
 * (002 T064) The player's presence settings — consent & visibility (contracts
 * §2 `PUT /api/v1/presence/settings`, FR-003). App-side `player_presence`
 * state, never delegated to Keycloak. Consumed by the social panel
 * (ui/socialPanel.ts) through main.ts.
 */
export interface PresenceSettings {
  /** Consent to be shown to colleagues (first-run dialog, FR-003). */
  consentGiven: boolean;
  /** Appear/hide toggle — changeable at any time (FR-003/FR-009). */
  visible: boolean;
}

/** `GET /api/v1/me` response — the current signed-in identity (contracts §2). */
export interface MeResponse {
  colleagueId: string; // the JWT `sub` claim (stable social key)
  displayName: string; // from access-token name/preferred_username claims
  avatar: string; // assigned avatar id
  consentGiven: boolean; // app-side, read from player_presence
  visible: boolean;
}

/**
 * Outcome of identity adoption (contracts §2, binding).
 *  - `ok: true`  — adopted `colleagueId`; the anonymous-UUID row is orphaned
 *    (never wiped), local save content is untouched, and the pushed state was
 *    merged server-side.
 *  - `ok: false` — adoption degraded without throwing into the game loop.
 *    `reason: 'signed_out'` = the token is missing/invalid/expired (a 401);
 *    `reason: 'network'`   = a transient failure (network drop / 5xx / other).
 *    The caller can distinguish a lost token (drop the session) from a
 *    retryable push failure (retry the adoption).
 */
export type IdentityAdoption =
  | { ok: true; colleagueId: string; serverState: GameState | null; mergedState: GameState }
  | { ok: false; reason: 'signed_out' | 'network' | 'schema_too_new' };

// ── Client ───────────────────────────────────────────────────────────────

/**
 * Thin REST client over `fetch`. Construct with an explicit `baseUrl` for
 * tests; use the exported `restClient` (or `createRestClient()`) for the app,
 * which is wired to the build-time `VITE_API_BASE_URL`.
 *
 * (002 T058) Pass an optional `TokenSource` (from auth.ts) to attach
 * `Authorization: Bearer` on authenticated calls; omit it for signed-out /
 * anonymous play. `setTokenSource` allows late binding once auth initializes.
 */
export class RestClient {
  private tokenSource: TokenSource | null;

  constructor(
    private readonly baseUrl: string,
    tokenSource: TokenSource | null = null,
  ) {
    this.tokenSource = tokenSource;
  }

  /** Late-bind the auth token source (e.g. once auth.ts has initialized). */
  setTokenSource(tokenSource: TokenSource | null): void {
    this.tokenSource = tokenSource;
  }

  /** `Authorization: Bearer ...` when a token is held, else empty (signed out). */
  private authHeaders(): Record<string, string> {
    const token = this.tokenSource?.getToken();
    return token !== null && token !== undefined
      ? { Authorization: `Bearer ${token.token}` }
      : {};
  }

  /** GET /api/v1/content — returns the raw envelope (caller runs `loadContent`). */
  async getContent(): Promise<ContentEnvelope> {
    // Public/anonymous endpoint (contracts §2) — no bearer attached.
    const res = await fetch(`${this.baseUrl}/api/v1/content`, { method: 'GET' });
    if (!res.ok) {
      throw await this.toRestError(res);
    }
    return (await res.json()) as ContentEnvelope;
  }

  /**
   * POST /api/v1/session — register/load a player.
   * Returns the saved state, or `null` on 404 (no save → fresh player).
   * Throws `RestError` on any other non-2xx status.
   *
   * (002 T058) attaches the bearer when held so an identity-bound id resolves
   * under the signed-in principal; signed-out (no token) keeps the 001
   * anonymous-UUID path.
   */
  async loadSession(playerId: string): Promise<GameState | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ playerId }),
    });
    if (res.status === 404) {
      return null; // fresh player — caller starts at zero
    }
    if (!res.ok) {
      throw await this.toRestError(res);
    }
    const body = (await res.json()) as { state: WireGameState };
    return fromWire(body.state);
  }

  /**
   * PUT /api/v1/session/{playerId}/state — save/sync.
   * Returns the authoritative merged state. Throws `SchemaTooNewError` on 409
   * (client must update); throws `RestError` on any other non-2xx status.
   */
  async saveState(
    playerId: string,
    state: GameState,
    clientTime: string,
  ): Promise<GameState> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/session/${encodeURIComponent(playerId)}/state`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ state: toWire(state), clientTime }),
      },
    );
    if (res.status === 409) {
      const err = await this.toRestError(res);
      throw new SchemaTooNewError(err.code, err.message);
    }
    if (!res.ok) {
      throw await this.toRestError(res);
    }
    const body = (await res.json()) as { state: WireGameState };
    return fromWire(body.state);
  }

  /**
   * GET /api/v1/me — the current signed-in identity (contracts §2). Requires a
   * bearer token; the server returns 401 `not_authenticated` without one (parsed
   * into a `RestError` with status 401).
   */
  async getMe(): Promise<MeResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/me`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw await this.toRestError(res);
    }
    return (await res.json()) as MeResponse;
  }

  /**
   * (002 T064) `PUT /api/v1/presence/settings` — store consent & visibility
   * (contracts §2, FR-003). Authenticated (bearer attached when held); returns
   * the STORED result the server echoes (which may differ from the request,
   * e.g. server-side normalization). Throws a `RestError` on any non-2xx —
   * notably 401 `not_authenticated` and 409 `consent_required` (`visible: true`
   * without stored-or-same-request consent). The CALLER (main.ts) degrades
   * without throwing into the game loop (FR-016).
   */
  async putPresenceSettings(settings: PresenceSettings): Promise<PresenceSettings> {
    const res = await fetch(`${this.baseUrl}/api/v1/presence/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      throw await this.toRestError(res);
    }
    return (await res.json()) as PresenceSettings;
  }

  /**
   * Identity adoption (contracts §2, binding). After sign-in the client stops
   * using its anonymous localStorage UUID and adopts `colleagueId` — the JWT
   * `sub` echoed by `/api/v1/me` — as its `playerId`: re-bootstrap
   * `POST /api/v1/session` under that id, then push local state via
   * `PUT /api/v1/session/{colleagueId}/state`. The monotonic max-merge preserves
   * all anonymous progress server-side; the anonymous-UUID row is **orphaned**
   * (never wiped, never auto-merged); the local save content is unchanged.
   *
   * Never throws into the game loop (FR-016): a 401 (token missing/invalid)
   * degrades to `signed_out`; a 409 (`schema_too_new` — the client's schema is
   * newer than the server supports) degrades to `schema_too_new` (permanent —
   * the caller should prompt a reload, NOT retry); any other failure (network
   * drop, 5xx) degrades to `network` — the caller can retry without dropping
   * the session.
   */
  async adoptIdentity(localState: GameState, clientTime: string): Promise<IdentityAdoption> {
    try {
      const me = await this.getMe();
      const serverState = await this.loadSession(me.colleagueId);
      const mergedState = await this.saveState(me.colleagueId, localState, clientTime);
      return { ok: true, colleagueId: me.colleagueId, serverState, mergedState };
    } catch (err) {
      if (err instanceof RestError) {
        // Classify by HTTP status (robust regardless of which call threw):
        // 401 = token missing/invalid → signed_out; 409 = client schema too
        // new → permanent schema_too_new (prompt reload, do NOT retry).
        if (err.status === 401) return { ok: false, reason: 'signed_out' };
        if (err.status === 409) return { ok: false, reason: 'schema_too_new' };
      }
      // Transient/network failure (or any unexpected error): never throw into
      // the game loop. The caller may retry adoption without dropping the session.
      console.warn('[restClient] Identity adoption failed — staying on the current identity.', err);
      return { ok: false, reason: 'network' };
    }
  }

  /**
   * Parse a non-2xx response into a `RestError`, extracting the error envelope's
   * `code`/`message` when present. Falls back to a generic message on a non-JSON
   * or malformed body (status is always preserved).
   */
  private async toRestError(res: Response): Promise<RestError> {
    let code = 'unknown';
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      // Non-JSON or unreadable body — keep the generic defaults (status preserved).
    }
    return new RestError(res.status, code, message);
  }
}

// ── Build-time config + default instance ─────────────────────────────────

/**
 * The backend API base URL. Injected at build time via `VITE_API_BASE_URL`
 * (set in the Docker build / `frontend/.env.production` to e.g.
 * `https://lise-game-api.schmitz.gg`). Defaults to the local dev backend.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

/** Factory: build a client for a custom base URL (defaults to the configured one). */
export function createRestClient(
  baseUrl: string = API_BASE_URL,
  tokenSource: TokenSource | null = null,
): RestClient {
  return new RestClient(baseUrl, tokenSource);
}

/** Default app-wide client, wired to the build-time `VITE_API_BASE_URL`. */
export const restClient = new RestClient(API_BASE_URL, null);
