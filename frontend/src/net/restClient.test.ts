// T030 — RED unit tests for the REST client (TDD).
//
// The frontend talks to the Spring Boot backend over REST (contracts §2):
//   GET  /api/v1/content                       -> 200 content envelope
//   POST /api/v1/session        { playerId }   -> 200 { playerId, state } | 404 error
//   PUT  /api/v1/session/{id}/state { state, clientTime } -> 200 { state } | 409 error
//
// `fetch` is stubbed per test via `vi.stubGlobal` (jsdom provides a fetch, but
// stubbing is deterministic and isolates the client from the network). Mock
// responses are real `Response` objects (jsdom provides the constructor).
//
// This file imports `./restClient`, which does NOT exist yet, so the suite
// fails to resolve its import = RED, the correct TDD starting state
// (Constitution Principle III).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestClient, RestError, SchemaTooNewError } from './restClient';
import type { GameState, ContentEnvelope } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE = 'https://api.example.test';

/** A minimal valid GameState with one owned producer. */
function makeState(loc = '100'): GameState {
  return {
    resources: { loc, cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: '2026-06-30T12:00:00.000Z',
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

/** Build a JSON `Response` with the given status + body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Test harness: stub a fresh `fetch` mock per test, restored after each.
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// getContent
// ---------------------------------------------------------------------------

describe('RestClient.getContent', () => {
  it('GETs <base>/api/v1/content and returns the parsed envelope on 200', async () => {
    const envelope: ContentEnvelope = {
      schemaVersion: 1,
      contentVersion: '1.0.0',
      producers: [],
      upgrades: [],
      trainings: [],
      milestones: [],
      burners: [],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, envelope));

    const client = new RestClient(BASE);
    const result = await client.getContent();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/v1/content`);
    expect(init?.method).toBe('GET');
    expect(result).toEqual(envelope);
  });

  it('throws a RestError (carrying the status) on a non-200 response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { code: 'internal', message: 'boom' } }),
    );

    const client = new RestClient(BASE);
    await expect(client.getContent()).rejects.toMatchObject({
      name: 'RestError',
      status: 500,
      code: 'internal',
    });
  });
});

// ---------------------------------------------------------------------------
// loadSession
// ---------------------------------------------------------------------------

describe('RestClient.loadSession', () => {
  it('POSTs { playerId } and returns the parsed state on 200', async () => {
    // The backend serializes ownership Set<String> fields as JSON arrays.
    const wireState = {
      resources: { loc: '250', cash: '0', aiTokens: '0' },
      ownedProducers: ['manual_typing', 'copilot'],
      ownedUpgrades: [],
      ownedTrainings: [],
      activeBurner: null,
      earnedMilestones: [],
      lastAdvancedAt: '2026-06-30T12:00:00.000Z',
      schemaVersion: 1,
      settings: { reducedMotion: false, muted: false },
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'p1', state: wireState }),
    );

    const client = new RestClient(BASE);
    const state = await client.loadSession('p1');

    // Request shape: POST to /api/v1/session with { playerId }.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/v1/session`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ playerId: 'p1' });

    // Returned state has the big-number string + ownership Sets reconstructed
    // from the wire arrays (a real GameState, usable by the pure sim).
    expect(state).not.toBeNull();
    expect(state!.resources.loc).toBe('250');
    expect(state!.ownedProducers).toBeInstanceOf(Set);
    expect([...state!.ownedProducers!]).toEqual(['manual_typing', 'copilot']);
  });

  it('returns null on 404 (no save — fresh-player contract)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'no_save', message: 'no save' } }),
    );

    const client = new RestClient(BASE);
    await expect(client.loadSession('fresh')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveState
// ---------------------------------------------------------------------------

describe('RestClient.saveState', () => {
  it('PUTs { state, clientTime } and returns the merged state on 200', async () => {
    const merged = {
      resources: { loc: '300', cash: '0', aiTokens: '0' },
      ownedProducers: ['manual_typing'],
      ownedUpgrades: [],
      ownedTrainings: [],
      activeBurner: null,
      earnedMilestones: [],
      lastAdvancedAt: '2026-06-30T12:00:00.000Z',
      schemaVersion: 1,
      settings: { reducedMotion: false, muted: false },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { state: merged }));

    const client = new RestClient(BASE);
    const state = makeState('100');
    const result = await client.saveState('p1', state, '2026-06-30T12:00:00.000Z');

    // Request shape: PUT to /api/v1/session/{playerId}/state.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/v1/session/p1/state`);
    expect(init?.method).toBe('PUT');

    // The body is { state, clientTime } and the Set ownership was serialized
    // to arrays on the wire (JSON.stringify(Set) would lose the contents).
    const body = JSON.parse(init!.body as string);
    expect(body.clientTime).toBe('2026-06-30T12:00:00.000Z');
    expect(body.state.ownedProducers).toEqual(['manual_typing']);
    expect(body.state.resources.loc).toBe('100');

    // Merged state returned with Sets reconstructed from wire arrays.
    expect(result.resources.loc).toBe('300');
    expect(result.ownedProducers).toBeInstanceOf(Set);
  });

  it('throws SchemaTooNewError on 409', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'schema_too_new', message: 'update required' } }),
    );

    const client = new RestClient(BASE);
    await expect(
      client.saveState('p1', makeState(), '2026-06-30T12:00:00.000Z'),
    ).rejects.toMatchObject({
      name: 'SchemaTooNewError',
      status: 409,
      code: 'schema_too_new',
    });
  });
});

// ---------------------------------------------------------------------------
// Generic error handling
// ---------------------------------------------------------------------------

describe('RestClient — generic error envelope', () => {
  it('a RestError carries status + parsed code/message from the error envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, { error: { code: 'bad_gateway', message: 'upstream down' } }),
    );

    const client = new RestClient(BASE);
    await expect(client.saveState('p1', makeState(), '2026-06-30T12:00:00.000Z')).rejects.toMatchObject({
      name: 'RestError',
      status: 502,
      code: 'bad_gateway',
      message: 'upstream down',
    });
  });

  it('SchemaTooNewError is an instance of RestError', () => {
    const err = new SchemaTooNewError('schema_too_new', 'msg');
    expect(err).toBeInstanceOf(RestError);
    expect(err).toBeInstanceOf(SchemaTooNewError);
    expect(err.status).toBe(409);
  });
});
