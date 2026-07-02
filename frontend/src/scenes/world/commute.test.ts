// T039 — RED tests for the pure commute-path math module (FR-022, SC-010).
//
// `frontend/src/scenes/world/commute.ts` is the Phaser-free math behind
// observing colleagues travel the `CommutePaths` polyline between the two lise
// buildings (T044 implementation, T080 rendering). It MUST stay pure: no
// Phaser, no `Date.now()`, no I/O — only elapsed time, the polyline, and a
// colleague id drive the result, so the commute-rush legibility math (SC-010)
// is unit-testable in isolation and deterministic across replays.
//
// This file imports `./commute`, which does NOT exist yet (T039 RED); the real
// implementation lands in T044. Every assertion below therefore FAILS until
// then (the import itself errors in vitest).
//
// ## Inputs (data-model.md; campus.json "CommutePaths"; coop.json)
//  - `coop.commuteSeconds` (content) — the office-switch travel duration.
//  - the `CommutePaths` object layer — Tiled polyline objects: each is a list
//    of `{ x, y }` world-space vertices, entrance-to-entrance.
//  - `colleagueId` — the stable social key (PresenceRecord). A stable hash of
//    it yields a deterministic perpendicular lane so simultaneous commuters
//    render side-by-side instead of stacking (commute-rush legibility, SC-010).

import { describe, it, expect } from 'vitest';
import {
  commuteProgress,
  positionAlongPolyline,
  laneOffset,
  commuterPosition,
} from './commute';

// The placeholder `coop.commuteSeconds` (data-model.md / coop.json): 30 s.
const COMMUTE_SECONDS = 30;

// ---------------------------------------------------------------------------
// commuteProgress — elapsed vs coop.commuteSeconds, clamped to [0, 1]
// ---------------------------------------------------------------------------

describe('commuteProgress — elapsed vs coop.commuteSeconds, clamped to [0,1]', () => {
  it('is 0 at the start (no time elapsed)', () => {
    expect(commuteProgress(0, COMMUTE_SECONDS)).toBe(0);
  });

  it('is 1 at the exact arrival instant (elapsed = commuteSeconds)', () => {
    expect(commuteProgress(COMMUTE_SECONDS * 1000, COMMUTE_SECONDS)).toBe(1);
  });

  it('clamps to 1 past arrival', () => {
    expect(commuteProgress(COMMUTE_SECONDS * 1000 + 5000, COMMUTE_SECONDS)).toBe(1);
  });

  it('clamps to 0 for negative elapsed (clock skew / pre-start)', () => {
    expect(commuteProgress(-1000, COMMUTE_SECONDS)).toBe(0);
  });

  it('is linear at the halfway point (half duration → 0.5)', () => {
    expect(commuteProgress(15_000, COMMUTE_SECONDS)).toBeCloseTo(0.5, 10);
  });

  it('is linear at a quarter (quarter duration → 0.25)', () => {
    expect(commuteProgress(7500, COMMUTE_SECONDS)).toBeCloseTo(0.25, 10);
  });

  it('resolves a non-positive commuteSeconds to arrived (1) — defensive', () => {
    expect(commuteProgress(0, 0)).toBe(1);
  });

  it('treats a non-finite elapsed as not-started (0) — defensive', () => {
    expect(commuteProgress(Number.NaN, COMMUTE_SECONDS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// positionAlongPolyline — world position by arc-length progress
// ---------------------------------------------------------------------------

describe('positionAlongPolyline — world position by arc-length progress', () => {
  it('returns the first point at progress 0', () => {
    expect(positionAlongPolyline([{ x: 10, y: 20 }, { x: 110, y: 20 }], 0)).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('returns the last point at progress 1', () => {
    expect(
      positionAlongPolyline(
        [
          { x: 10, y: 20 },
          { x: 110, y: 20 },
          { x: 110, y: 120 },
        ],
        1,
      ),
    ).toEqual({ x: 110, y: 120 });
  });

  it('interpolates along a single segment by distance', () => {
    expect(positionAlongPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.5)).toEqual({
      x: 50,
      y: 0,
    });
  });

  it('is proportional to arc length, NOT vertex count', () => {
    // Two segments of length 30 and 10 (total 40).
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }];
    // progress 0.5 → distance 20 → still inside the long first segment.
    // (vertex-proportional interpolation would put 0.5 at the (30,0) vertex.)
    expect(positionAlongPolyline(pts, 0.5)).toEqual({ x: 20, y: 0 });
    expect(positionAlongPolyline(pts, 0.75)).toEqual({ x: 30, y: 0 });
    expect(positionAlongPolyline(pts, 0.875)).toEqual({ x: 35, y: 0 });
  });

  it('interpolates across a 2D bend', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
    expect(positionAlongPolyline(pts, 0.25)).toEqual({ x: 0, y: 5 });
    expect(positionAlongPolyline(pts, 0.5)).toEqual({ x: 0, y: 10 });
    expect(positionAlongPolyline(pts, 0.75)).toEqual({ x: 5, y: 10 });
  });

  it('clamps progress below 0 to the first point', () => {
    expect(positionAlongPolyline([{ x: 5, y: 5 }, { x: 15, y: 5 }], -0.5)).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('clamps progress above 1 to the last point', () => {
    expect(positionAlongPolyline([{ x: 5, y: 5 }, { x: 15, y: 5 }], 1.5)).toEqual({
      x: 15,
      y: 5,
    });
  });

  it('returns the sole point for a single-vertex polyline', () => {
    expect(positionAlongPolyline([{ x: 7, y: 9 }], 0.5)).toEqual({ x: 7, y: 9 });
  });

  it('returns {0,0} for an empty polyline without throwing', () => {
    expect(() => positionAlongPolyline([], 0.5)).not.toThrow();
    expect(positionAlongPolyline([], 0.5)).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// laneOffset — deterministic per-colleague perpendicular offset (SC-010)
// ---------------------------------------------------------------------------

describe('laneOffset — deterministic per-colleague perpendicular offset', () => {
  it('is deterministic: the same colleagueId always yields the same offset', () => {
    expect(laneOffset('alice-uuid')).toBe(laneOffset('alice-uuid'));
  });

  it('is stable across value-equal strings (no object-identity dependence)', () => {
    const a = `${'bob'}-uuid`;
    const b = 'bob-uuid';
    expect(laneOffset(a)).toBe(laneOffset(b));
  });

  it('spreads distinct ids across lanes (different ids → ≥2 distinct offsets)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const offsets = new Set(ids.map((id) => laneOffset(id)));
    // Not all colleagues collapse onto one lane — the rush stays legible.
    expect(offsets.size).toBeGreaterThanOrEqual(2);
  });

  it('two distinct ids produce different offsets', () => {
    const idA = '11111111-1111-1111-1111-111111111111';
    const idB = '22222222-2222-2222-2222-222222222222';
    expect(laneOffset(idA)).not.toBe(laneOffset(idB));
  });

  it('default lanes are the symmetric set {-16,-8,0,8,16} (5 lanes × 8 px)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    for (const id of ids) {
      expect([-16, -8, 0, 8, 16]).toContain(laneOffset(id));
    }
  });

  it('honors laneCount + laneSpacing options (3 lanes × 4 px → {-4,0,4})', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (const id of ids) {
      expect([-4, 0, 4]).toContain(laneOffset(id, { laneCount: 3, laneSpacing: 4 }));
    }
  });

  it('maps a fixed id to a fixed lane deterministically under options', () => {
    const once = laneOffset('deterministic-id', { laneCount: 3, laneSpacing: 4 });
    const twice = laneOffset('deterministic-id', { laneCount: 3, laneSpacing: 4 });
    expect(once).toBe(twice);
  });
});

// ---------------------------------------------------------------------------
// commuterPosition — base position + perpendicular lane offset
// ---------------------------------------------------------------------------

describe('commuterPosition — base position + perpendicular lane offset', () => {
  // A straight horizontal path: tangent = (1, 0), so the perpendicular lane
  // offset moves ONLY the y-axis — the offset position's x equals the base x,
  // and the y shifts by the lane offset magnitude.
  const horizontal = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it('applies the lane offset perpendicular to the path', () => {
    const id = 'perpendicular-test-id';
    const base = positionAlongPolyline(horizontal, 0.5);
    const off = laneOffset(id);
    const result = commuterPosition(horizontal, 0.5, id);

    // x unchanged (perpendicular to a horizontal path is vertical).
    expect(result.x).toBeCloseTo(base.x, 6);
    // y shifted by exactly the lane offset magnitude.
    expect(Math.abs(result.y - base.y)).toBeCloseTo(Math.abs(off), 6);
  });

  it('the displacement is perpendicular to the local tangent (dot ≈ 0)', () => {
    const id = 'dot-product-id';
    const base = positionAlongPolyline(horizontal, 0.3);
    const result = commuterPosition(horizontal, 0.3, id);
    const dx = result.x - base.x;
    const dy = result.y - base.y;
    // Tangent of a horizontal segment is (1, 0); dot with the displacement ≈ 0.
    expect(dx).toBeCloseTo(0, 6);
    // And the displacement magnitude equals the lane offset magnitude.
    expect(Math.hypot(dx, dy)).toBeCloseTo(Math.abs(laneOffset(id)), 6);
  });

  it('with a single lane (offset 0) the commuter sits exactly on the path', () => {
    const base = positionAlongPolyline(horizontal, 0.5);
    expect(
      commuterPosition(horizontal, 0.5, 'anyone', { laneCount: 1, laneSpacing: 8 }),
    ).toEqual(base);
  });
});
