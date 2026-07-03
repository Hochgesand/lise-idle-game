// T065 — RED tests for the presence→world mapping module
// (frontend/src/scenes/world/presenceView.ts).
//
// presenceView is the PURE, Phaser-free bridge between the client presence
// model (net/presenceClient.ts, `PresenceRecord`) and the campus renderer
// (scenes/world/avatars.ts, `AvatarRender`): it takes the parsed seat anchors
// plus the visible presence records and produces one render per SEATED
// colleague — placed on a distinct `SeatAnchor` in the CORRECT building via
// the deterministic `assignSeats` (seats.ts), carrying the FR-005 labels
// (displayName + activity) and the FR-023 liveness tier (`live` green /
// `lastSeen` red).
//
// ## Invariants under test (FR-005/006/023; data-model.md seat invariant)
//  - a colleague present in an office renders AT a seat anchor tagged with
//    that office (`SeatAnchor.building` === `PresenceRecord.office`) — never
//    at another building's anchor;
//  - `status` maps `'live'` → `'live'` and `'last_seen'` → `'lastSeen'`
//    (the renderer's frame-selection tier, FR-023);
//  - `displayName` and `activity` pass through verbatim (the label texts,
//    FR-005);
//  - COMMUTING colleagues (`office === null` + `commute` set) are NOT seated —
//    they are skipped entirely here (T080 renders them on the commute path);
//  - a record with `office === null` and no commute (defensive: a malformed or
//    transitional presence) is skipped too — there is nowhere to place it;
//  - no two rendered colleagues share a pixel position, and overflow beyond
//    the anchors still renders (standing) — never hidden;
//  - the mapping is a pure function of its inputs: independent of record
//    input order, no mutation of the inputs.
//
// This file imports `./presenceView`, which does not exist yet (T065 RED).
// The import fails to resolve, so the suite FAILS — the correct TDD RED. The
// implementation lands in the T065 GREEN commit.

import { describe, it, expect } from 'vitest';
import { buildAvatarRenders } from './presenceView';
import type { SeatAnchor } from './seats';
import type { PresenceRecord } from '../../net/presenceClient';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A normalized seat anchor in `building` at pixel `(x, y)`. */
function anchor(building: string, x: number, y: number): SeatAnchor {
  return { x, y, building };
}

/**
 * A presence record with sensible defaults: a live colleague present in
 * `office_1`, activity "coding". Override per test.
 */
function record(overrides: Partial<PresenceRecord> & { colleagueId: string }): PresenceRecord {
  return {
    displayName: `Name of ${overrides.colleagueId}`,
    avatar: 'avatar_0',
    office: 'office_1',
    activity: 'coding',
    commute: null,
    status: 'live',
    lastSeenAt: '2026-07-02T10:00:00Z',
    ...overrides,
  };
}

/** A commuting record: `office` null + `commute` set (FR-007 shape). */
function commuter(colleagueId: string): PresenceRecord {
  return record({
    colleagueId,
    office: null,
    activity: 'commuting',
    commute: {
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: '2026-07-02T09:59:00Z',
    },
  });
}

const OFFICE_1_ANCHORS: SeatAnchor[] = [
  anchor('office_1', 100, 50),
  anchor('office_1', 132, 50),
  anchor('office_1', 100, 82),
];

const OFFICE_2_ANCHORS: SeatAnchor[] = [
  anchor('office_2', 900, 400),
  anchor('office_2', 932, 400),
];

const ALL_ANCHORS: SeatAnchor[] = [...OFFICE_1_ANCHORS, ...OFFICE_2_ANCHORS];

// ---------------------------------------------------------------------------
// Seating: anchor position + correct building
// ---------------------------------------------------------------------------

describe('buildAvatarRenders — seating', () => {
  it('renders a present colleague AT one of their building’s seat anchors', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [record({ colleagueId: 'c-1' })]);

    expect(renders).toHaveLength(1);
    const r = renders[0];
    expect(r.colleagueId).toBe('c-1');
    const seatPoints = OFFICE_1_ANCHORS.map((a) => `${a.x},${a.y}`);
    expect(seatPoints).toContain(`${r.x},${r.y}`);
  });

  it('never seats a colleague at another building’s anchor', () => {
    // office_1 anchors sort first (lower y/x) — an office_2 colleague must
    // still land on an office_2 anchor, not the "first" anchor overall.
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'c-2', office: 'office_2' }),
    ]);

    expect(renders).toHaveLength(1);
    const seatPoints = OFFICE_2_ANCHORS.map((a) => `${a.x},${a.y}`);
    expect(seatPoints).toContain(`${renders[0].x},${renders[0].y}`);
  });

  it('places colleagues in the same building at DISTINCT anchors', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'c-1' }),
      record({ colleagueId: 'c-2' }),
      record({ colleagueId: 'c-3' }),
    ]);

    expect(renders).toHaveLength(3);
    const positions = new Set(renders.map((r) => `${r.x},${r.y}`));
    expect(positions.size).toBe(3);
  });

  it('still renders overflow colleagues beyond the anchor count (standing, never hidden)', () => {
    // 4 colleagues, 3 office_1 anchors → all 4 render, at 4 distinct positions.
    const renders = buildAvatarRenders(OFFICE_1_ANCHORS, [
      record({ colleagueId: 'c-1' }),
      record({ colleagueId: 'c-2' }),
      record({ colleagueId: 'c-3' }),
      record({ colleagueId: 'c-4' }),
    ]);

    expect(renders).toHaveLength(4);
    const positions = new Set(renders.map((r) => `${r.x},${r.y}`));
    expect(positions.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Presence projection: status tier + labels (FR-005 / FR-023)
// ---------------------------------------------------------------------------

describe('buildAvatarRenders — presence projection', () => {
  it("maps status 'live' to the renderer tier 'live' (green frame, FR-023)", () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'c-1', status: 'live' }),
    ]);
    expect(renders[0].presence.status).toBe('live');
  });

  it("maps status 'last_seen' to the renderer tier 'lastSeen' (red frame, FR-023)", () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'c-1', status: 'last_seen' }),
    ]);
    expect(renders[0].presence.status).toBe('lastSeen');
  });

  it('passes displayName and activity through verbatim (the FR-005 labels)', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'c-1', displayName: 'Ada L.', activity: 'burning tokens' }),
    ]);
    expect(renders[0].presence.colleagueId).toBe('c-1');
    expect(renders[0].presence.displayName).toBe('Ada L.');
    expect(renders[0].presence.activity).toBe('burning tokens');
  });
});

// ---------------------------------------------------------------------------
// Commuters + placeless records are skipped (T080 owns the commute path)
// ---------------------------------------------------------------------------

describe('buildAvatarRenders — commuting / placeless records', () => {
  it('skips commuting colleagues (office null + commute set) — T080 renders them on the path', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [commuter('c-1')]);
    expect(renders).toHaveLength(0);
  });

  it('skips a placeless record (office null, no commute) rather than inventing a position', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'c-1', office: null, commute: null }),
    ]);
    expect(renders).toHaveLength(0);
  });

  it('seats the present colleagues while skipping the commuter in the same batch', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [
      record({ colleagueId: 'seated-1' }),
      commuter('commuting-1'),
      record({ colleagueId: 'seated-2', office: 'office_2' }),
    ]);

    expect(renders.map((r) => r.colleagueId).sort()).toEqual(['seated-1', 'seated-2']);
  });
});

// ---------------------------------------------------------------------------
// Purity + determinism
// ---------------------------------------------------------------------------

describe('buildAvatarRenders — purity & determinism', () => {
  it('returns [] for empty inputs', () => {
    expect(buildAvatarRenders([], [])).toEqual([]);
    expect(buildAvatarRenders(ALL_ANCHORS, [])).toEqual([]);
  });

  it('is independent of record input order (same renders either way)', () => {
    const a = record({ colleagueId: 'c-a' });
    const b = record({ colleagueId: 'c-b' });
    const c = record({ colleagueId: 'c-c', office: 'office_2' });

    const forward = buildAvatarRenders(ALL_ANCHORS, [a, b, c]);
    const reversed = buildAvatarRenders(ALL_ANCHORS, [c, b, a]);

    expect(reversed).toEqual(forward);
  });

  it('does not mutate the input records or anchors', () => {
    const anchors = ALL_ANCHORS.map((x) => ({ ...x }));
    const records = [record({ colleagueId: 'c-1' }), commuter('c-2')];
    const anchorsSnapshot = JSON.parse(JSON.stringify(anchors)) as unknown;
    const recordsSnapshot = JSON.parse(JSON.stringify(records)) as unknown;

    buildAvatarRenders(anchors, records);

    expect(JSON.parse(JSON.stringify(anchors))).toEqual(anchorsSnapshot);
    expect(JSON.parse(JSON.stringify(records))).toEqual(recordsSnapshot);
  });
});

// ---------------------------------------------------------------------------
// T016 (US1) — reserved player anchor rides through to assignSeats (FR-003)
// ---------------------------------------------------------------------------
//
// `buildAvatarRenders` gains an optional reserved-anchor input (the player's
// seat, `reservedAnchorFor` in seats.ts): no colleague — resident or arrived
// commuter — ever renders on it, at any crowd size. The parameter does not
// exist yet (T016 RED); the implementation lands in T019.

describe('buildAvatarRenders — reserved player anchor (T016)', () => {
  it('never seats a colleague on the reserved anchor', () => {
    const reserved = OFFICE_1_ANCHORS[0]; // (y,x)-first office_1 anchor
    const records = [record({ colleagueId: 'c-1' }), record({ colleagueId: 'c-2' })];

    const renders = buildAvatarRenders(ALL_ANCHORS, records, undefined, reserved);

    expect(renders).toHaveLength(2);
    for (const r of renders) {
      expect({ x: r.x, y: r.y }).not.toEqual({ x: reserved.x, y: reserved.y });
    }
  });

  it('keeps the reservation under overflow (crowd larger than the anchor pool)', () => {
    const reserved = OFFICE_1_ANCHORS[0];
    const crowd = Array.from({ length: 9 }, (_, i) =>
      record({ colleagueId: `c-${String(i).padStart(2, '0')}` }),
    );

    const renders = buildAvatarRenders(ALL_ANCHORS, crowd, undefined, reserved);

    expect(renders).toHaveLength(9); // never hidden
    const positions = renders.map((r) => `${r.x},${r.y}`);
    expect(new Set(positions).size).toBe(9); // never stacked
    expect(positions).not.toContain(`${reserved.x},${reserved.y}`);
  });

  it('without a reservation the behavior is unchanged (back-compat)', () => {
    const records = [record({ colleagueId: 'c-1' }), record({ colleagueId: 'c-2' })];

    expect(buildAvatarRenders(ALL_ANCHORS, records, undefined, null)).toEqual(
      buildAvatarRenders(ALL_ANCHORS, records),
    );
  });
});
