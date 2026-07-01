// T012 — STUB (RED) for `applyCoopPresence(state, segment, content)`.
//
// This module is the only entry point by which server-issued co-op lease
// segments reach the save (contracts §1). It is a discrete, non-time-based
// pure mutator (like the 001 mutators in `sim/actions.ts`): it merges a
// server-authored `CoopSegment` into `state.coopSegments` and NEVER touches
// `lastAdvancedAt` or resources. The third `content` parameter is required
// because the bounded-acceptance horizon reads `content.coop.leaseSeconds`.
//
// ## CURRENT STATE: RED STUB
// The function deliberately returns the state UNCHANGED so the T012 RED tests
// (every assertion expecting a segment to be stored) fail. The real
// implementation — upsert by `from` taking max(until)/max(multiplier),
// stale-segment no-op, bounded-acceptance horizon, malformed-input guard, and
// the segment clip/overlap helpers — lands in T023 (GREEN).

import type { ContentCatalog, CoopSegment, GameState } from './types';

/**
 * STUB (T012 RED). Merges a server-issued co-op lease `segment` into
 * `state.coopSegments`. The real implementation lands in T023.
 *
 * @param state    the current saveable snapshot (not mutated)
 * @param segment  a server-authored `{ from, until, multiplier }` lease segment
 * @param content  the versioned game content (reads `coop.leaseSeconds`)
 * @returns a NEW GameState with the segment merged — implemented in T023.
 */
export function applyCoopPresence(
  state: GameState,
  _segment: CoopSegment,
  _content: ContentCatalog,
): GameState {
  // RED: returns the state unchanged; T023 implements the merge.
  return state;
}
