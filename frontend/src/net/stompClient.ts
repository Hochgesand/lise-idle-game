// T031 — STOMP client: subscribe to the backend's push-only live channel
// (contracts §3).
//
// The backend `WebSocketConfig` (T024) uses PLAIN raw-WebSocket STOMP (no
// SockJS) — already verified live end-to-end with a real `@stomp/stompjs`
// client. So this client wraps `@stomp/stompjs`'s `Client` in its native
// raw-WebSocket mode (`brokerURL`), NOT SockJS / `webSocketFactory`.
//
// ## Channel (push-only, best-effort)
//   Endpoint : ws(s)://<host>/ws
//   Subscribe: /user/queue/state  (both message types arrive here, by `type`)
//     state.correction: { type, state:{...GameState, arrays...}, reason }
//       -> onStateCorrection(state, reason)
//     content.update  : { type, contentVersion }
//       -> onContentUpdate(contentVersion)
//
// The channel is ADVISORY only: the client's local localStorage save is the
// authoritative source for play (Constitution IV — offline-capable core). A
// socket failure is logged and the game stays playable; this is best-effort.
//
// ## Re-anchoring responsibility
// On a state.correction, the CALLER (the game loop, T032) replaces its local
// state and re-anchors `lastAdvancedAt` to now. This client is a thin
// transport wrapper — it does NOT perform that re-anchoring (kept free of
// `Date.now()` / gameplay semantics).
//
// ## Wire conversion (Set <-> array)
// The backend serializes `Set<String>` ownership fields as JSON arrays. The
// handler contract hands back a live `GameState` (with Sets), so the client
// converts arrays -> Sets at the transport boundary. This mirrors the same
// conversion in `net/restClient.ts` and `save/localStorage.ts` (a shared
// wire helper is a noted future refactor, out of scope here).

import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';
import type { GameState, CoopSegment, CommuteState } from '../sim/types';

/** The single STOMP destination both message types arrive on. */
const SUBSCRIPTION_DESTINATION = '/user/queue/state';

/** Handlers for the two push message types (either may be omitted). */
export interface StompHandlers {
  /** Called with the authoritative merged state + reason for a correction. */
  onStateCorrection?: (state: GameState, reason: string) => void;
  /** Called with the new content version string for a content update. */
  onContentUpdate?: (contentVersion: string) => void;
}

/**
 * Wire-shape GameState with ownership fields as arrays (JSON has no Set).
 *
 * (002) The co-op overlay fields are OPTIONAL on the wire: a state.correction
 * from a v1/anonymous server may omit them. `fromWire` normalizes absent/null
 * to the Spec 001 baseline (`[]`/`"office_1"`/`null`) so the push channel
 * never NPEs the co-op overlay (mirrors restClient.ts).
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

/** Convert a wire-shape (arrays) GameState into a live GameState (Sets). Pure. */
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
    // a v1/anonymous state.correction never NPEs the co-op overlay. Present
    // values pass through unchanged (mirrors restClient.ts leniency rule).
    coopSegments: wire.coopSegments ?? [],
    activeOffice: wire.activeOffice ?? 'office_1',
    commute: wire.commute ?? null,
  };
}

/**
 * Thin STOMP subscription wrapper over `@stomp/stompjs`'s `Client`.
 *
 * Construct with an explicit `brokerUrl` for tests (e.g.
 * `'wss://lise-game-api.schmitz.gg/ws'`); use the exported `stompClient` (or
 * `createStompClient()`) for the app, wired to the build-time
 * `VITE_WS_BASE_URL`.
 */
export class StompClient {
  private client: Client | null = null;
  private subscription: StompSubscription | null = null;
  private handlers: StompHandlers = {};

  constructor(private readonly brokerUrl: string) {}

  /** True once the underlying STOMP client reports a connection. */
  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Connect (idempotent) and subscribe to `/user/queue/state`, routing messages
   * by `type` to the registered handlers. Subsequent calls update the handlers
   * but do NOT create a second client or subscription.
   *
   * Errors on the socket/STOMP layer are logged only — the game stays playable
   * offline (Constitution IV).
   */
  connect(handlers: StompHandlers): void {
    this.handlers = handlers;

    // Idempotent: a client already exists (connecting or connected).
    if (this.client !== null) {
      return;
    }

    const client = new Client({ brokerURL: this.brokerUrl });
    this.client = client;

    client.onConnect = () => {
      this.subscription = client.subscribe(
        SUBSCRIPTION_DESTINATION,
        (message) => this.handleMessage(message),
      );
    };
    client.onStompError = (frame) => {
      console.error(
        '[stompClient] STOMP protocol error:',
        frame.headers['message'],
        frame.body,
      );
    };
    client.onWebSocketError = (event) => {
      console.error('[stompClient] WebSocket error:', event);
    };

    client.activate();
  }

  /**
   * Route one incoming STOMP message body to the matching handler. Unknown
   * types and unparseable bodies are ignored (the channel is advisory and must
   * never throw into the game loop). Pure parsing/routing: no Date.now(), no
   * state mutation beyond calling the handler.
   */
  private handleMessage(message: IMessage): void {
    let body: unknown;
    try {
      body = JSON.parse(message.body);
    } catch (err) {
      console.warn('[stompClient] Ignoring unparseable message body.', err);
      return;
    }
    if (body === null || typeof body !== 'object') {
      return;
    }

    const type = (body as { type?: unknown }).type;

    if (type === 'state.correction') {
      const payload = body as { state?: WireGameState; reason?: string };
      if (payload.state !== undefined) {
        this.handlers.onStateCorrection?.(
          fromWire(payload.state),
          payload.reason ?? '',
        );
      }
    } else if (type === 'content.update') {
      const payload = body as { contentVersion?: string };
      if (payload.contentVersion !== undefined) {
        this.handlers.onContentUpdate?.(payload.contentVersion);
      }
    }
    // Unknown type: ignore (push-only advisory channel must stay robust).
  }

  /**
   * Unsubscribe and deactivate the underlying client. Safe to call when not
   * connected. After disconnect, a subsequent `connect()` creates a fresh
   * client.
   */
  disconnect(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.client?.deactivate();
    this.client = null;
  }
}

// ── Build-time config + default instance ─────────────────────────────────

/**
 * The backend WebSocket base URL. Injected at build time via `VITE_WS_BASE_URL`
 * (WebSocket scheme `ws://`/`wss://`). Production sets it to
 * `wss://lise-game-api.schmitz.gg/ws`. Defaults to the local dev backend.
 */
export const WS_BASE_URL: string =
  import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8080/ws';

/** Factory: build a client for a custom broker URL (defaults to the configured one). */
export function createStompClient(brokerUrl: string = WS_BASE_URL): StompClient {
  return new StompClient(brokerUrl);
}

/** Default app-wide client, wired to the build-time `VITE_WS_BASE_URL`. */
export const stompClient = new StompClient(WS_BASE_URL);
