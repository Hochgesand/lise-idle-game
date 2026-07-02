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
//   Subscribe: /topic/presence  (002: broadcast presence deltas)
//       -> onPresence(parsedBody)
//   Subscribe: /user/queue/coop (002 T073: per-player co-op lease segments)
//     coop.segment    : { type, segment:{ from:ISO, until:ISO, multiplier } }
//       -> onCoopSegment({ from:ms, until:ms, multiplier })  (ISO→ms here)
//   On every (re)connect, after the subscriptions are (re)created:
//       -> onConnected()  (caller re-fetches the presence snapshot, main.ts)
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
import type { TokenSource } from './restClient';

/** The 001 state/content push destination (both message types arrive here, by `type`). */
const SUBSCRIPTION_DESTINATION = '/user/queue/state';

/** (002 T061) The broadcast presence-delta destination (contracts §3). */
const PRESENCE_SUBSCRIPTION = '/topic/presence';

/**
 * (002 T073) The per-player co-op lease destination (contracts §3): the server
 * pushes `coop.segment` messages here for the receiving player only (never
 * broadcast). Missed messages during a disconnect are NOT retroactively
 * issued — uncovered spans integrate at baseline by design (FR-013).
 */
const COOP_SUBSCRIPTION = '/user/queue/coop';

/** (002 T061) The client→server heartbeat destination. */
const HEARTBEAT_DESTINATION = '/app/presence.heartbeat';

/**
 * (002 T061) The heartbeat body (contracts §3 `/app/presence.heartbeat`).
 * `office` is null while commuting; `activity` is a client-derived display label;
 * `commute` mirrors the save's commute state (no `startedAt` — the server stamps
 * it). No client timestamps, no colleagueId (identity comes from the Principal).
 */
export interface HeartbeatPayload {
  office: string | null;
  activity: string;
  commute: { fromOffice: string; toOffice: string } | null;
}

/** Handlers for the push message types (any may be omitted). */
export interface StompHandlers {
  /** Called with the authoritative merged state + reason for a correction. */
  onStateCorrection?: (state: GameState, reason: string) => void;
  /** Called with the new content version string for a content update. */
  onContentUpdate?: (contentVersion: string) => void;
  /**
   * (002 T061) Called with a parsed `/topic/presence` delta
   * (`presence.update` / `presence.remove`) — the caller routes it into the
   * presence model. The body is parsed but otherwise unvalidated; the model
   * defends against malformed payloads (presenceClient.ts, T056/T062).
   */
  onPresence?: (message: unknown) => void;
  /**
   * (002 T073) Called with the sim-shape `CoopSegment` of a `/user/queue/coop`
   * `coop.segment` message. The wire carries ISO-8601 instants (contracts §3);
   * this client converts them to the sim timeline (ms) at the transport
   * boundary — mirroring the array→Set conversion — but does NOT validate
   * further: `applyCoopPresence` (sim/coop.ts) is the defense layer, dropping
   * NaN timestamps, inverted windows, and stale segments without throwing
   * (FR-017/018). The caller merges + persists via the safe mutation template
   * in main.ts.
   */
  onCoopSegment?: (segment: CoopSegment) => void;
  /**
   * Called after the (re)connect handshake completes and the subscriptions
   * above have been (re)created — on EVERY library-driven reconnect, not just
   * the first connect. The caller uses this to re-fetch snapshot state whose
   * deltas may have been missed during the disconnect window (main.ts
   * re-fetches the presence snapshot — presence deltas are broadcast-only and
   * never replayed, so without this a colleague removed while the socket was
   * down would stay rendered as a ghost until page reload). Fires after the
   * subscribes so the re-fetch cannot race a gap in the delta stream.
   */
  onConnected?: () => void;
}

/**
 * (002 T073) The `coop.segment` wire shape on `/user/queue/coop` (contracts
 * §3): server-authored ISO-8601 instants + a capped scalar multiplier. This is
 * distinct from the persisted sim `CoopSegment` (sim-timeline ms) — the
 * transport converts on receipt.
 */
interface WireCoopSegment {
  from?: unknown;
  until?: unknown;
  multiplier?: unknown;
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
  private presenceSubscription: StompSubscription | null = null;
  private coopSubscription: StompSubscription | null = null;
  private handlers: StompHandlers = {};
  private tokenSource: TokenSource | null;

  constructor(
    private readonly brokerUrl: string,
    tokenSource: TokenSource | null = null,
  ) {
    this.tokenSource = tokenSource;
  }

  /** (002 T061) Late-bind the auth token source (once auth.ts has initialized). */
  setTokenSource(tokenSource: TokenSource | null): void {
    this.tokenSource = tokenSource;
  }

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

    // (002 T061) Fresh bearer per connection attempt (contracts §3
    // token-freshness clause): access tokens live minutes while the socket
    // lives hours, so beforeConnect re-reads the token source on EVERY attempt
    // (incl. library-driven reconnects) and updates connectHeaders — static
    // headers would replay a stale token and silently kill presence after the
    // first expiry.
    client.beforeConnect = () => {
      const token = this.tokenSource?.getToken();
      client.connectHeaders =
        token !== null && token !== undefined
          ? { Authorization: `Bearer ${token.token}` }
          : {};
    };

    client.onConnect = () => {
      // Both subscriptions are created inside onConnect, which re-fires on every
      // library-driven reconnect — subscriptions self-heal (contracts §3), and
      // each reconnect carries a fresh access token (beforeConnect above).
      this.subscription = client.subscribe(
        SUBSCRIPTION_DESTINATION,
        (message) => this.handleMessage(message),
      );
      this.presenceSubscription = client.subscribe(
        PRESENCE_SUBSCRIPTION,
        (message) => this.handlePresenceMessage(message),
      );
      this.coopSubscription = client.subscribe(
        COOP_SUBSCRIPTION,
        (message) => this.handleCoopMessage(message),
      );
      // Notify AFTER the subscriptions exist: a snapshot re-fetch triggered
      // here sees every delta from this connection onward (no subscribe/fetch
      // race window).
      this.handlers.onConnected?.();
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
   * (002 T061) Route one `/topic/presence` message to `onPresence` as a parsed
   * object (the presence model defends against malformed payloads). Unparseable
   * bodies are ignored silently — the channel is advisory and must never throw
   * into the game loop.
   */
  private handlePresenceMessage(message: IMessage): void {
    let body: unknown;
    try {
      body = JSON.parse(message.body);
    } catch (err) {
      console.warn('[stompClient] Ignoring unparseable presence message body.', err);
      return;
    }
    this.handlers.onPresence?.(body);
  }

  /**
   * (002 T073) Route one `/user/queue/coop` `coop.segment` message to
   * `onCoopSegment`, converting the wire's ISO-8601 instants to sim-timeline
   * ms (`Date.parse`) at the transport boundary. Beyond the type/shape gate
   * the transport does not validate — a garbage timestamp passes through as
   * NaN and `applyCoopPresence` drops it (FR-017/018). Unknown types and
   * unparseable bodies are ignored silently — the channel is advisory and must
   * never throw into the game loop.
   */
  private handleCoopMessage(message: IMessage): void {
    let body: unknown;
    try {
      body = JSON.parse(message.body);
    } catch (err) {
      console.warn('[stompClient] Ignoring unparseable coop message body.', err);
      return;
    }
    if (body === null || typeof body !== 'object') {
      return;
    }

    const payload = body as { type?: unknown; segment?: unknown };
    if (payload.type !== 'coop.segment') {
      return;
    }
    if (payload.segment === null || typeof payload.segment !== 'object') {
      return;
    }

    const wire = payload.segment as WireCoopSegment;
    this.handlers.onCoopSegment?.({
      from: Date.parse(String(wire.from)),
      until: Date.parse(String(wire.until)),
      multiplier: Number(wire.multiplier),
    });
  }

  /**
   * (002 T061) Publish a heartbeat to `/app/presence.heartbeat` (contracts §3).
   * Guarded by `isConnected` — the heartbeat is advisory; when not connected it
   * is a no-op (the lease simply lapses). Identity comes from the STOMP
   * Principal installed by the CONNECT bearer, so no per-frame auth header.
   */
  publishHeartbeat(payload: HeartbeatPayload): void {
    if (!this.isConnected || this.client === null) {
      return;
    }
    this.client.publish({
      destination: HEARTBEAT_DESTINATION,
      body: JSON.stringify(payload),
    });
  }

  /**
   * Unsubscribe and deactivate the underlying client. Safe to call when not
   * connected. After disconnect, a subsequent `connect()` creates a fresh
   * client.
   */
  disconnect(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.presenceSubscription?.unsubscribe();
    this.presenceSubscription = null;
    this.coopSubscription?.unsubscribe();
    this.coopSubscription = null;
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
export function createStompClient(
  brokerUrl: string = WS_BASE_URL,
  tokenSource: TokenSource | null = null,
): StompClient {
  return new StompClient(brokerUrl, tokenSource);
}

/** Default app-wide client, wired to the build-time `VITE_WS_BASE_URL`. */
export const stompClient = new StompClient(WS_BASE_URL, null);
