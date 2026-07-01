// T017 — localStorage save/load + migration (Phase 2: Foundational).
//
// Reference: data-model.md "Save migration"; contracts §1 (offline-capable,
// local save is authoritative for play); research.md (client persistence =
// localStorage); quickstart.md Scenario 4 (save integrity & migration).
//
// ## Architecture (purity / testability)
// The Set<->array conversion and JSON serialize/deserialize logic is PURE and
// exported as `serializeState` / `deserializeState` so tests (T027/T053) can
// verify round-trip identity WITHOUT touching real localStorage. The actual
// storage access is confined to thin functions (saveGame/loadGame/clearGame).
//
// ## Corruption policy (Constitution IV — never silently wipe)
// A corrupted save (unparseable JSON) throws `CorruptedSaveError`; the caller
// decides how to recover. A save whose schemaVersion is NEWER than the client
// understands throws `SaveVersionTooNewError` (refuse, do not corrupt). The
// loader never silently discards a save.

import type { GameState, PlayerSettings } from '../sim/types';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations';

/** Fixed localStorage key for the v1 save. */
export const SAVE_KEY = 'lise-idle-save-v1';

// ── Errors (typed, so callers/UI can branch on them) ─────────────────────

/** The save blob exists but is not parseable JSON. Do NOT silently wipe. */
export class CorruptedSaveError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CorruptedSaveError';
    this.cause = cause;
  }
}

/**
 * The save was written by a newer client (schemaVersion > CURRENT). Refuse to
 * load rather than risk corrupting progress; prompt the user to update.
 */
export class SaveVersionTooNewError extends Error {
  readonly saveVersion: number;
  readonly supportedVersion: number;
  constructor(message: string, saveVersion: number, supportedVersion: number) {
    super(message);
    this.name = 'SaveVersionTooNewError';
    this.saveVersion = saveVersion;
    this.supportedVersion = supportedVersion;
  }
}

// ── Pure helpers (Set<->array, serialize/deserialize) ────────────────────
//
// GameState stores ownership as Set<string>, but JSON has no Set. These helpers
// convert losslessly: Set -> sorted array on write, array -> Set on read.

/** A JSON-serializable shape for GameState with Sets replaced by arrays. */
interface SerializedGameState {
  schemaVersion: number;
  resources: GameState['resources'];
  ownedProducers: string[];
  ownedUpgrades: string[];
  ownedTrainings: string[];
  activeBurner: GameState['activeBurner'];
  earnedMilestones: string[];
  lastAdvancedAt: string;
  settings: PlayerSettings;
}

/**
 * Convert a live GameState (with Sets) into a JSON-safe serialized shape
 * (with sorted arrays). Pure, no I/O.
 */
export function serializeState(state: GameState): string {
  const serialized: SerializedGameState = {
    schemaVersion: state.schemaVersion,
    resources: state.resources,
    ownedProducers: [...state.ownedProducers].sort(),
    ownedUpgrades: [...state.ownedUpgrades].sort(),
    ownedTrainings: [...state.ownedTrainings].sort(),
    activeBurner: state.activeBurner,
    earnedMilestones: [...state.earnedMilestones].sort(),
    lastAdvancedAt: state.lastAdvancedAt,
    settings: state.settings,
  };
  return JSON.stringify(serialized);
}

/**
 * Parse a serialized save JSON string back into a live GameState (with Sets
 * reconstructed). Pure, no localStorage I/O.
 *
 * Throws `CorruptedSaveError` if the JSON is unparseable or structurally
 * malformed (missing required fields). Throws `SaveVersionTooNewError` if the
 * save's schemaVersion is newer than the client supports. Runs the migration
 * chain if the save is older than CURRENT_SCHEMA_VERSION.
 */
export function deserializeState(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new CorruptedSaveError('Save data is not valid JSON and cannot be parsed.', err);
  }

  const state = toGameState(parsed); // structural validation (throws CorruptedSaveError)

  // Refuse future-version saves rather than risk corruption.
  if (state.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SaveVersionTooNewError(
      `Save schemaVersion ${state.schemaVersion} is newer than this client supports (${CURRENT_SCHEMA_VERSION}). Please update the game.`,
      state.schemaVersion,
      CURRENT_SCHEMA_VERSION,
    );
  }

  // Migrate older saves forward (no-op when already current).
  return state.schemaVersion === CURRENT_SCHEMA_VERSION ? state : migrate(state);
}

/**
 * Structurally validate an unknown parsed value and return a live GameState
 * (Sets reconstructed from arrays). Throws `CorruptedSaveError` on any
 * structural problem (missing/oversized fields, wrong types).
 */
function toGameState(parsed: unknown): GameState {
  if (!isObject(parsed)) {
    throw new CorruptedSaveError('Save root is not an object.');
  }

  const resourcesRaw = parsed.resources;
  if (!isObject(resourcesRaw)) {
    throw new CorruptedSaveError('Save is missing a valid `resources` object.');
  }
  const loc = resourcesRaw.loc;
  const cash = resourcesRaw.cash;
  const aiTokens = resourcesRaw.aiTokens;
  if (typeof loc !== 'string') {
    throw new CorruptedSaveError('Resource "loc" is not a string.');
  }
  if (typeof cash !== 'string') {
    throw new CorruptedSaveError('Resource "cash" is not a string.');
  }
  if (typeof aiTokens !== 'string') {
    throw new CorruptedSaveError('Resource "aiTokens" is not a string.');
  }

  const ownedProducers = toStringSet(parsed.ownedProducers, 'ownedProducers');
  const ownedUpgrades = toStringSet(parsed.ownedUpgrades, 'ownedUpgrades');
  const ownedTrainings = toStringSet(parsed.ownedTrainings, 'ownedTrainings');
  const earnedMilestones = toStringSet(parsed.earnedMilestones, 'earnedMilestones');

  const activeBurner = toActiveBurner(parsed.activeBurner);

  if (typeof parsed.lastAdvancedAt !== 'string') {
    throw new CorruptedSaveError('`lastAdvancedAt` is not a string.');
  }

  if (typeof parsed.schemaVersion !== 'number') {
    throw new CorruptedSaveError('`schemaVersion` is not a number.');
  }

  const settings = toPlayerSettings(parsed.settings);

  return {
    resources: { loc, cash, aiTokens },
    ownedProducers,
    ownedUpgrades,
    ownedTrainings,
    activeBurner,
    earnedMilestones,
    lastAdvancedAt: parsed.lastAdvancedAt,
    schemaVersion: parsed.schemaVersion,
    settings,
    // (002) Co-op overlay fields default to the Spec 001 baseline. T022 adds
    // lenient parsing of these from the save + the v1->v2 migration chain; for
    // now every loadable save is schemaVersion 1 (no such fields), so the
    // defaults make a v1 save byte-identical to 001 behavior.
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toStringSet(v: unknown, field: string): Set<string> {
  if (!Array.isArray(v)) {
    throw new CorruptedSaveError(`\`${field}\` is not an array.`);
  }
  for (const el of v) {
    if (typeof el !== 'string') {
      throw new CorruptedSaveError(`\`${field}\` contains a non-string element.`);
    }
  }
  return new Set(v);
}

function toActiveBurner(v: unknown): GameState['activeBurner'] {
  if (v === null) return null;
  if (!isObject(v)) {
    throw new CorruptedSaveError('`activeBurner` is neither null nor an object.');
  }
  if (
    typeof v.definitionId !== 'string' ||
    typeof v.startedAt !== 'string' ||
    typeof v.fuelRemaining !== 'string'
  ) {
    throw new CorruptedSaveError('`activeBurner` is missing required string fields.');
  }
  return {
    definitionId: v.definitionId,
    startedAt: v.startedAt,
    fuelRemaining: v.fuelRemaining,
  };
}

function toPlayerSettings(v: unknown): PlayerSettings {
  if (!isObject(v)) {
    throw new CorruptedSaveError('`settings` is not an object.');
  }
  if (typeof v.reducedMotion !== 'boolean') {
    throw new CorruptedSaveError('`settings.reducedMotion` is not a boolean.');
  }
  if (typeof v.muted !== 'boolean') {
    throw new CorruptedSaveError('`settings.muted` is not a boolean.');
  }
  return { reducedMotion: v.reducedMotion, muted: v.muted };
}

// ── Fresh state factory ──────────────────────────────────────────────────

/**
 * A valid fresh zero-state for a brand-new player (quickstart Scenario 4:
 * "first-ever load with no save: game starts cleanly at zero").
 *
 * `lastAdvancedAt` uses the epoch; the game loop re-anchors it to now on first
 * load via advance(), so this stays pure/deterministic (no `Date.now()` here).
 */
export function createInitialState(): GameState {
  return {
    resources: { loc: '0', cash: '0', aiTokens: '0' },
    ownedProducers: new Set<string>(),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: new Date(0).toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { reducedMotion: false, muted: false },
    // (002) Co-op overlay: a fresh, never-online save is byte-identical to
    // Spec 001 (empty segments, default office, no commute in progress).
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

// ── Thin localStorage adapter ────────────────────────────────────────────
//
// These are the only functions that touch `localStorage`. They wrap it so the
// game never crashes on storage failure (e.g. QuotaExceededError, disabled
// storage in private mode).

/** Persist the given GameState to localStorage. Never throws on quota errors. */
export function saveGame(state: GameState): void {
  const json = serializeState(state);
  try {
    localStorage.setItem(SAVE_KEY, json);
  } catch (err) {
    // QuotaExceededError, SecurityError, or storage disabled: log but do not
    // crash the game. The local save is best-effort for offline play; the
    // backend sync (when reachable) is the durable copy.
    console.error('Failed to persist save to localStorage:', err);
  }
}

/**
 * Load the save from localStorage.
 *
 * Returns `null` if no save exists (fresh player). Throws `CorruptedSaveError`
 * on unparseable/structurally-invalid JSON. Throws `SaveVersionTooNewError`
 * if the save is from a newer client. Never silently wipes a save.
 */
export function loadGame(): GameState | null {
  let json: string | null;
  try {
    json = localStorage.getItem(SAVE_KEY);
  } catch (err) {
    // Storage unavailable (private mode, disabled): treat as no save.
    console.error('Failed to read save from localStorage:', err);
    return null;
  }
  if (json === null) return null; // no save — fresh player
  return deserializeState(json); // validates + migrates (or throws typed error)
}

/** Remove the save key (for "reset" or testing). Never throws. */
export function clearGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    console.error('Failed to clear save from localStorage:', err);
  }
}
