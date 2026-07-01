// Tests for the bundled fallback content (fix review MAJOR #3).
//
// The fallback MUST contain `manual_typing` so the core loop produces LOC
// offline (Constitution IV). Without it, `computeRate` returns 0 and the game
// is unplayable without a backend.

import { describe, it, expect } from 'vitest';
import { FALLBACK_CONTENT } from './fallbackContent';
import { computeRate } from './advance';
import { grantStarterProducer } from './freshPlayer';
import { createInitialState } from '../save/localStorage';

describe('FALLBACK_CONTENT', () => {
  it('contains manual_typing (the free starter producer)', () => {
    const ids = FALLBACK_CONTENT.producers.map((p) => p.id);
    expect(ids).toContain('manual_typing');
  });

  it('has a valid schemaVersion and contentVersion', () => {
    expect(FALLBACK_CONTENT.schemaVersion).toBe(1);
    expect(FALLBACK_CONTENT.contentVersion).toBe('1.2.0');
  });

  it('produces a non-zero rate for a fresh player with manual_typing granted', () => {
    const state = grantStarterProducer(createInitialState());
    const rate = computeRate(state, FALLBACK_CONTENT);
    expect(rate.toString()).not.toBe('0');
  });

  it('manual_typing has baseRate "1" (LOC/sec)', () => {
    const manual = FALLBACK_CONTENT.producers.find((p) => p.id === 'manual_typing');
    expect(manual).toBeDefined();
    expect(manual!.baseRate).toBe('1');
  });

  it('mirrors the coop tuning block so offline boot integrates identically (002)', () => {
    // Same values as backend/.../content/coop.json (T021); loadContent validates
    // this shape on the served path, the fallback carries it for offline boots.
    expect(FALLBACK_CONTENT.coop).toEqual({
      perColleagueMultiplier: 0.1,
      maxMultiplier: 1.5,
      leaseSeconds: 60,
      heartbeatSeconds: 20,
      commuteSeconds: 30,
      lastSeenRetentionDays: 14,
    });
  });
});
