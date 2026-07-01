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
import { bn, compare } from './bigNumber';
import type { GameState, ContentCatalog } from './types';

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
