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
import { add, bn, compare, fromNumber, multiply, subtract, toString } from './bigNumber';

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

// ── US2: Error type ─────────────────────────────────────────────────────

/**
 * Thrown by economy mutators when the player cannot afford the operation
 * (contracts.md §1). Typed so the UI can catch it and disable/notify.
 * No partial mutation occurs on this error — the input state is untouched.
 */
export class InsufficientResourcesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientResourcesError';
  }
}

// ── US2: cashOut (LOC → Cash) ───────────────────────────────────────────

/**
 * Convert LOC into Cash at a conversion rate (contracts.md §1, quickstart
 * Scenario 2).
 *
 * @param state      the current saveable snapshot (not mutated)
 * @param locAmount  how much LOC to convert (big-number string)
 * @param cashRate   the conversion multiplier (cash gained = locAmount × cashRate)
 * @returns a NEW GameState: loc decreased by locAmount, cash increased by
 *          locAmount × cashRate; everything else unchanged.
 * @throws InsufficientResourcesError if loc < locAmount (input unchanged).
 *
 * Pure: returns a new state, never mutates the input, no I/O, no time advance.
 */
export function cashOut(
  state: GameState,
  locAmount: string,
  cashRate: number,
): GameState {
  // Affordability check BEFORE cloning (the input is never mutated either way,
  // but throwing early keeps the no-partial-mutation guarantee explicit).
  if (compare(bn(state.resources.loc), bn(locAmount)) < 0) {
    throw new InsufficientResourcesError(
      `Cannot cash out ${locAmount} LOC: only ${state.resources.loc} available.`,
    );
  }

  const result = cloneState(state);
  result.resources.loc = toString(subtract(bn(state.resources.loc), bn(locAmount)));
  result.resources.cash = toString(
    add(bn(state.resources.cash), multiply(bn(locAmount), fromNumber(cashRate))),
  );
  return result;
}

// ── US2: purchaseUpgrade ────────────────────────────────────────────────

/**
 * Purchase an upgrade: deducts its Cost from the named resource and adds the
 * upgrade id to ownedUpgrades (contracts.md §1).
 *
 * @param state      the current saveable snapshot (not mutated)
 * @param content    the versioned game content
 * @param upgradeId  the id of the Upgrade to purchase
 * @returns a NEW GameState with the cost deducted and the upgrade owned.
 * @throws Error if the upgrade id is not found in content (a usage bug, not
 *         an affordability condition).
 * @throws InsufficientResourcesError if the player cannot afford the Cost
 *         (input unchanged).
 *
 * Pure: returns a new state, never mutates the input, no I/O, no time advance.
 */
export function purchaseUpgrade(
  state: GameState,
  content: ContentCatalog,
  upgradeId: string,
): GameState {
  const upgrade = content.upgrades.find((u) => u.id === upgradeId);
  if (upgrade === undefined) {
    throw new Error(`Upgrade '${upgradeId}' not found in content.`);
  }

  const resource = upgrade.cost.resource;
  const amount = upgrade.cost.amount;
  if (compare(bn(state.resources[resource]), bn(amount)) < 0) {
    throw new InsufficientResourcesError(
      `Cannot purchase upgrade '${upgradeId}': needs ${amount} ${resource}, ` +
        `only ${state.resources[resource]} available.`,
    );
  }

  const result = cloneState(state);
  result.resources[resource] = toString(
    subtract(bn(state.resources[resource]), bn(amount)),
  );
  result.ownedUpgrades = new Set(state.ownedUpgrades);
  result.ownedUpgrades.add(upgradeId);
  return result;
}

// ── US2: activateBurner ─────────────────────────────────────────────────

/**
 * Activate an AI-token burner: deducts fuelCostToActivate from aiTokens and
 * sets activeBurner (contracts.md §1, quickstart Scenario 2). The fuel paid
 * for becomes the fuel available to burn (`fuelRemaining = fuelCostToActivate`).
 *
 * `startedAt` is anchored to `state.lastAdvancedAt` to keep the sim pure (no
 * `Date.now()` — Constitution Principle I). This field is informational only;
 * it is not read by `advance` or any UI component. It does NOT need to be
 * re-anchored to the real clock by the game loop.
 *
 * @param state     the current saveable snapshot (not mutated)
 * @param content   the versioned game content
 * @param burnerId  the id of the Burner definition to activate
 * @returns a NEW GameState with aiTokens reduced and activeBurner set.
 * @throws Error if the burner id is not found in content.
 * @throws InsufficientResourcesError if aiTokens < fuelCostToActivate
 *         (input unchanged).
 *
 * Pure: returns a new state, never mutates the input, no I/O, no time advance.
 */
export function activateBurner(
  state: GameState,
  content: ContentCatalog,
  burnerId: string,
): GameState {
  const burner = content.burners.find((b) => b.id === burnerId);
  if (burner === undefined) {
    throw new Error(`Burner '${burnerId}' not found in content.`);
  }

  const fuelCost = burner.fuelCostToActivate;
  if (compare(bn(state.resources.aiTokens), bn(fuelCost)) < 0) {
    throw new InsufficientResourcesError(
      `Cannot activate burner '${burnerId}': needs ${fuelCost} aiTokens, ` +
        `only ${state.resources.aiTokens} available.`,
    );
  }

  const result = cloneState(state);
  result.resources.aiTokens = toString(
    subtract(bn(state.resources.aiTokens), bn(fuelCost)),
  );
  result.activeBurner = {
    definitionId: burnerId,
    startedAt: state.lastAdvancedAt,
    fuelRemaining: fuelCost,
  };
  return result;
}
