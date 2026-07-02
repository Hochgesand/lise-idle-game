// T063 RED — heartbeat payload derivation (contracts §3 `/app/presence.heartbeat`).
//
// `deriveHeartbeat(state)` is the pure, Phaser-free derivation of the heartbeat
// body `{ office, activity, commute }` from save state:
//  - while a commute is in progress: `office: null`, `activity: "commuting"`,
//    `commute: { fromOffice, toOffice }` — WITHOUT `startedAt` (the server
//    stamps it; presence timestamps never mix clock domains).
//  - otherwise `office` mirrors `activeOffice`, `commute` is null, and
//    `activity` is `"burning tokens"` while a burner is active, else `"coding"`.
// `activity` is a client-derived display label — never stored in the save.
//
// `heartbeatIntervalMs(content)` yields the cadence for the main.ts interval:
// `content.coop.heartbeatSeconds * 1000`, falling back to the bundled default
// (20 s, mirroring fallbackContent.ts) when the catalog carries no coop block.

import { describe, it, expect } from 'vitest';
import type { GameState, ContentCatalog } from '../sim/types';
import { deriveHeartbeat, heartbeatIntervalMs } from './heartbeat';

/** A baseline (002-shaped) state — office_1, no commute, no burner. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    resources: { loc: '100', cash: '50', aiTokens: '10' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: '2026-07-02T09:00:00.000Z',
    schemaVersion: 2,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
    ...overrides,
  };
}

/** A minimal catalog with only the fields the helpers read. */
function makeContent(coop?: ContentCatalog['coop']): ContentCatalog {
  return {
    contentVersion: 'test',
    producers: [],
    upgrades: [],
    trainings: [],
    milestones: [],
    burners: [],
    coop,
  } as unknown as ContentCatalog;
}

describe('deriveHeartbeat', () => {
  it('derives the idle-coding payload: active office, "coding", no commute', () => {
    expect(deriveHeartbeat(makeState())).toEqual({
      office: 'office_1',
      activity: 'coding',
      commute: null,
    });
  });

  it('mirrors a non-default activeOffice', () => {
    const payload = deriveHeartbeat(makeState({ activeOffice: 'office_3' }));
    expect(payload.office).toBe('office_3');
  });

  it('labels an active burner "burning tokens" (office unchanged)', () => {
    const state = makeState({
      activeBurner: {
        burnerId: 'burner_1',
        activatedAt: '2026-07-02T08:59:00.000Z',
        fuelRemaining: '500',
      },
    });
    expect(deriveHeartbeat(state)).toEqual({
      office: 'office_1',
      activity: 'burning tokens',
      commute: null,
    });
  });

  it('reports a commute: office null, "commuting", commute without startedAt', () => {
    const state = makeState({
      commute: { fromOffice: 'office_1', toOffice: 'office_2', startedAt: 1_751_446_800_000 },
    });
    const payload = deriveHeartbeat(state);
    expect(payload).toEqual({
      office: null,
      activity: 'commuting',
      commute: { fromOffice: 'office_1', toOffice: 'office_2' },
    });
    // The server stamps commute.startedAt — the client must NOT send it
    // (contracts §3: no client timestamps on the heartbeat).
    expect(payload.commute).not.toHaveProperty('startedAt');
  });

  it('commuting wins over an active burner (the dev is in transit, not producing labels)', () => {
    const state = makeState({
      activeBurner: {
        burnerId: 'burner_1',
        activatedAt: '2026-07-02T08:59:00.000Z',
        fuelRemaining: '500',
      },
      commute: { fromOffice: 'office_2', toOffice: 'office_1', startedAt: 1_751_446_800_000 },
    });
    const payload = deriveHeartbeat(state);
    expect(payload.activity).toBe('commuting');
    expect(payload.office).toBeNull();
  });

  it('does not mutate the input state (pure)', () => {
    const state = makeState({
      commute: { fromOffice: 'office_1', toOffice: 'office_2', startedAt: 42 },
    });
    const before = JSON.parse(JSON.stringify({ ...state, ownedProducers: [...state.ownedProducers] }));
    deriveHeartbeat(state);
    const after = JSON.parse(JSON.stringify({ ...state, ownedProducers: [...state.ownedProducers] }));
    expect(after).toEqual(before);
  });

  it('emits exactly the contract keys { office, activity, commute }', () => {
    expect(Object.keys(deriveHeartbeat(makeState())).sort()).toEqual([
      'activity',
      'commute',
      'office',
    ]);
  });
});

describe('heartbeatIntervalMs', () => {
  it('reads content.coop.heartbeatSeconds (seconds → ms)', () => {
    const content = makeContent({
      perColleagueMultiplier: 0.1,
      maxMultiplier: 1.5,
      leaseSeconds: 60,
      heartbeatSeconds: 25,
      commuteSeconds: 30,
      lastSeenRetentionDays: 14,
    });
    expect(heartbeatIntervalMs(content)).toBe(25_000);
  });

  it('falls back to the bundled 20 s default when the catalog has no coop block', () => {
    expect(heartbeatIntervalMs(makeContent(undefined))).toBe(20_000);
  });
});
