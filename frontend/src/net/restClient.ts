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

import type { ContentEnvelope, GameState } from '../sim/types';

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

/** GameState with ownership sets flattened to arrays — the JSON wire shape. */
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
  };
}

// ── Client ───────────────────────────────────────────────────────────────

/**
 * Thin REST client over `fetch`. Construct with an explicit `baseUrl` for
 * tests; use the exported `restClient` (or `createRestClient()`) for the app,
 * which is wired to the build-time `VITE_API_BASE_URL`.
 */
export class RestClient {
  constructor(private readonly baseUrl: string) {}

  /** GET /api/v1/content — returns the raw envelope (caller runs `loadContent`). */
  async getContent(): Promise<ContentEnvelope> {
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
   */
  async loadSession(playerId: string): Promise<GameState | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
export function createRestClient(baseUrl: string = API_BASE_URL): RestClient {
  return new RestClient(baseUrl);
}

/** Default app-wide client, wired to the build-time `VITE_API_BASE_URL`. */
export const restClient = new RestClient(API_BASE_URL);
