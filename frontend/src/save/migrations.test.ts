// T010 — RED tests for the v1 → v2 save migration (Phase 2: Foundational).
//
// Reference: data-model.md "Save migration"; tasks.md T010/T022.
//
// `schemaVersion` bumps 1 → 2 for the 002 co-op overlay. The migration is
// ADDITIVE: it introduces `coopSegments: []`, `activeOffice: "office_1"`, and
// `commute: null` (the Spec 001 baseline) and changes nothing else. Every
// existing v1 save MUST stay loadable: structural validation in `toGameState`
// (localStorage.ts) treats the missing fields leniently — defaulting them
// BEFORE the migration chain runs — so `migrate()` always receives a complete
// GameState and a genuine v1 save blob (which never carried these fields)
// round-trips into a valid v2 state. A migration MUST be total: produce a
// valid new-version state or fail safely, never partially mutate
// (Constitution IV — never wipe progress).
//
// These tests target `migrate()` directly (pure, no I/O) plus one end-to-end
// assertion through `deserializeState` that proves the lenient-defaults +
// migration path loads a real v1 save blob. They are RED until T022 bumps
// CURRENT_SCHEMA_VERSION to 2 and registers `migrations[1]`.

import { describe, it, expect } from 'vitest';
import { migrate, CURRENT_SCHEMA_VERSION } from './migrations';
import { deserializeState } from './localStorage';
import type { GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANCHOR = '2026-06-30T12:00:00.000Z';

/**
 * A fully-populated Spec 001 state at schemaVersion 1, WITH the lenient co-op
 * overlay defaults already applied — the exact shape `toGameState` produces for
 * a v1 save before the migration chain runs (lenient defaults first). Exercises
 * big-number resources, non-empty ownership Sets, an active BurnerState, earned
 * milestones, and non-default settings so "changes nothing else" is provable.
 */
function v1StatePopulated(): GameState {
  return {
    resources: { loc: '9007199254740993', cash: '42', aiTokens: '100' },
    ownedProducers: new Set<string>(['manual_typing', 'copilot']),
    ownedUpgrades: new Set<string>(['u1', 'u2']),
    ownedTrainings: new Set<string>(['t1']),
    activeBurner: {
      definitionId: 'burner1',
      startedAt: '2026-06-30T11:30:00.000Z',
      fuelRemaining: '250',
    },
    earnedMilestones: new Set<string>(['iso9001', 'm1']),
    lastAdvancedAt: ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: true, muted: true },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

/**
 * A MINIMAL Spec 001 state at schemaVersion 1 (empty ownership, no burner, no
 * milestones) with lenient overlay defaults — proves even a bare v1 save
 * migrates.
 */
function v1StateMinimal(): GameState {
  return {
    resources: { loc: '0', cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

/**
 * A RAW v1 save as parsed straight from a pre-002 save blob: NONE of the co-op
 * overlay fields exist (they were introduced in v2). This is the realistic
 * on-disk shape of every existing player's save. We deliberately OMIT the
 * overlay fields (via the double cast) to prove the migration itself defaults
 * them — so `migrate()` is robust even if it is handed a state before lenient
 * `toGameState` normalization has run.
 */
function v1StateRawNoOverlay(): GameState {
  return {
    resources: { loc: '10', cash: '5', aiTokens: '0' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    // co-op overlay fields intentionally ABSENT — models a real v1 save blob.
  } as unknown as GameState;
}

/** Deterministic JSON of a GameState (Sets → sorted arrays) for value compare. */
function normalize(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Set) {
      return Array.from(value).sort();
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// v1 → v2 migration
// ---------------------------------------------------------------------------

describe('v1 → v2 save migration', () => {
  it('bumps schemaVersion 1 → 2 and defaults coopSegments=[], activeOffice="office_1", commute=null', () => {
    const result = migrate(v1StatePopulated());

    expect(result.schemaVersion).toBe(2);
    expect(result.coopSegments).toEqual([]);
    expect(result.activeOffice).toBe('office_1');
    expect(result.commute).toBeNull();
  });

  it('changes nothing else — every Spec 001 field is preserved byte-for-byte', () => {
    const input = v1StatePopulated();
    const result = migrate(input);

    expect(result.schemaVersion).toBe(2); // migrated
    // Spec 001 fields untouched by the additive migration
    expect(result.resources).toEqual(input.resources);
    expect(result.ownedProducers).toEqual(input.ownedProducers);
    expect(result.ownedUpgrades).toEqual(input.ownedUpgrades);
    expect(result.ownedTrainings).toEqual(input.ownedTrainings);
    expect(result.activeBurner).toEqual(input.activeBurner);
    expect(result.earnedMilestones).toEqual(input.earnedMilestones);
    expect(result.lastAdvancedAt).toBe(input.lastAdvancedAt);
    expect(result.settings).toEqual(input.settings);
  });

  it('is total — a raw v1 save (no overlay fields) migrates into a COMPLETE valid v2 state, never partial', () => {
    // A raw v1 save lacks the overlay fields entirely; the migration must
    // introduce them so the result is a complete v2 state (no undefined gaps).
    const result = migrate(v1StateRawNoOverlay());

    expect(result.schemaVersion).toBe(2);
    expect(Array.isArray(result.coopSegments)).toBe(true);
    expect(result.coopSegments).toEqual([]);
    expect(typeof result.activeOffice).toBe('string');
    expect(result.activeOffice).toBe('office_1');
    expect(result.commute).toBeNull();
    // Spec 001 fields are all still present and intact
    expect(result.resources).toEqual({ loc: '10', cash: '5', aiTokens: '0' });
    expect(result.ownedProducers).toEqual(new Set(['manual_typing']));
    expect(result.lastAdvancedAt).toBe(ANCHOR);
  });

  it('does not mutate the input (purity / never partially mutates the caller state)', () => {
    const input = v1StatePopulated();
    const snapshot = structuredClone(input);

    const result = migrate(input);

    // The caller's state is untouched (migrate deep-copies at the boundary).
    expect(input).toEqual(snapshot);
    expect(input.schemaVersion).toBe(1);
    // And the result is a distinct object, not the input reference.
    expect(result).not.toBe(input);
  });

  it('every v1 save stays loadable — minimal, populated, and overlay-less shapes all reach v2', () => {
    const inputs = [v1StateMinimal(), v1StatePopulated(), v1StateRawNoOverlay()];

    for (const input of inputs) {
      const result = migrate(input);

      // Each shape — regardless of overlay-field presence — migrates to a valid
      // v2 state with the baseline overlay defaults. This is the lenient
      // contract: a v1 save never carried these fields and still loads.
      expect(result.schemaVersion).toBe(2);
      expect(result.coopSegments).toEqual([]);
      expect(result.activeOffice).toBe('office_1');
      expect(result.commute).toBeNull();
      // Non-overlay fields carry through unchanged.
      expect(result.lastAdvancedAt).toBe(input.lastAdvancedAt);
      expect(result.settings).toEqual(input.settings);
    }
  });

  it('is a no-op for a state already at CURRENT_SCHEMA_VERSION (idempotent, never over-migrates)', () => {
    const current: GameState = {
      ...v1StatePopulated(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    const result = migrate(current);

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(normalize(result)).toEqual(normalize(current));
  });

  it('a raw v1 save blob loads through deserializeState as a valid v2 state (lenient defaults before the chain)', () => {
    // A genuine on-disk v1 save: schemaVersion 1, NO co-op overlay fields.
    // `toGameState` must apply lenient defaults BEFORE the migration chain runs
    // so this parses into a structurally valid GameState that `migrate()` walks
    // to v2 — proving every existing v1 save stays loadable end-to-end.
    const v1Blob = JSON.stringify({
      schemaVersion: 1,
      resources: { loc: '9007199254740993', cash: '42', aiTokens: '100' },
      ownedProducers: ['manual_typing', 'copilot'],
      ownedUpgrades: ['u1'],
      ownedTrainings: ['t1'],
      activeBurner: {
        definitionId: 'burner1',
        startedAt: '2026-06-30T11:30:00.000Z',
        fuelRemaining: '250',
      },
      earnedMilestones: ['iso9001'],
      lastAdvancedAt: ANCHOR,
      settings: { reducedMotion: true, muted: true },
    });

    const loaded = deserializeState(v1Blob);

    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.coopSegments).toEqual([]);
    expect(loaded.activeOffice).toBe('office_1');
    expect(loaded.commute).toBeNull();
    // Spec 001 fields survive the parse → lenient-default → migrate path.
    expect(loaded.resources).toEqual({ loc: '9007199254740993', cash: '42', aiTokens: '100' });
    expect(loaded.ownedProducers).toEqual(new Set(['manual_typing', 'copilot']));
    expect(loaded.ownedUpgrades).toEqual(new Set(['u1']));
    expect(loaded.ownedTrainings).toEqual(new Set(['t1']));
    expect(loaded.earnedMilestones).toEqual(new Set(['iso9001']));
    expect(loaded.activeBurner).toEqual({
      definitionId: 'burner1',
      startedAt: '2026-06-30T11:30:00.000Z',
      fuelRemaining: '250',
    });
    expect(loaded.lastAdvancedAt).toBe(ANCHOR);
    expect(loaded.settings).toEqual({ reducedMotion: true, muted: true });
  });
});
