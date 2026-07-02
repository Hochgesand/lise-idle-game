// T062 — Presence snapshot fetch + the client presence model (contracts §2/§3).
//
// The client holds an in-memory presence model fed two ways:
//   - `GET /api/v1/presence`  → a wholesale snapshot (authoritative as of its
//     `serverTime`); re-fetched after every (re)connect (the caller wires this
//     in main.ts, T063).
//   - `/topic/presence` deltas → `presence.update` (upsert) / `presence.remove`
//     (drop), routed through `PresenceModel.applyDelta`.
//
// The model is PURE reconciliation logic (no fetch, no STOMP, no Date.now() at
// construction). Malformed payloads and unknown `type` values are ignored
// silently — the channel is advisory and MUST never throw into the game loop
// (contracts §4). Staleness is resolved via `Date.parse` (not lexicographic
// ordering) so the second-precision server stamps (`...00Z`) and any
// millisecond stamps compare by instant.
//
// `PresenceClient` wraps a `PresenceModel` plus the snapshot fetch (bearer
// attached when a token is held). It mirrors the restClient seam: the same
// `TokenSource` from auth.ts, late-bindable via `setTokenSource`.

import { API_BASE_URL, type TokenSource } from './restClient';

// ── Types (contracts §2 PresenceRecord + PresenceSnapshot) ───────────────

/**
 * A colleague's presence — where they are and whether they are live
 * (contracts §2; data-model.md "PresenceRecord"). Read-only to everyone except
 * its owner (FR-008); only this allowlist of fields is ever exposed (FR-004).
 */
export interface PresenceRecord {
  /** Key — the Keycloak `sub` (stable social key); references PlayerIdentity. */
  colleagueId: string;
  /** Display name from the access-token claims (what colleagues see, FR-004). */
  displayName: string;
  /** Assigned avatar id (stable hash of colleagueId onto the avatar frame set). */
  avatar: string;
  /** Office id, or `null` while commuting. */
  office: string | null;
  /** Client-derived activity label (commuting / burning tokens / coding ...). */
  activity: string;
  /** Set while commuting (FR-007); `startedAt` is server-stamped. `null` otherwise. */
  commute: { fromOffice: string; toOffice: string; startedAt: string } | null;
  /** `"live"` (green) | `"last_seen"` (red) — drives avatar styling (FR-023). */
  status: 'live' | 'last_seen';
  /** ISO-8601 UTC — server-stamped on every heartbeat / on expiry. */
  lastSeenAt: string;
}

/** The `GET /api/v1/presence` snapshot (contracts §2). */
export interface PresenceSnapshot {
  /** Authoritative-as-of timestamp; deltas older than this may be discarded. */
  serverTime: string;
  /** The viewer's own record, echoed even while hidden. */
  self: PresenceRecord | null;
  /** One record per VISIBLE colleague, self excluded (hidden filtered server-side). */
  colleagues: PresenceRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** True when `value` is a string. */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** True when `value` is a well-formed commute sub-object (or it is null). */
function isValidCommuteOrNull(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return isString(c.fromOffice) && isString(c.toOffice) && isString(c.startedAt);
}

/**
 * True when `value` is a presence record carrying the full FR-004 allowlist of
 * fields with the expected types. A partial payload (e.g. only `colleagueId`)
 * is rejected so it never surfaces `undefined` fields at the render layer
 * (FR-023 avatar styling trusts these fields). The record is display-only.
 */
function isPresenceRecord(value: unknown): value is PresenceRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    isString(r.colleagueId) &&
    isString(r.displayName) &&
    isString(r.avatar) &&
    isString(r.activity) &&
    isString(r.lastSeenAt) &&
    (r.office === null || isString(r.office)) &&
    (r.status === 'live' || r.status === 'last_seen') &&
    isValidCommuteOrNull(r.commute)
  );
}

/**
 * True when `deltaTime` is strictly older than `snapshotTime`, comparing by
 * instant via `Date.parse` (handles both `...00Z` and `...00.000Z` stamps; a
 * lexicographic comparison would mis-rank mixed precisions). If either stamp is
 * unparseable the delta is treated as NOT stale (lenient — apply it; the next
 * snapshot refresh reconciles wholesale).
 */
function isStrictlyOlder(deltaTime: string, snapshotTime: string): boolean {
  const d = Date.parse(deltaTime);
  const s = Date.parse(snapshotTime);
  if (Number.isNaN(d) || Number.isNaN(s)) return false;
  return d < s;
}

// ── PresenceModel — pure reconciliation ───────────────────────────────────

/**
 * The client presence model. Snapshot-replace + delta upsert/remove with
 * staleness filtering and silent malformed-payload handling. Pure: no I/O, no
 * Date.now() at construction (only `Date.parse` on supplied stamps).
 */
export class PresenceModel {
  private readonly colleaguesById = new Map<string, PresenceRecord>();
  private selfRecord: PresenceRecord | null = null;
  private snapshotServerTime: string | null = null;

  /**
   * Replace the model wholesale with the snapshot — authoritative as of
   * `snapshot.serverTime`. All prior colleagues are dropped; `self` and the
   * authoritative serverTime are set.
   *
   * Atomic + defensive: the new colleagues map is built locally and swapped in
   * only on success, so a malformed body (non-array `colleagues`, non-string
   * `serverTime`, or an unparseable entry) never half-wipes the model — the
   * prior model stays INTACT (the documented guarantee). Never throws.
   */
  applySnapshot(snapshot: PresenceSnapshot): void {
    // Runtime-defend a body that was cast nominally over an unvalidated JSON
    // parse (fetchSnapshot) — including the literal JSON `null`, which parses
    // successfully. A non-object snapshot is ignored, keeping the prior model
    // intact rather than throwing.
    if (snapshot === null || typeof snapshot !== 'object') {
      return;
    }
    const colleagues = snapshot.colleagues;
    const serverTime = snapshot.serverTime;
    if (!Array.isArray(colleagues) || typeof serverTime !== 'string') {
      return;
    }
    // Build the new map locally, then swap atomically.
    const next = new Map<string, PresenceRecord>();
    for (const c of colleagues) {
      // A malformed entry (no colleagueId key) is skipped, not stored.
      if (isPresenceRecord(c)) {
        next.set(c.colleagueId, c);
      }
    }
    this.colleaguesById.clear();
    for (const [id, record] of next) {
      this.colleaguesById.set(id, record);
    }
    this.selfRecord = isPresenceRecord(snapshot.self) ? snapshot.self : null;
    this.snapshotServerTime = serverTime;
  }

  /**
   * Apply one `/topic/presence` delta (or any unknown payload, which is
   * ignored). Routes by `type`:
   *  - `presence.update`: upsert the record by `colleagueId`; a delta older than
   *    the snapshot's serverTime is discarded (stale).
   *  - `presence.remove`: drop the record by `colleagueId`.
   * Malformed payloads (non-object, missing fields, wrong types) and unknown
   * `type` values are ignored silently — never throws into the game loop.
   */
  applyDelta(message: unknown): void {
    if (message === null || typeof message !== 'object') return;
    const msg = message as { type?: unknown };
    const type = msg.type;

    if (type === 'presence.update') {
      const m = message as { serverTime?: unknown; record?: unknown };
      if (!isPresenceRecord(m.record)) return;
      // Staleness: discard only strictly-older, timestamped deltas. The snapshot
      // is authoritative as of its serverTime; applies only when one exists.
      if (this.snapshotServerTime !== null && typeof m.serverTime === 'string') {
        if (isStrictlyOlder(m.serverTime, this.snapshotServerTime)) return;
      }
      this.colleaguesById.set(m.record.colleagueId, m.record);
    } else if (type === 'presence.remove') {
      const m = message as { colleagueId?: unknown };
      if (typeof m.colleagueId === 'string') {
        this.colleaguesById.delete(m.colleagueId);
      }
    }
    // Unknown type / malformed: ignore (advisory channel must stay robust).
  }

  /** The current visible colleagues (snapshot + applied deltas). */
  colleagues(): readonly PresenceRecord[] {
    return [...this.colleaguesById.values()];
  }

  /** The viewer's own record (echoed by the snapshot even while hidden). */
  self(): PresenceRecord | null {
    return this.selfRecord;
  }

  /** The authoritative-as-of timestamp of the last snapshot (null before one). */
  serverTime(): string | null {
    return this.snapshotServerTime;
  }
}

// ── PresenceClient — snapshot fetch + model ───────────────────────────────

/**
 * Fetches the presence snapshot and owns a `PresenceModel`. The snapshot is
 * re-fetched after every (re)connect by the caller (main.ts, T063). Bearer is
 * attached when a token is held; presence is authenticated (401 without one).
 * On failure `fetchSnapshot` rejects so the caller can degrade to empty
 * presence (FR-016) — the model is left untouched.
 */
export class PresenceClient {
  /** The presence model — snapshot + delta reconciliation (pure). */
  readonly model = new PresenceModel();

  constructor(
    private readonly baseUrl: string,
    private tokenSource: TokenSource | null = null,
  ) {}

  /** Late-bind the auth token source (once auth.ts has initialized). */
  setTokenSource(tokenSource: TokenSource | null): void {
    this.tokenSource = tokenSource;
  }

  private authHeaders(): Record<string, string> {
    const token = this.tokenSource?.getToken();
    return token !== null && token !== undefined
      ? { Authorization: `Bearer ${token.token}` }
      : {};
  }

  /**
   * `GET /api/v1/presence` — fetch the snapshot and replace the model wholesale.
   * Throws on a non-2xx response (the caller degrades to empty presence). On a
   * 2xx with a malformed body the model is left INTACT (applySnapshot defends)
   * and no throw escapes — presence is display-only and best-effort.
   */
  async fetchSnapshot(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/presence`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new PresenceFetchError(res.status);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // Non-JSON body (empty body, HTML proxy error page, truncated stream) —
      // leave the model intact and degrade silently (presence is display-only).
      return;
    }
    this.model.applySnapshot(body as PresenceSnapshot);
  }
}

/** Thrown by `fetchSnapshot` on a non-2xx response (carries the HTTP status). */
export class PresenceFetchError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Presence snapshot fetch failed with status ${status}`);
    this.name = 'PresenceFetchError';
    this.status = status;
  }
}

// ── Build-time config + default instance ──────────────────────────────────

/** Factory: build a client for a custom base URL (defaults to the configured one). */
export function createPresenceClient(
  baseUrl: string = API_BASE_URL,
  tokenSource: TokenSource | null = null,
): PresenceClient {
  return new PresenceClient(baseUrl, tokenSource);
}

/** Default app-wide client, wired to the build-time `VITE_API_BASE_URL`. */
export const presenceClient = new PresenceClient(API_BASE_URL, null);
