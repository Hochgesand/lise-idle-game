// T056 — RED unit tests for the client presence model (TDD).
//
// The client holds an in-memory presence model fed by the snapshot
// (`GET /api/v1/presence`) and the `/topic/presence` deltas (contracts §2/§3).
// This file targets the MODEL (pure reconciliation logic — no fetch, no STOMP):
//   - snapshot replaces the model wholesale (authoritative as of serverTime)
//   - presence.update upserts / presence.remove drops by colleagueId
//   - deltas older than the snapshot's serverTime may be discarded
//   - malformed payloads + unknown type values are ignored silently
//     (never throw into the game loop — contracts §4)
//
// This file imports `./presenceClient`, which does not exist yet, so the suite
// fails to resolve its import = RED, the correct TDD starting state
// (Constitution Principle III).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PresenceModel, PresenceClient, PresenceFetchError } from './presenceClient';
import type { PresenceRecord, PresenceSnapshot } from './presenceClient';
import type { AccessToken, TokenSource } from './restClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a PresenceRecord fixture. Defaults to a live colleague in office_1;
 * `overrides` patch any field (colleagueId is the first positional arg).
 */
function rec(colleagueId: string, overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    colleagueId,
    displayName: colleagueId.toUpperCase(),
    avatar: `avatar-${colleagueId}`,
    office: 'office_1',
    activity: 'coding',
    commute: null,
    status: 'live',
    lastSeenAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

/** Build a snapshot fixture. */
function snapshot(
  serverTime: string,
  colleagues: PresenceRecord[],
  self: PresenceRecord | null = null,
): PresenceSnapshot {
  return { serverTime, self, colleagues };
}

/** Index a list of records by colleagueId for set-equality assertions. */
function byId(records: readonly PresenceRecord[]): Record<string, PresenceRecord> {
  const out: Record<string, PresenceRecord> = {};
  for (const r of records) out[r.colleagueId] = r;
  return out;
}

/** Find a record by colleagueId in the model. */
function find(model: PresenceModel, colleagueId: string): PresenceRecord | undefined {
  return model.colleagues().find((r) => r.colleagueId === colleagueId);
}

// ---------------------------------------------------------------------------
// applySnapshot — wholesale replace (authoritative as of serverTime)
// ---------------------------------------------------------------------------

describe('PresenceModel.applySnapshot', () => {
  it('replaces the model wholesale with the snapshot contents', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a'), rec('b')], rec('self')));

    expect(model.serverTime()).toBe('2026-07-01T09:00:00.000Z');
    expect(model.self()).toEqual(rec('self'));
    expect(byId(model.colleagues())).toEqual({ a: rec('a'), b: rec('b') });
  });

  it('a second snapshot fully replaces the first (a, b dropped when absent)', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a'), rec('b')]));
    model.applySnapshot(snapshot('2026-07-01T09:01:00.000Z', [rec('c')]));

    // Wholesale replace: stale a/b are gone, only c remains.
    expect(byId(model.colleagues())).toEqual({ c: rec('c') });
    expect(model.serverTime()).toBe('2026-07-01T09:01:00.000Z');
  });

  it('starts empty before any snapshot', () => {
    const model = new PresenceModel();
    expect(model.colleagues()).toEqual([]);
    expect(model.self()).toBeNull();
    expect(model.serverTime()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// presence.update — upsert by colleagueId
// ---------------------------------------------------------------------------

describe('PresenceModel — presence.update upsert', () => {
  it('replaces an existing colleague record by colleagueId', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a', { activity: 'coding' })]));

    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:00:30.000Z',
      record: rec('a', { activity: 'burning tokens', office: 'office_2' }),
    });

    const a = find(model, 'a');
    expect(a).toBeDefined();
    expect(a!.activity).toBe('burning tokens');
    expect(a!.office).toBe('office_2');
    // No duplicate record for the same colleagueId.
    expect(model.colleagues().filter((r) => r.colleagueId === 'a')).toHaveLength(1);
  });

  it('inserts a new colleague record (join)', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a')]));

    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:00:30.000Z',
      record: rec('c'),
    });

    expect(byId(model.colleagues())).toEqual({ a: rec('a'), c: rec('c') });
  });

  it('reflects the live -> last_seen transition via an update', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a', { status: 'live' })]));

    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:01:30.000Z',
      record: rec('a', { status: 'last_seen', lastSeenAt: '2026-07-01T09:01:30.000Z' }),
    });

    expect(find(model, 'a')!.status).toBe('last_seen');
  });
});

// ---------------------------------------------------------------------------
// presence.remove — drop by colleagueId
// ---------------------------------------------------------------------------

describe('PresenceModel — presence.remove drop', () => {
  it('drops the colleague record entirely (hide / consent revoke)', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a'), rec('b')]));

    model.applyDelta({ type: 'presence.remove', colleagueId: 'a' });

    expect(find(model, 'a')).toBeUndefined();
    expect(find(model, 'b')).toBeDefined();
  });

  it('is a no-op when the colleague is not present', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a')]));
    // Removing an unknown colleague must not throw or affect the others.
    model.applyDelta({ type: 'presence.remove', colleagueId: 'zzz' });
    expect(byId(model.colleagues())).toEqual({ a: rec('a') });
  });
});

// ---------------------------------------------------------------------------
// staleness — deltas older than the snapshot serverTime may be discarded
// ---------------------------------------------------------------------------

describe('PresenceModel — staleness', () => {
  it('discards a presence.update older than the snapshot serverTime', () => {
    const model = new PresenceModel();
    // Snapshot authoritative as of 09:01 (server-stamped, second precision).
    model.applySnapshot(snapshot('2026-07-01T09:01:00Z', []));

    // A stale update timestamped before the snapshot (millisecond precision) —
    // discarded. Mixing precisions also ensures the implementation compares
    // via Date.parse, not lexicographic string ordering.
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:00:00.000Z',
      record: rec('stale'),
    });

    expect(find(model, 'stale')).toBeUndefined();
  });

  it('applies a presence.update at or after the snapshot serverTime (boundary: equal applies)', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:01:00Z', []));

    // Equal instant, DIFFERENT precision: the snapshot is second-precision
    // ('...00Z') and the delta is millisecond-precision ('...00.000Z'). They
    // denote the same instant, so the delta is NOT older and MUST apply — a
    // lexicographic string comparison would rank '...00.000Z' < '...00Z' and
    // wrongly discard it, so this case pins the comparison to Date.parse.
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:01:00.000Z',
      record: rec('equal'),
    });
    expect(find(model, 'equal')).toBeDefined();

    // Strictly after: applies as well.
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:02:00.000Z',
      record: rec('fresh'),
    });
    expect(find(model, 'fresh')).toBeDefined();
  });

  it('applies updates when no snapshot has been received yet', () => {
    // Before any snapshot there is no authoritative baseline to compare against,
    // so updates are applied (the next snapshot refresh reconciles wholesale).
    const model = new PresenceModel();
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-01T09:00:00.000Z',
      record: rec('early'),
    });
    expect(find(model, 'early')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// robustness — malformed payloads + unknown types ignored silently
// ---------------------------------------------------------------------------

describe('PresenceModel — robustness (never throw into the game loop)', () => {
  it('ignores malformed payloads and unknown type values without throwing', () => {
    const model = new PresenceModel();
    model.applySnapshot(snapshot('2026-07-01T09:00:00.000Z', [rec('a')]));

    const malformed: unknown[] = [
      null,
      undefined,
      'not-an-object',
      42,
      {}, // no type
      { type: 'something.unknown' }, // unknown type
      { type: 'presence.update' }, // missing serverTime + record
      { type: 'presence.update', serverTime: '2026-07-01T09:00:30.000Z' }, // missing record
      { type: 'presence.update', serverTime: '2026-07-01T09:00:30.000Z', record: null }, // null record
      { type: 'presence.remove' }, // missing colleagueId
      { type: 'presence.remove', colleagueId: 123 }, // wrong type colleagueId
    ];

    for (const payload of malformed) {
      expect(() => model.applyDelta(payload)).not.toThrow();
    }

    // Model is unchanged by any of the malformed payloads.
    expect(byId(model.colleagues())).toEqual({ a: rec('a') });
  });
});

// ---------------------------------------------------------------------------
// PresenceClient.fetchSnapshot — snapshot fetch + bearer (contracts §2)
// ---------------------------------------------------------------------------

const FETCH_BASE = 'https://api.example.test';

/** Build a TokenSource that returns the given token (null => signed out). */
function tokenSource(token: string | null): TokenSource {
  let current: AccessToken | null = token === null ? null : { token };
  return { getToken: () => current };
}

/** Build a JSON `Response` with the given status + body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PresenceClient.fetchSnapshot', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs <base>/api/v1/presence with the bearer and applies the snapshot to the model', async () => {
    const client = new PresenceClient(FETCH_BASE, tokenSource('tok-1'));
    const snap = snapshot('2026-07-01T09:00:00Z', [rec('a'), rec('b')], rec('self'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, snap));

    await client.fetchSnapshot();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${FETCH_BASE}/api/v1/presence`);
    expect(init?.method).toBe('GET');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    // The snapshot replaced the model wholesale.
    expect(client.model.serverTime()).toBe('2026-07-01T09:00:00Z');
    expect(client.model.self()).toEqual(rec('self'));
    expect(client.model.colleagues()).toHaveLength(2);
  });

  it('omits the bearer when no token source is configured (signed out)', async () => {
    const client = new PresenceClient(FETCH_BASE); // no token source
    fetchMock.mockResolvedValueOnce(jsonResponse(200, snapshot('2026-07-01T09:00:00Z', [])));

    await client.fetchSnapshot();

    const headers = (fetchMock.mock.calls[0]![1]!.headers as Record<string, string>);
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws PresenceFetchError(status) on a non-2xx response and leaves the model untouched', async () => {
    const client = new PresenceClient(FETCH_BASE, tokenSource('tok-1'));
    // Pre-load the model so we can assert a failed fetch does not wipe it.
    client.model.applySnapshot(snapshot('2026-07-01T09:00:00Z', [rec('a')]));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'not_authenticated', message: 'no token' } }),
    );

    await expect(client.fetchSnapshot()).rejects.toMatchObject({
      name: 'PresenceFetchError',
      status: 401,
    });
    // The prior model is intact (presence is display-only + best-effort).
    expect(client.model.serverTime()).toBe('2026-07-01T09:00:00Z');
    expect(client.model.colleagues()).toHaveLength(1);
  });

  it('PresenceFetchError carries the status', () => {
    const err = new PresenceFetchError(500);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
  });

  it('leaves the model intact on a 2xx with a malformed body (no throw, no half-wipe)', async () => {
    const client = new PresenceClient(FETCH_BASE, tokenSource('tok-1'));
    client.model.applySnapshot(snapshot('2026-07-01T09:00:00Z', [rec('a'), rec('b')]));
    // A 200 whose body is nominally a snapshot but `colleagues` is not an array.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { serverTime: '2026-07-01T10:00:00Z', colleagues: 'not-an-array' }),
    );

    await expect(client.fetchSnapshot()).resolves.toBeUndefined();
    // Prior model intact (not cleared / not half-wiped).
    expect(client.model.serverTime()).toBe('2026-07-01T09:00:00Z');
    expect(client.model.colleagues()).toHaveLength(2);
  });

  it('leaves the model intact (no throw) on a 2xx with a non-JSON body', async () => {
    const client = new PresenceClient(FETCH_BASE, tokenSource('tok-1'));
    client.model.applySnapshot(snapshot('2026-07-01T09:00:00Z', [rec('a')]));
    // A 200 carrying a non-JSON body (e.g. an empty body or an HTML proxy page).
    fetchMock.mockResolvedValueOnce(
      new Response('<html>upstream proxy error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    await expect(client.fetchSnapshot()).resolves.toBeUndefined();
    // Prior model intact; no SyntaxError escaped into the game loop.
    expect(client.model.serverTime()).toBe('2026-07-01T09:00:00Z');
    expect(client.model.colleagues()).toHaveLength(1);
  });

  it('leaves the model intact (no throw) on a 2xx with a literal null body', async () => {
    const client = new PresenceClient(FETCH_BASE, tokenSource('tok-1'));
    client.model.applySnapshot(snapshot('2026-07-01T09:00:00Z', [rec('a')]));
    // A 200 whose body is valid JSON `null` (a proxy / empty-result serializer).
    fetchMock.mockResolvedValueOnce(jsonResponse(200, null));

    await expect(client.fetchSnapshot()).resolves.toBeUndefined();
    expect(client.model.serverTime()).toBe('2026-07-01T09:00:00Z');
    expect(client.model.colleagues()).toHaveLength(1);
  });
});
