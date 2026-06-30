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
