// T036 — Unit tests for the fresh-player starter-producer grant helper.
//
// TDD: written BEFORE the main.ts wiring. The helper itself (freshPlayer.ts)
// is pure and exists, so these serve as the regression guard proving:
//   - a fresh player gains manual_typing (so LOC grows from t=0),
//   - a returning player's ownership is untouched,
//   - purity (input never mutated, new object returned).

import { describe, it, expect } from 'vitest';
import { grantStarterProducer, STARTER_PRODUCER_ID } from './freshPlayer';
import { createInitialState } from '../save/localStorage';
import type { GameState } from './types';

/** Build a state with the given producer ids owned (all else fresh/zero). */
function makeStateWith(producers: string[]): GameState {
  const s = createInitialState();
  return { ...s, ownedProducers: new Set(producers) };
}

describe('grantStarterProducer', () => {
  it('grants manual_typing to a fresh player (empty ownedProducers)', () => {
    const fresh = createInitialState();
    const result = grantStarterProducer(fresh);

    expect(result.ownedProducers.has(STARTER_PRODUCER_ID)).toBe(true);
    expect(result.ownedProducers.size).toBe(1);
  });

  it('does NOT grant manual_typing to a returning player (non-empty)', () => {
    const returning = makeStateWith(['copilot']);
    const result = grantStarterProducer(returning);

    expect(result.ownedProducers.has(STARTER_PRODUCER_ID)).toBe(false);
    expect(result.ownedProducers.has('copilot')).toBe(true);
    expect(result.ownedProducers.size).toBe(1);
  });

  it('returns a NEW state object (purity — not the same reference)', () => {
    const fresh = createInitialState();
    const result = grantStarterProducer(fresh);

    expect(result).not.toBe(fresh);
  });

  it('does NOT mutate the input state (purity)', () => {
    const fresh = createInitialState();
    const sizeBefore = fresh.ownedProducers.size;

    grantStarterProducer(fresh);

    expect(fresh.ownedProducers.size).toBe(sizeBefore);
    expect(fresh.ownedProducers.has(STARTER_PRODUCER_ID)).toBe(false);
  });

  it('preserves all other fields unchanged', () => {
    const returning = makeStateWith(['stack_overflow']);
    const result = grantStarterProducer(returning);

    expect(result.resources).toEqual(returning.resources);
    expect(result.lastAdvancedAt).toBe(returning.lastAdvancedAt);
    expect(result.schemaVersion).toBe(returning.schemaVersion);
    expect(result.settings).toEqual(returning.settings);
  });
});
