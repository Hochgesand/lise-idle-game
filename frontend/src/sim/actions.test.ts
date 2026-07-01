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
import {
  manualBoost,
  cashOut,
  purchaseUpgrade,
  activateBurner,
  InsufficientResourcesError,
} from './actions';
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

// ===========================================================================
// T038 — RED tests for US2 action mutators (cashOut, purchaseUpgrade,
//         activateBurner). These imports do NOT exist yet (implemented by
//         T040); the file fails to resolve them = RED.
//
// ## Contracts being tested (T040 must satisfy these exactly)
//
// All three are PURE mutators: return a NEW GameState, never mutate the input,
// throw `InsufficientResourcesError` (exported from ./actions) when the player
// cannot afford the operation — with NO partial mutation on error.
//
// ### cashOut(state, locAmount: string, cashRate: number): GameState
// Converts LOC → Cash. `locAmount` is how much LOC to convert (big-number
// string); `cashRate` is the conversion multiplier (LOC × cashRate = Cash).
//   - resources.loc decreases by locAmount
//   - resources.cash increases by locAmount × cashRate
//   - throws InsufficientResourcesError if loc < locAmount
//
// ### purchaseUpgrade(state, content, upgradeId): GameState
// Looks up the Upgrade in content by id; deducts its Cost from the named
// resource; adds upgradeId to ownedUpgrades.
//   - throws InsufficientResourcesError if the player can't afford the Cost
//
// ### activateBurner(state, content, burnerId): GameState
// Looks up the Burner in content by id; deducts fuelCostToActivate from
// aiTokens; sets activeBurner = { definitionId: burnerId, startedAt, fuelRemaining }.
//   - throws InsufficientResourcesError if aiTokens < fuelCostToActivate
// ===========================================================================

// ---------------------------------------------------------------------------
// US2 Fixtures
// ---------------------------------------------------------------------------

/**
 * A state with accumulated LOC and Cash for testing economy mutators.
 * loc=1000, cash=500, aiTokens=200.
 */
function makeEconomyState(): GameState {
  return {
    resources: { loc: '1000', cash: '500', aiTokens: '200' },
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
 * Content catalog with one upgrade (costs cash) and one burner definition.
 */
function makeEconomyContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    producers: [
      {
        id: 'manual_typing',
        name: 'Manual Typing',
        description: 'The dev types by hand.',
        baseRate: '1',
        cost: { resource: 'cash', amount: '0' },
        costGrowth: 1.15,
        unlockRequirement: null,
      },
    ],
    upgrades: [
      {
        id: 'better_keyboard',
        name: 'Better Keyboard',
        cost: { resource: 'cash', amount: '100' },
        effect: { type: 'globalMultiplier', multiplier: 2 },
        prerequisite: null,
      },
    ],
    trainings: [],
    milestones: [],
    burners: [
      {
        id: 'ai_burner',
        name: 'AI Token Burner',
        fuelCostToActivate: '50',
        burnRate: '5',
        productionMultiplier: 3,
      },
    ],
  };
}

// ===========================================================================
// cashOut
// ===========================================================================

describe('cashOut — success path', () => {
  it('decreases loc by locAmount and increases cash by locAmount × cashRate', () => {
    const state = makeEconomyState(); // loc=1000, cash=500

    // cashRate=2 → 100 LOC converts to 200 Cash.
    const result = cashOut(state, '100', 2);

    // loc: 1000 - 100 = 900
    expect(result.resources.loc).toEqual('900');
    // cash: 500 + (100 × 2) = 700
    expect(result.resources.cash).toEqual('700');
  });

  it('only changes loc and cash; everything else is unchanged', () => {
    const state = makeEconomyState();

    const result = cashOut(state, '50', 1);

    expect(result.ownedProducers).toEqual(state.ownedProducers);
    expect(result.ownedUpgrades).toEqual(state.ownedUpgrades);
    expect(result.ownedTrainings).toEqual(state.ownedTrainings);
    expect(result.earnedMilestones).toEqual(state.earnedMilestones);
    expect(result.activeBurner).toEqual(state.activeBurner);
    expect(result.schemaVersion).toEqual(state.schemaVersion);
    expect(result.lastAdvancedAt).toEqual(state.lastAdvancedAt);
    expect(result.settings).toEqual(state.settings);
    expect(result.resources.aiTokens).toEqual(state.resources.aiTokens);
  });
});

describe('cashOut — InsufficientResourcesError', () => {
  it('throws InsufficientResourcesError when loc < locAmount', () => {
    const state = makeEconomyState(); // loc=1000

    expect(() => cashOut(state, '2000', 1)).toThrow(InsufficientResourcesError);
  });

  it('does NOT partially mutate on failure (input unchanged)', () => {
    const state = makeEconomyState();
    const before = normalize(state);

    try {
      cashOut(state, '2000', 1);
    } catch {
      // expected
    }

    expect(normalize(state)).toEqual(before);
  });
});

describe('cashOut — purity / no mutation', () => {
  it('returns a new state object (referential transparency)', () => {
    const state = makeEconomyState();

    const result = cashOut(state, '100', 1);

    expect(result).not.toBe(state);
  });

  it('does not mutate the input state', () => {
    const state = makeEconomyState();
    const before = normalize(state);

    cashOut(state, '100', 1);

    expect(normalize(state)).toEqual(before);
  });
});

describe('cashOut — determinism', () => {
  it('calling it twice on equal states yields equal results', () => {
    const r1 = cashOut(makeEconomyState(), '100', 2);
    const r2 = cashOut(makeEconomyState(), '100', 2);

    expect(normalize(r1)).toEqual(normalize(r2));
  });
});

// ===========================================================================
// purchaseUpgrade
// ===========================================================================

describe('purchaseUpgrade — success path', () => {
  it('adds the upgrade id to ownedUpgrades and deducts the cost resource', () => {
    const state = makeEconomyState(); // cash=500
    const content = makeEconomyContent(); // upgrade 'better_keyboard' costs 100 cash

    const result = purchaseUpgrade(state, content, 'better_keyboard');

    expect(result.ownedUpgrades.has('better_keyboard')).toBe(true);
    // cash: 500 - 100 = 400
    expect(result.resources.cash).toEqual('400');
  });

  it('only changes the cost resource and ownedUpgrades', () => {
    const state = makeEconomyState();
    const content = makeEconomyContent();

    const result = purchaseUpgrade(state, content, 'better_keyboard');

    expect(result.resources.loc).toEqual(state.resources.loc);
    expect(result.resources.aiTokens).toEqual(state.resources.aiTokens);
    expect(result.ownedProducers).toEqual(state.ownedProducers);
    expect(result.ownedTrainings).toEqual(state.ownedTrainings);
    expect(result.earnedMilestones).toEqual(state.earnedMilestones);
    expect(result.activeBurner).toEqual(state.activeBurner);
    expect(result.schemaVersion).toEqual(state.schemaVersion);
    expect(result.lastAdvancedAt).toEqual(state.lastAdvancedAt);
    expect(result.settings).toEqual(state.settings);
  });
});

describe('purchaseUpgrade — InsufficientResourcesError', () => {
  it('throws InsufficientResourcesError when the player cannot afford the cost', () => {
    // A state with only 50 cash (upgrade costs 100).
    const state: GameState = {
      ...makeEconomyState(),
      resources: { loc: '1000', cash: '50', aiTokens: '200' },
    };
    const content = makeEconomyContent();

    expect(() => purchaseUpgrade(state, content, 'better_keyboard')).toThrow(
      InsufficientResourcesError,
    );
  });

  it('does NOT partially mutate on failure (input unchanged)', () => {
    const state: GameState = {
      ...makeEconomyState(),
      resources: { loc: '1000', cash: '50', aiTokens: '200' },
    };
    const before = normalize(state);

    try {
      purchaseUpgrade(state, makeEconomyContent(), 'better_keyboard');
    } catch {
      // expected
    }

    expect(normalize(state)).toEqual(before);
  });
});

describe('purchaseUpgrade — purity / no mutation', () => {
  it('returns a new state object (referential transparency)', () => {
    const state = makeEconomyState();
    const content = makeEconomyContent();

    const result = purchaseUpgrade(state, content, 'better_keyboard');

    expect(result).not.toBe(state);
  });

  it('does not mutate the input state', () => {
    const state = makeEconomyState();
    const before = normalize(state);

    purchaseUpgrade(state, makeEconomyContent(), 'better_keyboard');

    expect(normalize(state)).toEqual(before);
  });
});

describe('purchaseUpgrade — determinism', () => {
  it('calling it twice on equal states yields equal results', () => {
    const content = makeEconomyContent();

    const r1 = purchaseUpgrade(makeEconomyState(), content, 'better_keyboard');
    const r2 = purchaseUpgrade(makeEconomyState(), content, 'better_keyboard');

    expect(normalize(r1)).toEqual(normalize(r2));
  });
});

// ===========================================================================
// activateBurner
// ===========================================================================

describe('activateBurner — success path', () => {
  it('sets activeBurner with the right definitionId and deducts fuelCostToActivate', () => {
    const state = makeEconomyState(); // aiTokens=200
    const content = makeEconomyContent(); // burner 'ai_burner' fuelCostToActivate=50

    const result = activateBurner(state, content, 'ai_burner');

    expect(result.activeBurner).not.toBeNull();
    expect(result.activeBurner!.definitionId).toEqual('ai_burner');
    // aiTokens: 200 - 50 = 150
    expect(result.resources.aiTokens).toEqual('150');
  });

  it('sets fuelRemaining on the active burner (amount derived from content)', () => {
    const state = makeEconomyState();
    const content = makeEconomyContent(); // burner fuelCostToActivate=50, burnRate=5, prodMult=3

    const result = activateBurner(state, content, 'ai_burner');

    expect(result.activeBurner).not.toBeNull();
    // The burner is activated with fuel = fuelCostToActivate (the fuel you
    // paid for becomes the fuel you burn). T040 must set fuelRemaining to
    // the Burner definition's fuelCostToActivate value.
    expect(result.activeBurner!.fuelRemaining).toEqual('50');
  });

  it('sets startedAt on the active burner (ISO-8601 string)', () => {
    const state = makeEconomyState();
    const content = makeEconomyContent();

    const result = activateBurner(state, content, 'ai_burner');

    expect(result.activeBurner).not.toBeNull();
    // startedAt must be an ISO-8601 string (we don't assert the exact value —
    // it's a timestamp; T040 picks the convention).
    expect(typeof result.activeBurner!.startedAt).toBe('string');
    expect(result.activeBurner!.startedAt.length).toBeGreaterThan(0);
  });

  it('only changes aiTokens and activeBurner', () => {
    const state = makeEconomyState();
    const content = makeEconomyContent();

    const result = activateBurner(state, content, 'ai_burner');

    expect(result.resources.loc).toEqual(state.resources.loc);
    expect(result.resources.cash).toEqual(state.resources.cash);
    expect(result.ownedProducers).toEqual(state.ownedProducers);
    expect(result.ownedUpgrades).toEqual(state.ownedUpgrades);
    expect(result.ownedTrainings).toEqual(state.ownedTrainings);
    expect(result.earnedMilestones).toEqual(state.earnedMilestones);
    expect(result.schemaVersion).toEqual(state.schemaVersion);
    expect(result.settings).toEqual(state.settings);
  });
});

describe('activateBurner — InsufficientResourcesError', () => {
  it('throws InsufficientResourcesError when aiTokens < fuelCostToActivate', () => {
    // A state with only 10 aiTokens (burner costs 50).
    const state: GameState = {
      ...makeEconomyState(),
      resources: { loc: '1000', cash: '500', aiTokens: '10' },
    };
    const content = makeEconomyContent();

    expect(() => activateBurner(state, content, 'ai_burner')).toThrow(
      InsufficientResourcesError,
    );
  });

  it('does NOT partially mutate on failure (input unchanged)', () => {
    const state: GameState = {
      ...makeEconomyState(),
      resources: { loc: '1000', cash: '500', aiTokens: '10' },
    };
    const before = normalize(state);

    try {
      activateBurner(state, makeEconomyContent(), 'ai_burner');
    } catch {
      // expected
    }

    expect(normalize(state)).toEqual(before);
  });
});

describe('activateBurner — purity / no mutation', () => {
  it('returns a new state object (referential transparency)', () => {
    const state = makeEconomyState();
    const content = makeEconomyContent();

    const result = activateBurner(state, content, 'ai_burner');

    expect(result).not.toBe(state);
  });

  it('does not mutate the input state', () => {
    const state = makeEconomyState();
    const before = normalize(state);

    activateBurner(state, makeEconomyContent(), 'ai_burner');

    expect(normalize(state)).toEqual(before);
  });
});

describe('activateBurner — determinism', () => {
  it('calling it twice on equal states yields equal activeBurner.definitionId', () => {
    const content = makeEconomyContent();

    const r1 = activateBurner(makeEconomyState(), content, 'ai_burner');
    const r2 = activateBurner(makeEconomyState(), content, 'ai_burner');

    // definitionId and fuelRemaining are deterministic (startedAt may vary
    // if T040 uses Date.now — we only assert the deterministic fields here).
    expect(r1.activeBurner!.definitionId).toEqual(r2.activeBurner!.definitionId);
    expect(r1.activeBurner!.fuelRemaining).toEqual(r2.activeBurner!.fuelRemaining);
    expect(r1.resources.aiTokens).toEqual(r2.resources.aiTokens);
  });
});
