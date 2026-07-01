// T042 — Integration guard: the economy wiring (main.ts) exports CASH_RATE and
// computeRate reflects the active burner multiplier live.
//
// Responsibility #1: once `state.activeBurner` is set (by activateBurner),
// `computeRate(state, content)` multiplies the base rate by the burner's
// productionMultiplier. This is the property the HUD rate display depends on —
// it must jump when a burner activates (quickstart.md Scenario 2).
//
// Responsibility #2: the wiring exports CASH_RATE (the LOC → Cash conversion
// rate T043 left for T042 to define).

import { describe, it, expect } from 'vitest';
import { CASH_RATE } from './economyConfig';
import { computeRate } from '../sim/advance';
import { bn } from '../sim/bigNumber';
import type { GameState, ContentCatalog } from '../sim/types';

// Minimal content: one producer (1 LOC/sec) + one burner (×3 multiplier).
function makeContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.1.0',
    producers: [
      {
        id: 'manual_typing',
        name: 'Manual Typing',
        description: '',
        baseRate: '1',
        cost: { resource: 'cash', amount: '0' },
        costGrowth: 1.15,
        unlockRequirement: null,
      },
    ],
    upgrades: [],
    trainings: [],
    milestones: [],
    burners: [
      {
        id: 'gpu_cluster',
        name: 'GPU Cluster',
        fuelCostToActivate: '100',
        burnRate: '10',
        productionMultiplier: 3,
      },
    ],
  };
}

function makeState(activeBurner: GameState['activeBurner']): GameState {
  return {
    resources: { loc: '0', cash: '0', aiTokens: '1000' },
    ownedProducers: new Set(['manual_typing']),
    ownedUpgrades: new Set(),
    ownedTrainings: new Set(),
    activeBurner,
    earnedMilestones: new Set(),
    lastAdvancedAt: '2026-06-30T12:00:00.000Z',
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
  };
}

describe('T042 — economy wiring', () => {
  it('exports a stable CASH_RATE constant', () => {
    expect(CASH_RATE).toBe(0.5);
  });

  it('computeRate with active burner > computeRate without burner', () => {
    const content = makeContent();
    const withoutBurner = makeState(null);
    const withBurner = makeState({
      definitionId: 'gpu_cluster',
      startedAt: '2026-06-30T12:00:00.000Z',
      fuelRemaining: '100',
    });

    const baseRate = computeRate(withoutBurner, content);
    const boostedRate = computeRate(withBurner, content);

    // Base rate = 1 LOC/sec; boosted = 1 × 3 = 3 LOC/sec.
    expect(bn(boostedRate).gt(baseRate)).toBe(true);
    expect(boostedRate.toString()).toBe('3');
  });
});
