// T041 — Unit tests for the pure economy view helper (economy.ts).
//
// The EconomyScene (Phaser overlay) is integration-level; the testable core is
// `getEconomyView`, `canAfford`, and `isUnlocked` — pure derivations of the
// UI state from (state, content). This follows the testability split used by
// HudScene (format.ts tested, scene integration-level).

import { describe, it, expect } from 'vitest';
import { canAfford, isUnlocked, getEconomyView } from './economy';
import type { GameState, ContentCatalog, Cost, Requirement } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_ANCHOR = '2026-06-30T12:00:00.000Z';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    resources: { loc: '100', cash: '50', aiTokens: '10', ...overrides.resources },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: FIXED_ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    // (002) co-op overlay defaults (placed before the override spread so a
    // test may still override them via `overrides`).
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
    activeTraining: null,
    ...overrides,
  };
}

function makeContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    producers: [],
    upgrades: [
      {
        id: 'upgrade_cheap',
        name: 'Cheap Upgrade',
        cost: { resource: 'cash', amount: '20' },
        effect: { type: 'globalMultiplier', multiplier: 2 },
        prerequisite: null,
      },
      {
        id: 'upgrade_expensive',
        name: 'Expensive Upgrade',
        cost: { resource: 'cash', amount: '9999' },
        effect: { type: 'globalMultiplier', multiplier: 5 },
        prerequisite: null,
      },
      {
        id: 'upgrade_locked',
        name: 'Locked Upgrade',
        cost: { resource: 'loc', amount: '10' },
        effect: { type: 'globalMultiplier', multiplier: 3 },
        prerequisite: { type: 'ownsUpgrade', targetId: 'upgrade_cheap', threshold: null },
      },
    ],
    trainings: [],
    milestones: [],
    burners: [
      {
        id: 'ai_burner',
        name: 'AI Token Burner',
        fuelCostToActivate: '5',
        burnRate: '1',
        productionMultiplier: 3,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// canAfford
// ---------------------------------------------------------------------------

describe('canAfford', () => {
  it('returns true when the player has enough of the cost resource', () => {
    const state = makeState();
    const cost: Cost = { resource: 'cash', amount: '20' };
    expect(canAfford(state, cost)).toBe(true);
  });

  it('returns true for exact match (boundary)', () => {
    const state = makeState(); // cash = 50
    const cost: Cost = { resource: 'cash', amount: '50' };
    expect(canAfford(state, cost)).toBe(true);
  });

  it('returns false when the player does not have enough', () => {
    const state = makeState();
    const cost: Cost = { resource: 'cash', amount: '9999' };
    expect(canAfford(state, cost)).toBe(false);
  });

  it('works for loc resource', () => {
    const state = makeState(); // loc = 100
    expect(canAfford(state, { resource: 'loc', amount: '100' })).toBe(true);
    expect(canAfford(state, { resource: 'loc', amount: '101' })).toBe(false);
  });

  it('works for aiTokens resource', () => {
    const state = makeState(); // aiTokens = 10
    expect(canAfford(state, { resource: 'aiTokens', amount: '10' })).toBe(true);
    expect(canAfford(state, { resource: 'aiTokens', amount: '11' })).toBe(false);
  });

  it('handles very large big-number amounts', () => {
    // Use astronomically large values that break_eternity can distinguish
    // (integers near MAX_SAFE_INTEGER have precision limits in the library).
    const state = makeState({
      resources: { loc: '1e30', cash: '0', aiTokens: '0' },
    });
    expect(canAfford(state, { resource: 'loc', amount: '1e30' })).toBe(true);
    expect(canAfford(state, { resource: 'loc', amount: '1e31' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isUnlocked
// ---------------------------------------------------------------------------

describe('isUnlocked', () => {
  it('returns true when requirement is null', () => {
    const state = makeState();
    expect(isUnlocked(state, null)).toBe(true);
  });

  it('ownsProducer — true when the player owns the producer', () => {
    const state = makeState(); // owns manual_typing
    const req: Requirement = { type: 'ownsProducer', targetId: 'manual_typing', threshold: null };
    expect(isUnlocked(state, req)).toBe(true);
  });

  it('ownsProducer — false when not owned', () => {
    const state = makeState();
    const req: Requirement = { type: 'ownsProducer', targetId: 'copilot', threshold: null };
    expect(isUnlocked(state, req)).toBe(false);
  });

  it('ownsUpgrade — true when the upgrade is owned', () => {
    const state = makeState({ ownedUpgrades: new Set(['upgrade_cheap']) });
    const req: Requirement = { type: 'ownsUpgrade', targetId: 'upgrade_cheap', threshold: null };
    expect(isUnlocked(state, req)).toBe(true);
  });

  it('resourceGte — true when resource meets threshold', () => {
    const state = makeState(); // loc = 100
    const req: Requirement = { type: 'resourceGte', targetId: 'loc', threshold: '100' };
    expect(isUnlocked(state, req)).toBe(true);
  });

  it('resourceGte — false when below threshold', () => {
    const state = makeState(); // loc = 100
    const req: Requirement = { type: 'resourceGte', targetId: 'loc', threshold: '101' };
    expect(isUnlocked(state, req)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEconomyView
// ---------------------------------------------------------------------------

describe('getEconomyView', () => {
  it('derives upgrade affordability, ownership, and locked state', () => {
    const state = makeState(); // cash=50, loc=100
    const content = makeContent();

    const view = getEconomyView(state, content);

    // Cheap upgrade: affordable (cash 50 >= 20), not owned, unlocked (null prereq)
    const cheap = view.upgrades.find((u) => u.id === 'upgrade_cheap')!;
    expect(cheap.affordable).toBe(true);
    expect(cheap.owned).toBe(false);
    expect(cheap.unlocked).toBe(true);

    // Expensive: not affordable, not owned, unlocked
    const expensive = view.upgrades.find((u) => u.id === 'upgrade_expensive')!;
    expect(expensive.affordable).toBe(false);
    expect(expensive.owned).toBe(false);
    expect(expensive.unlocked).toBe(true);

    // Locked: prerequisite not met (doesn't own upgrade_cheap)
    const locked = view.upgrades.find((u) => u.id === 'upgrade_locked')!;
    expect(locked.unlocked).toBe(false);
    expect(locked.affordable).toBe(false); // locked => not affordable for purchase
  });

  it('marks a locked upgrade as unlocked once its prerequisite is met', () => {
    const state = makeState({ ownedUpgrades: new Set(['upgrade_cheap']) });
    const content = makeContent();

    const view = getEconomyView(state, content);
    const locked = view.upgrades.find((u) => u.id === 'upgrade_locked')!;
    expect(locked.unlocked).toBe(true);
    // It costs 10 loc, player has 100 loc
    expect(locked.affordable).toBe(true);
  });

  it('marks an owned upgrade as owned (not purchasable)', () => {
    const state = makeState({ ownedUpgrades: new Set(['upgrade_cheap']) });
    const content = makeContent();

    const view = getEconomyView(state, content);
    const cheap = view.upgrades.find((u) => u.id === 'upgrade_cheap')!;
    expect(cheap.owned).toBe(true);
  });

  it('derives burner: activatable when aiTokens >= fuelCost', () => {
    const state = makeState(); // aiTokens = 10
    const content = makeContent(); // burner costs 5

    const view = getEconomyView(state, content);
    expect(view.burner).toBeDefined();
    expect(view.burner!.activatable).toBe(true);
    expect(view.burner!.active).toBe(false);
    expect(view.burner!.fuelRemaining).toBeNull(); // not active
  });

  it('derives burner: not activatable when insufficient aiTokens', () => {
    const state = makeState({ resources: { loc: '0', cash: '0', aiTokens: '2' } });
    const content = makeContent(); // burner costs 5

    const view = getEconomyView(state, content);
    expect(view.burner!.activatable).toBe(false);
  });

  it('derives burner: active with fuelRemaining when activeBurner is set', () => {
    const state = makeState({
      activeBurner: { definitionId: 'ai_burner', startedAt: FIXED_ANCHOR, fuelRemaining: '42' },
    });
    const content = makeContent();

    const view = getEconomyView(state, content);
    expect(view.burner!.active).toBe(true);
    expect(view.burner!.fuelRemaining).toBe('42');
  });

  it('returns undefined burner when content has no burner defs', () => {
    const state = makeState();
    const content = makeContent();
    content.burners = [];

    const view = getEconomyView(state, content);
    expect(view.burner).toBeUndefined();
  });
});
