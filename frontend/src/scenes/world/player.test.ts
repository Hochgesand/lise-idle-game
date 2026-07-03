// T017 — RED tests for the player projection (frontend/src/scenes/world/player.ts).
//
// Phaser-free BY DESIGN (Constitution Principle III; the vitest suite never
// imports Phaser): the PURE derivation behind the player's own avatar (US1)
// lives in `player.ts`; the Phaser rendering layer that APPLIES it
// (`playerLayer.ts`, T020) is integration-level (`tsc -b` + `vite build`).
//
// ## What is pinned here (data-model.md §5; FR-001/002/004; research Decision 1)
//  1. `seated`: the player renders at the RESERVED seat of `activeOffice` —
//     the `reservedAnchorFor` anchor (seats.ts), i.e. the (y,x)-first anchor
//     of the active office. Pure function of local save state: fully
//     functional offline and signed-out (FR-001).
//  2. `commuting`: an in-progress `GameState.commute` interpolates along the
//     `CommutePaths` polyline via the SAME `commuteProgress`/`commuterPosition`
//     math observers use, against `coop.commuteSeconds` — FR-004's "matches
//     what observers see" is true by construction (one math module, two
//     consumers). The path is oriented by `commute.fromOffice` (`orientPath`),
//     and the player rides the route centerline (a single-lane offset — the
//     lane spread exists to declutter crowds, and the player is one body).
//  3. Precedence: `commuting` > `seated` (data-model §5 — the `walking` and
//     `occupied` kinds join in T029/T042). Arrival (progress ≥ 1) resolves to
//     the DESTINATION office's reserved seat — no gap while `advance` flips
//     `activeOffice` on its next tick.
//  4. Label (FR-002): the display name when an identity is present, the
//     literal "Du" otherwise — a render input, never save state.
//
// This file imports `./player`, which does not exist yet (T017 RED). The
// import fails to resolve, so the suite FAILS — the correct TDD RED. The
// implementation lands in T020.

import { describe, it, expect } from 'vitest';
import {
  derivePlayerProjection,
  playerLabel,
  type PlayerProjectionInput,
  type PlayerWorldContext,
} from './player';
import { reservedAnchorFor, type SeatAnchor } from './seats';
import {
  commuteProgress,
  commuterPosition,
  orientPath,
  type CommutePath,
} from './commute';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A normalized seat anchor in `building` at pixel `(x, y)`. */
function anchor(building: string, x: number, y: number): SeatAnchor {
  return { x, y, building };
}

/** Anchors for both campus buildings; the (y,x)-first anchor of each is the
 * player's reserved seat (office_1 → (100, 50); office_2 → (900, 400)). */
const ANCHORS: SeatAnchor[] = [
  anchor('office_1', 132, 50),
  anchor('office_1', 100, 50),
  anchor('office_1', 100, 82),
  anchor('office_2', 932, 400),
  anchor('office_2', 900, 400),
];

/**
 * The campus commute route as authored in campus.json: ONE polyline running
 * office_2 → office_1 (campusMap.test.ts pins the real asset). A straight
 * horizontal line keeps position assertions readable.
 */
const PATH: CommutePath = {
  from: 'office_2',
  to: 'office_1',
  points: [
    { x: 800, y: 400 },
    { x: 200, y: 400 },
  ],
};

/** Commute tuning (contract: content.coop.commuteSeconds). */
const COMMUTE_SECONDS = 90;

/** The sim-timeline commute start (CommuteState.startedAt is numeric ms). */
const STARTED_AT_MS = Date.parse('2026-07-02T10:00:00Z');

/** Context with the full world available (anchors + route + tuning). */
function ctx(overrides: Partial<PlayerWorldContext> = {}): PlayerWorldContext {
  return {
    anchors: ANCHORS,
    commutePath: PATH,
    commuteSeconds: COMMUTE_SECONDS,
    ...overrides,
  };
}

/** A seated-at-office_1 input at `nowMs`; override per test. */
function input(overrides: Partial<PlayerProjectionInput> = {}): PlayerProjectionInput {
  return {
    activeOffice: 'office_1',
    commute: null,
    nowMs: STARTED_AT_MS,
    ...overrides,
  };
}

/** An in-progress office_1 → office_2 commute (walks the authored path REVERSED). */
function commuteInput(elapsedMs: number): PlayerProjectionInput {
  return input({
    commute: { fromOffice: 'office_1', toOffice: 'office_2', startedAt: STARTED_AT_MS },
    nowMs: STARTED_AT_MS + elapsedMs,
  });
}

// ---------------------------------------------------------------------------
// 1. seated — the reserved seat of the active office (FR-001)
// ---------------------------------------------------------------------------

describe('derivePlayerProjection — seated at the reserved seat (FR-001)', () => {
  it('seats the player at the reserved ((y,x)-first) anchor of the active office', () => {
    const projection = derivePlayerProjection(input(), ctx());

    const reserved = reservedAnchorFor(ANCHORS, 'office_1')!;
    expect(projection).toEqual({ kind: 'seated', x: reserved.x, y: reserved.y });
    expect(projection).toEqual({ kind: 'seated', x: 100, y: 50 });
  });

  it('follows the active office (office_2 save → office_2 reserved seat)', () => {
    const projection = derivePlayerProjection(input({ activeOffice: 'office_2' }), ctx());

    expect(projection).toEqual({ kind: 'seated', x: 900, y: 400 });
  });

  it('needs NO route, tuning, or network — local save state only (offline/signed-out)', () => {
    const projection = derivePlayerProjection(
      input(),
      ctx({ commutePath: null, commuteSeconds: undefined }),
    );

    expect(projection).toEqual({ kind: 'seated', x: 100, y: 50 });
  });

  it('returns null when the active office has no anchors (map desync — defensive)', () => {
    expect(derivePlayerProjection(input({ activeOffice: 'office_9' }), ctx())).toBeNull();
    expect(derivePlayerProjection(input(), ctx({ anchors: [] }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. commuting — the observers' math, by construction (FR-004)
// ---------------------------------------------------------------------------

describe('derivePlayerProjection — commuting rides the observers’ math (FR-004)', () => {
  it('interpolates via the same commuteProgress/commuterPosition math observers use', () => {
    const elapsed = 27_000; // 30% of 90 s
    const projection = derivePlayerProjection(commuteInput(elapsed), ctx());

    // The exact observer computation: progress from elapsed vs commuteSeconds,
    // path oriented by fromOffice, position by arc length — on the centerline
    // (laneCount 1: the lane spread declutters crowds; the player is one body).
    const oriented = orientPath(PATH, 'office_1');
    const progress = commuteProgress(elapsed, COMMUTE_SECONDS);
    const expected = commuterPosition(oriented, progress, 'player', { laneCount: 1 });

    expect(projection).toEqual({ kind: 'commuting', x: expected.x, y: expected.y });
    // Straight 200→800 line walked office_1-wards at 30%: x = 200 + 0.3·600.
    expect(projection).toEqual({ kind: 'commuting', x: 380, y: 400 });
  });

  it('orients the path by fromOffice (office_2 origin walks the authored direction)', () => {
    const projection = derivePlayerProjection(
      input({
        activeOffice: 'office_2',
        commute: { fromOffice: 'office_2', toOffice: 'office_1', startedAt: STARTED_AT_MS },
        nowMs: STARTED_AT_MS + 45_000, // 50%
      }),
      ctx(),
    );

    // Authored direction (office_2 → office_1) at 50%: midpoint (500, 400).
    expect(projection).toEqual({ kind: 'commuting', x: 500, y: 400 });
  });

  it('outranks seated (precedence: commuting > seated, data-model §5)', () => {
    // The save still says activeOffice office_1 (advance flips it on arrival);
    // an in-progress commute must render on the route, not at the desk.
    const projection = derivePlayerProjection(commuteInput(45_000), ctx());

    expect(projection?.kind).toBe('commuting');
  });

  it('resolves arrival (progress ≥ 1) to the DESTINATION reserved seat — no gap', () => {
    // advance flips activeOffice := toOffice on its next tick; until then the
    // projection already seats the player at the destination (no teleport
    // back, no limbo) — mirroring the observers' arrived-commuter rule.
    const projection = derivePlayerProjection(commuteInput(90_000), ctx());

    expect(projection).toEqual({ kind: 'seated', x: 900, y: 400 });
  });

  it('falls back to seated when the route or tuning is missing (defensive)', () => {
    // A map without CommutePaths / a catalog without coop: nothing to ride —
    // the player stays at their (origin) desk instead of vanishing.
    expect(derivePlayerProjection(commuteInput(45_000), ctx({ commutePath: null }))).toEqual({
      kind: 'seated',
      x: 100,
      y: 50,
    });
    expect(
      derivePlayerProjection(commuteInput(45_000), ctx({ commuteSeconds: undefined })),
    ).toEqual({ kind: 'seated', x: 100, y: 50 });
  });

  it('is pure — same inputs, same output; inputs never mutated', () => {
    const i = commuteInput(27_000);
    const c = ctx();
    const iSnapshot = JSON.parse(JSON.stringify(i)) as unknown;
    const cSnapshot = JSON.parse(JSON.stringify(c)) as unknown;

    expect(derivePlayerProjection(i, c)).toEqual(derivePlayerProjection(i, c));
    expect(JSON.parse(JSON.stringify(i))).toEqual(iSnapshot);
    expect(JSON.parse(JSON.stringify(c))).toEqual(cSnapshot);
  });
});

// ---------------------------------------------------------------------------
// 3. label — "Du" signed out, display name signed in (FR-002)
// ---------------------------------------------------------------------------

describe('playerLabel — display name when present, the literal "Du" otherwise (FR-002)', () => {
  it('returns the display name when an identity is present', () => {
    expect(playerLabel('Grace Hopper')).toBe('Grace Hopper');
  });

  it('returns "Du" when signed out (null identity)', () => {
    expect(playerLabel(null)).toBe('Du');
  });

  it('returns "Du" for a blank display name (defensive — never an empty label)', () => {
    expect(playerLabel('')).toBe('Du');
    expect(playerLabel('   ')).toBe('Du');
  });
});
