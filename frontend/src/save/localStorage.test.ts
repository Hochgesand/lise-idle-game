// T027 — Integration test for localStorage save → reload round-trip.
//
// Proves quickstart.md Scenario 1/4: `saveGame(state)` then `loadGame()` returns
// an IDENTICAL GameState — no progress lost across reload (Constitution IV).
// This goes through the REAL `saveGame`/`loadGame`/`clearGame` (which reference
// the bare `localStorage` global), exercising the Set→sorted-array→Set
// conversion, the activeBurner null/object handling, big-number string
// fidelity, and the migration/validation path end-to-end.
//
// The save module `localStorage.ts` already exists (T017) and is fully
// implemented, so this suite serves as the integration regression guard and is
// expected GREEN from the start.
//
// ## Environment note (test fixture)
// This project's jsdom/vitest setup does NOT expose a `localStorage` global
// (jsdom without an origin URL provides none, and Node's experimental
// `--localstorage-file` flag is not set). The production code under test
// references the bare `localStorage` global — which a real browser always
// provides. To exercise the real saveGame/loadGame/clearGame code paths here we
// install a minimal, spec-shaped `localStorage` shim onto `globalThis` (a fresh
// Map per test for isolation). This is a standard test fixture: the ONLY fake
// part is the storage backend; every serialization/Set/validation/migration
// code path it drives is the real production code.

import { describe, it, expect, beforeEach } from 'vitest';
import { saveGame, loadGame, clearGame, createInitialState } from './localStorage';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import type { GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// localStorage shim (test fixture)
// ---------------------------------------------------------------------------

/**
 * Minimal Storage shim: getItem/setItem/removeItem/clear/key/length over a Map.
 * Matches the `localStorage` interface the production adapter calls.
 */
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
    key: (index: number): string | null => {
      const keys = Array.from(store.keys());
      return index >= 0 && index < keys.length ? keys[index]! : null;
    },
    get length(): number {
      return store.size;
    },
  } satisfies Storage;
}

// A fresh, empty store per test → guaranteed isolation (no cross-test leakage).
beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = makeLocalStorage();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_ANCHOR = '2026-06-30T12:00:00.000Z';

/**
 * A fully-populated GameState exercising EVERY field: big-number resources
 * beyond MAX_SAFE_INTEGER, non-empty ownership Sets, an active BurnerState,
 * earned milestones, and non-default settings (muted: true).
 */
function makePopulatedState(): GameState {
  return {
    resources: {
      loc: '9007199254740993', // beyond MAX_SAFE_INTEGER
      cash: '42',
      aiTokens: '100',
    },
    ownedProducers: new Set<string>(['manual_typing', 'copilot']),
    ownedUpgrades: new Set<string>(['u1', 'u2']),
    ownedTrainings: new Set<string>(['t1']),
    activeBurner: {
      definitionId: 'burner1',
      startedAt: '2026-06-30T11:30:00.000Z',
      fuelRemaining: '250',
    },
    earnedMilestones: new Set<string>(['m1', 'iso9001']),
    lastAdvancedAt: FIXED_ANCHOR,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { reducedMotion: true, muted: true },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

/**
 * Deterministic normalization of a GameState to a stable JSON string so two
 * states can be compared by VALUE (Set order is not significant, and Set
 * reference equality is insufficient across a round-trip). Mirrors the helper
 * in advance.test.ts: Sets → sorted arrays → stable JSON string.
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
// loadGame / saveGame round-trip
// ---------------------------------------------------------------------------

describe('localStorage save → reload round-trip', () => {
  it('returns null when no save exists (fresh player)', () => {
    expect(loadGame()).toBeNull();
  });

  it('round-trips a fully-populated state to a VALUE-EQUAL state', () => {
    const original = makePopulatedState();

    saveGame(original);
    const restored = loadGame();

    expect(restored).not.toBeNull();
    // The core assertion: byte-for-byte equality after normalization (Sets
    // reconstructed, big-number strings, activeBurner, settings, schemaVersion,
    // lastAdvancedAt all match).
    expect(normalize(restored!)).toEqual(normalize(original));
  });

  it('multiple round-trips are stable (save → load → save → load has no drift)', () => {
    const original = makePopulatedState();

    saveGame(original);
    const first = loadGame();
    saveGame(first!);
    const second = loadGame();

    expect(normalize(first!)).toEqual(normalize(original));
    expect(normalize(second!)).toEqual(normalize(first!));
    expect(normalize(second!)).toEqual(normalize(original));
  });

  it('createInitialState round-trips cleanly', () => {
    const fresh = createInitialState();

    saveGame(fresh);
    const restored = loadGame();

    expect(restored).not.toBeNull();
    expect(normalize(restored!)).toEqual(normalize(fresh));
  });

  it('clearGame wipes the save so loadGame returns null', () => {
    saveGame(makePopulatedState());
    expect(loadGame()).not.toBeNull();

    clearGame();

    expect(loadGame()).toBeNull();
  });

  it('ownership sets survive unordered population (Set → sorted-array → Set)', () => {
    // Build a state whose Sets were populated in NON-sorted order. The serialize
    // step sorts arrays; the deserialize step rebuilds Sets. Order must not
    // matter for membership equality.
    const state: GameState = {
      resources: { loc: '10', cash: '5', aiTokens: '0' },
      ownedProducers: new Set<string>(['zebra', 'apple', 'mango']),
      ownedUpgrades: new Set<string>(['u3', 'u1', 'u2']),
      ownedTrainings: new Set<string>(['t2', 't1']),
      activeBurner: null,
      earnedMilestones: new Set<string>(['m3', 'm1', 'm2']),
      lastAdvancedAt: FIXED_ANCHOR,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: { reducedMotion: false, muted: false },
      coopSegments: [],
      activeOffice: 'office_1',
      commute: null,
    };

    saveGame(state);
    const restored = loadGame();

    expect(restored).not.toBeNull();
    // Same members regardless of insertion/iteration order.
    expect(restored!.ownedProducers).toEqual(new Set(['apple', 'mango', 'zebra']));
    expect(restored!.ownedUpgrades).toEqual(new Set(['u1', 'u2', 'u3']));
    expect(restored!.ownedTrainings).toEqual(new Set(['t1', 't2']));
    expect(restored!.earnedMilestones).toEqual(new Set(['m1', 'm2', 'm3']));
  });

  it('activeBurner === null round-trips as null (not undefined, not {})', () => {
    const state: GameState = {
      resources: { loc: '7', cash: '0', aiTokens: '0' },
      ownedProducers: new Set<string>(['manual_typing']),
      ownedUpgrades: new Set<string>(),
      ownedTrainings: new Set<string>(),
      activeBurner: null,
      earnedMilestones: new Set<string>(),
      lastAdvancedAt: FIXED_ANCHOR,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: { reducedMotion: false, muted: false },
      coopSegments: [],
      activeOffice: 'office_1',
      commute: null,
    };

    saveGame(state);
    const restored = loadGame();

    expect(restored).not.toBeNull();
    // Explicitly null, never undefined (key present) and never an empty object.
    expect(restored!.activeBurner).toBeNull();
    expect(restored!.activeBurner).not.toBeUndefined();
    expect(restored!.activeBurner).toEqual(null);
  });

  it('(002) co-op overlay fields round-trip losslessly, including non-default values', () => {
    // A v2 save carrying real server-issued segments, a non-default office, and
    // an in-progress commute MUST persist verbatim (data-model.md: "save
    // round-trips remain lossless with the new field included"). Dropping these
    // on save would silently lose the co-op bonus / commute.
    const state: GameState = {
      resources: { loc: '9007199254740993', cash: '42', aiTokens: '100' },
      ownedProducers: new Set<string>(['manual_typing', 'copilot']),
      ownedUpgrades: new Set<string>(['u1']),
      ownedTrainings: new Set<string>(['t1']),
      activeBurner: {
        definitionId: 'burner1',
        startedAt: '2026-06-30T11:30:00.000Z',
        fuelRemaining: '250',
      },
      earnedMilestones: new Set<string>(['iso9001']),
      lastAdvancedAt: FIXED_ANCHOR,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: { reducedMotion: true, muted: true },
      coopSegments: [
        { from: 1000, until: 2000, multiplier: 1.2 },
        { from: 3000, until: 4000, multiplier: 1.5 },
      ],
      activeOffice: 'office_2',
      commute: { fromOffice: 'office_1', toOffice: 'office_2', startedAt: 5000 },
    };

    saveGame(state);
    const restored = loadGame();

    expect(restored).not.toBeNull();
    expect(restored!.coopSegments).toEqual(state.coopSegments);
    expect(restored!.activeOffice).toBe('office_2');
    expect(restored!.commute).toEqual({
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: 5000,
    });
    // Already-current schemaVersion → no migration, full value equality holds.
    expect(normalize(restored!)).toEqual(normalize(state));
  });
});
