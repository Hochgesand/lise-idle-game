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
import type {
  GameState,
  ContentEnvelope,
} from '../sim/types';
// (002) T056a — auth + identity-adoption client tests (contracts §2).
// These types do not exist on the RestClient yet (RED); the GREEN impl in
// T058 adds them.
import type {
  AccessToken,
  TokenSource,
  MeResponse,
  IdentityAdoption,
} from './restClient';

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

    // (002) T035: the wire fixture omits the co-op fields, so fromWire must
    // normalize them to the Spec 001 baseline (leniency rule) — never null/undefined.
    expect(state!.coopSegments).toEqual([]);
    expect(state!.activeOffice).toBe('office_1');
    expect(state!.commute).toBeNull();
  });

  it('normalizes explicit null co-op fields to the baseline (002)', async () => {
    const wireState = {
      resources: { loc: '0', cash: '0', aiTokens: '0' },
      ownedProducers: [],
      ownedUpgrades: [],
      ownedTrainings: [],
      activeBurner: null,
      earnedMilestones: [],
      lastAdvancedAt: '2026-06-30T12:00:00.000Z',
      schemaVersion: 1,
      settings: { reducedMotion: false, muted: false },
      coopSegments: null,
      activeOffice: null,
      commute: null,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'p1', state: wireState }),
    );

    const client = new RestClient(BASE);
    const state = await client.loadSession('p1');

    expect(state!.coopSegments).toEqual([]);
    expect(state!.activeOffice).toBe('office_1');
    expect(state!.commute).toBeNull();
  });

  it('passes present coopSegments/activeOffice/commute through from the wire (002)', async () => {
    const wireState = {
      resources: { loc: '0', cash: '0', aiTokens: '0' },
      ownedProducers: [],
      ownedUpgrades: [],
      ownedTrainings: [],
      activeBurner: null,
      earnedMilestones: [],
      lastAdvancedAt: '2026-06-30T12:00:00.000Z',
      schemaVersion: 1,
      settings: { reducedMotion: false, muted: false },
      coopSegments: [{ from: 1000, until: 2000, multiplier: 1.2 }],
      activeOffice: 'office_2',
      commute: { fromOffice: 'office_2', toOffice: 'office_3', startedAt: 1500 },
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'p1', state: wireState }),
    );

    const client = new RestClient(BASE);
    const state = await client.loadSession('p1');

    // Present values pass through unchanged (sim keeps ms numbers; no conversion).
    expect(state!.coopSegments).toEqual([
      { from: 1000, until: 2000, multiplier: 1.2 },
    ]);
    expect(state!.activeOffice).toBe('office_2');
    expect(state!.commute).toEqual({
      fromOffice: 'office_2',
      toOffice: 'office_3',
      startedAt: 1500,
    });
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

    // (002) T035: toWire serializes the co-op overlay fields onto the wire
    // (same shape as the live state — the baseline defaults ride through).
    expect(body.state.coopSegments).toEqual([]);
    expect(body.state.activeOffice).toBe('office_1');
    expect(body.state.commute).toBeNull();

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

// ---------------------------------------------------------------------------
// (002) T056a — auth header + identity adoption (contracts §2)
// ---------------------------------------------------------------------------
//
// The RestClient consumes a mocked TokenSource (no real Keycloak network):
// when a token is held it attaches `Authorization: Bearer <token>` to
// authenticated calls; when signed out (no token source / null token) it
// omits the header and the anonymous-UUID path works as in 001. Identity
// adoption (contracts §2, binding): after sign-in the client adopts the
// Keycloak `sub` (echoed by /api/v1/me) as its playerId — re-bootstrapping
// POST /api/v1/session under that id and pushing local state via
// PUT /api/v1/session/{colleagueId}/state. The anonymous-UUID row is
// orphaned, NEVER wiped (orphan-never-wipe). A 401 or network failure
// degrades to signed-out behavior without throwing into the game loop
// (FR-001/002/016).

/** Build a TokenSource that returns the given token (null => signed out). */
function tokenSource(token: string | null): TokenSource {
  let current: AccessToken | null = token === null ? null : { token };
  return {
    getToken: () => current,
  };
}

/** Headers actually sent on a captured fetch call (init.headers). */
function sentHeaders(call: unknown[]): Record<string, string> {
  const init = call[1] as { headers?: Record<string, string> } | undefined;
  return init?.headers ?? {};
}

/** A minimal wire state for session/ bootstrap / push fixtures. */
function wireState(loc = '0'): Record<string, unknown> {
  return {
    schemaVersion: 2,
    resources: { loc, cash: '0', aiTokens: '0' },
    ownedProducers: ['manual_typing'],
    ownedUpgrades: [],
    ownedTrainings: [],
    activeBurner: null,
    earnedMilestones: [],
    lastAdvancedAt: '2026-06-30T12:00:00.000Z',
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

/** A valid /api/v1/me response body. */
function meBody(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    colleagueId: 'keycloak-sub-uuid',
    displayName: 'Ada Example',
    avatar: 'avatar-7',
    consentGiven: true,
    visible: true,
    ...overrides,
  };
}

describe('RestClient — bearer token attachment (T058)', () => {
  it('attaches Authorization: Bearer when a token is held (on loadSession)', async () => {
    const client = new RestClient(BASE, tokenSource('abc123'));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'p1', state: wireState('10') }),
    );

    await client.loadSession('p1');

    expect(sentHeaders(fetchMock.mock.calls[0]!)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer abc123',
    });
  });

  it('omits Authorization when the token source holds no token', async () => {
    const client = new RestClient(BASE, tokenSource(null));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'p1', state: wireState('10') }),
    );

    await client.loadSession('p1');

    const headers = sentHeaders(fetchMock.mock.calls[0]!);
    expect(headers.Authorization).toBeUndefined();
  });

  it('omits Authorization when no token source is configured (001 anonymous path)', async () => {
    const client = new RestClient(BASE); // no token source
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'p1', state: wireState('10') }),
    );

    await client.loadSession('p1');

    const headers = sentHeaders(fetchMock.mock.calls[0]!);
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('attaches the bearer on saveState (PUT) when a token is held', async () => {
    const client = new RestClient(BASE, tokenSource('tok-1'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { state: wireState('100') }));

    await client.saveState('p1', makeState('100'), '2026-06-30T12:00:00.000Z');

    expect(sentHeaders(fetchMock.mock.calls[0]!)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-1',
    });
  });
});

describe('RestClient.getMe (T058)', () => {
  it('GETs <base>/api/v1/me with the bearer and returns the parsed identity on 200', async () => {
    const client = new RestClient(BASE, tokenSource('tok-1'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meBody()));

    const me = await client.getMe();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/v1/me`);
    expect(init?.method).toBe('GET');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(me).toEqual(meBody());
  });

  it('throws a RestError(status 401) when the token is missing/invalid (server-side gate)', async () => {
    const client = new RestClient(BASE, tokenSource('stale'));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'not_authenticated', message: 'no token' } }),
    );

    await expect(client.getMe()).rejects.toMatchObject({
      name: 'RestError',
      status: 401,
      code: 'not_authenticated',
    });
  });
});

describe('RestClient.adoptIdentity — identity adoption (T058, contracts §2)', () => {
  it('re-bootstraps POST /api/v1/session under colleagueId and pushes PUT (orphan-never-wipe)', async () => {
    const client = new RestClient(BASE, tokenSource('tok-1'));
    // 1. getMe -> colleagueId
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meBody({ colleagueId: 'ada-sub' })));
    // 2. re-bootstrap POST under the colleague id (fresh colleague -> 404 -> null)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'no_save', message: 'fresh' } }),
    );
    // 3. push local state via PUT under the colleague id
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { state: wireState('500') }));

    const local = makeState('500');
    const result: IdentityAdoption = await client.adoptIdentity(local, '2026-07-01T09:00:00.000Z');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected adoption to succeed');

    // colleagueId adopted from the JWT sub echoed by /me.
    expect(result.colleagueId).toBe('ada-sub');
    // Re-bootstrap returned null (fresh colleague — no prior server save).
    expect(result.serverState).toBeNull();
    // Merged state from the PUT push, reconstructed into a live GameState.
    expect(result.mergedState.resources.loc).toBe('500');
    expect(result.mergedState.ownedProducers).toBeInstanceOf(Set);

    // The bootstrap POST targeted the colleague id (not any anonymous uuid).
    const [, bootstrapInit] = fetchMock.mock.calls[1]!;
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/api/v1/session`);
    expect(JSON.parse((bootstrapInit!.body as string))).toEqual({ playerId: 'ada-sub' });

    // The push PUT targeted /api/v1/session/ada-sub/state with the LOCAL state.
    expect(fetchMock.mock.calls[2]![0]).toBe(`${BASE}/api/v1/session/ada-sub/state`);
    const pushBody = JSON.parse((fetchMock.mock.calls[2]![1]!.body as string));
    expect(pushBody.clientTime).toBe('2026-07-01T09:00:00.000Z');
    expect(pushBody.state.resources.loc).toBe('500');

    // Orphan-never-wipe: NO DELETE was issued against the anonymous-UUID row,
    // and the bootstrap+push targeted only the colleague id. The anonymous row
    // is left in place (a manual/support action to restore).
    const methods = fetchMock.mock.calls.map((c) => (c[1] as { method?: string } | undefined)?.method);
    expect(methods).not.toContain('DELETE');

    // The local save content itself is untouched by adoption (input not mutated).
    expect(local.resources.loc).toBe('500');
    expect([...local.ownedProducers]).toEqual(['manual_typing']);
  });

  it('adopts an existing colleague server save without wiping local progress', async () => {
    // The colleague already has a server save (POST 200 with a state). Adoption
    // still pushes local; the monotonic max-merge preserves the higher of each
    // field (contracts §2 / data-model merge rule). Local content is unchanged.
    const client = new RestClient(BASE, tokenSource('tok-1'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meBody({ colleagueId: 'bob-sub' })));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { playerId: 'bob-sub', state: wireState('250') }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { state: wireState('500') }));

    const local = makeState('500');
    const result = await client.adoptIdentity(local, '2026-07-01T09:00:00.000Z');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected adoption to succeed');
    // serverState is the colleague's pre-existing save.
    expect(result.serverState).not.toBeNull();
    expect(result.serverState!.resources.loc).toBe('250');
    expect(local.resources.loc).toBe('500'); // local untouched
  });

  it('degrades to signed-out (no throw) on a 401 from /me', async () => {
    const client = new RestClient(BASE, tokenSource('expired'));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'not_authenticated', message: 'expired' } }),
    );

    const result = await client.adoptIdentity(makeState('500'), '2026-07-01T09:00:00.000Z');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected signed-out degradation');
    expect(result.reason).toBe('signed_out');
    // Only the /me probe ran — no bootstrap, no push (nothing written under any id).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully (no throw) on a network failure from /me, reported as a transient network error', async () => {
    // A network failure (not a 401) is transient and retryable — distinct from
    // a genuinely signed-out state. It must still never throw into the game
    // loop, but the caller can tell a transient failure apart from a lost
    // token so it doesn't wrongly prompt re-login.
    const client = new RestClient(BASE, tokenSource('tok-1'));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await client.adoptIdentity(makeState('500'), '2026-07-01T09:00:00.000Z');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected degradation');
    expect(result.reason).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully (no throw) on a network failure mid-adoption, reported as a transient network error', async () => {
    // /me succeeds (the token is valid and the colleagueId is known), but the
    // PUT push fails on the network — adoption still never throws into the
    // game loop. The failure is transient (network), NOT signed-out: the
    // caller should retry the push, not drop the session.
    const client = new RestClient(BASE, tokenSource('tok-1'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meBody({ colleagueId: 'ada-sub' })));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: 'no_save', message: 'fresh' } }));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await client.adoptIdentity(makeState('500'), '2026-07-01T09:00:00.000Z');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected degradation');
    expect(result.reason).toBe('network');
  });

  it('reports a permanent schema_too_new (not retryable network) when the push 409s', async () => {
    // The PUT push returns 409 schema_too_new (the client's schemaVersion is
    // newer than the server supports). This is permanent — retrying the push
    // will never succeed — so it is classified distinctly from a transient
    // network failure (the caller should prompt a reload, not retry).
    const client = new RestClient(BASE, tokenSource('tok-1'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, meBody({ colleagueId: 'ada-sub' })));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: 'no_save', message: 'fresh' } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'schema_too_new', message: 'update required' } }),
    );

    const result = await client.adoptIdentity(makeState('500'), '2026-07-01T09:00:00.000Z');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('schema_too_new');
  });
});
