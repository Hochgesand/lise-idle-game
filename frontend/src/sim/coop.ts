// T023 — `applyCoopPresence` + segment clip/overlap helpers (contracts §1).
//
// This module is the only entry point by which server-issued co-op lease
// segments reach the save. It is a discrete, non-time-based pure mutator (like
// the 001 mutators in `sim/actions.ts`): it merges a server-authored
// `CoopSegment` into `state.coopSegments` and NEVER touches `lastAdvancedAt`
// or resources. The third `content` parameter is required because the
// bounded-acceptance horizon reads `content.coop.leaseSeconds`.
//
// ## Purity (Constitution Principle I)
// Returns a NEW GameState on the merge path; never mutates the input. No I/O,
// no `Date.now()` — only the passed state + content drive the result. Sets are
// rebuilt; nested objects are fresh (mirrors `cloneState` in `advance.ts`).
//
// ## Timestamp convention (data-model.md "CoopSegment"; types.ts)
// `CoopSegment.from`/`until` are **sim-timeline timestamps in milliseconds**
// (the same numeric timeline `advance` derives from
// `Date.parse(state.lastAdvancedAt)`). `state.lastAdvancedAt` is an ISO-8601
// UTC string. `coop.leaseSeconds` is in seconds, so the horizon is
//   `Date.parse(state.lastAdvancedAt) + content.coop.leaseSeconds * 1000`.
//
// ## clip/overlap helpers
// The exported `clipSegment` / `coveringSegmentAt` / `clampMultiplier` /
// `effectiveMultiplier` helpers encode contracts §1's integration rules
// (latest-`from`-wins overlap, [1, maxMultiplier] clamp, interval clipping).
// `advance` (T024) consumes them for the piecewise `coopSegments` integration;
// they are pure functions of state data, kept here next to the merge rule so
// the co-op invariants live in one module.

import type { ContentCatalog, CoopSegment, GameState } from './types';

// ── Deep clone (purity guarantee) ────────────────────────────────────────
//
// Mirrors the module-private `cloneState` in `advance.ts`/`actions.ts` so this
// mutator can build a fresh output without ever touching the caller's object
// (sets rebuilt; nested objects fresh; coopSegments deep-copied so a later
// `advance` can never share segment references with the caller's state).

/**
 * Produce a value-equal, independent copy of `state` so `applyCoopPresence`
 * can return a new state without sharing any references with the input.
 */
function cloneState(state: GameState): GameState {
  return {
    resources: {
      loc: state.resources.loc,
      cash: state.resources.cash,
      aiTokens: state.resources.aiTokens,
    },
    ownedProducers: new Set(state.ownedProducers),
    ownedUpgrades: new Set(state.ownedUpgrades),
    ownedTrainings: new Set(state.ownedTrainings),
    activeBurner: state.activeBurner === null ? null : { ...state.activeBurner },
    earnedMilestones: new Set(state.earnedMilestones),
    lastAdvancedAt: state.lastAdvancedAt,
    schemaVersion: state.schemaVersion,
    settings: { ...state.settings },
    coopSegments: state.coopSegments.map((s) => ({ ...s })),
    activeOffice: state.activeOffice,
    commute: state.commute === null ? null : { ...state.commute },
    // (003) in-progress training — deep-copied for the same purity guarantee.
    activeTraining: state.activeTraining === null ? null : { ...state.activeTraining },
  };
}

// ── The co-op presence mutator ───────────────────────────────────────────

/**
 * Merge a server-issued co-op lease `segment` into `state.coopSegments`
 * (contracts §1; data-model.md "CoopSegment"). The ONLY channel by which
 * presence affects the save; discrete and non-time-based — it never touches
 * `lastAdvancedAt` or resources.
 *
 * Merge rule — **upsert by `from`**: an existing segment with the same `from`
 * takes `until = max(existing.until, segment.until)` and
 * `multiplier = max(existing.multiplier, segment.multiplier)`. This is the
 * identical, conflict-free rule `sync/StateMerger.java` applies server-side,
 * so client merge and server merge cannot disagree; repeated delivery of the
 * same heartbeat extension is idempotent (max is monotonic).
 *
 * Postconditions (all return the state UNCHANGED, never throw — FR-017/018):
 *  - malformed segment (non-finite timestamps/multiplier, `until <= from`,
 *    negative multiplier) → unchanged;
 *  - stale segment (`until <= lastAdvancedAt`, fully in the past) → unchanged;
 *  - a segment beyond the bounded-acceptance horizon
 *    (`from > lastAdvancedAt + coop.leaseSeconds`) → dropped (unchanged) — a
 *    correct server never issues one, and accepting it would park a
 *    never-compacted segment in the save (unbounded-growth hole).
 *
 * @param state    the current saveable snapshot (not mutated)
 * @param segment  a server-authored `{ from, until, multiplier }` lease segment
 *                 (sim-timeline ms for `from`/`until`)
 * @param content  the versioned game content (reads `coop.leaseSeconds`)
 * @returns a NEW GameState with the segment merged, or `state` unchanged.
 */
export function applyCoopPresence(
  state: GameState,
  segment: CoopSegment,
  content: ContentCatalog,
): GameState {
  const { from, until, multiplier } = segment;

  // Malformed input — never throw (FR-017/018: social input must not corrupt
  // the sim or throw into the game loop). Non-finite timestamps (e.g. a
  // `Date.parse('garbage')` NaN the wire layer passed through), a degenerate
  // or inverted window (until <= from), and a non-finite or negative
  // multiplier all return the state unchanged.
  if (!Number.isFinite(from) || !Number.isFinite(until)) {
    return state;
  }
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    return state;
  }
  if (until <= from) {
    return state;
  }

  // The content catalog carries the lease tuning the horizon needs. It is
  // always present on catalogs produced by `loadContent`/`FALLBACK_CONTENT`;
  // if a partial fixture omits it, fail safe (baseline) rather than throw.
  const coop = content.coop;
  if (coop === undefined) {
    return state;
  }

  // The sim "now" anchor — CoopSegment times share the numeric timeline
  // `advance` derives from Date.parse(state.lastAdvancedAt).
  const nowMs = Date.parse(state.lastAdvancedAt);
  if (!Number.isFinite(nowMs)) {
    // Defensive: a corrupt lastAdvancedAt is the sim's own bug, not social
    // input — still fail safe by returning the state unchanged.
    return state;
  }

  // Stale segment: fully in the past. Already-integrated time is never
  // re-credited (contracts §1; data-model "Compacted").
  if (until <= nowMs) {
    return state;
  }

  // Bounded-acceptance horizon: a correct server never issues a segment whose
  // `from` lies more than one lease beyond the sim's now. Accepting one would
  // park a never-compacted segment in the save (unbounded-growth hole).
  // `coop.leaseSeconds` is in seconds → convert to the ms timeline.
  const horizon = nowMs + coop.leaseSeconds * 1000;
  if (from > horizon) {
    return state;
  }

  // Upsert by `from`, taking max(until) AND max(multiplier).
  const result = cloneState(state);
  const existing = result.coopSegments.find((s) => s.from === from);
  if (existing === undefined) {
    result.coopSegments.push({ from, until, multiplier });
  } else {
    existing.until = Math.max(existing.until, until);
    existing.multiplier = Math.max(existing.multiplier, multiplier);
  }
  return result;
}

// ── Segment clip / overlap helpers (consumed by advance, T024) ───────────

/**
 * Clamp a raw segment multiplier into `[1, maxMultiplier]` (contracts §1 "Cap
 * clamp"). Defense in depth against a tampered save (FR-011): post-clamp
 * multipliers are >= 1, so `result.resources.loc >= state.resources.loc`
 * (monotonicity) is preserved and the 001 monotonic merge stays sound.
 */
export function clampMultiplier(multiplier: number, maxMultiplier: number): number {
  if (!Number.isFinite(multiplier)) {
    return 1;
  }
  return Math.max(1, Math.min(multiplier, maxMultiplier));
}

/**
 * Clip a single segment to the half-open integration interval
 * `[intervalStartMs, intervalEndMs)`, returning a NEW clipped segment or
 * `null` if the segment does not overlap the interval (contracts §1 "Clock-skew
 * clamping" — a skewed client clock can shift where a segment overlaps the
 * local timeline but can never lengthen coverage beyond the issued lease).
 *
 * The returned segment's `multiplier` passes through verbatim (the clamp is
 * applied by `effectiveMultiplier`/`advance` at use time).
 */
export function clipSegment(
  segment: CoopSegment,
  intervalStartMs: number,
  intervalEndMs: number,
): CoopSegment | null {
  // No overlap: segment ends at/before the interval starts, or begins at/after
  // the interval ends.
  if (segment.until <= intervalStartMs || segment.from >= intervalEndMs) {
    return null;
  }
  return {
    from: Math.max(segment.from, intervalStartMs),
    until: Math.min(segment.until, intervalEndMs),
    multiplier: segment.multiplier,
  };
}

/**
 * Resolve the **covering** segment at sim-timeline instant `tMs` per the
 * latest-`from`-wins overlap rule (contracts §1 "Overlap rule"): among all
 * segments with `from <= tMs < until`, the one with the greatest `from`
 * applies (this lets a server-issued downgrade segment override remaining
 * coverage of an older, higher one). Returns `null` if no segment covers `tMs`.
 *
 * Ties on `from` (impossible post-`applyCoopPresence` merge, but defended
 * against a hand-authored save) are broken by the larger multiplier, keeping
 * the choice deterministic.
 */
export function coveringSegmentAt(segments: CoopSegment[], tMs: number): CoopSegment | null {
  let best: CoopSegment | null = null;
  for (const segment of segments) {
    if (segment.from <= tMs && tMs < segment.until) {
      if (
        best === null ||
        segment.from > best.from ||
        (segment.from === best.from && segment.multiplier > best.multiplier)
      ) {
        best = segment;
      }
    }
  }
  return best;
}

/**
 * The effective co-op production multiplier at sim-timeline instant `tMs`
 * (contracts §1): the covering segment's multiplier, clamped to
 * `[1, maxMultiplier]` (latest-`from`-wins), or exactly `1` where no segment
 * covers the instant (baseline outside segments). This is the sim's only notion
 * of "now", keeping the rate preview (`computeRate`) pure.
 */
export function effectiveMultiplier(
  segments: CoopSegment[],
  tMs: number,
  maxMultiplier: number,
): number {
  const covering = coveringSegmentAt(segments, tMs);
  if (covering === null) {
    return 1;
  }
  return clampMultiplier(covering.multiplier, maxMultiplier);
}
