// T029 — Discrete player-action mutator layer (pure).
//
// Reference: contracts.md §1 "Player-action mutators"; Constitution Principle
// I (the sim stays pure, deterministic, and I/O-free); quickstart.md
// Scenario 1 ("Click/interact with the scene; confirm an immediate LOC boost").
//
// Player actions are discrete mutations applied on user input; they are NOT
// time-based and do NOT call `advance`. The game loop calls `advance`
// separately (to catch up offline progress) and then applies the action here.
// Keeping actions pure and separate from the time-based core preserves the
// deterministic, offline-correct simulation (Constitution Principle I):
// `advance` remains the single source of truth for time-based progression.
//
// ## Purity contract (testable)
// Every mutator here returns a NEW GameState and NEVER mutates its input.
// Sets are rebuilt (no shared references); nested objects (resources,
// activeBurner, settings) are fresh. There is no I/O, no `Date.now()`, no
// randomness — only the passed state + content drive the result.
//
// ## Boost formula (manualBoost)
//   boost = computeRate(state, content) * factor          [LOC]
//   result.resources.loc = state.resources.loc + boost
// i.e. `manualBoost` grants `factor` SECONDS of current production as LOC.
// `factor` defaults to 1 (one second of production). The grant is a
// positive-only LOC addition; it never reduces loc, never touches ownership,
// time, burner, or settings. With zero production (no producers owned) the
// boost is 0 and the result is an equal-but-new state (a no-op grant).

import type { ContentCatalog, GameState } from './types';
import { computeRate } from './advance';
import { add, bn, fromNumber, multiply, toString } from './bigNumber';

// ── Deep clone (purity guarantee) ────────────────────────────────────────
//
// Mirrors the module-private `cloneState` in advance.ts so this mutator can
// build a fresh output without ever touching the caller's object (sets are
// rebuilt; nested objects are fresh). This keeps the purity contract of the
// pure simulation (Constitution Principle I) consistent across both the
// time-based core (`advance`) and the discrete action layer (here).

/**
 * Produce a value-equal, independent copy of `state` so action mutators can
 * return a new state without sharing any references with the input. Sets are
 * rebuilt; nested objects (resources, activeBurner, settings) are fresh.
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
    activeBurner:
      state.activeBurner === null ? null : { ...state.activeBurner },
    earnedMilestones: new Set(state.earnedMilestones),
    lastAdvancedAt: state.lastAdvancedAt,
    schemaVersion: state.schemaVersion,
    settings: { ...state.settings },
  };
}

// ── The manual-boost action ──────────────────────────────────────────────

/**
 * Grant `factor` seconds of current production as LOC (the manual-boost
 * interaction; quickstart.md Scenario 1).
 *
 * @param state   the current saveable snapshot (not mutated)
 * @param content the versioned game content (producers/upgrades/etc.)
 * @param factor  how many seconds of production to grant (default 1)
 * @returns a NEW GameState with `resources.loc` increased by
 *          `computeRate(state, content) * factor`; everything else unchanged.
 *
 * Pure: returns a new state, never mutates the input, no I/O, no time advance.
 */
export function manualBoost(
  state: GameState,
  content: ContentCatalog,
  factor = 1,
): GameState {
  const result = cloneState(state);

  const rate = computeRate(state, content); // LOC / sec (BigNumber)
  const boost = multiply(rate, fromNumber(factor)); // LOC granted this action
  result.resources.loc = toString(add(bn(state.resources.loc), boost));

  return result;
}
