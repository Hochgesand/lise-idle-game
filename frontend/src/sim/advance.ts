// T015/T016 — the pure, deterministic idle-game simulation core.
//
// This is the single source of truth for progression (Constitution Principle I).
// `advance(state, dt, content) -> state` advances a saveable snapshot by an
// elapsed time delta; it is pure (no I/O, no randomness, no Date.now()), so
// offline progress is computed by the EXACT same path as online play and
// `advance(advance(s, a), b) === advance(s, a + b)` (associativity = determinism
// = offline-correct). See data-model.md "State transitions" and contracts §1.
//
// Content is injected as a separate argument — it is versioned data (Principle
// II) and is deliberately NOT part of GameState. The rate is computed in
// O(active features) (sum over owned producers + owned upgrades/trainings +
// earned milestones), NEVER O(dt): a multi-day offline catch-up is as cheap as
// a 1-second tick (Constitution "Additional Constraints").
//
// ## Purity (testable)
// - Returns a NEW GameState; the input is never mutated (deep-copied up front).
// - No `Date.now()` — only the passed `lastAdvancedAt` string and `dt` feed it.
//
// ## Timestamp convention
// `dt` is in milliseconds (integer >= 0). `computeRate` returns LOC per SECOND.
// `advance` converts internally: `loc_gain = rate_per_sec * (dt / 1000)`.

import type { ContentCatalog, Effect, GameState, Requirement, ResourceType } from './types';
import {
  add,
  bn,
  compare,
  divide,
  fromNumber,
  isZero,
  multiply,
  subtract,
  toString,
} from './bigNumber';
import type { BigNumber } from './bigNumber';

// ── Timestamp helper ─────────────────────────────────────────────────────

/**
 * Advance an ISO-8601 UTC timestamp by `deltaTimeMs` milliseconds.
 * Matches `new Date(Date.parse(iso) + dtMs).toISOString()` exactly, which is
 * the identity `advance.test.ts` asserts for timestamp anchoring.
 */
export function advanceTime(lastAdvancedAt: string, deltaTimeMs: number): string {
  return new Date(Date.parse(lastAdvancedAt) + deltaTimeMs).toISOString();
}

// ── Rate computation (shared by computeRate + advance) ───────────────────

/**
 * The LOC/sec rate contributed by producers, upgrades, trainings, and earned
 * milestone multiplier-rewards — i.e. everything EXCEPT the active burner.
 *
 * Factorizing this out lets `advance` compute the two-segment burner fuel math
 * (rate WITH burner vs rate WITHOUT burner) without recomputing the base, and
 * keeps the burner preview logic in `computeRate` trivial.
 *
 * Multiplier effects from owned upgrades and earned milestone rewards are
 * applied uniformly (data-model treats them as the same Effect union):
 *  - producerRateMultiplier multiplies a single producer's base contribution.
 *  - globalMultiplier multiplies the summed total.
 * Trainings apply their permanentMultiplier to the total. All multiplier
 * products are accumulated in JS `number` space (they are small gameplay
 * constants) and folded in once; only the big baseRate sums use BigNumber.
 */
function rateWithoutBurner(state: GameState, content: ContentCatalog): BigNumber {
  // Per-producer multiplier (product of all producerRate effects targeting it).
  const producerMult = new Map<string, number>();
  const bumpProducer = (producerId: string, m: number): void => {
    producerMult.set(producerId, (producerMult.get(producerId) ?? 1) * m);
  };
  for (const upgrade of content.upgrades) {
    if (
      state.ownedUpgrades.has(upgrade.id) &&
      upgrade.effect.type === 'producerRateMultiplier'
    ) {
      bumpProducer(upgrade.effect.producerId, upgrade.effect.multiplier);
    }
  }
  for (const milestone of content.milestones) {
    if (
      state.earnedMilestones.has(milestone.id) &&
      milestone.reward.type === 'producerRateMultiplier'
    ) {
      bumpProducer(milestone.reward.producerId, milestone.reward.multiplier);
    }
  }

  // Sum owned producer contributions (each scaled by its per-producer mult).
  let rate = bn('0');
  for (const producer of content.producers) {
    if (state.ownedProducers.has(producer.id)) {
      const mult = producerMult.get(producer.id) ?? 1;
      if (mult !== 0) {
        rate = add(rate, multiply(bn(producer.baseRate), fromNumber(mult)));
      }
    }
  }

  // Global multiplier: product of global upgrade effects + global milestone
  // rewards + all owned training permanentMultipliers.
  let globalMult = 1;
  for (const upgrade of content.upgrades) {
    if (
      state.ownedUpgrades.has(upgrade.id) &&
      upgrade.effect.type === 'globalMultiplier'
    ) {
      globalMult *= upgrade.effect.multiplier;
    }
  }
  for (const milestone of content.milestones) {
    if (
      state.earnedMilestones.has(milestone.id) &&
      milestone.reward.type === 'globalMultiplier'
    ) {
      globalMult *= milestone.reward.multiplier;
    }
  }
  for (const training of content.trainings) {
    if (state.ownedTrainings.has(training.id)) {
      globalMult *= training.permanentMultiplier;
    }
  }
  rate = multiply(rate, fromNumber(globalMult));

  return rate;
}

/**
 * Preview the current LOC production rate (LOC per SECOND) as a BigNumber.
 *
 * Applies everything `rateWithoutBurner` does, plus the active burner's
 * productionMultiplier — for a UI preview the burner is assumed to have fuel
 * (the actual fuel-budgeted gain is computed inside `advance`). Used by UI
 * (HUD rate display, affordability hints) and internally by `advance`.
 */
export function computeRate(state: GameState, content: ContentCatalog): BigNumber {
  let rate = rateWithoutBurner(state, content);
  if (state.activeBurner !== null) {
    const def = content.burners.find((b) => b.id === state.activeBurner!.definitionId);
    if (def) {
      rate = multiply(rate, fromNumber(def.productionMultiplier));
    }
  }
  return rate;
}

// ── Milestone evaluation (data-model step 4) ─────────────────────────────

/** True if `requirement` is satisfied by `state`. */
function requirementMet(
  state: GameState,
  requirement: Requirement,
): boolean {
  switch (requirement.type) {
    case 'resourceGte': {
      // For resourceGte, `targetId` names the resource ('loc' | 'cash' |
      // 'aiTokens') and `threshold` is the big-number floor to reach.
      if (requirement.threshold === null || requirement.targetId === null) {
        return false;
      }
      const have = bn(state.resources[requirement.targetId as ResourceType]);
      return compare(have, bn(requirement.threshold)) >= 0;
    }
    case 'ownsProducer':
      return requirement.targetId !== null && state.ownedProducers.has(requirement.targetId);
    case 'ownsUpgrade':
      return requirement.targetId !== null && state.ownedUpgrades.has(requirement.targetId);
    case 'ownsTraining':
      return requirement.targetId !== null && state.ownedTrainings.has(requirement.targetId);
    case 'ownsMilestone':
      return (
        requirement.targetId !== null && state.earnedMilestones.has(requirement.targetId)
      );
    default: {
      const exhaustive: never = requirement.type;
      throw new Error(`unknown requirement type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Apply a milestone reward to `state`. `grantResource` rewards are granted
 * once at earn-time (the resource only ever increases, so the grant is
 * permanent). Multiplier rewards (globalMultiplier / producerRateMultiplier)
 * are intentionally NOT applied here — they are derived continuously from
 * `earnedMilestones` by `computeRate`/`rateWithoutBurner`, so applying them
 * here would double-count. This keeps reward semantics coherent and monotonic.
 */
function applyReward(state: GameState, reward: Effect): void {
  if (reward.type === 'grantResource') {
    const current = bn(state.resources[reward.resource]);
    state.resources[reward.resource] = toString(add(current, bn(reward.amount)));
  }
  // Multiplier rewards: no-op here (derived from earnedMilestones in computeRate).
}

/**
 * Evaluate every unearned milestone against the (already LOC-updated) state,
 * appending newly-earned ids and granting one-time rewards. Loops until a full
 * pass earns nothing — a reward (e.g. grantResource) can satisfy a further
 * milestone, so cascades must resolve fully. Terminates because milestones are
 * only ever added to a finite set.
 */
function applyMilestones(state: GameState, content: ContentCatalog): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const milestone of content.milestones) {
      if (
        !state.earnedMilestones.has(milestone.id) &&
        requirementMet(state, milestone.requirement)
      ) {
        state.earnedMilestones.add(milestone.id);
        applyReward(state, milestone.reward);
        changed = true;
      }
    }
  }
}

// ── Deep clone (purity guarantee) ────────────────────────────────────────

/**
 * Produce a value-equal, independent copy of `state` so `advance` can mutate
 * freely without ever touching the caller's object. Sets are rebuilt; nested
 * objects (resources, activeBurner, settings) are fresh.
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

// ── The core mutator ─────────────────────────────────────────────────────

/**
 * Advance `state` by `deltaTimeMs` milliseconds and return a NEW GameState.
 *
 * Algorithm (data-model.md "State transitions", 5 steps), computed in CLOSED
 * FORM over the whole interval — O(active features), never O(dt):
 *
 *  1. baseRate  = rateWithoutBurner(state, content)            [LOC/sec]
 *  2. burner fuel budgeting + two-segment LOC gain (see below)
 *  3. resources.loc += (rate effectively applied) * (dt/1000)
 *  4. milestone check: earn newly-satisfied milestones + grant one-time rewards
 *  5. lastAdvancedAt = advanceTime(state.lastAdvancedAt, dt)
 *
 * ## Burner fuel math (associativity guarantee)
 * Let R_b = baseRate, R_f = baseRate * productionMultiplier (with burner).
 * Fuel burns linearly at `burnRate` tokens/sec. Over the whole interval the
 * burner WOULD burn `wouldBurn = burnRate * dt_sec`. Two cases:
 *  - fuelRemaining >= wouldBurn: burner runs the WHOLE interval at R_f;
 *    fuelRemaining -= wouldBurn (drop the burner once it hits 0).
 *  - fuelRemaining <  wouldBurn: burner runs out partway. It is active for
 *    fuelTime = fuelRemaining / burnRate seconds (at R_f), then the remainder
 *    `dt_sec - fuelTime` runs at base R_b. LOC gain = R_f*fuelTime + R_b*rem.
 *
 * This is associative (advance(advance(s,a),b) === advance(s,a+b)) because
 * fuel burn and LOC gain are both LINEAR in time:
 *  - Splitting at a >= fuelTime: advance(s,a) fully exhausts fuel (active for
 *    fuelTime, LOC = R_f*fuelTime + R_b*(a-fuelTime)); advance(_,b) has no
 *    burner (LOC += R_b*b). Total active time = fuelTime, matching the single
 *    call.
 *  - Splitting at a < fuelTime: advance(s,a) burns burnRate*a of fuel and is
 *    active the whole a (LOC += R_f*a); advance(_,b) continues with the
 *    remaining fuel for min(b, fuelTime-a). Total active time =
 *    a + min(b, fuelTime-a) = min(a+b, fuelTime) — identical to the single call.
 * Fuel remaining and `lastAdvancedAt` are likewise additive, so the full
 * normalized state matches byte-for-byte.
 */
export function advance(
  state: GameState,
  deltaTimeMs: number,
  content: ContentCatalog,
): GameState {
  // Defensive clamp: the contract is integer >= 0; never run backwards.
  const dt = deltaTimeMs < 0 ? 0 : deltaTimeMs;
  const result = cloneState(state);

  // dt === 0: a pure no-op. Nothing is produced, no milestones can newly be
  // earned, and the timestamp is unchanged. Return the clone immediately so
  // the no-op is exact (no incidental burner-state churn).
  if (dt === 0) {
    return result;
  }

  const dtSec = fromNumber(dt / 1000);
  const baseRate = rateWithoutBurner(state, content);

  // Steps 2 + 3: burner fuel budgeting + LOC gain.
  if (result.activeBurner !== null) {
    const def = content.burners.find((b) => b.id === result.activeBurner!.definitionId);
    if (def === undefined) {
      // Burner definition vanished from content (version drift): drop it and
      // fall back to base production for the interval.
      result.activeBurner = null;
      result.resources.loc = toString(
        add(bn(result.resources.loc), multiply(baseRate, dtSec)),
      );
    } else {
      const burnRate = bn(def.burnRate); // tokens / sec
      const fuelRemaining = bn(result.activeBurner.fuelRemaining);
      const burnerRate = multiply(baseRate, fromNumber(def.productionMultiplier));

      if (isZero(burnRate)) {
        // Degenerate: a burner that burns no fuel is active indefinitely at R_f.
        result.resources.loc = toString(
          add(bn(result.resources.loc), multiply(burnerRate, dtSec)),
        );
      } else {
        const wouldBurn = multiply(burnRate, dtSec);
        if (compare(fuelRemaining, wouldBurn) >= 0) {
          // Enough fuel for the whole interval.
          const gain = multiply(burnerRate, dtSec);
          result.resources.loc = toString(add(bn(result.resources.loc), gain));
          const newFuel = subtract(fuelRemaining, wouldBurn);
          if (compare(newFuel, bn('0')) <= 0) {
            result.activeBurner = null;
          } else {
            result.activeBurner = {
              ...result.activeBurner,
              fuelRemaining: toString(newFuel),
            };
          }
        } else {
          // Runs out partway: R_f for fuelTime, then R_b for the remainder.
          const fuelTime = divide(fuelRemaining, burnRate); // seconds
          const burnGain = multiply(burnerRate, fuelTime);
          const remainder = subtract(dtSec, fuelTime);
          const baseGain = multiply(baseRate, remainder);
          result.resources.loc = toString(
            add(bn(result.resources.loc), add(burnGain, baseGain)),
          );
          result.activeBurner = null;
        }
      }
    }
  } else {
    // No active burner: straight base production.
    result.resources.loc = toString(
      add(bn(result.resources.loc), multiply(baseRate, dtSec)),
    );
  }

  // Step 4: milestone evaluation (against the now-updated resources).
  applyMilestones(result, content);

  // Step 5: re-anchor the clock.
  result.lastAdvancedAt = advanceTime(state.lastAdvancedAt, dt);

  return result;
}
