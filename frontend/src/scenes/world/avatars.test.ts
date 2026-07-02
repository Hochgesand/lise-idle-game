// T078 — RED tests for the avatar state-transition derivation logic (US3).
//
// Phaser-free BY DESIGN (Constitution Principle III; the vitest suite never
// imports Phaser): the pure derivation behind the US3 "alive" transitions
// lives in `presenceView.ts` (the presence→render bridge) + `commute.ts`
// (path math/parsing), and `avatars.ts` (the Phaser layer) merely APPLIES it.
// This file names `avatars.test.ts` per tasks.md T078 — it tests the
// derivation the avatar layer consumes, not Phaser game objects.
//
// ## What is pinned here (US3 acceptance 1–3; FR-022; SC-010)
//  1. live → last-seen produces a SOFT transition state: the colleague stays
//     rendered at their seat (no abrupt removal) and the renderer is told to
//     fade (`statusTransition` → 'fadeToLastSeen'), never to pop — with
//     `reducedMotion` honored by the (constant-driven) fade decision.
//  2. live delta transitions (T079): `presence.update` / `presence.remove`
//     reconcile joins, leaves, office moves, and activity changes through
//     `PresenceModel.applyDelta` → `buildAvatarRenders` — no snapshot
//     re-fetch, no refresh.
//  3. commute-in-progress (T080): a commuting record resolves to a ROUTE
//     position from the server-stamped `startedAt` against
//     `coop.commuteSeconds` — on the `CommutePaths` polyline, oriented by
//     `commute.fromOffice`, with the deterministic per-colleague lane offset.
//  4. arrival resolves BACK TO A SEAT: elapsed ≥ commuteSeconds seats the
//     colleague at a destination-building anchor (distinct from occupants).
//  5. in-transit label decluttering (FR-022): labels are tap/hover-only while
//     commuting, even at label-persistent zoom.
//
// This file imports exports that do not exist yet (T078 RED): the extended
// `buildAvatarRenders` commute context, `statusTransition`, `labelVisible`,
// the last-seen fade constants, and `extractCommutePath`/`orientPath`. The
// suite FAILS to compile — the correct TDD RED. The implementation lands with
// the T079 GREEN commit (shared derivation), consumed by T080/T081 wiring.

import { describe, it, expect } from 'vitest';
import {
  buildAvatarRenders,
  statusTransition,
  labelVisible,
  LAST_SEEN_ALPHA,
  LAST_SEEN_FADE_MS,
  type CommuteRenderContext,
} from './presenceView';
import {
  commuteProgress,
  commuterPosition,
  extractCommutePath,
  orientPath,
  type CommutePath,
} from './commute';
import type { SeatAnchor } from './seats';
import { PresenceModel, type PresenceRecord } from '../../net/presenceClient';

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

/** A commuting record (`office: null`, server-stamped `startedAt`). */
function commuter(
  colleagueId: string,
  opts: { fromOffice?: string; toOffice?: string; startedAt?: string } = {},
): PresenceRecord {
  return record({
    colleagueId,
    office: null,
    activity: 'commuting',
    commute: {
      fromOffice: opts.fromOffice ?? 'office_1',
      toOffice: opts.toOffice ?? 'office_2',
      startedAt: opts.startedAt ?? '2026-07-02T10:00:00Z',
    },
  });
}

const OFFICE_1_ANCHORS: SeatAnchor[] = [
  anchor('office_1', 100, 50),
  anchor('office_1', 132, 50),
];

const OFFICE_2_ANCHORS: SeatAnchor[] = [
  anchor('office_2', 900, 400),
  anchor('office_2', 932, 400),
];

const ALL_ANCHORS: SeatAnchor[] = [...OFFICE_1_ANCHORS, ...OFFICE_2_ANCHORS];

/**
 * The campus commute route as authored in campus.json: ONE polyline running
 * office_2 → office_1 (campus-layout.md; campusMap.test.ts pins the real
 * asset). Tests reuse the same shape with simple coordinates.
 */
const PATH: CommutePath = {
  from: 'office_2',
  to: 'office_1',
  points: [
    { x: 800, y: 400 }, // office_2 entrance
    { x: 500, y: 400 },
    { x: 500, y: 100 },
    { x: 200, y: 100 }, // office_1 entrance
  ],
};

/** Commute tuning used across the tests (contract: content.coop.commuteSeconds). */
const COMMUTE_SECONDS = 90;

/** Commute start instant used across the tests (server-stamped). */
const STARTED_AT = '2026-07-02T10:00:00Z';
const STARTED_AT_MS = Date.parse(STARTED_AT);

/** Build a CommuteRenderContext at `elapsedMs` since STARTED_AT. */
function ctxAt(elapsedMs: number): CommuteRenderContext {
  return {
    path: PATH,
    nowMs: STARTED_AT_MS + elapsedMs,
    commuteSeconds: COMMUTE_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// 1. live → last-seen: soft transition, no abrupt removal
// ---------------------------------------------------------------------------

describe('live → last-seen soft transition (US3 acceptance 3)', () => {
  it('keeps an expired colleague rendered AT their seat with the lastSeen tier (no removal)', () => {
    const live = [record({ colleagueId: 'c-1', status: 'live' })];
    const expired = [record({ colleagueId: 'c-1', status: 'last_seen' })];

    const before = buildAvatarRenders(ALL_ANCHORS, live);
    const after = buildAvatarRenders(ALL_ANCHORS, expired);

    // Still rendered — the transition is a styling change, never a removal.
    expect(after).toHaveLength(1);
    expect(after[0].presence.status).toBe('lastSeen');
    // Same seat: the avatar does not jump when it expires.
    expect(after[0].x).toBe(before[0].x);
    expect(after[0].y).toBe(before[0].y);
  });

  it('statusTransition derives a fade for live → lastSeen (the no-pop rule)', () => {
    expect(statusTransition('live', 'lastSeen')).toBe('fadeToLastSeen');
  });

  it('statusTransition derives an instant revive for lastSeen → live', () => {
    expect(statusTransition('lastSeen', 'live')).toBe('revive');
  });

  it('statusTransition is "appear" for a first-seen colleague (no fade on join)', () => {
    expect(statusTransition(undefined, 'live')).toBe('appear');
    expect(statusTransition(undefined, 'lastSeen')).toBe('appear');
  });

  it('statusTransition is "none" when the tier is unchanged', () => {
    expect(statusTransition('live', 'live')).toBe('none');
    expect(statusTransition('lastSeen', 'lastSeen')).toBe('none');
  });

  it('exposes sane fade constants (desaturated resting alpha; a real duration)', () => {
    // The renderer fades TO this alpha (red/desaturated at-desk state) …
    expect(LAST_SEEN_ALPHA).toBeGreaterThan(0);
    expect(LAST_SEEN_ALPHA).toBeLessThan(1);
    // … over this duration; reducedMotion applies it instantly instead.
    expect(LAST_SEEN_FADE_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. live delta transitions (T079): joins/leaves/moves/activity, no refresh
// ---------------------------------------------------------------------------

describe('live delta transitions through the presence model (T079, US3 acceptance 1)', () => {
  function seededModel(): PresenceModel {
    const model = new PresenceModel();
    model.applySnapshot({
      serverTime: '2026-07-02T10:00:00Z',
      self: null,
      colleagues: [record({ colleagueId: 'c-1' })],
    });
    return model;
  }

  it('a presence.update JOIN renders a new avatar without any snapshot re-fetch', () => {
    const model = seededModel();
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-02T10:00:05Z',
      record: record({ colleagueId: 'c-2', office: 'office_2' }),
    });

    const renders = buildAvatarRenders(ALL_ANCHORS, model.colleagues());
    expect(renders.map((r) => r.colleagueId).sort()).toEqual(['c-1', 'c-2']);
  });

  it('a presence.update OFFICE MOVE re-seats the avatar in the destination building', () => {
    const model = seededModel();
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-02T10:00:05Z',
      record: record({ colleagueId: 'c-1', office: 'office_2' }),
    });

    const renders = buildAvatarRenders(ALL_ANCHORS, model.colleagues());
    expect(renders).toHaveLength(1);
    const seatPoints = OFFICE_2_ANCHORS.map((a) => `${a.x},${a.y}`);
    expect(seatPoints).toContain(`${renders[0].x},${renders[0].y}`);
  });

  it('a presence.update ACTIVITY change updates the rendered label text', () => {
    const model = seededModel();
    model.applyDelta({
      type: 'presence.update',
      serverTime: '2026-07-02T10:00:05Z',
      record: record({ colleagueId: 'c-1', activity: 'burning tokens' }),
    });

    const renders = buildAvatarRenders(ALL_ANCHORS, model.colleagues());
    expect(renders[0].presence.activity).toBe('burning tokens');
  });

  it('a presence.remove LEAVE drops the avatar', () => {
    const model = seededModel();
    model.applyDelta({ type: 'presence.remove', colleagueId: 'c-1' });

    expect(buildAvatarRenders(ALL_ANCHORS, model.colleagues())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. commute-in-progress resolves to a route position (T080, FR-022, SC-010)
// ---------------------------------------------------------------------------

describe('commute-in-progress → route position (T080)', () => {
  it('places a mid-commute colleague at the lane-offset polyline position for their progress', () => {
    const elapsed = (COMMUTE_SECONDS * 1000) / 2; // half way
    const c = commuter('c-go', { fromOffice: 'office_1', toOffice: 'office_2', startedAt: STARTED_AT });

    const renders = buildAvatarRenders(ALL_ANCHORS, [c], ctxAt(elapsed));

    expect(renders).toHaveLength(1);
    const progress = commuteProgress(elapsed, COMMUTE_SECONDS);
    // office_1 → office_2 traverses the (office_2 → office_1 authored) route REVERSED.
    const expected = commuterPosition(orientPath(PATH, 'office_1'), progress, 'c-go');
    expect(renders[0].x).toBeCloseTo(expected.x, 6);
    expect(renders[0].y).toBeCloseTo(expected.y, 6);
  });

  it('traverses the route as authored when commuting from the path’s own origin', () => {
    const c = commuter('c-back', { fromOffice: 'office_2', toOffice: 'office_1', startedAt: STARTED_AT });

    // Just started: an office_2 → office_1 commute begins NEAR the office_2
    // entrance (the authored polyline start), not the office_1 end.
    const renders = buildAvatarRenders(ALL_ANCHORS, [c], ctxAt(1000));
    expect(renders).toHaveLength(1);
    const progress = commuteProgress(1000, COMMUTE_SECONDS);
    const expected = commuterPosition(PATH.points, progress, 'c-back');
    expect(renders[0].x).toBeCloseTo(expected.x, 6);
    expect(renders[0].y).toBeCloseTo(expected.y, 6);
    // Structurally near the office_2 entrance end of the route.
    expect(Math.abs(renders[0].x - 800)).toBeLessThan(60);
  });

  it('marks a mid-commute render inTransit (and a seated render not)', () => {
    const renders = buildAvatarRenders(
      ALL_ANCHORS,
      [commuter('c-go', { startedAt: STARTED_AT }), record({ colleagueId: 'c-desk' })],
      ctxAt(1000),
    );

    const byId = new Map(renders.map((r) => [r.colleagueId, r]));
    expect(byId.get('c-go')?.inTransit).toBe(true);
    expect(byId.get('c-desk')?.inTransit ?? false).toBe(false);
  });

  it('progress comes from the server-stamped startedAt against commuteSeconds', () => {
    const c = commuter('c-go', { fromOffice: 'office_1', startedAt: STARTED_AT });

    const early = buildAvatarRenders(ALL_ANCHORS, [c], ctxAt(9_000))[0];
    const late = buildAvatarRenders(ALL_ANCHORS, [c], ctxAt(81_000))[0];

    const at = (elapsed: number) =>
      commuterPosition(
        orientPath(PATH, 'office_1'),
        commuteProgress(elapsed, COMMUTE_SECONDS),
        'c-go',
      );
    expect({ x: early.x, y: early.y }).toEqual(at(9_000));
    expect({ x: late.x, y: late.y }).toEqual(at(81_000));
    // And it actually MOVES along the route between the two instants.
    expect(early.x !== late.x || early.y !== late.y).toBe(true);
  });

  it('gives simultaneous commuters deterministic per-colleague lane positions (SC-010)', () => {
    const a = commuter('colleague-a', { fromOffice: 'office_1', startedAt: STARTED_AT });
    const b = commuter('colleague-b', { fromOffice: 'office_1', startedAt: STARTED_AT });
    const elapsed = (COMMUTE_SECONDS * 1000) / 2;

    const once = buildAvatarRenders(ALL_ANCHORS, [a, b], ctxAt(elapsed));
    const twice = buildAvatarRenders(ALL_ANCHORS, [b, a], ctxAt(elapsed)); // order-independent

    const pos = (rs: typeof once, id: string) => {
      const r = rs.find((x) => x.colleagueId === id);
      return r === undefined ? undefined : { x: r.x, y: r.y };
    };
    // Deterministic: same inputs (any order) → same positions.
    expect(pos(twice, 'colleague-a')).toEqual(pos(once, 'colleague-a'));
    expect(pos(twice, 'colleague-b')).toEqual(pos(once, 'colleague-b'));
    // Each equals the composed commuterPosition (which applies laneOffset).
    const oriented = orientPath(PATH, 'office_1');
    const progress = commuteProgress(elapsed, COMMUTE_SECONDS);
    expect(pos(once, 'colleague-a')).toEqual(commuterPosition(oriented, progress, 'colleague-a'));
    expect(pos(once, 'colleague-b')).toEqual(commuterPosition(oriented, progress, 'colleague-b'));
  });

  it('still skips commuters when no commute context is supplied (pre-T080 behavior)', () => {
    const renders = buildAvatarRenders(ALL_ANCHORS, [commuter('c-go')]);
    expect(renders).toHaveLength(0);
  });

  it('treats an unparseable startedAt as not-started (route start, never NaN)', () => {
    const c = commuter('c-bad', { fromOffice: 'office_1', startedAt: 'not-a-date' });
    const renders = buildAvatarRenders(ALL_ANCHORS, [c], ctxAt(30_000));

    expect(renders).toHaveLength(1);
    const expected = commuterPosition(orientPath(PATH, 'office_1'), 0, 'c-bad');
    expect(renders[0].x).toBeCloseTo(expected.x, 6);
    expect(renders[0].y).toBeCloseTo(expected.y, 6);
    expect(Number.isFinite(renders[0].x)).toBe(true);
    expect(Number.isFinite(renders[0].y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. arrival resolves back to a seat (T080)
// ---------------------------------------------------------------------------

describe('arrival resolves back to a seat (T080)', () => {
  it('seats a colleague at a destination-building anchor once elapsed ≥ commuteSeconds', () => {
    const c = commuter('c-go', { fromOffice: 'office_1', toOffice: 'office_2', startedAt: STARTED_AT });

    const renders = buildAvatarRenders(ALL_ANCHORS, [c], ctxAt(COMMUTE_SECONDS * 1000));

    expect(renders).toHaveLength(1);
    const seatPoints = OFFICE_2_ANCHORS.map((a) => `${a.x},${a.y}`);
    expect(seatPoints).toContain(`${renders[0].x},${renders[0].y}`);
    expect(renders[0].inTransit ?? false).toBe(false);
  });

  it('an arrived commuter takes a DISTINCT anchor from colleagues already seated there', () => {
    const arrived = commuter('c-go', {
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: STARTED_AT,
    });
    const resident = record({ colleagueId: 'c-resident', office: 'office_2' });

    const renders = buildAvatarRenders(ALL_ANCHORS, [arrived, resident], ctxAt(COMMUTE_SECONDS * 1000 + 5_000));

    expect(renders).toHaveLength(2);
    const positions = new Set(renders.map((r) => `${r.x},${r.y}`));
    expect(positions.size).toBe(2); // no illegible stacking
    for (const r of renders) {
      expect(OFFICE_2_ANCHORS.map((a) => `${a.x},${a.y}`)).toContain(`${r.x},${r.y}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. in-transit label decluttering (FR-022)
// ---------------------------------------------------------------------------

describe('in-transit label rule (labelVisible, FR-022)', () => {
  it('suppresses persistent labels while in transit (tap/hover only)', () => {
    expect(
      labelVisible({ persistent: true, hovered: false, pinned: false, inTransit: true }),
    ).toBe(false);
  });

  it('shows the label on hover or pin even while in transit', () => {
    expect(
      labelVisible({ persistent: false, hovered: true, pinned: false, inTransit: true }),
    ).toBe(true);
    expect(
      labelVisible({ persistent: false, hovered: false, pinned: true, inTransit: true }),
    ).toBe(true);
  });

  it('keeps the FR-005 × FR-024 zoom rule for seated avatars', () => {
    expect(
      labelVisible({ persistent: true, hovered: false, pinned: false, inTransit: false }),
    ).toBe(true);
    expect(
      labelVisible({ persistent: false, hovered: false, pinned: false, inTransit: false }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. CommutePaths parsing + orientation (commute.ts)
// ---------------------------------------------------------------------------

describe('extractCommutePath / orientPath (commute.ts)', () => {
  const tiledObjects = [
    {
      x: 100,
      y: 200,
      polyline: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: -80 },
      ],
      properties: [
        { name: 'from', type: 'string', value: 'office_2' },
        { name: 'to', type: 'string', value: 'office_1' },
      ],
    },
  ];

  it('parses the polyline into world-space points with from/to tags', () => {
    const path = extractCommutePath(tiledObjects);
    expect(path).not.toBeNull();
    expect(path?.from).toBe('office_2');
    expect(path?.to).toBe('office_1');
    // Vertices are offset by the object origin (Tiled polyline convention).
    expect(path?.points).toEqual([
      { x: 100, y: 200 },
      { x: 150, y: 200 },
      { x: 150, y: 120 },
    ]);
  });

  it('returns null for an empty layer or a malformed object (never throws)', () => {
    expect(extractCommutePath([])).toBeNull();
    expect(extractCommutePath([{ x: 0, y: 0 }])).toBeNull(); // no polyline
    expect(
      extractCommutePath([
        { x: 0, y: 0, polyline: [{ x: 0, y: 0 }] }, // single vertex, no props
      ]),
    ).toBeNull();
  });

  it('orients the route by the commute origin (as-authored / reversed), without mutating', () => {
    const asAuthored = orientPath(PATH, 'office_2');
    expect(asAuthored).toEqual(PATH.points);

    const reversed = orientPath(PATH, 'office_1');
    expect(reversed).toEqual([...PATH.points].reverse());
    // Pure: the authored path is untouched.
    expect(PATH.points[0]).toEqual({ x: 800, y: 400 });

    // Unknown origin: fall back to the authored direction (defensive).
    expect(orientPath(PATH, 'office_9')).toEqual(PATH.points);
  });
});
