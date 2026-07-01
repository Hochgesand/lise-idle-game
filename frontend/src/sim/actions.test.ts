// T026 — RED test for the manual-boost player-action mutator.
//
// ## API being defined (implemented by T029 in ./actions.ts, which does NOT
// exist yet — so this test file fails to resolve its import = RED, the correct
// TDD starting state per Constitution Principle III).
//
// `manualBoost(state, content, factor?)` is a PURE discrete player-action
// mutator (contracts.md §1 "Player-action mutators"). It does NOT call
// `advance` and does NOT advance time — it is a discrete LOC grant applied on
// user input; the game loop then calls `advance` separately to catch up.
//
// ### Boost formula (DOCUMENTED contract T029 must implement)
//   boost = computeRate(state, content) * factor          [LOC]
//   result.resources.loc = state.resources.loc + boost
//
// i.e. the boost grants `factor` SECONDS of current production. `factor`
// defaults to 1 (one second of production), matching quickstart.md Scenario 1
// "an immediate LOC boost." The grant is a positive-only LOC addition; it
// never reduces loc, never touches ownership/time/burner.
//
// ## Conventions (mirror advance.test.ts)
//  - `computeRate(state, content)` returns LOC/sec as a BigNumber.
//  - All resource fields are big-number strings.
//  - `manualBoost` is PURE: returns a NEW state, never mutates the input.
//  - Compare states by value via `normalize()` (Sets → sorted arrays → JSON).

import { describe, it, expect } from 'vitest';
import { manualBoost } from './actions';
import { computeRate } from './advance';
import { add, bn, compare, multiply, toString } from './bigNumber';
import type { GameState, ContentCatalog } from './types';

// ---------------------------------------------------------------------------
// Fixtures (mirror advance.test.ts conventions)
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
 * Minimal content catalog: a single producer with a base rate of 1 LOC/sec.
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
 * A higher-rate content fixture: a producer with baseRate 10 LOC/sec. Used to
 * prove the boost scales with production rate, not a constant.
 */
function makeHighRateContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    producers: [
      {
        id: 'manual_typing',
        name: 'Manual Typing',
        description: 'The dev types by hand.',
        baseRate: '10', // LOC/sec — 10x the baseline
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

/** A state that owns no producers → computeRate is 0. */
function makeEmptyState(): GameState {
  return {
    resources: { loc: '5', cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(),
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
 * Deterministic normalization of a GameState to a stable JSON string so two
 * states compare by value (Set order is not significant).
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
// manualBoost — purity / no mutation
// ---------------------------------------------------------------------------

describe('manualBoost — purity / no mutation', () => {
  it('returns a new state object (referential transparency)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = manualBoost(state, content);

    expect(result).not.toBe(state);
  });

  it('does not mutate the input state', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();
    const before = normalize(state);

    manualBoost(state, content);

    expect(normalize(state)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// manualBoost — LOC increases
// ---------------------------------------------------------------------------

describe('manualBoost — LOC increases', () => {
  it('result.resources.loc is strictly greater than state.resources.loc', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = manualBoost(state, content);

    expect(compare(bn(result.resources.loc), bn(state.resources.loc))).toBe(1);
  });

  it('grants exactly computeRate * factor LOC (default factor=1 → 1s of production)', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = manualBoost(state, content);

    // rate=1 LOC/sec, factor=1 → boost = 1 LOC. Starting at "0" → "1".
    const expected = toString(
      add(bn(state.resources.loc), computeRate(state, content)),
    );
    expect(compare(bn(result.resources.loc), bn(expected))).toBe(0);
  });

  it('factor multiplies the boost: factor=5 → 5s of production', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = manualBoost(state, content, 5);

    // rate=1 LOC/sec, factor=5 → boost = 5 LOC. Starting at "0" → "5".
    const expected = toString(
      add(bn(state.resources.loc), multiply(computeRate(state, content), bn('5'))),
    );
    expect(compare(bn(result.resources.loc), bn(expected))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// manualBoost — determinism
// ---------------------------------------------------------------------------

describe('manualBoost — determinism', () => {
  it('calling it twice on equal states yields equal results', () => {
    const content = makeFixtureContent();

    const r1 = manualBoost(makeFixtureState(), content);
    const r2 = manualBoost(makeFixtureState(), content);

    expect(normalize(r1)).toEqual(normalize(r2));
  });
});

// ---------------------------------------------------------------------------
// manualBoost — only LOC changes, nothing else
// ---------------------------------------------------------------------------

describe('manualBoost — only LOC changes, nothing else', () => {
  it('ownership sets, burner, schemaVersion, lastAdvancedAt, settings unchanged', () => {
    const state = makeFixtureState();
    const content = makeFixtureContent();

    const result = manualBoost(state, content);

    expect(result.ownedProducers).toEqual(state.ownedProducers);
    expect(result.ownedUpgrades).toEqual(state.ownedUpgrades);
    expect(result.ownedTrainings).toEqual(state.ownedTrainings);
    expect(result.earnedMilestones).toEqual(state.earnedMilestones);
    expect(result.activeBurner).toEqual(state.activeBurner);
    expect(result.schemaVersion).toEqual(state.schemaVersion);
    expect(result.lastAdvancedAt).toEqual(state.lastAdvancedAt);
    expect(result.settings).toEqual(state.settings);
    // cash / aiTokens unchanged (only loc is granted).
    expect(result.resources.cash).toEqual(state.resources.cash);
    expect(result.resources.aiTokens).toEqual(state.resources.aiTokens);
  });
});

// ---------------------------------------------------------------------------
// manualBoost — boost scales with production rate
// ---------------------------------------------------------------------------

describe('manualBoost — boost scales with production rate', () => {
  it('a higher-rate state yields a larger boost than the baseline', () => {
    const state = makeFixtureState();
    const baselineContent = makeFixtureContent(); // rate = 1 LOC/sec
    const highRateContent = makeHighRateContent(); // rate = 10 LOC/sec

    const baselineResult = manualBoost(state, baselineContent);
    const highRateResult = manualBoost(state, highRateContent);

    // boost_highRate > boost_baseline (10 LOC > 1 LOC).
    expect(
      compare(bn(highRateResult.resources.loc), bn(baselineResult.resources.loc)),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// manualBoost — non-negative / never decreases (zero-rate case)
// ---------------------------------------------------------------------------

describe('manualBoost — non-negative / never decreases', () => {
  it('with zero producers owned (rate 0), loc does not decrease (no-op grant of 0)', () => {
    const state = makeEmptyState(); // loc "5", no producers → rate 0
    const content = makeFixtureContent();

    const result = manualBoost(state, content);

    // DOCUMENTED behavior: zero rate → boost = 0 → loc unchanged.
    expect(compare(bn(result.resources.loc), bn(state.resources.loc))).
      toBeGreaterThanOrEqual(0);
    expect(result.resources.loc).toEqual(state.resources.loc);
  });
});
