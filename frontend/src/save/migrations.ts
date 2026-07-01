// T017 — Save migration chain (Phase 2: Foundational).
//
// Reference: data-model.md "Save migration".
//
// `schemaVersion` enables forward-compatible saves. On load:
//  - If save.schemaVersion < CURRENT, the migration chain runs in order.
//  - A migration MUST be total: produce a valid new-version state or throw,
//    never partially mutate (Constitution IV — never wipe progress).
//  - Unknown future versions on an older client: refuse to load with a clear
//    message rather than corrupt (handled by the save loader, not here).
//
// This module is PURE (no I/O) so it is unit-testable in isolation. The save
// loader (localStorage.ts) imports `migrate` from here. Today (v1) the chain
// is empty; future versions add an entry keyed by the source version.

import type { GameState } from '../sim/types';

/**
 * The current save-format version. Bump this whenever the persisted GameState
 * shape changes, and add a migration keyed by the previous version below.
 *
 * v2 (002-shared-office-coop): the GameState gained the additive co-op
 * overlay fields `coopSegments`, `activeOffice`, and `commute`
 * (data-model.md "Save migration"). See `migrations[1]` below.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** A migration transforms a state AT a given source version into the next. */
export type Migration = (state: GameState) => GameState;

/**
 * Registry of migrations keyed by SOURCE version.
 * - Key `n` migrates a state whose schemaVersion === n to schemaVersion === n+1.
 * - `migrate` walks from `state.schemaVersion` up to CURRENT_SCHEMA_VERSION.
 */
const migrations: Record<number, Migration> = {
  // v1 → v2 (002-shared-office-coop): introduce the co-op overlay fields at
  // their Spec 001 baseline. A v1 save never carried `coopSegments`,
  // `activeOffice`, or `commute`; this step defaults them so the result is a
  // complete, valid v2 state. The migration is ADDITIVE — it spreads every
  // Spec 001 field through untouched and only adds the three overlay fields +
  // the version bump (data-model.md "Save migration": changes nothing else).
  // `toGameState` (localStorage.ts) already applies these same lenient
  // defaults before the chain runs, so in practice this re-affirms them; it is
  // defensive so `migrate()` is total even when handed a raw pre-002 save shape.
  1: (s): GameState => ({
    ...s,
    schemaVersion: 2,
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  }),
};

/**
 * Walk the migration chain from `input.schemaVersion` up to
 * CURRENT_SCHEMA_VERSION, applying each migration in order.
 *
 * Totality contract (Constitution IV): each migration either produces a valid
 * next-version state or throws; this function never partially mutates. Each
 * migration receives a deep copy, so a throw leaves no side effects.
 *
 * Pure: no I/O, no mutation of the input.
 */
export function migrate(input: GameState): GameState {
  // Deep-copy once at the boundary so migrations can freely mutate their copy
  // without touching the caller's state (the input may be the parsed save).
  let s = structuredClone(input);

  while (s.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const fromVersion = s.schemaVersion;
    const fn = migrations[fromVersion];
    if (!fn) {
      throw new Error(
        `No migration registered from schemaVersion ${fromVersion}; cannot migrate to ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    // Each migration MUST set schemaVersion to fromVersion + 1 (or this throws).
    const next = fn(s);
    if (next.schemaVersion !== fromVersion + 1) {
      throw new Error(
        `Migration from schemaVersion ${fromVersion} did not advance the version to ${fromVersion + 1}.`,
      );
    }
    s = next;
  }

  return s;
}
