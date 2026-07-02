// T031 — RED unit tests for the STOMP client (TDD).
//
// The frontend subscribes to the backend's push-only STOMP channel
// (contracts §3): destination `/user/queue/state`, where both message types
// arrive discriminated by their `type` field:
//   state.correction: { type, state:{...GameState, arrays...}, reason }
//   content.update:   { type, contentVersion }
//
// The backend WebSocketConfig (T024) uses PLAIN raw-WebSocket STOMP (no SockJS),
// already verified live end-to-end. So the client wraps `@stomp/stompjs`'s
// `Client` in its native raw-WebSocket mode (`brokerURL`).
//
// ## Mocking strategy
// `@stomp/stompjs` is mocked via `vi.mock` with a hand-written fake `Client`
// (built with `vi.hoisted` so it is in scope for the hoisted factory). The fake
// captures `brokerURL`, the subscribe destination + callback, and simulates a
// successful STOMP CONNECT handshake synchronously on `activate()`. Tests then
// drive the captured subscribe callback with synthetic message bodies — no
// network, fully deterministic. The ONLY fake part is the stompjs transport;
// every parse/route/conversion path the StompClient runs is the real code.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted makes these declarations available to the hoisted vi.mock factory.
const { MockClient, instances } = vi.hoisted(() => {
  const instances: MockClientShape[] = [];

  interface Subscription {
    destination: string;
    callback: (message: { body: string }) => void;
  }
  interface PublishCall {
    destination: string;
    body?: string;
    headers?: Record<string, string>;
  }

  interface MockClientShape {
    brokerURL: string | undefined;
    onConnect: ((frame: unknown) => void) | undefined;
    onStompError: ((frame: unknown) => void) | undefined;
    onWebSocketError: ((event: unknown) => void) | undefined;
    // (002 T061) fresh-token-per-connect wiring.
    beforeConnect: ((client: unknown) => void | Promise<void>) | undefined;
    connectHeaders: Record<string, string> | undefined;
    connected: boolean;
    // Multiple subscriptions (state + presence), captured in subscribe order.
    subscriptions: Subscription[];
    // (002 T061) publish spy (heartbeat).
    publishCalls: PublishCall[];
    activateCalls: number;
    deactivateCalls: number;
    activate(): void;
    deactivate(): void;
    subscribe(
      destination: string,
      callback: (message: { body: string }) => void,
    ): { id: string; unsubscribe: () => void };
    publish(params: PublishCall): void;
  }

  class MockClientImpl implements MockClientShape {
    brokerURL: string | undefined;
    onConnect: ((frame: unknown) => void) | undefined = undefined;
    onStompError: ((frame: unknown) => void) | undefined = undefined;
    onWebSocketError: ((event: unknown) => void) | undefined = undefined;
    beforeConnect: ((client: unknown) => void | Promise<void>) | undefined = undefined;
    connectHeaders: Record<string, string> | undefined = undefined;
    connected = false;
    subscriptions: Subscription[] = [];
    publishCalls: PublishCall[] = [];
    activateCalls = 0;
    deactivateCalls = 0;

    constructor(config: { brokerURL?: string }) {
      this.brokerURL = config.brokerURL;
      instances.push(this);
    }

    activate(): void {
      this.activateCalls++;
      // Simulate the library calling beforeConnect before the CONNECT frame.
      this.beforeConnect?.(this);
      this.connected = true;
      // Simulate a successful STOMP CONNECT/CONNECTED handshake synchronously.
      this.onConnect?.({});
    }

    deactivate(): void {
      this.deactivateCalls++;
      this.connected = false;
    }

    subscribe(
      destination: string,
      callback: (message: { body: string }) => void,
    ): { id: string; unsubscribe: () => void } {
      this.subscriptions.push({ destination, callback });
      return { id: `sub-${this.subscriptions.length}`, unsubscribe: () => {} };
    }

    publish(params: PublishCall): void {
      this.publishCalls.push(params);
    }
  }

  return { MockClient: MockClientImpl, instances };
});

vi.mock('@stomp/stompjs', () => ({ Client: MockClient }));

// Imported AFTER vi.mock (hoisted) so it resolves the mocked Client.
import { StompClient } from './stompClient';
import type { HeartbeatPayload } from './stompClient';
import type { AccessToken, TokenSource } from './restClient';
import type { CoopSegment, GameState } from '../sim/types';
// (T073) The real pure mutator + bundled content: the application-path tests
// drive the REAL transport→sim conversion into the REAL merge rule.
import { applyCoopPresence } from '../sim/coop';
import { FALLBACK_CONTENT } from '../sim/fallbackContent';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BROKER = 'wss://api.example.test/ws';

/** Build a mutable TokenSource whose token can be flipped per test. */
function tokenSource(initial: string | null): { source: TokenSource; set(t: string | null): void } {
  let current: AccessToken | null = initial === null ? null : { token: initial };
  return {
    source: { getToken: () => current },
    set: (t: string | null) => {
      current = t === null ? null : { token: t };
    },
  };
}

/** A wire-shape GameState (ownership as arrays, as the backend serializes). */
function wireState(loc = '42'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    resources: { loc, cash: '0', aiTokens: '0' },
    ownedProducers: ['manual_typing'],
    ownedUpgrades: [],
    ownedTrainings: [],
    activeBurner: null,
    earnedMilestones: [],
    lastAdvancedAt: '2026-06-30T12:00:00.000Z',
    settings: { reducedMotion: false, muted: false },
  };
}

/** Deliver a STOMP message body to a specific subscription destination. */
function deliverTo(destination: string, body: string): void {
  const client = instances[instances.length - 1];
  const sub = client?.subscriptions.find((s) => s.destination === destination);
  if (!sub) {
    throw new Error(`no active subscription for ${destination}`);
  }
  sub.callback({ body });
}

/** Deliver to the 001 state/content subscription (backward-compatible helper). */
function deliver(body: string): void {
  deliverTo('/user/queue/state', body);
}

/** Deliver to the (002) presence subscription. */
function deliverPresence(body: string): void {
  deliverTo('/topic/presence', body);
}

/** (T073) Deliver to the per-player co-op lease subscription. */
function deliverCoop(body: string): void {
  deliverTo('/user/queue/coop', body);
}

/**
 * (T073) A minimal live GameState fixture for the application-path tests
 * (schemaVersion 2 co-op overlay present, empty segment list).
 */
function liveState(lastAdvancedAt: string): GameState {
  return {
    resources: { loc: '0', cash: '0', aiTokens: '0' },
    ownedProducers: new Set(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt,
    schemaVersion: 2,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
    activeTraining: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StompClient', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('constructs the stompjs Client with the given brokerURL', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});

    expect(instances).toHaveLength(1);
    expect(instances[0]!.brokerURL).toBe(BROKER);
  });

  it('on connect, subscribes to /user/queue/state', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});

    const dests = instances[0]!.subscriptions.map((s) => s.destination);
    expect(dests).toContain('/user/queue/state');
  });

  it('activates the underlying client on connect', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});

    expect(instances[0]!.activateCalls).toBe(1);
    expect(stomp.isConnected).toBe(true);
  });

  it('connect is idempotent: does not create a second client/subscription', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});
    stomp.connect({});

    expect(instances).toHaveLength(1);
    expect(instances[0]!.activateCalls).toBe(1);
  });

  it('routes a state.correction message to onStateCorrection(state, reason)', () => {
    const onStateCorrection = vi.fn();
    const onContentUpdate = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onStateCorrection, onContentUpdate });

    deliver(JSON.stringify({ type: 'state.correction', state: wireState('123'), reason: 'multi_device_sync' }));

    expect(onStateCorrection).toHaveBeenCalledOnce();
    expect(onContentUpdate).not.toHaveBeenCalled();
    const [state, reason] = onStateCorrection.mock.calls[0]!;
    expect(reason).toBe('multi_device_sync');
    // Ownership arrays are reconstructed into Sets (wire -> GameState).
    expect(state.ownedProducers).toBeInstanceOf(Set);
    expect((state.ownedProducers as Set<string>).has('manual_typing')).toBe(true);
    expect((state as GameState).resources.loc).toBe('123');
  });

  it('routes a content.update message to onContentUpdate(contentVersion)', () => {
    const onStateCorrection = vi.fn();
    const onContentUpdate = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onStateCorrection, onContentUpdate });

    deliver(JSON.stringify({ type: 'content.update', contentVersion: '1.2.0' }));

    expect(onContentUpdate).toHaveBeenCalledOnce();
    expect(onContentUpdate).toHaveBeenCalledWith('1.2.0');
    expect(onStateCorrection).not.toHaveBeenCalled();
  });

  it('ignores an unknown message type (no handler called, no throw)', () => {
    const onStateCorrection = vi.fn();
    const onContentUpdate = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onStateCorrection, onContentUpdate });

    expect(() =>
      deliver(JSON.stringify({ type: 'something.unknown', foo: 'bar' })),
    ).not.toThrow();

    expect(onStateCorrection).not.toHaveBeenCalled();
    expect(onContentUpdate).not.toHaveBeenCalled();
  });

  it('ignores an unparseable message body without throwing', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({ onStateCorrection: vi.fn(), onContentUpdate: vi.fn() });

    expect(() => deliver('<<<not-json>>>')).not.toThrow();
  });

  it('disconnect calls deactivate() on the underlying client', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});
    const client = instances[0]!;

    stomp.disconnect();

    expect(client.deactivateCalls).toBe(1);
    expect(stomp.isConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (002) T061 — bearer in the CONNECT frame + /topic/presence + heartbeat
// ---------------------------------------------------------------------------

describe('StompClient — bearer in the CONNECT frame (fresh token per connect)', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('supplies a fresh bearer in connectHeaders when a token is held', () => {
    const { source } = tokenSource('access-tok-1');
    const stomp = new StompClient(BROKER, source);
    stomp.connect({});

    // beforeConnect ran during activate() and set the CONNECT headers.
    expect(instances[0]!.beforeConnect).toBeInstanceOf(Function);
    expect(instances[0]!.connectHeaders).toEqual({ Authorization: 'Bearer access-tok-1' });
  });

  it('omits the Authorization header when signed out (no token)', () => {
    const { source } = tokenSource(null);
    const stomp = new StompClient(BROKER, source);
    stomp.connect({});

    expect(instances[0]!.connectHeaders?.Authorization).toBeUndefined();
  });

  it('omits the Authorization header when no token source is configured', () => {
    const stomp = new StompClient(BROKER); // no token source
    stomp.connect({});

    expect(instances[0]!.connectHeaders?.Authorization).toBeUndefined();
  });

  it('re-reads the token source on every beforeConnect call (fresh token per reconnect)', () => {
    // Access tokens live minutes while the socket lives hours; the library
    // calls beforeConnect before each (re)connection attempt. A static header
    // would replay a stale token; beforeConnect must re-read the source.
    const { source, set } = tokenSource('tok-A');
    const stomp = new StompClient(BROKER, source);
    stomp.connect({});
    expect(instances[0]!.connectHeaders).toEqual({ Authorization: 'Bearer tok-A' });

    // Simulate a reconnect after the token was renewed.
    set('tok-B');
    instances[0]!.beforeConnect?.(instances[0]!);
    expect(instances[0]!.connectHeaders).toEqual({ Authorization: 'Bearer tok-B' });

    // And a reconnect after sign-out.
    set(null);
    instances[0]!.beforeConnect?.(instances[0]!);
    expect(instances[0]!.connectHeaders?.Authorization).toBeUndefined();
  });

  it('late-bound setTokenSource is read by beforeConnect', () => {
    const stomp = new StompClient(BROKER); // starts signed out
    stomp.connect({});
    expect(instances[0]!.connectHeaders?.Authorization).toBeUndefined();

    const { source } = tokenSource('late-tok');
    stomp.setTokenSource(source);
    instances[0]!.beforeConnect?.(instances[0]!);
    expect(instances[0]!.connectHeaders).toEqual({ Authorization: 'Bearer late-tok' });
  });
});

describe('StompClient — /topic/presence subscription + onPresence', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('subscribes to /topic/presence on connect (self-heals on reconnect)', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({ onPresence: vi.fn() });

    const dests = instances[0]!.subscriptions.map((s) => s.destination);
    expect(dests).toContain('/topic/presence');
  });

  it('routes a presence.update delta to onPresence as a parsed object', () => {
    const onPresence = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onPresence });

    const delta = { type: 'presence.update', serverTime: '2026-07-01T09:00:30Z', record: { colleagueId: 'a' } };
    deliverPresence(JSON.stringify(delta));

    expect(onPresence).toHaveBeenCalledOnce();
    expect(onPresence).toHaveBeenCalledWith(delta);
  });

  it('routes a presence.remove delta to onPresence', () => {
    const onPresence = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onPresence });

    deliverPresence(JSON.stringify({ type: 'presence.remove', colleagueId: 'a' }));

    expect(onPresence).toHaveBeenCalledWith({ type: 'presence.remove', colleagueId: 'a' });
  });

  it('ignores an unparseable presence body without throwing (no handler call)', () => {
    const onPresence = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onPresence });

    expect(() => deliverPresence('<<<not-json>>>')).not.toThrow();
    expect(onPresence).not.toHaveBeenCalled();
  });

  it('does not call onPresence when it is omitted (no throw)', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({}); // no onPresence handler
    expect(() =>
      deliverPresence(JSON.stringify({ type: 'presence.update', record: { colleagueId: 'a' } })),
    ).not.toThrow();
  });
});

describe('StompClient.publishHeartbeat', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('publishes to /app/presence.heartbeat with the payload body when connected', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});

    const payload: HeartbeatPayload = {
      office: 'office_1',
      activity: 'coding',
      commute: null,
    };
    stomp.publishHeartbeat(payload);

    expect(instances[0]!.publishCalls).toHaveLength(1);
    expect(instances[0]!.publishCalls[0]!.destination).toBe('/app/presence.heartbeat');
    expect(JSON.parse(instances[0]!.publishCalls[0]!.body!)).toEqual(payload);
  });

  it('serializes a commuting heartbeat (office null, commute set)', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});

    const payload: HeartbeatPayload = {
      office: null,
      activity: 'commuting',
      commute: { fromOffice: 'office_1', toOffice: 'office_2' },
    };
    stomp.publishHeartbeat(payload);
    expect(JSON.parse(instances[0]!.publishCalls[0]!.body!)).toEqual(payload);
  });

  it('is a no-op when not connected (never publishes)', () => {
    const stomp = new StompClient(BROKER);
    // No connect() — isConnected is false.
    stomp.publishHeartbeat({ office: 'office_1', activity: 'coding', commute: null });

    // No client was ever constructed, so nothing to inspect — assert no throw.
    expect(instances).toHaveLength(0);
  });

  it('is a no-op after disconnect', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({});
    const client = instances[0]!;
    stomp.disconnect();

    stomp.publishHeartbeat({ office: 'office_1', activity: 'coding', commute: null });
    expect(client.publishCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (002) T073 — /user/queue/coop subscription + onCoopSegment
// ---------------------------------------------------------------------------
//
// contracts §3 `coop.segment`: a server-authored lease segment for the
// receiving player only, on the user-addressed `/user/queue/coop` queue:
//   { "type": "coop.segment",
//     "segment": { "from": "<ISO>", "until": "<ISO>", "multiplier": 1.2 } }
//
// The wire carries ISO-8601 instants while the sim `CoopSegment` uses the
// numeric sim-timeline (ms) — the client CONVERTS AT THE TRANSPORT BOUNDARY
// (`Date.parse`), mirroring the array→Set conversion for state.corrections.
// Beyond that conversion the transport does NOT validate: `applyCoopPresence`
// is the defense layer (a garbage timestamp becomes NaN and is dropped there,
// never thrown — FR-017/018).

describe('StompClient — /user/queue/coop subscription + onCoopSegment (T073)', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('subscribes to /user/queue/coop on connect (self-heals on reconnect)', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment: vi.fn() });

    const dests = instances[0]!.subscriptions.map((s) => s.destination);
    expect(dests).toContain('/user/queue/coop');

    // Self-heal: the library re-fires onConnect on every reconnect; the coop
    // subscription must be re-created (contracts §3 "Reconnect").
    instances[0]!.onConnect?.({});
    const coopSubs = instances[0]!.subscriptions.filter(
      (s) => s.destination === '/user/queue/coop',
    );
    expect(coopSubs).toHaveLength(2);
  });

  it('routes a coop.segment to onCoopSegment with ISO instants converted to sim-timeline ms', () => {
    const onCoopSegment = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment });

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: {
          from: '2026-07-01T09:00:00Z',
          until: '2026-07-01T09:01:00Z',
          multiplier: 1.2,
        },
      }),
    );

    expect(onCoopSegment).toHaveBeenCalledOnce();
    expect(onCoopSegment).toHaveBeenCalledWith({
      from: Date.parse('2026-07-01T09:00:00Z'),
      until: Date.parse('2026-07-01T09:01:00Z'),
      multiplier: 1.2,
    });
  });

  it('does not route state/presence handlers from the coop queue (and vice versa)', () => {
    const onCoopSegment = vi.fn();
    const onStateCorrection = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment, onStateCorrection });

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:00Z', multiplier: 1.1 },
      }),
    );

    expect(onStateCorrection).not.toHaveBeenCalled();
    expect(onCoopSegment).toHaveBeenCalledOnce();
  });

  it('ignores an unknown message type on the coop queue (no handler call, no throw)', () => {
    const onCoopSegment = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment });

    expect(() =>
      deliverCoop(JSON.stringify({ type: 'something.unknown', foo: 'bar' })),
    ).not.toThrow();
    expect(onCoopSegment).not.toHaveBeenCalled();
  });

  it('ignores a coop.segment with a missing/non-object segment field (no handler call)', () => {
    const onCoopSegment = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment });

    expect(() => deliverCoop(JSON.stringify({ type: 'coop.segment' }))).not.toThrow();
    expect(() =>
      deliverCoop(JSON.stringify({ type: 'coop.segment', segment: 'nope' })),
    ).not.toThrow();
    expect(onCoopSegment).not.toHaveBeenCalled();
  });

  it('ignores an unparseable coop body without throwing (no handler call)', () => {
    const onCoopSegment = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment });

    expect(() => deliverCoop('<<<not-json>>>')).not.toThrow();
    expect(onCoopSegment).not.toHaveBeenCalled();
  });

  it('does not throw when onCoopSegment is omitted', () => {
    const stomp = new StompClient(BROKER);
    stomp.connect({}); // no onCoopSegment handler
    expect(() =>
      deliverCoop(
        JSON.stringify({
          type: 'coop.segment',
          segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:00Z', multiplier: 1.2 },
        }),
      ),
    ).not.toThrow();
  });

  it('passes garbage timestamps through as NaN (validation lives in applyCoopPresence)', () => {
    // The transport is a thin wrapper: it converts, it does not judge.
    // coop.ts explicitly defends against "a Date.parse('garbage') NaN the
    // wire layer passed through" — this pins that layering.
    const onCoopSegment = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onCoopSegment });

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: 'garbage', until: '2026-07-01T09:01:00Z', multiplier: 1.2 },
      }),
    );

    expect(onCoopSegment).toHaveBeenCalledOnce();
    const seg = onCoopSegment.mock.calls[0]![0] as CoopSegment;
    expect(Number.isNaN(seg.from)).toBe(true);
    expect(seg.until).toBe(Date.parse('2026-07-01T09:01:00Z'));
  });
});

// ---------------------------------------------------------------------------
// (002) onConnected — reconnect notification (cubic P3 follow-up on 906588e)
// ---------------------------------------------------------------------------
//
// presenceClient.ts documents the snapshot as "re-fetched after every
// (re)connect", but StompHandlers exposed no reconnect signal, so main.ts
// could only fetch once at boot — presence deltas missed during a disconnect
// window were permanently lost (a colleague removed while offline stayed
// rendered as a ghost until page reload). `onConnected` fires from the
// library's onConnect on EVERY (re)connect, AFTER the subscriptions above are
// (re)created, so the caller can re-fetch the snapshot with the delta stream
// already flowing (no subscribe/fetch race window).

describe('StompClient — onConnected fires on every (re)connect', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('invokes onConnected once on the initial connect', () => {
    const onConnected = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onConnected });

    expect(onConnected).toHaveBeenCalledOnce();
  });

  it('re-invokes onConnected on every library-driven reconnect', () => {
    const onConnected = vi.fn();
    const stomp = new StompClient(BROKER);
    stomp.connect({ onConnected });
    expect(onConnected).toHaveBeenCalledOnce();

    // The library re-fires onConnect on each reconnect — the same path the
    // subscription self-heal rides (contracts §3 "Reconnect").
    instances[0]!.onConnect?.({});
    instances[0]!.onConnect?.({});

    expect(onConnected).toHaveBeenCalledTimes(3);
  });

  it('fires AFTER the subscriptions are (re)created (snapshot re-fetch cannot race the delta stream)', () => {
    // If onConnected fired before the subscribes, a delta arriving between
    // the snapshot fetch and the (re)subscription would be silently missed —
    // the exact class of loss this handler exists to close.
    const destsAtCall: string[][] = [];
    const stomp = new StompClient(BROKER);
    stomp.connect({
      onConnected: () => {
        destsAtCall.push(instances[0]!.subscriptions.map((s) => s.destination));
      },
    });

    expect(destsAtCall).toHaveLength(1);
    expect(destsAtCall[0]).toContain('/user/queue/state');
    expect(destsAtCall[0]).toContain('/topic/presence');
    expect(destsAtCall[0]).toContain('/user/queue/coop');
  });

  it('does not throw when onConnected is omitted', () => {
    const stomp = new StompClient(BROKER);
    expect(() => stomp.connect({})).not.toThrow();
    // And a reconnect without the handler stays silent too.
    expect(() => instances[0]!.onConnect?.({})).not.toThrow();
  });
});

describe('StompClient — coop.segment application path via applyCoopPresence (T073)', () => {
  // These tests drive the REAL transport conversion into the REAL pure merge
  // (sim/coop.ts) with the REAL bundled content — the exact wiring main.ts
  // performs at its safe mutation point, minus the loop/save side effects.
  beforeEach(() => {
    instances.length = 0;
  });

  /** Connect a client whose onCoopSegment merges into a captive state. */
  function connectMerging(initial: GameState): { current: () => GameState } {
    let state = initial;
    const stomp = new StompClient(BROKER);
    stomp.connect({
      onCoopSegment: (segment: CoopSegment) => {
        state = applyCoopPresence(state, segment, FALLBACK_CONTENT);
      },
    });
    return { current: () => state };
  }

  it('merges a delivered coop.segment into state.coopSegments (upsert by from)', () => {
    const anchor = '2026-07-01T09:00:00.000Z';
    const handle = connectMerging(liveState(anchor));

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:00Z', multiplier: 1.2 },
      }),
    );

    expect(handle.current().coopSegments).toEqual([
      {
        from: Date.parse('2026-07-01T09:00:00Z'),
        until: Date.parse('2026-07-01T09:01:00Z'),
        multiplier: 1.2,
      },
    ]);
  });

  it('re-delivery of the same heartbeat extension is idempotent (one segment)', () => {
    const handle = connectMerging(liveState('2026-07-01T09:00:00.000Z'));
    const body = JSON.stringify({
      type: 'coop.segment',
      segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:00Z', multiplier: 1.2 },
    });

    deliverCoop(body);
    deliverCoop(body);

    expect(handle.current().coopSegments).toHaveLength(1);
    expect(handle.current().coopSegments[0]!.multiplier).toBe(1.2);
  });

  it('a heartbeat extension (same from, later until) extends the stored segment', () => {
    const handle = connectMerging(liveState('2026-07-01T09:00:00.000Z'));

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:00Z', multiplier: 1.2 },
      }),
    );
    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:20Z', multiplier: 1.2 },
      }),
    );

    expect(handle.current().coopSegments).toEqual([
      {
        from: Date.parse('2026-07-01T09:00:00Z'),
        until: Date.parse('2026-07-01T09:01:20Z'),
        multiplier: 1.2,
      },
    ]);
  });

  it('a malformed segment (garbage timestamp) leaves the state untouched', () => {
    const initial = liveState('2026-07-01T09:00:00.000Z');
    const handle = connectMerging(initial);

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: 'garbage', until: '2026-07-01T09:01:00Z', multiplier: 1.2 },
      }),
    );

    // applyCoopPresence returns the state UNCHANGED (same reference) on bad input.
    expect(handle.current()).toBe(initial);
  });

  it('a stale segment (fully before lastAdvancedAt) is never re-credited', () => {
    // Missed segments during a disconnect are NOT retroactively issued
    // (contracts §3); a late/stale delivery must not credit past time.
    const initial = liveState('2026-07-01T09:05:00.000Z');
    const handle = connectMerging(initial);

    deliverCoop(
      JSON.stringify({
        type: 'coop.segment',
        segment: { from: '2026-07-01T09:00:00Z', until: '2026-07-01T09:01:00Z', multiplier: 1.5 },
      }),
    );

    expect(handle.current()).toBe(initial);
  });
});
