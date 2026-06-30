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
 */
export const CURRENT_SCHEMA_VERSION = 1;

/** A migration transforms a state AT a given source version into the next. */
export type Migration = (state: GameState) => GameState;

/**
 * Registry of migrations keyed by SOURCE version.
 * - Key `n` migrates a state whose schemaVersion === n to schemaVersion === n+1.
 * - `migrate` walks from `state.schemaVersion` up to CURRENT_SCHEMA_VERSION.
 *
 * For v1 there are no migrations yet — the chain is intentionally empty.
 * Example for a future v2:
 *   migrations[1] = (s) => ({ ...deepClone(s), schemaVersion: 2, <field changes> });
 */
const migrations: Record<number, Migration> = {
  // empty for v1 — nothing to migrate yet
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
