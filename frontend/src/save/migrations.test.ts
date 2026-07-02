// T010 — tests for the v1 → v2 save migration (Phase 2 of 002: Foundational).
// T003 — RED tests for the v2 → v3 save migration (Phase 2 of 003: Foundational).
//
// Reference: data-model.md "Save migration" (002); 003 data-model.md §8.
//
// `schemaVersion` bumped 1 → 2 for the 002 co-op overlay and bumps 2 → 3 for
// the 003 `activeTraining` field. Each migration is ADDITIVE: v1→v2 introduces
// `coopSegments: []`, `activeOffice: "office_1"`, and `commute: null`; v2→v3
// introduces `activeTraining: null` — and changes NOTHING else. Every existing
// v1/v2 save MUST stay loadable: structural validation in `toGameState`
// (localStorage.ts) treats the missing fields leniently — defaulting them
// BEFORE the migration chain runs — so `migrate()` always receives a complete
// GameState and a genuine v1/v2 save blob (which never carried these fields)
// round-trips into a valid current-version state. A migration MUST be total:
// produce a valid new-version state or fail safely, never partially mutate
// (Constitution IV — never wipe progress; FR-022).
//
// These tests target `migrate()` directly (pure, no I/O) plus end-to-end
// assertions through `deserializeState`/`serializeState` that prove the
// lenient-defaults + migration path loads real v1/v2 save blobs losslessly.
// The 003 additions are RED until T009 bumps CURRENT_SCHEMA_VERSION to 3 and
// registers `migrations[2]`.

import { describe, it, expect } from 'vitest';
import { migrate, CURRENT_SCHEMA_VERSION } from './migrations';
import { deserializeState, serializeState } from './localStorage';
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
    activeTraining: null,
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
    activeTraining: null,
  };
}

/**
 * A fully-populated 002 state at schemaVersion 2 with NON-DEFAULT co-op
 * overlay values (real segments, office_2, an in-progress commute) and NO
 * `activeTraining` key — the realistic on-disk shape of every existing v2
 * save. Proves the v2 → v3 migration defaults the one new field and changes
 * nothing else (FR-022; 003 data-model §8).
 */
function v2StateRawNoActiveTraining(): GameState {
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
    schemaVersion: 2,
    settings: { reducedMotion: true, muted: true },
    coopSegments: [
      { from: 1000, until: 2000, multiplier: 1.2 },
      { from: 3000, until: 4000, multiplier: 1.5 },
    ],
    activeOffice: 'office_2',
    commute: { fromOffice: 'office_1', toOffice: 'office_2', startedAt: 5000 },
    // `activeTraining` intentionally ABSENT — models a real v2 save blob.
  } as unknown as GameState;
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

describe('v1 → v2 → v3 save migration chain', () => {
  it('walks a v1 save to CURRENT (3), defaulting coopSegments=[], activeOffice="office_1", commute=null, activeTraining=null', () => {
    const result = migrate(v1StatePopulated());

    expect(result.schemaVersion).toBe(3);
    expect(result.coopSegments).toEqual([]);
    expect(result.activeOffice).toBe('office_1');
    expect(result.commute).toBeNull();
    expect(result.activeTraining).toBeNull();
  });

  it('changes nothing else — every Spec 001 field is preserved byte-for-byte', () => {
    const input = v1StatePopulated();
    const result = migrate(input);

    expect(result.schemaVersion).toBe(3); // migrated to CURRENT
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

  it('is total — a raw v1 save (no overlay fields) migrates into a COMPLETE valid current state, never partial', () => {
    // A raw v1 save lacks the overlay fields entirely; the migration must
    // introduce them so the result is a complete current state (no undefined gaps).
    const result = migrate(v1StateRawNoOverlay());

    expect(result.schemaVersion).toBe(3);
    expect(Array.isArray(result.coopSegments)).toBe(true);
    expect(result.coopSegments).toEqual([]);
    expect(typeof result.activeOffice).toBe('string');
    expect(result.activeOffice).toBe('office_1');
    expect(result.commute).toBeNull();
    expect(result.activeTraining).toBeNull();
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

  it('every v1 save stays loadable — minimal, populated, and overlay-less shapes all reach CURRENT', () => {
    const inputs = [v1StateMinimal(), v1StatePopulated(), v1StateRawNoOverlay()];

    for (const input of inputs) {
      const result = migrate(input);

      // Each shape — regardless of overlay-field presence — migrates to a valid
      // current state with the baseline overlay defaults. This is the lenient
      // contract: a v1 save never carried these fields and still loads.
      expect(result.schemaVersion).toBe(3);
      expect(result.coopSegments).toEqual([]);
      expect(result.activeOffice).toBe('office_1');
      expect(result.commute).toBeNull();
      expect(result.activeTraining).toBeNull();
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

  it('a raw v1 save blob loads through deserializeState as a valid current state (lenient defaults before the chain)', () => {
    // A genuine on-disk v1 save: schemaVersion 1, NO co-op overlay fields.
    // `toGameState` must apply lenient defaults BEFORE the migration chain runs
    // so this parses into a structurally valid GameState that `migrate()` walks
    // to CURRENT — proving every existing v1 save stays loadable end-to-end.
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

    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.coopSegments).toEqual([]);
    expect(loaded.activeOffice).toBe('office_1');
    expect(loaded.commute).toBeNull();
    expect(loaded.activeTraining).toBeNull();
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

// ---------------------------------------------------------------------------
// (003) v2 → v3 migration — activeTraining: null, nothing else (T003 RED)
// ---------------------------------------------------------------------------

describe('v2 → v3 save migration (003)', () => {
  it('bumps schemaVersion 2 → 3 and defaults activeTraining=null', () => {
    const result = migrate(v2StateRawNoActiveTraining());

    expect(result.schemaVersion).toBe(3);
    expect(result.activeTraining).toBeNull();
  });

  it('changes NOTHING else — every 001/002 field survives, including non-default overlay values', () => {
    const input = v2StateRawNoActiveTraining();
    const result = migrate(input);

    expect(result.schemaVersion).toBe(3);
    // Spec 001 fields untouched by the additive migration.
    expect(result.resources).toEqual(input.resources);
    expect(result.ownedProducers).toEqual(input.ownedProducers);
    expect(result.ownedUpgrades).toEqual(input.ownedUpgrades);
    expect(result.ownedTrainings).toEqual(input.ownedTrainings);
    expect(result.activeBurner).toEqual(input.activeBurner);
    expect(result.earnedMilestones).toEqual(input.earnedMilestones);
    expect(result.lastAdvancedAt).toBe(input.lastAdvancedAt);
    expect(result.settings).toEqual(input.settings);
    // (002) overlay fields carry their NON-DEFAULT values verbatim — the v2→v3
    // migration must not reset segments/office/commute (never wipe progress).
    expect(result.coopSegments).toEqual([
      { from: 1000, until: 2000, multiplier: 1.2 },
      { from: 3000, until: 4000, multiplier: 1.5 },
    ]);
    expect(result.activeOffice).toBe('office_2');
    expect(result.commute).toEqual({
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: 5000,
    });
  });

  it('is total and pure — the input v2 state is never mutated (safe failure, never partial)', () => {
    const input = v2StateRawNoActiveTraining();
    const snapshot = structuredClone(input);

    const result = migrate(input);

    expect(input).toEqual(snapshot);
    expect(input.schemaVersion).toBe(2);
    expect(result).not.toBe(input);
  });

  it('is a no-op for a state already at CURRENT_SCHEMA_VERSION (3)', () => {
    const current: GameState = {
      ...v1StatePopulated(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      activeTraining: null,
    };

    const result = migrate(current);

    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(normalize(result)).toEqual(normalize(current));
  });

  it('a raw v2 save blob loads through deserializeState as a valid v3 state (lenient default before the chain)', () => {
    // A genuine on-disk v2 save: schemaVersion 2, full 002 overlay, NO
    // `activeTraining` key. `toGameState` must default it to null BEFORE the
    // migration chain runs so every existing v2 save stays loadable (FR-022).
    const v2Blob = JSON.stringify({
      schemaVersion: 2,
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
      coopSegments: [{ from: 1000, until: 2000, multiplier: 1.2 }],
      activeOffice: 'office_2',
      commute: { fromOffice: 'office_1', toOffice: 'office_2', startedAt: 5000 },
    });

    const loaded = deserializeState(v2Blob);

    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.activeTraining).toBeNull();
    // Every 001/002 field survives the parse → lenient-default → migrate path.
    expect(loaded.resources).toEqual({ loc: '9007199254740993', cash: '42', aiTokens: '100' });
    expect(loaded.coopSegments).toEqual([{ from: 1000, until: 2000, multiplier: 1.2 }]);
    expect(loaded.activeOffice).toBe('office_2');
    expect(loaded.commute).toEqual({
      fromOffice: 'office_1',
      toOffice: 'office_2',
      startedAt: 5000,
    });
  });

  it('save → load → save is byte-identical for a migrated v2 save (lossless round-trip, FR-022)', () => {
    const v2Blob = JSON.stringify({
      schemaVersion: 2,
      resources: { loc: '123', cash: '7', aiTokens: '9' },
      ownedProducers: ['manual_typing'],
      ownedUpgrades: [],
      ownedTrainings: ['t1'],
      activeBurner: null,
      earnedMilestones: ['m1'],
      lastAdvancedAt: ANCHOR,
      settings: { reducedMotion: false, muted: false },
      coopSegments: [{ from: 1000, until: 2000, multiplier: 1.2 }],
      activeOffice: 'office_2',
      commute: null,
    });

    // load (migrates to v3) → save → load → save
    const migrated = deserializeState(v2Blob);
    const firstSave = serializeState(migrated);
    const reloaded = deserializeState(firstSave);
    const secondSave = serializeState(reloaded);

    // The migrated save carries the new field explicitly (present, null)…
    expect(JSON.parse(firstSave).activeTraining).toBeNull();
    expect(Object.hasOwn(JSON.parse(firstSave), 'activeTraining')).toBe(true);
    // …and round-trips byte-identically from then on.
    expect(secondSave).toBe(firstSave);
    expect(normalize(reloaded)).toEqual(normalize(migrated));
  });
});
