// T048 — Unit tests for the pure academy view derivation (getAcademyView).
//
// Tests the testable core: which trainings are affordable / locked-by-prereq /
// owned, and which milestones are earned vs unearned-but-requirement-met vs
// locked. The Phaser scene wiring (AcademyScene) is integration-level.

import { describe, it, expect } from 'vitest';
import { getAcademyView } from './academy';
import type { ContentCatalog, GameState } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_ANCHOR = '2026-06-30T12:00:00.000Z';

/** A state with a known amount of cash (for training affordability tests). */
function makeState(cash: string, ownedTrainings = new Set<string>()): GameState {
  return {
    resources: { loc: '1000', cash, aiTokens: '0' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings,
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: FIXED_ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
  };
}

/** Minimal academy content: 2 trainings + 2 milestones. */
function makeAcademyContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.2.0',
    producers: [],
    upgrades: [],
    trainings: [
      {
        id: 'iso_9001_course',
        name: 'ISO 9001 Course',
        description: 'Learn quality management basics.',
        cost: { resource: 'cash', amount: '500' },
        permanentMultiplier: 2,
        prerequisite: null, // always available
      },
      {
        id: 'agile_master',
        name: 'Agile Master',
        description: 'Master Scrum and Kanban.',
        cost: { resource: 'cash', amount: '200' },
        permanentMultiplier: 3,
        prerequisite: { type: 'ownsTraining', targetId: 'iso_9001_course', threshold: null },
      },
    ],
    milestones: [
      {
        id: 'iso_9001_certified',
        name: 'ISO 9001 Certified',
        requirement: { type: 'resourceGte', targetId: 'loc', threshold: '500' },
        reward: { type: 'grantResource', resource: 'cash', amount: '50' },
      },
      {
        id: 'gold_partner',
        name: 'Microsoft Gold Partner',
        requirement: { type: 'ownsTraining', targetId: 'agile_master', threshold: null },
        reward: { type: 'globalMultiplier', multiplier: 1.5 },
      },
    ],
    burners: [],
  };
}

// ---------------------------------------------------------------------------
// trainings
// ---------------------------------------------------------------------------

describe('getAcademyView — trainings', () => {
  it('marks a training as affordable when unlocked, not owned, and can pay', () => {
    const view = getAcademyView(makeState('1000'), makeAcademyContent());
    const t = view.trainings.find((x) => x.id === 'iso_9001_course')!;
    expect(t.affordable).toBe(true);
    expect(t.owned).toBe(false);
    expect(t.unlocked).toBe(true);
  });

  it('marks a training as NOT affordable when cannot pay the cost', () => {
    const view = getAcademyView(makeState('100'), makeAcademyContent());
    const t = view.trainings.find((x) => x.id === 'iso_9001_course')!;
    expect(t.affordable).toBe(false);
    expect(t.unlocked).toBe(true); // unlocked (no prereq) but too expensive
  });

  it('marks a training as locked when its prerequisite is not met', () => {
    const view = getAcademyView(makeState('10000'), makeAcademyContent());
    const t = view.trainings.find((x) => x.id === 'agile_master')!;
    // agile_master requires owning iso_9001_course, which is not owned
    expect(t.unlocked).toBe(false);
    expect(t.affordable).toBe(false);
  });

  it('marks a gated training as affordable once its prereq training is owned', () => {
    const ownedTrainings = new Set<string>(['iso_9001_course']);
    const view = getAcademyView(makeState('10000', ownedTrainings), makeAcademyContent());
    const t = view.trainings.find((x) => x.id === 'agile_master')!;
    expect(t.unlocked).toBe(true);
    expect(t.affordable).toBe(true);
  });

  it('marks an owned training as owned and NOT affordable', () => {
    const ownedTrainings = new Set<string>(['iso_9001_course']);
    const view = getAcademyView(makeState('10000', ownedTrainings), makeAcademyContent());
    const t = view.trainings.find((x) => x.id === 'iso_9001_course')!;
    expect(t.owned).toBe(true);
    expect(t.affordable).toBe(false);
  });

  it('exposes training metadata (name, description, cost, permanentMultiplier)', () => {
    const view = getAcademyView(makeState('0'), makeAcademyContent());
    const t = view.trainings.find((x) => x.id === 'iso_9001_course')!;
    expect(t.name).toBe('ISO 9001 Course');
    expect(t.description).toBe('Learn quality management basics.');
    expect(t.cost).toEqual({ resource: 'cash', amount: '500' });
    expect(t.permanentMultiplier).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// milestones
// ---------------------------------------------------------------------------

describe('getAcademyView — milestones', () => {
  it('marks a milestone as earned when it is in earnedMilestones', () => {
    const state = makeState('0');
    state.earnedMilestones.add('iso_9001_certified');
    const view = getAcademyView(state, makeAcademyContent());
    const m = view.milestones.find((x) => x.id === 'iso_9001_certified')!;
    expect(m.earned).toBe(true);
  });

  it('marks an unearned milestone whose requirement IS met (preview)', () => {
    // loc is 1000, threshold is 500 → requirement met but NOT earned
    const view = getAcademyView(makeState('0'), makeAcademyContent());
    const m = view.milestones.find((x) => x.id === 'iso_9001_certified')!;
    expect(m.earned).toBe(false);
    expect(m.requirementMet).toBe(true);
  });

  it('marks a milestone as locked (not earned, requirement NOT met)', () => {
    const state = makeState('0'); // no agile_master training owned
    const view = getAcademyView(state, makeAcademyContent());
    const m = view.milestones.find((x) => x.id === 'gold_partner')!;
    expect(m.earned).toBe(false);
    expect(m.requirementMet).toBe(false);
  });

  it('marks a ownsTraining-milestone as requirementMet when the training is owned', () => {
    const state = makeState('0');
    state.ownedTrainings.add('agile_master');
    const view = getAcademyView(state, makeAcademyContent());
    const m = view.milestones.find((x) => x.id === 'gold_partner')!;
    expect(m.earned).toBe(false);
    expect(m.requirementMet).toBe(true);
  });

  it('exposes milestone metadata (name)', () => {
    const view = getAcademyView(makeState('0'), makeAcademyContent());
    const m = view.milestones.find((x) => x.id === 'iso_9001_certified')!;
    expect(m.name).toBe('ISO 9001 Certified');
  });
});

// ---------------------------------------------------------------------------
// edge cases
// ---------------------------------------------------------------------------

describe('getAcademyView — edge cases', () => {
  it('returns empty arrays when content has no trainings/milestones', () => {
    const emptyContent: ContentCatalog = {
      schemaVersion: 1,
      contentVersion: '1.0.0',
      producers: [],
      upgrades: [],
      trainings: [],
      milestones: [],
      burners: [],
    };
    const view = getAcademyView(makeState('0'), emptyContent);
    expect(view.trainings).toEqual([]);
    expect(view.milestones).toEqual([]);
  });

  it('is pure: does not mutate the input state', () => {
    const state = makeState('500');
    const before = JSON.stringify(state, (_k, v) => (v instanceof Set ? [...v] : v));
    getAcademyView(state, makeAcademyContent());
    const after = JSON.stringify(state, (_k, v) => (v instanceof Set ? [...v] : v));
    expect(after).toEqual(before);
  });
});
