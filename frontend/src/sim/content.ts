// T014 — Content loader with validation.
//
// The backend serves versioned balance JSON as a `ContentEnvelope` (contracts
// §2 GET /api/v1/content). The client must parse + validate it into a typed
// `ContentCatalog` before the sim ever reads it (Constitution Principle II —
// data-driven content; the sim never runs with half-parsed balance data).
//
// This module is PURE and I/O-free: the caller passes the already-parsed
// envelope; no `fetch` lives here. It is deterministic and fully synchronous.
// Validation is all-or-nothing — either a complete typed catalog is returned
// or a `ContentValidationError` is thrown BEFORE any partial output leaks.
//
// Big-number fields (baseRate, cost.amount, fuelCostToActivate, burnRate,
// threshold) MUST be strings (never double). A number where a string is
// required is malformed and rejected (numeric-integrity contract).

import type {
  Burner,
  ContentCatalog,
  ContentEnvelope,
  Cost,
  Effect,
  Milestone,
  Producer,
  Requirement,
  RequirementType,
  ResourceType,
  Training,
  Upgrade,
} from './types';

/** The loader's own error type. Thrown on any malformed content. */
export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

// ── Enum allow-lists (the only place these literals are centralized) ──────

const RESOURCE_TYPES: readonly ResourceType[] = ['loc', 'cash', 'aiTokens'];
const REQUIREMENT_TYPES: readonly RequirementType[] = [
  'resourceGte',
  'ownsProducer',
  'ownsUpgrade',
  'ownsTraining',
  'ownsMilestone',
];
const EFFECT_TYPES: readonly Effect['type'][] = [
  'globalMultiplier',
  'producerRateMultiplier',
  'grantResource',
];

// ── Low-level assertion + narrowing helpers ──────────────────────────────

/** Throws ContentValidationError when `condition` is falsy. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ContentValidationError(message);
  }
}

/** Narrows to a plain object (non-array, non-null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, field: string, ctx: string): string {
  assert(typeof value === 'string', `${ctx}: "${field}" must be a string (got ${typeof value})`);
  return value;
}

/**
 * A big-number field: MUST be a string. Rejects numbers explicitly so a
 * `double` can never slip through (numeric-integrity contract).
 */
function expectBigNumber(value: unknown, field: string, ctx: string): string {
  assert(
    typeof value === 'string',
    `${ctx}: "${field}" must be a big-number string (got ${typeof value})`,
  );
  return value;
}

function expectNumber(value: unknown, field: string, ctx: string): number {
  assert(
    typeof value === 'number' && !Number.isNaN(value),
    `${ctx}: "${field}" must be a number (got ${typeof value})`,
  );
  return value;
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  ctx: string,
): T {
  assert(
    typeof value === 'string' && (allowed as readonly string[]).includes(value),
    `${ctx}: "${field}" must be one of ${allowed.join(' | ')} (got ${String(value)})`,
  );
  return value as T;
}

/** A field that may be null OR a string; undefined is normalized to null. */
function expectNullableString(value: unknown, field: string, ctx: string): string | null {
  assert(
    value === null || value === undefined || typeof value === 'string',
    `${ctx}: "${field}" must be a string or null (got ${typeof value})`,
  );
  return value === undefined ? null : (value as string | null);
}

// ── Per-entity validators ────────────────────────────────────────────────

function validateCost(raw: unknown, ctx: string): Cost {
  assert(isRecord(raw), `${ctx}: cost must be an object`);
  return {
    resource: expectEnum(raw.resource, RESOURCE_TYPES, 'cost.resource', ctx),
    amount: expectBigNumber(raw.amount, 'cost.amount', ctx),
  };
}

function validateRequirement(raw: unknown, ctx: string): Requirement {
  assert(isRecord(raw), `${ctx}: requirement must be an object`);
  return {
    type: expectEnum(raw.type, REQUIREMENT_TYPES, 'requirement.type', ctx),
    targetId: expectNullableString(raw.targetId, 'requirement.targetId', ctx),
    threshold: expectNullableString(raw.threshold, 'requirement.threshold', ctx),
  };
}

/** A Requirement, or null (for nullable gating fields). */
function validateNullableRequirement(raw: unknown, ctx: string): Requirement | null {
  if (raw === null || raw === undefined) return null;
  return validateRequirement(raw, ctx);
}

function validateEffect(raw: unknown, ctx: string): Effect {
  assert(isRecord(raw), `${ctx}: effect must be an object`);
  const type = expectEnum(raw.type, EFFECT_TYPES, 'effect.type', ctx);
  switch (type) {
    case 'globalMultiplier':
      return {
        type,
        multiplier: expectNumber(raw.multiplier, 'effect.multiplier', ctx),
      };
    case 'producerRateMultiplier':
      return {
        type,
        producerId: expectString(raw.producerId, 'effect.producerId', ctx),
        multiplier: expectNumber(raw.multiplier, 'effect.multiplier', ctx),
      };
    case 'grantResource':
      return {
        type,
        resource: expectEnum(raw.resource, RESOURCE_TYPES, 'effect.resource', ctx),
        amount: expectBigNumber(raw.amount, 'effect.amount', ctx),
      };
    default: {
      // Exhaustiveness guard — unreachable because expectEnum already validated.
      const exhaustive: never = type;
      throw new ContentValidationError(`${ctx}: unknown effect type "${String(exhaustive)}"`);
    }
  }
}

function validateProducer(raw: unknown): Producer {
  const ctx = `producer "${typeof raw === 'object' && raw !== null ? String((raw as Record<string, unknown>).id ?? '?') : '?'}"`;
  assert(isRecord(raw), 'producer must be an object');
  const id = expectString(raw.id, 'id', ctx);
  return {
    id,
    name: expectString(raw.name, 'name', ctx),
    description: expectString(raw.description, 'description', ctx),
    baseRate: expectBigNumber(raw.baseRate, 'baseRate', ctx),
    cost: validateCost(raw.cost, ctx),
    costGrowth: expectNumber(raw.costGrowth, 'costGrowth', ctx),
    unlockRequirement: validateNullableRequirement(raw.unlockRequirement, ctx),
  };
}

function validateUpgrade(raw: unknown): Upgrade {
  assert(isRecord(raw), 'upgrade must be an object');
  const ctx = `upgrade "${String(raw.id ?? '?')}"`;
  return {
    id: expectString(raw.id, 'id', ctx),
    name: expectString(raw.name, 'name', ctx),
    cost: validateCost(raw.cost, ctx),
    effect: validateEffect(raw.effect, ctx),
    prerequisite: validateNullableRequirement(raw.prerequisite, ctx),
  };
}

function validateTraining(raw: unknown): Training {
  assert(isRecord(raw), 'training must be an object');
  const ctx = `training "${String(raw.id ?? '?')}"`;
  return {
    id: expectString(raw.id, 'id', ctx),
    name: expectString(raw.name, 'name', ctx),
    description: expectString(raw.description, 'description', ctx),
    cost: validateCost(raw.cost, ctx),
    permanentMultiplier: expectNumber(raw.permanentMultiplier, 'permanentMultiplier', ctx),
    prerequisite: validateNullableRequirement(raw.prerequisite, ctx),
  };
}

function validateMilestone(raw: unknown): Milestone {
  assert(isRecord(raw), 'milestone must be an object');
  const ctx = `milestone "${String(raw.id ?? '?')}"`;
  return {
    id: expectString(raw.id, 'id', ctx),
    name: expectString(raw.name, 'name', ctx),
    requirement: validateRequirement(raw.requirement, ctx),
    reward: validateEffect(raw.reward, ctx),
  };
}

function validateBurner(raw: unknown): Burner {
  assert(isRecord(raw), 'burner must be an object');
  const ctx = `burner "${String(raw.id ?? '?')}"`;
  return {
    id: expectString(raw.id, 'id', ctx),
    name: expectString(raw.name, 'name', ctx),
    fuelCostToActivate: expectBigNumber(raw.fuelCostToActivate, 'fuelCostToActivate', ctx),
    burnRate: expectBigNumber(raw.burnRate, 'burnRate', ctx),
    productionMultiplier: expectNumber(raw.productionMultiplier, 'productionMultiplier', ctx),
  };
}

/** Ensures all ids within one content type are unique. */
function assertUniqueIds<T extends { id: string }>(items: T[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new ContentValidationError(`${label}: duplicate id "${item.id}"`);
    }
    seen.add(item.id);
  }
}

/** Reads + validates an array field of the envelope (present + is an array). */
function expectArrayField(envelope: Record<string, unknown>, name: string): unknown[] {
  const value = envelope[name];
  assert(
    Array.isArray(value),
    `content envelope: "${name}" must be an array (got ${typeof value})`,
  );
  return value;
}

// ── Public entry point ───────────────────────────────────────────────────

/**
 * Validate + type-narrow an already-parsed content envelope into a typed
 * `ContentCatalog`. All-or-nothing: returns a complete catalog or throws
 * `ContentValidationError` before any partial output can leak.
 */
export function loadContent(envelope: ContentEnvelope): ContentCatalog {
  // Treat the envelope defensively — malformed input may not match the type.
  assert(isRecord(envelope), 'content envelope must be an object');

  const schemaVersion = expectNumber(envelope.schemaVersion, 'schemaVersion', 'content envelope');
  const contentVersion = expectString(
    envelope.contentVersion,
    'contentVersion',
    'content envelope',
  );

  // Validate every entity list fully BEFORE assembling the catalog, so a
  // failure never yields a partial result (all-or-nothing contract).
  const producers = expectArrayField(envelope, 'producers').map(validateProducer);
  const upgrades = expectArrayField(envelope, 'upgrades').map(validateUpgrade);
  const trainings = expectArrayField(envelope, 'trainings').map(validateTraining);
  const milestones = expectArrayField(envelope, 'milestones').map(validateMilestone);
  const burners = expectArrayField(envelope, 'burners').map(validateBurner);

  assertUniqueIds(producers, 'producers');
  assertUniqueIds(upgrades, 'upgrades');
  assertUniqueIds(trainings, 'trainings');
  assertUniqueIds(milestones, 'milestones');
  assertUniqueIds(burners, 'burners');

  return {
    schemaVersion,
    contentVersion,
    producers,
    upgrades,
    trainings,
    milestones,
    burners,
  };
}
