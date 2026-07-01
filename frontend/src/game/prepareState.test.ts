// Tests for `prepareInitialState` — the boot-state preparation logic.
//
// Regression guards for the BLOCKER (fresh player epoch credit) and the
// offline-capability requirement (returning player gets credit, fresh starts
// at ~0). These are pure-helper tests (no Phaser, no fetch mocking).

import { describe, it, expect } from 'vitest';
import { prepareInitialState } from './prepareState';
import { FALLBACK_CONTENT } from '../sim/fallbackContent';
import { createInitialState } from '../save/localStorage';
import { bn } from '../sim/bigNumber';
import type { GameState } from '../sim/types';

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0); // 2026-07-01T12:00:00Z

describe('prepareInitialState — fresh player (loaded === null)', () => {
  it('starts at LOC "0" (no phantom epoch credit)', () => {
    const state = prepareInitialState(null, FALLBACK_CONTENT, NOW);

    // The BLOCKER: before the fix, a fresh player got ~1.77e9 LOC.
    expect(state.resources.loc).toBe('0');
  });

  it('is granted manual_typing (so LOC grows on the first tick)', () => {
    const state = prepareInitialState(null, FALLBACK_CONTENT, NOW);

    expect(state.ownedProducers.has('manual_typing')).toBe(true);
  });

  it('re-anchors lastAdvancedAt to now (so catch-up dt = 0)', () => {
    const state = prepareInitialState(null, FALLBACK_CONTENT, NOW);

    expect(state.lastAdvancedAt).toBe(new Date(NOW).toISOString());
  });
});

describe('prepareInitialState — returning player (loaded !== null)', () => {
  it('credits offline progress at the real production rate', () => {
    // A returning player who owns manual_typing (1 LOC/s), last advanced 1
    // hour (3600s) ago. Offline credit should be ~3600 LOC.
    const oneHourAgo = NOW - 3600_000;
    const loaded: GameState = {
      ...createInitialState(),
      ownedProducers: new Set(['manual_typing']),
      lastAdvancedAt: new Date(oneHourAgo).toISOString(),
      resources: { loc: '100', cash: '0', aiTokens: '0' },
    };

    const state = prepareInitialState(loaded, FALLBACK_CONTENT, NOW);

    // 100 + 3600 = 3700 LOC (1 LOC/s × 3600s).
    expect(bn(state.resources.loc).toString()).toBe('3700');
  });

  it('does NOT credit a huge phantom amount (regression for the epoch bug)', () => {
    // Same setup as above — the LOC should be in the thousands, NOT billions.
    const oneHourAgo = NOW - 3600_000;
    const loaded: GameState = {
      ...createInitialState(),
      ownedProducers: new Set(['manual_typing']),
      lastAdvancedAt: new Date(oneHourAgo).toISOString(),
    };

    const state = prepareInitialState(loaded, FALLBACK_CONTENT, NOW);

    // Sanity: LOC is 3600, not ~1.77e9.
    const loc = Number(state.resources.loc);
    expect(loc).toBeLessThan(100_000);
    expect(loc).toBeGreaterThan(0);
  });

  it('re-anchors lastAdvancedAt to now after catch-up', () => {
    const oneHourAgo = NOW - 3600_000;
    const loaded: GameState = {
      ...createInitialState(),
      ownedProducers: new Set(['manual_typing']),
      lastAdvancedAt: new Date(oneHourAgo).toISOString(),
    };

    const state = prepareInitialState(loaded, FALLBACK_CONTENT, NOW);

    expect(state.lastAdvancedAt).toBe(new Date(NOW).toISOString());
  });
});

describe('prepareInitialState — offline with empty content (backend unreachable)', () => {
  it('fresh player still starts at 0 even with fallback content', () => {
    // The FALLBACK_CONTENT contains manual_typing, so even with no backend
    // the game produces LOC. But a FRESH player still starts at 0.
    const state = prepareInitialState(null, FALLBACK_CONTENT, NOW);

    expect(state.resources.loc).toBe('0');
    expect(state.ownedProducers.has('manual_typing')).toBe(true);
  });
});
