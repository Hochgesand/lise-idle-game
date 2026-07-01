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

import type {
  ContentCatalog,
  CoopSegment,
  Effect,
  GameState,
  Requirement,
  ResourceType,
} from './types';
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
// (002) co-op segment clip/overlap helpers (contracts §1) — the latest-`from`
// overlap rule, [1, maxMultiplier] clamp, and interval clipping live in coop.ts
// next to the merge rule so the co-op invariants have one home. `advance` and
// `computeRate` consume them for piecewise integration + the rate preview.
import { clipSegment, effectiveMultiplier } from './coop';

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
  // (002) Apply the covering co-op segment's multiplier at `lastAdvancedAt`
  // (contracts §1 — the sim's only notion of "now", keeping the function pure):
  // latest-`from`-wins, cap-clamped to `coop.maxMultiplier`. `manualBoost` is
  // derived from `computeRate`, so lease multipliers apply to boosts identically
  // to the preview (consistency is contractual). With no covering segment the
  // multiplier is exactly 1 (baseline), so a `coopSegments: []` state returns
  // the unchanged 001 rate.
  const coop = content.coop;
  if (coop !== undefined && state.coopSegments.length > 0) {
    const nowMs = Date.parse(state.lastAdvancedAt);
    if (Number.isFinite(nowMs)) {
      const mult = effectiveMultiplier(state.coopSegments, nowMs, coop.maxMultiplier);
      rate = multiply(rate, fromNumber(mult));
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
    // (002) co-op overlay — deep-copied so `advance` never shares references
    // with the caller's state (T024 finalizes segment-aware cloning).
    coopSegments: state.coopSegments.map((s) => ({ ...s })),
    activeOffice: state.activeOffice,
    commute: state.commute === null ? null : { ...state.commute },
  };
}

// ── (002) Co-op piecewise-integration helpers ───────────────────────────

/**
 * (002, data-model step 1) Resolve an in-progress commute whose arrival at
 * `commute.startedAt + coop.commuteSeconds` falls at or before the advanced
 * timeline `t0 + dt`: set `activeOffice := commute.toOffice`, `commute := null`.
 * A pure function of state + content, so it resolves correctly across offline
 * spans. Commutes never affect production and add no rate split point.
 *
 * `t0` is `Date.parse(state.lastAdvancedAt)` (the contracts §1 anchor); the
 * commute's `startedAt` shares that numeric ms timeline (types.ts).
 */
function resolveCommute(
  result: GameState,
  t0: number,
  dt: number,
  content: ContentCatalog,
): void {
  if (result.commute === null) return;
  const coop = content.coop;
  if (coop === undefined || !Number.isFinite(t0)) return;
  const arrivalMs = result.commute.startedAt + coop.commuteSeconds * 1000;
  if (arrivalMs <= t0 + dt) {
    result.activeOffice = result.commute.toOffice;
    result.commute = null;
  }
}

/**
 * (002) The segments overlapping `[startMs, endMs)`, each clipped to the
 * interval (contracts §1 "Clock-skew clamping"). Used to enumerate the split
 * points; coverage/multiplier lookup still queries the ORIGINAL segments
 * (see `integratePiecewise`) so the latest-`from` rule is correct even when
 * several segments began before the interval.
 */
function clippedOverlapping(
  segments: CoopSegment[],
  startMs: number,
  endMs: number,
): CoopSegment[] {
  const out: CoopSegment[] = [];
  for (const s of segments) {
    const clipped = clipSegment(s, startMs, endMs);
    if (clipped !== null) out.push(clipped);
  }
  return out;
}

/**
 * (002, data-model steps 3–4) Integrate LOC gain piecewise over `[t0, t0+dt]`,
 * splitting the interval at every clipped segment boundary AND at the burner
 * fuel-exhaustion instant. Per sub-interval:
 *
 *     gain_i = rate_i × multiplier_i × len_i
 *
 * where `rate_i` is the burner rate while fuel lasts (else base) and
 * `multiplier_i` is the covering segment's effective multiplier (latest-`from`,
 * cap-clamped to `coop.maxMultiplier`), or 1 where uncovered. The multiplier
 * scales PRODUCTION only — fuel burns at the unscaled `burnRate`, so fuel math
 * stays linear across segment boundaries (data-model BurnerState note).
 *
 * `coverageSegments` are the ORIGINAL (un-clipped, un-pruned) segments, passed
 * explicitly so the latest-`from` overlap rule is evaluated against the
 * server-authored `from` values (clipping would tie segments that began before
 * the interval and break the tiebreak).
 */
function integratePiecewise(
  result: GameState,
  baseRate: BigNumber,
  dtSec: BigNumber,
  t0: number,
  dt: number,
  overlapping: CoopSegment[],
  coverageSegments: CoopSegment[],
  content: ContentCatalog,
): void {
  // `coop` is always present on catalogs from loadContent/FALLBACK; if a partial
  // fixture omits it, skip the upper clamp (multipliers still clamp to >= 1).
  const maxMultiplier = content.coop?.maxMultiplier ?? Infinity;

  // Split points (relative ms within [0, dt]): interval ends + clipped segment
  // boundaries + the burner fuel-exhaustion instant.
  const points = new Set<number>([0, dt]);
  for (const seg of overlapping) {
    points.add(seg.from - t0);
    points.add(seg.until - t0);
  }

  // Burner setup + fuel-exhaustion split point (mirrors the 001 closed form).
  let burnerRate = baseRate;
  let burnRateBn: BigNumber | null = null;
  let fuelRemainingBn: BigNumber | null = null;
  let exhaustRel = dt; // active through the whole interval unless it exhausts earlier
  if (result.activeBurner !== null) {
    const def = content.burners.find((b) => b.id === result.activeBurner!.definitionId);
    if (def === undefined) {
      // Burner definition vanished from content (version drift): drop it.
      result.activeBurner = null;
    } else {
      burnerRate = multiply(baseRate, fromNumber(def.productionMultiplier));
      burnRateBn = bn(def.burnRate);
      fuelRemainingBn = bn(result.activeBurner.fuelRemaining);
      if (!isZero(burnRateBn)) {
        const wouldBurn = multiply(burnRateBn, dtSec);
        if (compare(fuelRemainingBn, wouldBurn) < 0) {
          // Exhausts partway: fuelTime = fuelRemaining / burnRate seconds.
          const fuelTimeSec = divide(fuelRemainingBn, burnRateBn);
          let ex = fuelTimeSec.toNumber() * 1000;
          if (!Number.isFinite(ex) || ex < 0) ex = 0;
          if (ex > dt) ex = dt;
          exhaustRel = ex;
          points.add(ex);
        }
      }
    }
  }

  const sorted = Array.from(points)
    .filter((p) => p >= 0 && p <= dt)
    .sort((a, b) => a - b);

  let gain = bn('0');
  let fuelBurned = bn('0');
  for (let i = 0; i + 1 < sorted.length; i++) {
    const startRel = sorted[i];
    const endRel = sorted[i + 1];
    const lenMs = endRel - startRel;
    if (lenMs <= 0) continue;
    const lenSec = fromNumber(lenMs / 1000);
    // Burner active strictly before the exhaustion instant; off at/after it.
    const burnerOn = result.activeBurner !== null && startRel < exhaustRel;
    const rate = burnerOn ? burnerRate : baseRate;
    // Each sub-interval lies wholly within one segment's coverage (boundaries
    // are split points), so the multiplier at its start applies throughout.
    const mult = effectiveMultiplier(coverageSegments, t0 + startRel, maxMultiplier);
    gain = add(gain, multiply(multiply(rate, fromNumber(mult)), lenSec));
    if (burnerOn && burnRateBn !== null) {
      fuelBurned = add(fuelBurned, multiply(burnRateBn, lenSec));
    }
  }

  result.resources.loc = toString(add(bn(result.resources.loc), gain));
  if (result.activeBurner !== null && fuelRemainingBn !== null) {
    const newFuel = subtract(fuelRemainingBn, fuelBurned);
    if (compare(newFuel, bn('0')) <= 0) {
      result.activeBurner = null;
    } else {
      result.activeBurner = { ...result.activeBurner, fuelRemaining: toString(newFuel) };
    }
  }
}

// ── The core mutator ─────────────────────────────────────────────────────

/**
 * Advance `state` by `deltaTimeMs` milliseconds and return a NEW GameState.
 *
 * Algorithm (data-model.md "State transitions", extended by 002), computed in
 * CLOSED FORM over the whole interval — O(active features + #segments
 * overlapping the interval), never O(dt):
 *
 *  1. (002) resolve an in-progress commute at startedAt + coop.commuteSeconds;
 *  2. (002) compact — prune fully-integrated coopSegments;
 *  3. (002) split [t0, t0+dt] at clipped segment boundaries + fuel exhaustion;
 *  4. gain = Σ rate_i × multiplier_i × len_i (cap-clamped, production only);
 *  5. resources.loc += gain;
 *  6. milestone check: earn newly-satisfied milestones + grant one-time rewards;
 *  7. lastAdvancedAt = advanceTime(state.lastAdvancedAt, dt).
 *
 * When no segment overlaps the interval, step 4 takes the EXACT 001 two-segment
 * burner/base path verbatim — byte-identical 001 behavior for `coopSegments: []`
 * (every 001 save). The piecewise loop runs only when a segment overlaps.
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
 * fuel burn and LOC gain are both LINEAR in time, and every split point
 * (segment boundary, fuel exhaustion, commute arrival) is a pure function of
 * state, never wall clock. Exact for multiples of 1000 ms (the same ULP
 * caveat as 001 applies to a non-integer-second split on a boundary).
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
  // earned, NO compaction runs, and the timestamp is unchanged. Return the
  // clone immediately so the no-op is exact (contracts §1).
  if (dt === 0) {
    return result;
  }

  const dtSec = fromNumber(dt / 1000);
  const baseRate = rateWithoutBurner(state, content);
  const t0 = Date.parse(state.lastAdvancedAt);

  // (002) Step 1: resolve an in-progress commute (data-model step 1).
  resolveCommute(result, t0, dt, content);

  // (002) Step 2: compaction — prune fully-integrated segments. After advance,
  // `result.coopSegments` holds no segment with `until <= result.lastAdvancedAt`
  // (== t0 + dt). Pruning is idempotent and expired segments contribute
  // nothing, so this preserves associativity and keeps the array bounded.
  if (Number.isFinite(t0)) {
    const endMs = t0 + dt;
    result.coopSegments = result.coopSegments.filter((s) => s.until > endMs);
  }

  // (002) Step 3: split points — segments overlapping [t0, t0+dt] (clipped).
  const overlapping = Number.isFinite(t0)
    ? clippedOverlapping(state.coopSegments, t0, t0 + dt)
    : [];

  // (002) Step 4: piecewise gain when a segment overlaps; otherwise the EXACT
  // 001 two-segment burner/base path (byte-identical for coopSegments: []).
  if (overlapping.length > 0) {
    integratePiecewise(
      result,
      baseRate,
      dtSec,
      t0,
      dt,
      overlapping,
      state.coopSegments,
      content,
    );
  } else if (result.activeBurner !== null) {
    // === Spec 001 burner fuel budgeting + LOC gain (unchanged) ===
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

  // Step 6: milestone evaluation (against the now-updated resources).
  applyMilestones(result, content);

  // Step 7: re-anchor the clock.
  result.lastAdvancedAt = advanceTime(state.lastAdvancedAt, dt);

  return result;
}
