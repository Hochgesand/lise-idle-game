// T032 — RED tests for the game-loop wiring (tick / catch-up-on-load).
//
// The pure-sim core `advance(state, dt, content)` is the ONLY time-based
// mutator (Constitution Principle I). The game loop's job is to:
//   - compute `dt` from a wall-clock source (Date.now() at the orchestration
//     boundary — never fed to the sim),
//   - delegate to `advance`,
//   - re-anchor `lastAdvancedAt` to "now" after an offline catch-up so the
//     next tick starts from the present.
//
// To stay unit-testable without Phaser, the math is extracted into pure
// functions that take `nowMs` as a parameter (no `Date.now()` inside them),
// and a thin orchestrator class sits on top.

import { describe, it, expect } from 'vitest';
import { catchUpOnLoad, tick, GameLoop } from './gameLoop';
import { createInitialState } from '../save/localStorage';
import { bn, compare } from '../sim/bigNumber';
import type { ContentCatalog, GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures (mirror advance.test.ts: one producer, baseRate 1 LOC/sec)
// ---------------------------------------------------------------------------

/** A minimal valid GameState with one owned producer (manual_typing). */
function makeFixtureState(lastAdvancedAt: string, loc = '0'): GameState {
  return {
    resources: { loc, cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
  };
}

/** Single producer @ 1 LOC/sec. */
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

// ---------------------------------------------------------------------------
// catchUpOnLoad
// ---------------------------------------------------------------------------

describe('catchUpOnLoad', () => {
  it('credits offline progress since lastAdvancedAt and re-anchors to now', () => {
    const nowMs = Date.parse('2026-06-30T12:02:00.000Z'); // 2 min after the anchor
    const state = makeFixtureState('2026-06-30T12:00:00.000Z'); // anchor 120s before now
    const content = makeFixtureContent();

    const result = catchUpOnLoad(state, nowMs, content);

    // 120s @ 1 LOC/s => +120 LOC.
    expect(result.resources.loc).toBe('120');
    // lastAdvancedAt re-anchored to now.
    expect(result.lastAdvancedAt).toBe('2026-06-30T12:02:00.000Z');
  });

  it('does NOT cap a large offline dt (fresh epoch-anchored state)', () => {
    // A FRESH state has lastAdvancedAt = epoch (1970) — enormous dt. The
    // Constitution says offline progress must not be silently capped; advance
    // is O(features) and handles large dt (proven by T025). It must not throw.
    const nowMs = Date.parse('2026-06-30T12:00:00.000Z');
    const fresh = createInitialState(); // lastAdvancedAt = epoch
    // Give the fresh state the manual_typing producer so it produces.
    const state: GameState = { ...fresh, ownedProducers: new Set(['manual_typing']) };
    const content = makeFixtureContent();

    const result = catchUpOnLoad(state, nowMs, content);

    // LOC increased (a huge amount) and no crash.
    expect(compare(bn(result.resources.loc), bn('0'))).toBeGreaterThan(0);
    expect(result.lastAdvancedAt).toBe('2026-06-30T12:00:00.000Z');
  });

  it('clamps negative dt (clock skew: now before lastAdvancedAt) to 0', () => {
    // Clock skew: the recorded anchor is AHEAD of "now". dt would be negative.
    // Clamp to 0 => no LOC loss, no backwards time, lastAdvancedAt re-anchored to now.
    const nowMs = Date.parse('2026-06-30T12:00:00.000Z');
    const state = makeFixtureState('2026-06-30T12:02:00.000Z', '50'); // anchor 2min AHEAD
    const content = makeFixtureContent();

    const result = catchUpOnLoad(state, nowMs, content);

    // LOC unchanged (no production credited, no loss).
    expect(result.resources.loc).toBe('50');
    // Re-anchored to now (not the future anchor).
    expect(result.lastAdvancedAt).toBe('2026-06-30T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------

describe('tick', () => {
  it('advances by exactly nowMs - prevTickMs', () => {
    const prevTickMs = Date.parse('2026-06-30T12:00:00.000Z');
    const nowMs = prevTickMs + 5000; // 5s later
    const state = makeFixtureState('2026-06-30T12:00:00.000Z');
    const content = makeFixtureContent();

    const result = tick(state, prevTickMs, nowMs, content);

    // 5s @ 1 LOC/s => +5 LOC. lastAdvancedAt advances by advance() (+= 5000ms).
    expect(result.resources.loc).toBe('5');
    expect(result.lastAdvancedAt).toBe('2026-06-30T12:00:05.000Z');
  });

  it('is pure w.r.t. the input state (returns a new object, input unchanged)', () => {
    const prevTickMs = 1_000_000;
    const nowMs = prevTickMs + 1000;
    const state = makeFixtureState('2026-06-30T12:00:00.000Z');
    const content = makeFixtureContent();
    const beforeLoc = state.resources.loc;
    const beforeAnchor = state.lastAdvancedAt;

    const result = tick(state, prevTickMs, nowMs, content);

    expect(result).not.toBe(state);
    // Input untouched.
    expect(state.resources.loc).toBe(beforeLoc);
    expect(state.lastAdvancedAt).toBe(beforeAnchor);
  });

  it('clamps a backwards dt (nowMs < prevTickMs) to 0', () => {
    const prevTickMs = Date.parse('2026-06-30T12:00:05.000Z');
    const nowMs = Date.parse('2026-06-30T12:00:00.000Z'); // BEFORE prev
    const state = makeFixtureState('2026-06-30T12:00:00.000Z', '7');
    const content = makeFixtureContent();

    const result = tick(state, prevTickMs, nowMs, content);

    // No production, no loss.
    expect(result.resources.loc).toBe('7');
  });
});

// ---------------------------------------------------------------------------
// GameLoop orchestrator (no Phaser import — injectable nowMs via update(timeMs))
// ---------------------------------------------------------------------------

describe('GameLoop', () => {
  it('load(null) returns a fresh createInitialState re-anchored to now', () => {
    let current: GameState | null = null;
    const content = makeFixtureContent();
    const loop = new GameLoop({
      getContent: () => content,
      getState: () => current!,
      setState: (s) => {
        current = s;
      },
    });

    const result = loop.load(null, Date.parse('2026-06-30T12:00:00.000Z'));

    // Fresh state: empty ownership, zero resources, re-anchored to now.
    expect(result.ownedProducers.size).toBe(0);
    expect(result.resources.loc).toBe('0');
    expect(result.lastAdvancedAt).toBe('2026-06-30T12:00:00.000Z');
  });

  it('load(savedState) catch-ups the saved state and re-anchors', () => {
    let current: GameState | null = null;
    const content = makeFixtureContent();
    const loop = new GameLoop({
      getContent: () => content,
      getState: () => current!,
      setState: (s) => {
        current = s;
      },
    });

    const saved = makeFixtureState('2026-06-30T11:00:00.000Z'); // 1h before now
    const result = loop.load(saved, Date.parse('2026-06-30T12:00:00.000Z'));

    // 1h @ 1 LOC/s => +3600 LOC.
    expect(result.resources.loc).toBe('3600');
    expect(result.lastAdvancedAt).toBe('2026-06-30T12:00:00.000Z');
  });

  it('update(timeMs) ticks the state forward across two frames', () => {
    let current: GameState | null = null;
    const content = makeFixtureContent();
    const loop = new GameLoop({
      getContent: () => content,
      getState: () => current!,
      setState: (s) => {
        current = s;
      },
    });

    // Bootstrap: load a zero-LOC state anchored at 12:00:00.
    loop.load(makeFixtureState('2026-06-30T12:00:00.000Z'), Date.parse('2026-06-30T12:00:00.000Z'));

    // Two ticks: +2s then +3s => total +5s @ 1 LOC/s = 5 LOC.
    loop.update(Date.parse('2026-06-30T12:00:02.000Z'));
    loop.update(Date.parse('2026-06-30T12:00:05.000Z'));

    expect(current!.resources.loc).toBe('5');
  });
});
