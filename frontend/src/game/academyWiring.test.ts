// T049 — Integration guard: computeRate reflects owned training permanentMultipliers.
//
// Responsibility #1: once a training is purchased (ownedTrainings gains the
// training id), `computeRate(state, content)` multiplies the base rate by the
// training's permanentMultiplier. This is the property the HUD rate display
// depends on — it must jump when a training is bought (quickstart.md Scenario 3).
//
// Responsibility #2: milestones evaluate each tick via advance's applyMilestones
// (T015/T016). That is covered by advance.test.ts (T045, 8 tests); here we
// guard the training-boost flow through computeRate.

import { describe, it, expect } from 'vitest';
import { computeRate } from '../sim/advance';
import type { GameState, ContentCatalog } from '../sim/types';

// Minimal content: one producer (1 LOC/sec) + one training (×2 permanent).
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
    trainings: [
      {
        id: 'iso_9001_course',
        name: 'ISO 9001 Course',
        description: '',
        cost: { resource: 'cash', amount: '100' },
        permanentMultiplier: 2,
        prerequisite: null,
      },
    ],
    milestones: [],
    burners: [],
  };
}

function makeState(ownedTrainings: Set<string>): GameState {
  return {
    resources: { loc: '0', cash: '1000', aiTokens: '0' },
    ownedProducers: new Set(['manual_typing']),
    ownedUpgrades: new Set(),
    ownedTrainings,
    activeBurner: null,
    earnedMilestones: new Set(),
    lastAdvancedAt: '2026-06-30T12:00:00.000Z',
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

describe('T049 — academy wiring', () => {
  it('computeRate with owned training > computeRate without training', () => {
    const content = makeContent();
    const withoutTraining = makeState(new Set());
    const withTraining = makeState(new Set(['iso_9001_course']));

    const baseRate = computeRate(withoutTraining, content);
    const boostedRate = computeRate(withTraining, content);

    // Base rate = 1 LOC/sec; with ×2 training = 2 LOC/sec.
    expect(boostedRate.toString()).toBe('2');
    expect(baseRate.toString()).toBe('1');
    expect(boostedRate.toString() > baseRate.toString()).toBe(true);
  });

  it('multiple trainings stack multiplicatively in computeRate', () => {
    const content: ContentCatalog = {
      ...makeContent(),
      trainings: [
        {
          id: 'iso_9001_course',
          name: 'ISO 9001 Course',
          description: '',
          cost: { resource: 'cash', amount: '100' },
          permanentMultiplier: 2,
          prerequisite: null,
        },
        {
          id: 'agile_master',
          name: 'Agile Master',
          description: '',
          cost: { resource: 'cash', amount: '500' },
          permanentMultiplier: 3,
          prerequisite: null,
        },
      ],
    };

    const withBoth = makeState(new Set(['iso_9001_course', 'agile_master']));
    const rate = computeRate(withBoth, content);

    // Base 1 × 2 × 3 = 6 LOC/sec.
    expect(rate.toString()).toBe('6');
  });
});
