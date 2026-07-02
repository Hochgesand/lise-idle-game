// T044 — Pure commute-path math (FR-022, SC-010). Implements the T039 tests.
//
// This module is the Phaser-free math behind observing colleagues travel the
// `CommutePaths` polyline between the two lise buildings (the campus.json
// object layer of entrance-to-entrance Tiled polyline objects — T040). The
// renderer (`CampusScene.ts`, T080) consumes it to place a commuting avatar
// along the route with progress derived from the server-stamped `startedAt`
// against `coop.commuteSeconds`, plus a deterministic per-colleague
// perpendicular lane offset so a commute rush renders side-by-side instead of
// stacking (SC-010).
//
// ## Purity (Constitution Principle I)
// No Phaser, no `Date.now()`, no I/O. Every output is a pure function of the
// elapsed time, the polyline vertices, and a colleague id — so the commute
// math is unit-testable in isolation and deterministic across replays. The
// caller owns the clock: it passes `elapsed = now - commute.startedAt` (the
// server-stamped `startedAt` lives on PresenceRecord; data-model.md
// "PresenceRecord"); this module never reads a clock itself.
//
// ## Units
//  - `elapsedMs` is a sim-timeline duration in **milliseconds**
//    (`Date.parse(now) - commute.startedAt`, the same numeric timeline
//    `advance` uses).
//  - `commuteSeconds` is `content.coop.commuteSeconds` in **seconds**.
//  - Polyline vertices are world-space pixels (the Tiled `{ x, y }` shape).

/**
 * A world-space vertex on a CommutePaths polyline. Structurally identical to
 * the Tiled polyline vertex `{ x, y }`, so a campus.json polyline's points
 * (the object's `polyline` offset by its own `x`/`y` origin) pass straight in.
 */
export interface PolylinePoint {
  x: number;
  y: number;
}

/**
 * Tunable knobs for the perpendicular lane offset. All optional; sensible
 * defaults keep a ~30-commauteer rush legible against 16 px tiles.
 */
export interface LaneOffsetOptions {
  /** Number of discrete lanes the band is split into (default 5). */
  laneCount?: number;
  /** Pixel spacing between adjacent lanes (default 8). */
  laneSpacing?: number;
}

const DEFAULT_LANE_COUNT = 5;
const DEFAULT_LANE_SPACING = 8;

// ── Commute progress ─────────────────────────────────────────────────────

/**
 * Commute progress as a function of elapsed time vs `coop.commuteSeconds`,
 * clamped to `[0, 1]`: `0` at the start (no time elapsed), `1` at arrival
 * (`elapsedMs >= commuteSeconds * 1000`). Linear in between.
 *
 * The renderer uses this to place a commuter along the `CommutePaths` polyline
 * from the server-stamped `startedAt` (data-model.md "PresenceRecord"); it
 * also matches `advance`'s commute resolution at `startedAt +
 * coop.commuteSeconds`, so an observer's progress and the sim's arrival agree.
 *
 * Defensive: a non-finite `elapsedMs` is treated as not-started (`0`), and a
 * non-positive `commuteSeconds` resolves to arrived (`1`) — content validation
 * guarantees `commuteSeconds > 0` (T014), so the latter is tamper-safe only.
 *
 * @param elapsedMs       ms since the commute started (sim-timeline duration)
 * @param commuteSeconds  the travel duration from `content.coop.commuteSeconds`
 * @returns progress in `[0, 1]`.
 */
export function commuteProgress(elapsedMs: number, commuteSeconds: number): number {
  // Non-finite elapsed (e.g. a missing/invalid startedAt on the wire) → safe
  // "not started" rather than NaN propagating into the renderer.
  if (!Number.isFinite(elapsedMs)) {
    return 0;
  }
  // A non-positive duration means the commute resolves instantly; content
  // validation keeps this tamper-only, so treat it as already arrived.
  if (!Number.isFinite(commuteSeconds) || commuteSeconds <= 0) {
    return 1;
  }
  const progress = elapsedMs / (commuteSeconds * 1000);
  return Math.max(0, Math.min(1, progress));
}

// ── Polyline traversal (arc-length) ──────────────────────────────────────

/**
 * Clamp a value into `[0, 1]`. Used for progress clamping before walking the
 * polyline; non-finite input collapses to `0` (safe degenerate).
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Result of walking a polyline to a given progress: the world-space `pos` and
 * the unit `tangent` of the segment the point lies on (the renderer derives the
 * perpendicular lane direction from it). Internal — `positionAlongPolyline`
 * returns just the position, `commuterPosition` uses both.
 */
interface WalkResult {
  pos: PolylinePoint;
  tangent: PolylinePoint;
}

/**
 * Walk `points` by arc length to `progress` ∈ `[0, 1]`, returning the
 * world-space position and the unit tangent of the containing segment.
 *
 * Degenerate inputs are handled without throwing so the renderer never crashes
 * on a malformed map object:
 *  - empty polyline → `{0, 0}` with tangent `{1, 0}`;
 *  - single vertex → that vertex with tangent `{1, 0}`;
 *  - zero total length (all vertices coincide) → the last vertex.
 *
 * The tangent of a zero-length segment falls back to `{1, 0}`.
 */
function walkPolyline(points: readonly PolylinePoint[], progress: number): WalkResult {
  if (points.length === 0) {
    return { pos: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  }
  const p = clamp01(progress);
  if (points.length === 1) {
    return { pos: { x: points[0].x, y: points[0].y }, tangent: { x: 1, y: 0 } };
  }

  // Per-segment lengths and total arc length.
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  const last = points[points.length - 1];
  if (total === 0) {
    return { pos: { x: last.x, y: last.y }, tangent: { x: 1, y: 0 } };
  }

  // Find the segment containing the target arc-length distance, then
  // interpolate within it. The final segment always wins ties at progress 1.
  let target = p * total;
  let segIndex = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      segIndex = i;
      break;
    }
    target -= segLens[i];
  }
  const a = points[segIndex];
  const b = points[segIndex + 1];
  const segLen = segLens[segIndex];
  const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, target / segLen));
  const pos: PolylinePoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const tangent: PolylinePoint =
    segLen === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen };
  return { pos, tangent };
}

/**
 * World-space position along `points` at the given `progress` ∈ `[0, 1]`,
 * interpolated by **arc length** (not vertex count): two segments of unequal
 * length are traversed proportionally to their pixel length, so a commuter
 * moves at constant world speed along the whole route. Progress outside
 * `[0, 1]` is clamped to the endpoints.
 *
 * @param points   the polyline vertices (world-space pixels)
 * @param progress position along the route, `0` = start, `1` = end
 * @returns the world-space `{ x, y }` (a fresh object).
 */
export function positionAlongPolyline(
  points: readonly PolylinePoint[],
  progress: number,
): PolylinePoint {
  return walkPolyline(points, progress).pos;
}

// ── Deterministic per-colleague lane offset (SC-010) ─────────────────────

/**
 * Stable 32-bit FNV-1a hash of a string. Pure and deterministic (no
 * `Math.random`, no `Date`) — the same `colleagueId` always yields the same
 * hash, so a colleague's lane is stable across reconnects and replays. Operates
 * on UTF-16 code units (colleague ids are ASCII UUIDs in practice).
 */
function hash32(str: string): number {
  let h = 0x811c9dc5; // FNV offset basis (2166136261)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime (16777619), 32-bit multiply
  }
  return h >>> 0; // unsigned
}

/**
 * Deterministic perpendicular lane offset (in pixels) for a colleague, from a
 * stable hash of `colleagueId` (SC-010). Simultaneous commuters on the same
 * polyline each land on one of `laneCount` discrete lanes spaced `laneSpacing`
 * apart and centered on the path, so a rush renders side-by-side instead of
 * stacking — and each colleague's lane is stable across reconnects/replays.
 *
 * Defaults split the band into 5 lanes × 8 px → the symmetric set
 * `{-16, -8, 0, 8, 16}`. `laneCount: 1` collapses to a single on-path lane
 * (offset always `0`).
 *
 * @param colleagueId  the stable social key (PresenceRecord.colleagueId)
 * @param options      optional `{ laneCount, laneSpacing }` tuning
 * @returns the perpendicular offset in pixels (signed, centered on 0).
 */
export function laneOffset(colleagueId: string, options?: LaneOffsetOptions): number {
  const rawCount = options?.laneCount;
  const count =
    rawCount !== undefined && Number.isFinite(rawCount) && rawCount >= 1
      ? Math.floor(rawCount)
      : DEFAULT_LANE_COUNT;
  const rawSpacing = options?.laneSpacing;
  const spacing =
    rawSpacing !== undefined && Number.isFinite(rawSpacing) ? rawSpacing : DEFAULT_LANE_SPACING;

  const laneIndex = (hash32(colleagueId) >>> 0) % count; // [0, count)
  // Center the band on the path: index 0 → most-negative, index count-1 →
  // most-positive; an odd count puts a lane exactly on the centerline.
  return (laneIndex - (count - 1) / 2) * spacing;
}

// ── Composed commuter position ───────────────────────────────────────────

/**
 * The rendered world-space position of a commuting colleague: the arc-length
 * position along `points` at `progress`, shifted by the colleague's
 * deterministic perpendicular `laneOffset`. The lane offset is applied along
 * the segment's perpendicular (the tangent rotated 90°), so commuters spread
 * across the band orthogonal to their direction of travel (SC-010).
 *
 * This composes `positionAlongPolyline` + `laneOffset` for the renderer (T080);
 * both are exported individually too. Degenerate polylines are passed through
 * `walkPolyline` and never throw.
 *
 * @param points       the polyline vertices (world-space pixels)
 * @param progress     commute progress in `[0, 1]` (see `commuteProgress`)
 * @param colleagueId  the stable social key driving the lane offset
 * @param options      optional `{ laneCount, laneSpacing }` tuning
 * @returns the offset world-space `{ x, y }` (a fresh object).
 */
export function commuterPosition(
  points: readonly PolylinePoint[],
  progress: number,
  colleagueId: string,
  options?: LaneOffsetOptions,
): PolylinePoint {
  const { pos, tangent } = walkPolyline(points, progress);
  const offset = laneOffset(colleagueId, options);
  // Perpendicular to the tangent: rotate (tx, ty) by 90° → (-ty, tx).
  return {
    x: pos.x + -tangent.y * offset,
    y: pos.y + tangent.x * offset,
  };
}
