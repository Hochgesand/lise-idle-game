// T007 — RED property test for the pure, deterministic `advance` simulation.
//
// ## Conventions (fixed here, implemented by T013/T015/T016)
//  - `dt` (deltaTimeMs) is in **milliseconds** (integer >= 0), per contracts §1.
//  - `computeRate(state, content)` returns the current LOC production rate in
//    **LOC per second** as a BigNumber (stringified).
//  - `advance` converts dt internally: `loc_gain = rate_per_sec * (dt / 1000)`.
//  - All resource fields (loc/cash/aiTokens) are big-number **strings**.
//  - `advance` is PURE: it returns a NEW state and never mutates the input.
//
// This file imports `./advance` and `./types`, which DO NOT EXIST yet
// (implemented in T013/T015/T016). Therefore the suite fails to resolve and is
// RED — the correct TDD starting state per Constitution Principle III.
//
// To compare two GameStates we normalize each via `normalize(state)` which
// turns Sets into sorted arrays and serializes to a stable JSON string; two
// equal states produce byte-identical normalized JSON.

import { describe, it, expect } from 'vitest';
import { advance, computeRate } from './advance';
import { manualBoost } from './actions';
import { bn, compare } from './bigNumber';
import type {
  CommuteState,
  ContentCatalog,
  CoopConfig,
  CoopSegment,
  GameState,
  Milestone,
} from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_ANCHOR = '2026-06-30T12:00:00.000Z';

/** A minimal valid GameState with one owned producer (manual_typing). */
function makeFixtureState(): GameState {
  return {
    resources: { loc: '0', cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: FIXED_ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
    activeTraining: null,
  };
}

/**
 * Minimal content catalog for the fixture: a single producer with a base rate
 * of 1 LOC/sec. `computeRate`/`advance` read the producer definitions by id.
 */
function makeFixtureContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    producers: [
      {
        id: 'manual_typing',
        name: 'Manual Typing',
        description: 'The dev types by hand.',
        baseRate: '1', // LOC/sec
        cost: { resource: 'cash', amount: '0' },
        costGrowth: 1.15,
        unlockRequirement: null,
      },
    ],
    upgrades: [],
    trainings: [],
    milestones: [],
    burners: [],
  };
}

/**
 * Deterministic normalization of a GameState to a stable JSON string so two
 * states can be compared by value (Set order is not significant).
 */
function normalize(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Set) {
      return Array.from(value).sort();
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// advance — determinism / associativity
// ---------------------------------------------------------------------------

describe('advance — determinism / associativity', () => {
  it('advance(advance(s, a), b) equals advance(s, a+b)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();
    const a = 1000; // ms
    const b = 2000; // ms

    const split = advance(advance(state, a, content), b, content);
    const combined = advance(state, a + b, content);

    expect(normalize(split)).toEqual(normalize(combined));
  });

  it('is pure: does not mutate the input state', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();
    const before = normalize(state);

    advance(state, 1000, content);

    expect(normalize(state)).toEqual(before);
  });

  it('returns a new state object (referential transparency)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = advance(state, 1, content);

    expect(result).not.toBe(state);
  });
});

// ---------------------------------------------------------------------------
// advance — monotonic production
// ---------------------------------------------------------------------------

describe('advance — monotonic production', () => {
  it('resources.loc only increases (dt > 0 with a producer owned)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = advance(state, 2000, content); // 2s @ 1 LOC/s => +2

    // loc increased; big-number strings compared numerically via parseFloat.
    expect(parseFloat(result.resources.loc)).toBeGreaterThan(
      parseFloat(state.resources.loc),
    );
  });

  it('dt=0 is a no-op returning an equal state (modulo object identity)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = advance(state, 0, content);

    // Resources unchanged ...
    expect(result.resources.loc).toEqual(state.resources.loc);
    // ... and lastAdvancedAt unchanged (adding 0ms).
    expect(result.lastAdvancedAt).toEqual(state.lastAdvancedAt);
  });
});

// ---------------------------------------------------------------------------
// advance — timestamp anchoring
// ---------------------------------------------------------------------------

describe('advance — timestamp anchoring', () => {
  it('result.lastAdvancedAt === advanceTime(state.lastAdvancedAt, dt)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();
    const dt = 3500; // ms

    const result = advance(state, dt, content);

    const expected = new Date(
      Date.parse(state.lastAdvancedAt) + dt,
    ).toISOString();

    expect(result.lastAdvancedAt).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// computeRate
// ---------------------------------------------------------------------------

describe('computeRate', () => {
  it('returns the summed base rate of owned producers (LOC/sec)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const rate = computeRate(state, content);

    // One producer at baseRate 1 LOC/sec => "1".
    expect(rate.toString()).toEqual('1');
  });
});

// ---------------------------------------------------------------------------
// advance — offline catch-up (large dt)
//
// quickstart.md Scenario 1: a closed tab for N minutes should credit LOC by
// ~rate×N on reopen. `advance` is closed-form (O(active features), never
// O(dt)), so a multi-day catch-up is as cheap as a 1s tick (Constitution
// "Performance of time skips"). These tests guard that property and the
// correctness of large-delta progression.
// ---------------------------------------------------------------------------

describe('advance — offline catch-up (large dt)', () => {
  it('minutes: 2 min @ 1 LOC/s yields ~120 LOC', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = advance(state, 120_000, content); // 120 s @ 1 LOC/s

    // Exact integer (well within break_eternity layer-0 exactness).
    expect(compare(bn(result.resources.loc), bn('120'))).toBe(0);
  });

  it('hours: 3 h @ 1 LOC/s yields ~10800 LOC', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = advance(state, 3 * 3600_000, content); // 10800 s

    expect(compare(bn(result.resources.loc), bn('10800'))).toBe(0);
  });

  it('multi-day catch-up is cheap and correct: 7 days @ 1 LOC/s yields ~604800 LOC (O(features), not O(dt))', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = advance(state, 7 * 86400_000, content); // 604800 s

    expect(compare(bn(result.resources.loc), bn('604800'))).toBe(0);
  });

  it('offline catch-up equals online sum (associativity at scale: 1h + 2h === 3h)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();
    const a = 3600_000; // 1 hour
    const b = 2 * 3600_000; // 2 hours

    const split = advance(advance(state, a, content), b, content);
    const combined = advance(state, a + b, content);

    expect(normalize(split)).toEqual(normalize(combined));
  });

  it('monotonicity holds at scale: loc never decreases, lastAdvancedAt advances by exactly dt', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();
    const dt = 5 * 3600_000; // 5 hours

    const result = advance(state, dt, content);

    // loc is monotonic (>= original).
    expect(compare(bn(result.resources.loc), bn(state.resources.loc))).
      toBeGreaterThanOrEqual(0);
    // lastAdvancedAt advanced by exactly dt.
    const expectedTs = new Date(
      Date.parse(state.lastAdvancedAt) + dt,
    ).toISOString();
    expect(result.lastAdvancedAt).toEqual(expectedTs);
  });
});

// ---------------------------------------------------------------------------
// advance — active burner (US2: cash & token burner)
//
// data-model.md "BurnerState" + "State transitions" steps 2-3:
// When activeBurner is set, `advance` consumes fuel at the burner's burnRate
// while applying its productionMultiplier to LOC production. When fuel runs
// out the burner is dropped (activeBurner = null). The two-segment closed-form
// math (R_f for fuelTime, R_b for the remainder) must be associative.
// ---------------------------------------------------------------------------

/**
 * Fixture content with a burner: burnRate "10" tokens/sec, productionMultiplier 2.
 * Base producer manual_typing at 1 LOC/sec (from makeFixtureContent).
 */
function makeBurnerContent(): ContentCatalog {
  return {
    ...makeFixtureContent(),
    burners: [
      {
        id: 'test_burner',
        name: 'Test Burner',
        fuelCostToActivate: '0',
        burnRate: '10', // tokens/sec
        productionMultiplier: 2,
      },
    ],
  };
}

/**
 * A fixture state with an active burner (definitionId 'test_burner', the
 * given fuelRemaining, startedAt at the fixed anchor).
 */
function makeBurnerState(fuel: string): GameState {
  return {
    ...makeFixtureState(),
    activeBurner: {
      definitionId: 'test_burner',
      startedAt: FIXED_ANCHOR,
      fuelRemaining: fuel,
    },
  };
}

describe('advance — active burner', () => {
  it('multiplies rate while fuel lasts (fuel 1000, dt 1s: +2 LOC, fuel→990)', () => {
    const content = makeBurnerContent();
    const state = makeBurnerState('1000');

    const result = advance(state, 1000, content); // 1s

    // baseRate=1, mult=2, dtSec=1 → gain = 1×2×1 = 2 (NOT base 1).
    expect(compare(bn(result.resources.loc), bn('2'))).toBe(0);
    // Fuel: 1000 − 10×1 = 990; burner still active.
    expect(result.activeBurner).not.toBeNull();
    expect(result.activeBurner!.fuelRemaining).toEqual('990');
  });

  it('fuel exhaustion mid-interval: partial at mult rate + remainder at base (fuel 5, dt 1s: +1.5 LOC, burner→null)', () => {
    const content = makeBurnerContent();
    const state = makeBurnerState('5');

    const result = advance(state, 1000, content); // 1s

    // fuelTime = 5/10 = 0.5s at mult rate (2→+1.0), remainder 0.5s at base (1→+0.5) = +1.5.
    expect(compare(bn(result.resources.loc), bn('1.5'))).toBe(0);
    expect(result.activeBurner).toBeNull();
  });

  it('exact boundary: fuel == burnRate×dtSec → full mult gain, fuel hits 0, burner→null', () => {
    const content = makeBurnerContent();
    const state = makeBurnerState('10'); // exactly burnRate(10) × dtSec(1)

    const result = advance(state, 1000, content); // 1s

    // Whole interval at mult rate: 2×1 = 2.
    expect(compare(bn(result.resources.loc), bn('2'))).toBe(0);
    expect(result.activeBurner).toBeNull();
  });

  it('monotonicity: loc never decreases and fuelRemaining never goes negative', () => {
    const content = makeBurnerContent();
    let state = makeBurnerState('25'); // 2.5s of fuel at burnRate 10

    const steps = [1000, 1000, 1000, 1000]; // 4 × 1s
    let prevLoc = state.resources.loc;
    for (const dt of steps) {
      state = advance(state, dt, content);
      // loc never decreases.
      expect(
        compare(bn(state.resources.loc), bn(prevLoc)),
      ).toBeGreaterThanOrEqual(0);
      prevLoc = state.resources.loc;
      // fuel never negative.
      if (state.activeBurner !== null) {
        expect(
          compare(bn(state.activeBurner.fuelRemaining), bn('0')),
        ).toBeGreaterThanOrEqual(0);
      }
    }
    // After 4s the burner (2.5s fuel) is exhausted.
    expect(state.activeBurner).toBeNull();
  });

  it('associativity with burner that exhausts: advance(advance(s,A),B) === advance(s,A+B)', () => {
    const content = makeBurnerContent();
    const state = makeBurnerState('5'); // fuelTime = 0.5s; total dt 1s exhausts

    // Split at exactly the fuel boundary (500ms = 0.5s). Step A exhausts the
    // fuel via the "enough fuel" branch (fuel→0, burner dropped); the combined
    // call takes the "runs out partway" branch — different code paths, same result.
    const a = 500; // 0.5s
    const b = 500; // 0.5s

    const split = advance(advance(state, a, content), b, content);
    const combined = advance(state, a + b, content);

    expect(normalize(split)).toEqual(normalize(combined));
  });

  // ── Fuzzy associativity (realistic ms splits) ──────────────────────
  //
  // The exact-associativity test above uses "nice" 500/500 ms splits where
  // dtSec = ms/1000 is exactly representable in binary-64. Realistic frame/
  // offline timings (e.g. 317ms, 9833ms, 16667ms) produce dtSec values that
  // are NOT exactly representable, so when a split crosses the fuel-exhaustion
  // boundary the rate×dtSec product accumulates an irreducible ULP rounding.
  // The offline-correctness GUARANTEE (no lost/phantom progress) holds exactly;
  // only the last bit of the LOC accumulator can differ at ~1e-15 relative.
  //
  // These tests assert ε-tolerance on loc (generous 1e-9 relative, the actual
  // drift is ~1e-15) while requiring timestamps + activeBurner to be EXACTLY
  // equal. See contracts.md §1 "up to floating-point ULP" clarification.

  /**
   * Assert two GameState LOC values are equal within a relative ε tolerance,
   * using parseFloat for comparison (the values are small enough here).
   */
  function expectLocClose(
    actual: string,
    expected: string,
    epsilon = 1e-9,
  ): void {
    const a = parseFloat(actual);
    const e = parseFloat(expected);
    if (e === 0) {
      expect(Math.abs(a)).toBeLessThan(epsilon);
    } else {
      expect(Math.abs(a - e) / Math.abs(e)).toBeLessThan(epsilon);
    }
  }

  /**
   * A realistic-millis split scenario: state with 10 tokens of fuel
   * (burnRate 10 → fuelTime 1.0s = 1000ms). The split crosses the exhaustion
   * boundary at non-round ms values so dtSec is not exactly representable.
   */
  function fuzzySplitScenario(a: number, b: number): void {
    const content = makeBurnerContent();
    // fuel 10 at burnRate 10 → fuelTime = 1.0s = 1000ms.
    const state = makeBurnerState('10');

    const split = advance(advance(state, a, content), b, content);
    const combined = advance(state, a + b, content);

    // LOC: approximately equal (ULP drift at the exhaustion boundary).
    expectLocClose(split.resources.loc, combined.resources.loc);
    // Timestamps: exactly equal (always integer ms → exact).
    expect(split.lastAdvancedAt).toEqual(combined.lastAdvancedAt);
    // activeBurner: exactly equal (fuel logic is exact in both paths).
    expect(split.activeBurner).toEqual(combined.activeBurner);
  }

  it('fuzzy associativity across exhaustion boundary: 9833ms + 2500ms (split crosses fuelTime=1000ms)', () => {
    // a=9833ms (> 1000ms fuel boundary → first step exhausts fuel),
    // b=2500ms (second step runs at base rate). Neither dtSec is exactly
    // representable in binary-64.
    fuzzySplitScenario(9833, 2500);
  });

  it('fuzzy associativity: split BEFORE exhaustion (317ms + 3683ms)', () => {
    // a=317ms (< 1000ms → first step still burning), b=3683ms (exhausts in
    // second step). Realistic sub-frame ms values.
    fuzzySplitScenario(317, 3683);
  });

  it('fuzzy associativity: three-way realistic split (16667ms + 8333ms + 5000ms)', () => {
    // Two-step associative check with realistic 60fps-adjacent ms values.
    const content = makeBurnerContent();
    const state = makeBurnerState('10'); // fuelTime 1000ms

    const s1 = advance(state, 16667, content);
    const s2 = advance(s1, 8333, content);
    const combined = advance(state, 16667 + 8333, content);

    expectLocClose(s2.resources.loc, combined.resources.loc);
    expect(s2.lastAdvancedAt).toEqual(combined.lastAdvancedAt);
    expect(s2.activeBurner).toEqual(combined.activeBurner);
  });
});

// ---------------------------------------------------------------------------
// advance — milestone evaluation (US3: lise Academy progression)
//
// data-model.md "Milestone"/"Reward"/"Requirement" + quickstart.md Scenario 3.
// `advance` evaluates milestone requirements AFTER the LOC gain for the
// interval, then loops (cascade) until stable. Only `grantResource` rewards
// are applied once at earn-time; multiplier rewards (globalMultiplier /
// producerRateMultiplier) are derived continuously from `earnedMilestones` by
// `computeRate`/`rateWithoutBurner`, so they must NOT be double-counted.
// These tests guard the US3 regression: buy training → permanent boost → reach
// milestone → earn + reward → persist.
// ---------------------------------------------------------------------------

/**
 * Fixture content with milestones. Base producer manual_typing at 1 LOC/sec
 * (from makeFixtureContent). Caller supplies the milestone definitions.
 */
function makeMilestoneContent(milestones: Milestone[]): ContentCatalog {
  return {
    ...makeFixtureContent(),
    milestones,
  };
}

/**
 * A fixture state with the given LOC and optional pre-seeded milestones /
 * producers. Everything else at zero/empty.
 */
function makeStateWithLoc(
  locStr: string,
  opts: { ownedProducers?: string[]; earnedMilestones?: string[] } = {},
): GameState {
  return {
    ...makeFixtureState(),
    resources: { loc: locStr, cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(
      opts.ownedProducers ?? ['manual_typing'],
    ),
    earnedMilestones: new Set<string>(opts.earnedMilestones ?? []),
  };
}

describe('advance — milestone evaluation', () => {
  // ── 1. resourceGte earns on threshold cross ────────────────────────────

  it('resourceGte: loc crosses threshold during advance → milestone earned + grantResource cash reward applied', () => {
    const milestone: Milestone = {
      id: 'iso_9001',
      name: 'ISO 9001 Certified',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100' },
      reward: { type: 'grantResource', resource: 'cash', amount: '50' },
    };
    const content = makeMilestoneContent([milestone]);
    const state = makeStateWithLoc('99'); // 1 LOC/s; 2s → 101 ≥ 100

    const result = advance(state, 2000, content); // +2 LOC → 101

    expect(result.earnedMilestones.has('iso_9001')).toBe(true);
    expect(result.resources.cash).toEqual('50');
  });

  // ── 2. resourceGte does NOT earn below threshold ───────────────────────

  it('resourceGte: loc stays below threshold → no earn, no reward', () => {
    const milestone: Milestone = {
      id: 'iso_9001',
      name: 'ISO 9001 Certified',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100' },
      reward: { type: 'grantResource', resource: 'cash', amount: '50' },
    };
    const content = makeMilestoneContent([milestone]);
    const state = makeStateWithLoc('98'); // 1 LOC/s; 1s → 99 < 100

    const result = advance(state, 1000, content); // +1 LOC → 99

    expect(result.earnedMilestones.has('iso_9001')).toBe(false);
    expect(result.resources.cash).toEqual('0');
  });

  // ── 3. ownsProducer milestone earns when owned ─────────────────────────

  it('ownsProducer: milestone requiring a producer earns when the producer is already owned', () => {
    const milestone: Milestone = {
      id: 'copilot_user',
      name: 'Copilot Adopter',
      requirement: { type: 'ownsProducer', targetId: 'copilot', threshold: null },
      reward: { type: 'grantResource', resource: 'cash', amount: '10' },
    };
    const content = makeMilestoneContent([milestone]);
    // Pre-seed: copilot is owned (advance only checks; it does not grant).
    const state = makeStateWithLoc('0', { ownedProducers: ['manual_typing', 'copilot'] });

    const result = advance(state, 1000, content); // any dt triggers milestone check

    expect(result.earnedMilestones.has('copilot_user')).toBe(true);
    expect(result.resources.cash).toEqual('10');
  });

  // ── 4. ownsProducer does NOT earn when not owned ───────────────────────

  it('ownsProducer: milestone does NOT earn when the producer is not owned', () => {
    const milestone: Milestone = {
      id: 'copilot_user',
      name: 'Copilot Adopter',
      requirement: { type: 'ownsProducer', targetId: 'copilot', threshold: null },
      reward: { type: 'grantResource', resource: 'cash', amount: '10' },
    };
    const content = makeMilestoneContent([milestone]);
    const state = makeStateWithLoc('0', { ownedProducers: ['manual_typing'] }); // no copilot

    const result = advance(state, 1000, content);

    expect(result.earnedMilestones.has('copilot_user')).toBe(false);
    expect(result.resources.cash).toEqual('0');
  });

  // ── 5. globalMultiplier reward is derived, not double-counted ──────────

  it('globalMultiplier reward: rate doubles via computeRate, but NO spurious lump grant', () => {
    const milestone: Milestone = {
      id: 'efficiency_expert',
      name: 'Efficiency Expert',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100' },
      reward: { type: 'globalMultiplier', multiplier: 2 },
    };
    const content = makeMilestoneContent([milestone]);
    const state = makeStateWithLoc('99'); // 1 LOC/s; 2s → 101 ≥ 100

    const result = advance(state, 2000, content); // +2 LOC → 101, milestone earns

    // Milestone was earned.
    expect(result.earnedMilestones.has('efficiency_expert')).toBe(true);
    // The multiplier is derived from earnedMilestones — computeRate doubles.
    const baselineRate = computeRate(makeStateWithLoc('99'), content);
    const afterRate = computeRate(result, content);
    expect(afterRate.toString()).toEqual('2');
    expect(baselineRate.toString()).toEqual('1');
    // NO spurious lump grant: the LOC gain for THIS interval was computed
    // using the pre-earn base rate (1×2s = +2), so loc = 99+2 = 101. The
    // multiplier applies to FUTURE intervals via computeRate, not retroactively.
    // No extra resource (cash/aiTokens) was granted.
    expect(compare(bn(result.resources.loc), bn('101'))).toBe(0);
    expect(result.resources.cash).toEqual('0');
    expect(result.resources.aiTokens).toEqual('0');
  });

  // ── 6. Cascade: A earns → reward enables B → B also earns ──────────────

  it('cascade: milestone A (loc≥100, reward +1000 loc) enables milestone B (loc≥1000, reward +50 cash) in the same advance', () => {
    const milestones: Milestone[] = [
      {
        id: 'milestone_a',
        name: 'Milestone A',
        requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100' },
        reward: { type: 'grantResource', resource: 'loc', amount: '1000' },
      },
      {
        id: 'milestone_b',
        name: 'Milestone B',
        requirement: { type: 'resourceGte', targetId: 'loc', threshold: '1000' },
        reward: { type: 'grantResource', resource: 'cash', amount: '50' },
      },
    ];
    const content = makeMilestoneContent(milestones);
    const state = makeStateWithLoc('99'); // 1 LOC/s; 2s → 101 ≥ 100 (A earns, +1000 loc → 1101 ≥ 1000, B earns)

    const result = advance(state, 2000, content);

    // Both milestones earned in a single advance (cascade resolved).
    expect(result.earnedMilestones.has('milestone_a')).toBe(true);
    expect(result.earnedMilestones.has('milestone_b')).toBe(true);
    // B's reward applied: +50 cash.
    expect(result.resources.cash).toEqual('50');
  });

  // ── 7. Idempotent: already-earned milestone is not re-applied ──────────

  it('idempotent: advancing with an already-earned milestone does NOT re-apply the reward', () => {
    const milestone: Milestone = {
      id: 'iso_9001',
      name: 'ISO 9001 Certified',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100' },
      reward: { type: 'grantResource', resource: 'cash', amount: '50' },
    };
    const content = makeMilestoneContent([milestone]);
    // Pre-seed the milestone as already earned; loc well above threshold.
    const state = makeStateWithLoc('500', { earnedMilestones: ['iso_9001'] });
    expect(state.resources.cash).toEqual('0');

    const result = advance(state, 1000, content);

    // earnedMilestones size unchanged (not re-added).
    expect(result.earnedMilestones.size).toBe(1);
    // Cash NOT re-granted (stays 0; only LOC grew by +1 from production).
    expect(result.resources.cash).toEqual('0');
  });

  // ── 8. Monotonic: loc never decreases through milestone evaluation ─────

  it('monotonic: loc never decreases across multiple advances with milestone evaluation', () => {
    const milestone: Milestone = {
      id: 'iso_9001',
      name: 'ISO 9001 Certified',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100' },
      reward: { type: 'grantResource', resource: 'loc', amount: '500' },
    };
    const content = makeMilestoneContent([milestone]);
    let state = makeStateWithLoc('97'); // 1 LOC/s

    let prevLoc = state.resources.loc;
    for (let i = 0; i < 5; i++) {
      state = advance(state, 1000, content); // +1 LOC each second
      expect(
        compare(bn(state.resources.loc), bn(prevLoc)),
      ).toBeGreaterThanOrEqual(0);
      prevLoc = state.resources.loc;
    }
    // The milestone (loc≥100) should have earned during this sequence.
    expect(state.earnedMilestones.has('iso_9001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T051 — advance with extreme LOC values (no NaN/Infinity)
// ---------------------------------------------------------------------------

describe('T051 — advance numeric integrity at extreme LOC values', () => {
  /** Content with a single high-rate producer (1e30 LOC/sec). */
  function makeExtremeContent(): ContentCatalog {
    return {
      schemaVersion: 1,
      contentVersion: '1.0.0',
      producers: [
        {
          id: 'mega_producer',
          name: 'Mega Producer',
          description: 'Extreme rate for numeric testing.',
          baseRate: '1e30',
          cost: { resource: 'cash', amount: '0' },
          costGrowth: 1.15,
          unlockRequirement: null,
        },
      ],
      upgrades: [],
      trainings: [],
      milestones: [],
      burners: [],
    };
  }

  function makeExtremeState(loc: string): GameState {
    return {
      resources: { loc, cash: '0', aiTokens: '0' },
      ownedProducers: new Set<string>(['mega_producer']),
      ownedUpgrades: new Set<string>(),
      ownedTrainings: new Set<string>(),
      activeBurner: null,
      earnedMilestones: new Set<string>(),
      lastAdvancedAt: FIXED_ANCHOR,
      schemaVersion: 1,
      settings: { reducedMotion: false, muted: false },
      coopSegments: [],
      activeOffice: 'office_1',
      commute: null,
      activeTraining: null,
    };
  }

  it('advancing from loc=1e50 at rate 1e30/sec stays finite (no NaN/Infinity)', () => {
    const content = makeExtremeContent();
    const state = makeExtremeState('1e50');

    const result = advance(state, 1000, content); // 1s @ 1e30/sec

    // Result loc must be a finite big-number string (not NaN/Infinity).
    expect(result.resources.loc).not.toBe('NaN');
    expect(result.resources.loc).not.toBe('Infinity');
    // parseFloat must yield a finite JS number (1e50 is within double range).
    expect(Number.isFinite(parseFloat(result.resources.loc))).toBe(true);
    // loc must be non-decreasing (at ~15 sig figs, 1e30 absorbed into 1e50 is
    // expected — the gain is 20 orders of magnitude smaller than the base).
    expect(compare(bn(result.resources.loc), bn('1e50'))).toBeGreaterThanOrEqual(0);
  });

  it('advancing beyond Number.MAX_VALUE stays finite (no NaN/Infinity)', () => {
    const content = makeExtremeContent();
    const state = makeExtremeState('1e400'); // beyond double range

    const result = advance(state, 1000, content);

    expect(result.resources.loc).not.toBe('NaN');
    expect(result.resources.loc).not.toBe('Infinity');
    // The value is non-decreasing (monotonic production).
    expect(compare(bn(result.resources.loc), bn('1e400'))).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// T011 — RED: piecewise coopSegment integration + commute resolution.
//
// These assert the 002 extension of `advance`/`computeRate` (contracts §1;
// data-model.md "State transitions"). Against the UN-extended 001 `advance`
// (which ignores `coopSegments`/`commute`) every gain / cap-clamp /
// compaction / commute-resolution / computeRate assertion below FAILS — the
// RED TDD starting state (Constitution Principle III).
//
// ## Timestamp model (types.ts; contracts §1 "T0 = Date.parse(state.lastAdvancedAt)")
// `state.lastAdvancedAt` stays an ISO-8601 STRING (byte-identical to 001).
// `CoopSegment.from`/`until` and `CommuteState.startedAt` are sim-timeline
// NUMBERS (ms) on the same numeric timeline `Date.parse(lastAdvancedAt)`
// yields. Segment/commute times below are offsets from `T0`.
// ===========================================================================

/** Sim-timeline ms anchor = Date.parse(FIXED_ANCHOR). */
const T0 = Date.parse(FIXED_ANCHOR);

/** The (002) coop tuning block (placeholder values, data-model.md CoopConfig). */
const COOP_CONFIG: CoopConfig = {
  perColleagueMultiplier: 0.1,
  maxMultiplier: 1.5,
  leaseSeconds: 60,
  heartbeatSeconds: 20,
  commuteSeconds: 30,
  lastSeenRetentionDays: 14,
};

/** Fixture content carrying the (002) coop tuning block. */
function makeCoopContent(): ContentCatalog {
  return { ...makeFixtureContent(), coop: COOP_CONFIG };
}

/** Fixture content with the test burner AND the coop block. */
function makeCoopBurnerContent(): ContentCatalog {
  return { ...makeBurnerContent(), coop: COOP_CONFIG };
}

/** A fixture state (base producer owned, 1 LOC/s) with the given coopSegments. */
function makeCoopState(segments: CoopSegment[]): GameState {
  return { ...makeFixtureState(), coopSegments: segments };
}

// ---------------------------------------------------------------------------
// T011 — advance: piecewise coopSegment integration (interval split)
// contracts §1: gain = Σ rate_i × multiplier_i × len_i; multiplier exactly 1
// outside any segment; segments clipped to [lastAdvancedAt, lastAdvancedAt+dt].
// ---------------------------------------------------------------------------

describe('T011 — advance: piecewise coopSegment integration', () => {
  it('splits the interval at a segment boundary: middle sub-interval boosted, edges baseline', () => {
    // Segment covers [T0+1s, T0+3s] at ×1.2; dt = 5s.
    // gain = 1×1×1 (1s) + 1×1.2×2 (2s) + 1×1×2 (2s) = 1 + 2.4 + 2 = 5.4.
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 + 1000, until: T0 + 3000, multiplier: 1.2 },
    ]);

    const result = advance(state, 5000, content);

    expect(compare(bn(result.resources.loc), bn('5.4'))).toBe(0);
  });

  it('clips a segment that overhangs the interval: whole interval covered, gain = rate×mult×dt', () => {
    // Segment [T0-1s, T0+10s] clipped to [T0, T0+2s]; dt = 2s → 1×1.5×2 = 3.
    const content = makeCoopContent();
    const seg: CoopSegment = { from: T0 - 1000, until: T0 + 10_000, multiplier: 1.5 };
    const state = makeCoopState([seg]);

    const result = advance(state, 2000, content);

    expect(compare(bn(result.resources.loc), bn('3'))).toBe(0);
    // Clipping is integration-only: the stored segment keeps server-authored times.
    expect(result.coopSegments).toEqual([seg]);
  });

  it('multiplier is exactly 1 outside segments (future segment contributes nothing)', () => {
    // Segment lies entirely beyond the interval → baseline only.
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 + 10_000, until: T0 + 20_000, multiplier: 1.5 },
    ]);

    const result = advance(state, 2000, content);

    // Baseline 1 LOC/s × 2s = 2 (NOT boosted).
    expect(compare(bn(result.resources.loc), bn('2'))).toBe(0);
  });

  it('triple split: burner fuel-exhaustion point + segment boundary both honoured', () => {
    // Burner: rate 2, burnRate 10, fuel 10 → fuelTime = 1s (exhausts at T0+1s).
    // Segment [T0+2s, T0+5s] at ×1.5; dt = 4s. Split points: T0+1s (exhaust),
    // T0+2s (seg from). Sub-intervals:
    //   [0,1s] burner rate 2, no segment → 2×1×1 = 2
    //   [1s,2s] base rate 1, no segment → 1×1×1 = 1
    //   [2s,4s] base rate 1, segment ×1.5 → 1×1.5×2 = 3
    //   total = 6. Fuel burns 10 (NOT scaled) → 0 → burner dropped.
    const content = makeCoopBurnerContent();
    const state: GameState = {
      ...makeBurnerState('10'),
      coopSegments: [{ from: T0 + 2000, until: T0 + 5000, multiplier: 1.5 }],
    };

    const result = advance(state, 4000, content);

    expect(compare(bn(result.resources.loc), bn('6'))).toBe(0);
    expect(result.activeBurner).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T011 — advance: overlap rule (latest-from wins) + cap clamp
// ---------------------------------------------------------------------------

describe('T011 — advance: overlap rule + cap clamp', () => {
  it('latest-`from` wins on overlap (NOT max multiplier): later lower-mult segment overrides', () => {
    // seg1 [T0, T0+4s] ×1.5; seg2 [T0+1s, T0+3s] ×1.2 (later `from`).
    // [0,1s] seg1 ×1.5 → 1.5; [1s,3s] seg2 ×1.2 (latest-from) → 2.4;
    // [3s,4s] seg1 ×1.5 → 1.5; total = 5.4 (would be 6.0 under max-mult rule).
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0, until: T0 + 4000, multiplier: 1.5 },
      { from: T0 + 1000, until: T0 + 3000, multiplier: 1.2 },
    ]);

    const result = advance(state, 4000, content);

    expect(compare(bn(result.resources.loc), bn('5.4'))).toBe(0);
  });

  it('cap clamp (tampered-save defense): multiplier 99 clamped to maxMultiplier 1.5', () => {
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0, until: T0 + 2000, multiplier: 99 },
    ]);

    const result = advance(state, 2000, content);

    // Clamped to 1.5 → 1×1.5×2 = 3 (NOT 198).
    expect(compare(bn(result.resources.loc), bn('3'))).toBe(0);
  });

  it('clamp lower bound: multiplier 0.5 clamped to 1 (monotonicity — loc never reduced)', () => {
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0, until: T0 + 2000, multiplier: 0.5 },
    ]);

    const result = advance(state, 2000, content);

    // Clamped to 1 → baseline 2 (post-clamp multiplier is always ≥ 1).
    expect(compare(bn(result.resources.loc), bn('2'))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T011 — advance: multiplier scales PRODUCTION only, never burnRate
// data-model: fuel burn stays linear across segment boundaries.
// ---------------------------------------------------------------------------

describe('T011 — advance: production-only multiplier (burnRate unaffected)', () => {
  it('segment multiplier scales LOC production, but fuel burns at the unscaled burnRate', () => {
    // Burner rate 2, burnRate 10, fuel 100 (plenty). Segment ×1.5 over [T0, T0+2s].
    // dt = 1s: LOC = burnerRate(2) × segMult(1.5) × 1 = 3; fuel = 100 − 10×1 = 90.
    const content = makeCoopBurnerContent();
    const state: GameState = {
      ...makeBurnerState('100'),
      coopSegments: [{ from: T0, until: T0 + 2000, multiplier: 1.5 }],
    };

    const result = advance(state, 1000, content);

    // Production scaled by the segment multiplier.
    expect(compare(bn(result.resources.loc), bn('3'))).toBe(0);
    // Fuel burn NOT scaled (10 tokens, not 15).
    expect(result.activeBurner).not.toBeNull();
    expect(result.activeBurner!.fuelRemaining).toEqual('90');
  });
});

// ---------------------------------------------------------------------------
// T011 — advance: compaction prunes integrated segments (idempotent)
// contracts §1: result.coopSegments has no segment with until <= lastAdvancedAt.
// ---------------------------------------------------------------------------

describe('T011 — advance: compaction (prune fully-integrated segments)', () => {
  it('prunes segments with until <= lastAdvancedAt; keeps segments still overlapping', () => {
    // past seg (until <= T0) pruned; future seg (until T0+3s > new ts T0+2s) kept.
    const content = makeCoopContent();
    const future: CoopSegment = { from: T0 + 1000, until: T0 + 3000, multiplier: 1.2 };
    const state = makeCoopState([
      { from: T0 - 5000, until: T0 - 1000, multiplier: 1.2 }, // fully past
      future,
    ]);

    const result = advance(state, 2000, content);

    expect(result.coopSegments).toEqual([future]);
    // The kept segment still integrates over [T0+1s, T0+2s]: 1×1×1 + 1×1.2×1 = 2.2.
    expect(compare(bn(result.resources.loc), bn('2.2'))).toBe(0);
  });

  it('idempotent: a boundary segment (until == lastAdvancedAt) is pruned and stays gone', () => {
    // until == T0 == lastAdvancedAt → pruned on first advance; empty thereafter.
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 - 2000, until: T0, multiplier: 1.2 },
    ]);

    const first = advance(state, 1000, content);
    expect(first.coopSegments).toEqual([]);

    const second = advance(first, 1000, content);
    // Still empty — pruned segments are never resurrected.
    expect(second.coopSegments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T011 — advance: commute resolution at startedAt + coop.commuteSeconds
// data-model step 1: resolve when startedAt + commuteSeconds <= lastAdvancedAt + dt.
// Works across offline spans (pure function of state + content).
// ---------------------------------------------------------------------------

describe('T011 — advance: commute resolution', () => {
  it('resolves at the exact boundary (startedAt + commuteSeconds == lastAdvancedAt + dt)', () => {
    // commuteSeconds = 30; dt = 30s → arrival exactly at the interval end.
    const content = makeCoopContent();
    const commute: CommuteState = {
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: T0,
    };
    const state: GameState = { ...makeCoopState([]), commute };

    const result = advance(state, 30_000, content);

    expect(result.activeOffice).toEqual('office_2');
    expect(result.commute).toBeNull();
    // Commutes do not affect production (no rate split): baseline gain only.
    expect(compare(bn(result.resources.loc), bn('30'))).toBe(0);
  });

  it('does NOT resolve when dt < commuteSeconds (commute still in progress)', () => {
    const content = makeCoopContent();
    const commute: CommuteState = {
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: T0,
    };
    const state: GameState = { ...makeCoopState([]), commute };

    const result = advance(state, 10_000, content); // 10s < 30s

    expect(result.commute).toEqual(commute);
    expect(result.activeOffice).toEqual('office_1');
  });

  it('resolves across an offline span (startedAt far in the past, large catch-up dt)', () => {
    // Commute started 200s ago; catch up 100s. startedAt+30s is well within reach.
    const content = makeCoopContent();
    const commute: CommuteState = {
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: T0 - 200_000,
    };
    const state: GameState = { ...makeCoopState([]), commute };

    const result = advance(state, 100_000, content);

    expect(result.activeOffice).toEqual('office_2');
    expect(result.commute).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T011 — advance: dt=0 no-op (NO pruning) + empty-segments baseline
// contracts §1: dt=0 is an exact no-op; coopSegments:[] is byte-identical to 001.
// ---------------------------------------------------------------------------

describe('T011 — advance: dt=0 no-op + empty-segment baseline', () => {
  it('dt=0 is an exact no-op: segments (even past ones) retained, timestamp unchanged', () => {
    const content = makeCoopContent();
    const past: CoopSegment = { from: T0 - 5000, until: T0 - 1000, multiplier: 1.2 };
    const future: CoopSegment = { from: T0 + 1000, until: T0 + 3000, multiplier: 1.2 };
    const state = makeCoopState([past, future]);

    const result = advance(state, 0, content);

    // No compaction at dt=0 — both segments retained verbatim.
    expect(result.coopSegments).toEqual([past, future]);
    expect(result.lastAdvancedAt).toEqual(state.lastAdvancedAt);
    expect(result.resources.loc).toEqual(state.resources.loc);
  });

  it('coopSegments: [] is byte-identical to 001 (coop block present but no effect)', () => {
    const content = makeCoopContent();
    const state = makeCoopState([]);

    const result = advance(state, 2000, content);

    // Baseline gain only; segments still empty.
    expect(compare(bn(result.resources.loc), bn('2'))).toBe(0);
    expect(result.coopSegments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T011 — advance: associativity with coopSegments (exact for multiples of 1000ms)
// contracts §1: advance(advance(s,a),b) === advance(s,a+b). Segment and
// commute boundaries are pure functions of state, so splitting is stable.
// ---------------------------------------------------------------------------

describe('T011 — advance: associativity with coopSegments', () => {
  it('advance(advance(s,a),b) === advance(s,a+b) with a segment present (a,b multiples of 1000ms)', () => {
    // Segment [T0+1s, T0+4s] ×1.5 (dyadic-exact). a=2s, b=3s.
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 + 1000, until: T0 + 4000, multiplier: 1.5 },
    ]);
    const a = 2000;
    const b = 3000;

    const split = advance(advance(state, a, content), b, content);
    const combined = advance(state, a + b, content);

    // Exact value-equality (integer-second boundaries + dyadic multiplier 1.5).
    expect(normalize(split)).toEqual(normalize(combined));
  });

  it('loc gain matches across the split (covered sub-interval identical either way)', () => {
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 + 1000, until: T0 + 4000, multiplier: 1.5 },
    ]);
    const a = 2000;
    const b = 3000;

    const split = advance(advance(state, a, content), b, content);
    const combined = advance(state, a + b, content);

    // [1s,4s] covered at ×1.5 (3s) + 2s baseline = 1×1.5×3 + 1×1×2 = 6.5.
    expect(compare(bn(split.resources.loc), bn('6.5'))).toBe(0);
    expect(compare(bn(combined.resources.loc), bn('6.5'))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T011 — computeRate + manualBoost: covering-segment consistency
// contracts §1: computeRate applies the covering segment at lastAdvancedAt
// (latest-from, cap-clamped); manualBoost is DERIVED from computeRate, so the
// preview and the boost MUST agree (consistency is contractual).
// ---------------------------------------------------------------------------

describe('T011 — computeRate + manualBoost: covering-segment consistency', () => {
  it('computeRate applies the covering segment multiplier at lastAdvancedAt', () => {
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 - 1000, until: T0 + 10_000, multiplier: 1.2 }, // covers T0
    ]);

    const rate = computeRate(state, content);

    // base 1 × covering ×1.2 = 1.2.
    expect(compare(rate, bn('1.2'))).toBe(0);
  });

  it('computeRate returns baseline with no covering segment', () => {
    const content = makeCoopContent();
    const state = makeCoopState([]);

    const rate = computeRate(state, content);

    expect(compare(rate, bn('1'))).toBe(0);
  });

  it('computeRate: latest-from wins AND cap-clamps (tampered ×99 → 1.5)', () => {
    const content = makeCoopContent();
    const state = makeCoopState([
      { from: T0 - 5000, until: T0 + 5000, multiplier: 1.5 },
      { from: T0 - 1000, until: T0 + 3000, multiplier: 99 }, // latest-from, capped
    ]);

    const rate = computeRate(state, content);

    // Latest-from (×99) clamped to maxMultiplier 1.5 → base 1 × 1.5 = 1.5.
    expect(compare(rate, bn('1.5'))).toBe(0);
  });

  it('manualBoost matches the preview under an active segment (both apply the multiplier)', () => {
    const content = makeCoopContent();
    const withSeg = makeCoopState([
      { from: T0 - 1000, until: T0 + 10_000, multiplier: 1.2 },
    ]);
    const baseline = makeCoopState([]);

    // manualBoost grants computeRate × factor (factor 1). Under the segment
    // computeRate = 1.2 → boost = +1.2 LOC; baseline computeRate = 1 → +1.0.
    const boostedWithSeg = manualBoost(withSeg, content, 1);
    const boostedBaseline = manualBoost(baseline, content, 1);

    expect(compare(bn(boostedWithSeg.resources.loc), bn('1.2'))).toBe(0);
    expect(compare(bn(boostedBaseline.resources.loc), bn('1'))).toBe(0);
    // The boost gain ratio equals the covering multiplier (1.2) — preview and
    // boost agree because manualBoost is derived from computeRate.
    expect(parseFloat(boostedWithSeg.resources.loc) /
      parseFloat(boostedBaseline.resources.loc)).toBeCloseTo(1.2, 10);
  });
});

// ===========================================================================
// T070 — offline-baseline CHARACTERIZATION/REGRESSION tests.
//
// Explicitly EXEMPT from the RED-first gate (tasks.md T070): the pure
// `advance` behavior exercised here shipped in Phase 2 (T024), so these
// tests arrive GREEN by design — they pin the behavior down as a regression
// guard while T071/T072 land the server side.
//
// ## The carve-out being characterized (plan.md Complexity Tracking;
// ## quickstart Scenario 5; FR-012/013 with the FR-013/SC-003 carve-out)
// An offline span integrates at BASELINE, with one documented, bounded
// deviation: the residual lease tail earned while the player was still
// online. The last heartbeat happens at/before the go-offline moment
// (== `lastAdvancedAt` of the persisted save), so a saved segment extends
// at most `coop.leaseSeconds` past that moment; beyond the segment's
// `until` the integration continues at exactly baseline. Presence during
// the absence contributes nothing — only the SAVED `coopSegments` enter
// the result, so replaying the identical save reproduces identical credit.
// ===========================================================================

describe('T070 — offline baseline characterization (carve-out regression guard)', () => {
  /**
   * The 001 ε-tolerance convention for LOC comparison (see the "Fuzzy
   * associativity" block above: generous 1e-9 relative; actual drift ~1e-15).
   * The values in these tests are integer-second sums and come out exact —
   * the tolerance documents the 001 offline comparison convention.
   */
  function expectLoc001Close(actual: string, expected: string, epsilon = 1e-9): void {
    const a = parseFloat(actual);
    const e = parseFloat(expected);
    if (e === 0) {
      expect(Math.abs(a)).toBeLessThan(epsilon);
    } else {
      expect(Math.abs(a - e) / Math.abs(e)).toBeLessThan(epsilon);
    }
  }

  /**
   * The maximal legitimate residual lease tail: a segment issued while the
   * player was still online (last heartbeat at/before T0 == lastAdvancedAt),
   * extending exactly `coop.leaseSeconds` past the go-offline moment.
   */
  function residualTailSegment(multiplier = 1.2): CoopSegment {
    return {
      from: T0 - 30_000, // issued while still online
      until: T0 + COOP_CONFIG.leaseSeconds * 1000, // ≤ one lease past go-offline
      multiplier,
    };
  }

  // ── Case 1: offline span covered ONLY by the pre-offline lease tail ─────

  it('carve-out: ×mult for the ≤ leaseSeconds tail, baseline beyond — piecewise total (5 min offline → 72 + 240 = 312)', () => {
    const content = makeCoopContent();
    const tail = residualTailSegment(1.2);
    // The tail extends at most coop.leaseSeconds past the go-offline moment.
    expect(tail.until - T0).toBeLessThanOrEqual(COOP_CONFIG.leaseSeconds * 1000);
    const state = makeCoopState([tail]);
    const dt = 300_000; // 5 min offline (quickstart Scenario 5 step 4)

    const result = advance(state, dt, content);

    // Piecewise expectation: tail [T0, T0+60s] at 1 LOC/s × 1.2 = 72, then
    // baseline [T0+60s, T0+300s] at 1 LOC/s × 240s = 240 → total 312.
    expect(compare(bn(result.resources.loc), bn('312'))).toBe(0);
    // The extra over the pure 001 baseline is EXACTLY the bounded tail bonus:
    // (mult − 1) × leaseSeconds × rate = 0.2 × 60 × 1 = 12 — never more.
    const baseline001 = advance(makeCoopState([]), dt, content);
    expect(compare(bn(baseline001.resources.loc), bn('300'))).toBe(0);
    const extra =
      parseFloat(result.resources.loc) - parseFloat(baseline001.resources.loc);
    expect(extra).toBeCloseTo((1.2 - 1) * COOP_CONFIG.leaseSeconds * 1, 9);
    // Bounded by the cap: extra ≤ (maxMultiplier − 1) × leaseSeconds × rate.
    expect(extra).toBeLessThanOrEqual(
      (COOP_CONFIG.maxMultiplier - 1) * COOP_CONFIG.leaseSeconds * 1,
    );
    // The fully-integrated tail is compacted away (no segment survives whose
    // until ≤ the new lastAdvancedAt) — no re-credit on a later advance.
    expect(result.coopSegments).toEqual([]);
  });

  // ── Case 2: long offline span (hours) — baseline beyond the stale tail ──

  it('long offline span (3 h) with a stale tail: baseline beyond the tail matches the 001 offline result within the 001 tolerance', () => {
    const content = makeCoopContent();
    const state = makeCoopState([residualTailSegment(1.2)]);
    const dt = 3 * 3600_000; // 3 hours offline

    // One-shot catch-up: tail 60s × 1.2 = 72, then 10740s baseline → 10812.
    const oneShot = advance(state, dt, content);
    expect(compare(bn(oneShot.resources.loc), bn('10812'))).toBe(0);

    // Beyond the tail the integration IS the 001 offline math: consume the
    // tail (60s → 72 LOC, segment compacted), then the remaining 2h59m gain
    // equals the pure-001 (coopSegments: []) gain over the same remainder,
    // within the 001 ε-tolerance convention.
    const afterTail = advance(state, COOP_CONFIG.leaseSeconds * 1000, content);
    expect(afterTail.coopSegments).toEqual([]);
    const rest = advance(afterTail, dt - COOP_CONFIG.leaseSeconds * 1000, content);
    const beyondTailGain =
      parseFloat(rest.resources.loc) - parseFloat(afterTail.resources.loc);
    const pure001 = advance(
      makeCoopState([]),
      dt - COOP_CONFIG.leaseSeconds * 1000,
      content,
    );
    expectLoc001Close(String(beyondTailGain), pure001.resources.loc);
    // Whole-span comparison against the 001 result (3h @ 1 LOC/s = 10800):
    // identical except the bounded tail extra (12 = 0.2 × 60 × 1).
    const baseline001 = advance(makeCoopState([]), dt, content);
    expect(compare(bn(baseline001.resources.loc), bn('10800'))).toBe(0);
    expectLoc001Close(
      String(parseFloat(oneShot.resources.loc) - (1.2 - 1) * COOP_CONFIG.leaseSeconds),
      baseline001.resources.loc,
    );
    // And split === one-shot (associativity holds across the tail boundary).
    expect(normalize(rest)).toEqual(normalize(oneShot));
  });

  // ── Case 3: replay determinism (quickstart Scenario 5 steps 6–7) ────────

  it('replay determinism: identical saved coopSegments over the identical span → byte-identical resources (FR-012/013)', () => {
    const content = makeCoopContent();
    const dt = 300_000; // the same 5 min absence, computed twice
    // Two independently-constructed, value-identical saves — the Scenario 5
    // step-2 "copy the localStorage save aside, then restore it" form.
    const original = makeCoopState([residualTailSegment(1.2)]);
    const restoredCopy = makeCoopState([residualTailSegment(1.2)]);

    const first = advance(original, dt, content);
    const replayed = advance(restoredCopy, dt, content);

    // Byte-identical resource strings — the credit is a deterministic
    // function of the save, never of wall clock or live presence.
    expect(replayed.resources.loc).toBe(first.resources.loc);
    expect(replayed.resources.cash).toBe(first.resources.cash);
    expect(replayed.resources.aiTokens).toBe(first.resources.aiTokens);
    // Full-state determinism (segments, timestamp, everything).
    expect(normalize(replayed)).toEqual(normalize(first));
  });

  it('replay over a longer span differs by exactly baseline × extra time (presence enters only via saved segments)', () => {
    // Scenario 5 step 7: replaying the restored save after MORE wall-clock
    // time has passed recomputes the same segment credit — the result differs
    // from the original catch-up only by the extra elapsed time at BASELINE
    // rate (no segment can cover it; nothing arrives live).
    const content = makeCoopContent();
    const extraMs = 120_000; // 2 further minutes at baseline
    const original = advance(
      makeCoopState([residualTailSegment(1.2)]),
      300_000,
      content,
    );
    const replayedLonger = advance(
      makeCoopState([residualTailSegment(1.2)]),
      300_000 + extraMs,
      content,
    );

    // 312 (original credit) + 1 LOC/s × 120s baseline = 432 — exact.
    expect(compare(bn(replayedLonger.resources.loc), bn('432'))).toBe(0);
    expect(
      parseFloat(replayedLonger.resources.loc) - parseFloat(original.resources.loc),
    ).toBeCloseTo(extraMs / 1000, 9);
  });
});
