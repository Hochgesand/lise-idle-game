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

  interface MockClientShape {
    brokerURL: string | undefined;
    onConnect: ((frame: unknown) => void) | undefined;
    onStompError: ((frame: unknown) => void) | undefined;
    onWebSocketError: ((event: unknown) => void) | undefined;
    connected: boolean;
    subscriptionDestination: string | undefined;
    subscriptionCallback: ((message: { body: string }) => void) | undefined;
    activateCalls: number;
    deactivateCalls: number;
    activate(): void;
    deactivate(): void;
    subscribe(
      destination: string,
      callback: (message: { body: string }) => void,
    ): { id: string; unsubscribe: () => void };
  }

  class MockClientImpl implements MockClientShape {
    brokerURL: string | undefined;
    onConnect: ((frame: unknown) => void) | undefined = undefined;
    onStompError: ((frame: unknown) => void) | undefined = undefined;
    onWebSocketError: ((event: unknown) => void) | undefined = undefined;
    connected = false;
    subscriptionDestination: string | undefined;
    subscriptionCallback: ((message: { body: string }) => void) | undefined;
    activateCalls = 0;
    deactivateCalls = 0;

    constructor(config: { brokerURL?: string }) {
      this.brokerURL = config.brokerURL;
      instances.push(this);
    }

    activate(): void {
      this.activateCalls++;
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
      this.subscriptionDestination = destination;
      this.subscriptionCallback = callback;
      return { id: 'sub-1', unsubscribe: () => {} };
    }
  }

  return { MockClient: MockClientImpl, instances };
});

vi.mock('@stomp/stompjs', () => ({ Client: MockClient }));

// Imported AFTER vi.mock (hoisted) so it resolves the mocked Client.
import { StompClient } from './stompClient';
import type { GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BROKER = 'wss://api.example.test/ws';

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

/** Deliver a STOMP message body to the captured subscribe callback. */
function deliver(body: string): void {
  const client = instances[instances.length - 1];
  if (!client?.subscriptionCallback) {
    throw new Error('no active subscription to deliver to');
  }
  client.subscriptionCallback({ body });
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

    expect(instances[0]!.subscriptionDestination).toBe('/user/queue/state');
    expect(instances[0]!.subscriptionCallback).toBeInstanceOf(Function);
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
