// T009 — RED unit test for the content loader validation.
//
// ## Background (data-model.md, contracts §1, §2)
// All game content (producers, upgrades, trainings, milestones, burners) is
// versioned JSON served by the backend at `GET /api/v1/content` (contracts §2).
// The client parses the raw envelope into a typed, validated ContentCatalog.
// Malformed content → throws ContentValidationError; the game never runs with
// half-parsed balance data (contracts §1 "Content loader").
//
// Big-number fields (baseRate, cost.amount, fuelCostToActivate, burnRate,
// threshold) are serialized as **strings** end-to-end — never `double`. A
// number where a string is required is malformed and must be rejected.
//
// ## API designed here (implemented by T014)
//  - `loadContent(envelope: ContentEnvelope): ContentCatalog`
//        Validate + type-narrow the already-parsed envelope. All-or-nothing:
//        either returns a fully-valid catalog or throws ContentValidationError
//        before returning anything partial.
//  - `class ContentValidationError extends Error`
//        The loader's own error type, exported from `./content`.
//
// ## Envelope shape (contracts §2)
//   { schemaVersion: number; contentVersion: string;
//     producers: unknown[]; upgrades: unknown[]; trainings: unknown[];
//     milestones: unknown[]; burners: unknown[] }
//
// This file imports `./content` and `./types`, which DO NOT EXIST yet
// (implemented in T014 and T013 respectively). Therefore the suite fails to
// resolve and is RED — the correct TDD starting state per Constitution
// Principle III.

import { describe, it, expect } from 'vitest';
import { loadContent, ContentValidationError } from './content';
import type { ContentEnvelope, ContentCatalog } from './types';
import { FALLBACK_CONTENT } from './fallbackContent';
import { OFFICE_2_UNLOCK_MILESTONE } from '../ui/hudPanel';

// ---------------------------------------------------------------------------
// Fixture builders (DRY) — each returns a fresh deep clone so a test may
// mutate its copy without affecting siblings.
// ---------------------------------------------------------------------------

/** A single valid producer, optionally overridden. */
function producer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'manual_typing',
    name: 'Manual Typing',
    description: 'Type lines of code by hand.',
    baseRate: '1',
    cost: { resource: 'cash', amount: '10' },
    costGrowth: 1.15,
    unlockRequirement: null,
    ...overrides,
  };
}

/** A single valid upgrade. */
function upgrade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'better_keyboard',
    name: 'Better Keyboard',
    cost: { resource: 'cash', amount: '100' },
    effect: { type: 'producerRateMultiplier', producerId: 'manual_typing', multiplier: 2 },
    prerequisite: null,
    ...overrides,
  };
}

/** A single valid lise Academy training. */
function training(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lise_onboarding',
    name: 'lise Onboarding',
    description: 'Welcome to the lise Academy.',
    cost: { resource: 'cash', amount: '50' },
    permanentMultiplier: 1.1,
    prerequisite: null,
    ...overrides,
  };
}

/** A single valid credential milestone. */
function milestone(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'iso_9001',
    name: 'ISO 9001 Certified',
    requirement: { type: 'resourceGte', targetId: null, threshold: '1000' },
    reward: { type: 'globalMultiplier', multiplier: 1.05 },
    ...overrides,
  };
}

/** A single valid burner definition. */
function burner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'copilot_burner',
    name: 'Copilot Burner',
    fuelCostToActivate: '100',
    burnRate: '10',
    productionMultiplier: 3,
    ...overrides,
  };
}

/**
 * A valid coop tuning block (data-model.md CoopConfig; T021 placeholder
 * values). Override fields per test via `coop({ ... })`.
 */
function coop(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    perColleagueMultiplier: 0.1,
    maxMultiplier: 1.5,
    leaseSeconds: 60,
    heartbeatSeconds: 20,
    commuteSeconds: 30,
    lastSeenRetentionDays: 14,
    ...overrides,
  };
}

/**
 * A valid (003) world tuning block (003 data-model §3; T008 placeholder
 * value). Override fields per test via `world({ ... })`.
 */
function world(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    walkSeconds: 2,
    ...overrides,
  };
}

/** A fresh, fully-valid envelope with one entry of each type. */
function validEnvelope(): ContentEnvelope {
  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    producers: [producer()],
    upgrades: [upgrade()],
    trainings: [training()],
    milestones: [milestone()],
    burners: [burner()],
    coop: coop(),
    world: world(),
  };
}

// ---------------------------------------------------------------------------
// loadContent — valid input
// ---------------------------------------------------------------------------

describe('loadContent — valid input', () => {
  it('parses a well-formed envelope into a typed catalog', () => {
    const catalog = loadContent(validEnvelope());

    // Each content type array has the expected length.
    expect(catalog.producers).toHaveLength(1);
    expect(catalog.upgrades).toHaveLength(1);
    expect(catalog.trainings).toHaveLength(1);
    expect(catalog.milestones).toHaveLength(1);
    expect(catalog.burners).toHaveLength(1);

    // The producer is typed with the expected id and fields.
    expect(catalog.producers[0].id).toBe('manual_typing');
    expect(catalog.producers[0].name).toBe('Manual Typing');
    expect(catalog.producers[0].baseRate).toBe('1');
    expect(catalog.producers[0].costGrowth).toBe(1.15);
    expect(catalog.producers[0].unlockRequirement).toBeNull();
  });

  it('handles empty arrays (all content empty)', () => {
    const catalog = loadContent({
      schemaVersion: 1,
      contentVersion: '1.0.0',
      producers: [],
      upgrades: [],
      trainings: [],
      milestones: [],
      burners: [],
      coop: coop(),
      world: world(),
    });

    // Five empty arrays, no throw.
    expect(catalog.producers).toEqual([]);
    expect(catalog.upgrades).toEqual([]);
    expect(catalog.trainings).toEqual([]);
    expect(catalog.milestones).toEqual([]);
    expect(catalog.burners).toEqual([]);
  });

  it('preserves big-number string fields as strings (baseRate, cost.amount)', () => {
    const catalog = loadContent(validEnvelope());

    // Big numbers MUST stay strings — never coerced to number.
    expect(typeof catalog.producers[0].baseRate).toBe('string');
    expect(catalog.producers[0].baseRate).toBe('1');
    expect(typeof catalog.producers[0].cost.amount).toBe('string');
    expect(catalog.producers[0].cost.amount).toBe('10');
  });

  it('returns a catalog carrying the envelope schemaVersion/contentVersion', () => {
    const catalog: ContentCatalog = loadContent(validEnvelope());
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.contentVersion).toBe('1.0.0');
  });
});

// ---------------------------------------------------------------------------
// loadContent — malformed input throws ContentValidationError
// ---------------------------------------------------------------------------

describe('loadContent — malformed input throws ContentValidationError', () => {
  it('throws when producers is missing', () => {
    const env = validEnvelope();
    // @ts-expect-error — intentionally malformed (producers deleted).
    delete env.producers;
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when a producer is missing a required field (id)', () => {
    const env = validEnvelope();
    env.producers = [producer({ id: undefined })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when baseRate is not a string (number forbidden — big numbers are strings)', () => {
    const env = validEnvelope();
    // A number where a string is required is malformed.
    env.producers = [producer({ baseRate: 1 })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when cost.amount is not a string', () => {
    const env = validEnvelope();
    env.producers = [producer({ cost: { resource: 'cash', amount: 10 } })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when requirement.type is not one of the allowed enum values', () => {
    const env = validEnvelope();
    env.milestones = [
      milestone({
        requirement: { type: 'nonsense', targetId: null, threshold: null },
      }),
    ];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws on duplicate ids within a content type', () => {
    const env = validEnvelope();
    env.producers = [producer({ id: 'dup' }), producer({ id: 'dup' })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when schemaVersion is missing / not a number', () => {
    const env = validEnvelope();
    // @ts-expect-error — intentionally malformed.
    env.schemaVersion = 'oops';
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when cost.resource is not an allowed enum value', () => {
    const env = validEnvelope();
    env.producers = [producer({ cost: { resource: 'gold', amount: '10' } })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });
});

// ---------------------------------------------------------------------------
// loadContent — never runs with half-parsed data
// ---------------------------------------------------------------------------

describe('loadContent — never runs with half-parsed data', () => {
  // The contract (§1) guarantees all-or-nothing: a throwing validation
  // produces NO partial catalog. loadContent must throw BEFORE returning any
  // half-built object. The tests above already assert that malformed input
  // throws ContentValidationError; this block makes the guarantee explicit.

  it('a throwing validation produces NO partial catalog (throws before returning)', () => {
    const env = validEnvelope();
    env.producers = [producer({ baseRate: 1 })]; // malformed

    // Calling loadContent must not resolve to a value at all — it throws.
    expect(() => loadContent(env)).toThrow(ContentValidationError);
    // No additional assertion needed: a thrown error means no return value,
    // hence no partial catalog can leak to the caller (the sim).
  });
});

// ---------------------------------------------------------------------------
// loadContent — coop block validation (002, FR-015)
// ---------------------------------------------------------------------------
//
// The additive sixth content entry `coop` (data-model.md CoopConfig; contracts
// §1 "Content loader" / §2). loadContent MUST validate it all-or-nothing and
// throw ContentValidationError on any malformed value, as it does for the five
// 001 arrays. These tests are RED until T026 adds the validation to content.ts.

describe('loadContent — coop block validation (002)', () => {
  it('parses a well-formed coop block into the typed catalog', () => {
    const catalog = loadContent(validEnvelope());

    expect(catalog.coop).toBeDefined();
    const coopBlock = catalog.coop!;
    expect(coopBlock.perColleagueMultiplier).toBe(0.1);
    expect(coopBlock.maxMultiplier).toBe(1.5);
    expect(coopBlock.leaseSeconds).toBe(60);
    expect(coopBlock.heartbeatSeconds).toBe(20);
    expect(coopBlock.commuteSeconds).toBe(30);
    expect(coopBlock.lastSeenRetentionDays).toBe(14);
  });

  it('throws ContentValidationError when the coop block is missing', () => {
    const env = validEnvelope();
    delete env.coop;
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when coop is not an object', () => {
    const env = validEnvelope();
    env.coop = 'nope';
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when a coop field is missing (perColleagueMultiplier)', () => {
    const env = validEnvelope();
    env.coop = coop({ perColleagueMultiplier: undefined });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when perColleagueMultiplier < 0', () => {
    const env = validEnvelope();
    env.coop = coop({ perColleagueMultiplier: -0.1 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when maxMultiplier < 1', () => {
    const env = validEnvelope();
    env.coop = coop({ maxMultiplier: 0.9 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when leaseSeconds <= 0', () => {
    const env = validEnvelope();
    env.coop = coop({ leaseSeconds: 0 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when heartbeatSeconds <= 0', () => {
    const env = validEnvelope();
    env.coop = coop({ heartbeatSeconds: 0 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when heartbeatSeconds >= leaseSeconds (must be strictly less)', () => {
    const env = validEnvelope();
    env.coop = coop({ heartbeatSeconds: 60, leaseSeconds: 60 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when commuteSeconds <= 0', () => {
    const env = validEnvelope();
    env.coop = coop({ commuteSeconds: 0 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when lastSeenRetentionDays <= 0', () => {
    const env = validEnvelope();
    env.coop = coop({ lastSeenRetentionDays: 0 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when a coop field is not a number (maxMultiplier as string)', () => {
    const env = validEnvelope();
    env.coop = coop({ maxMultiplier: 'big' });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('accepts perColleagueMultiplier = 0 (lower bound inclusive) and maxMultiplier = 1 (lower bound inclusive)', () => {
    const env = validEnvelope();
    env.coop = coop({ perColleagueMultiplier: 0, maxMultiplier: 1 });
    const catalog = loadContent(env);
    expect(catalog.coop!.perColleagueMultiplier).toBe(0);
    expect(catalog.coop!.maxMultiplier).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FALLBACK_CONTENT — coop block (002)
// ---------------------------------------------------------------------------
//
// The bundled fallback (frontend/src/sim/fallbackContent.ts) MUST mirror the
// identical coop block so an offline-booting client integrates with the same
// values as the served envelope (contracts §1). RED until T026 mirrors it.

describe('FALLBACK_CONTENT — coop block (002)', () => {
  it('mirrors the placeholder coop values so offline boot integrates identically', () => {
    expect(FALLBACK_CONTENT.coop).toEqual(coop());
  });
});

// ---------------------------------------------------------------------------
// loadContent — world block validation (003, FR-021) — T004 RED
// ---------------------------------------------------------------------------
//
// The additive seventh content entry `world` (003 data-model §3; the exact
// `coop.json` pattern). loadContent MUST enforce it present and validate
// `walkSeconds` as a finite number > 0, all-or-nothing, throwing
// ContentValidationError on any malformed value. RED until T010.

describe('loadContent — world block validation (003)', () => {
  it('parses a well-formed world block into the typed catalog', () => {
    const catalog = loadContent(validEnvelope());

    expect(catalog.world).toBeDefined();
    expect(catalog.world!.walkSeconds).toBe(2);
  });

  it('throws ContentValidationError when the world block is missing (enforced-present)', () => {
    const env = validEnvelope();
    delete env.world;
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when world is not an object', () => {
    const env = validEnvelope();
    env.world = 'nope';
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when walkSeconds is missing', () => {
    const env = validEnvelope();
    env.world = world({ walkSeconds: undefined });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when walkSeconds is not a number', () => {
    const env = validEnvelope();
    env.world = world({ walkSeconds: '2' });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when walkSeconds is 0 (must be > 0)', () => {
    const env = validEnvelope();
    env.world = world({ walkSeconds: 0 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when walkSeconds is negative', () => {
    const env = validEnvelope();
    env.world = world({ walkSeconds: -1 });
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when walkSeconds is not finite (Infinity / NaN)', () => {
    for (const bad of [Infinity, -Infinity, NaN]) {
      const env = validEnvelope();
      env.world = world({ walkSeconds: bad });
      expect(() => loadContent(env)).toThrow(ContentValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// loadContent — Training.durationSeconds validation (003, FR-016/021) — T004 RED
// ---------------------------------------------------------------------------
//
// Trainings gain an OPTIONAL duration (003 data-model §2): absent (or 0) keeps
// the Spec 001 instant-purchase behavior — existing content stays valid
// unchanged (FR-016). Present values must be finite numbers >= 0.

describe('loadContent — Training.durationSeconds validation (003)', () => {
  it('preserves a valid nonzero durationSeconds on the typed training', () => {
    const env = validEnvelope();
    env.trainings = [training({ durationSeconds: 90 })];

    const catalog = loadContent(env);

    expect(catalog.trainings[0].durationSeconds).toBe(90);
  });

  it('accepts durationSeconds = 0 (Spec 001 instant behavior)', () => {
    const env = validEnvelope();
    env.trainings = [training({ durationSeconds: 0 })];

    const catalog = loadContent(env);

    expect(catalog.trainings[0].durationSeconds).toBe(0);
  });

  it('keeps existing trainings WITHOUT durationSeconds valid unchanged (FR-016 backward compatibility)', () => {
    const env = validEnvelope();
    env.trainings = [training()]; // no durationSeconds key — pre-003 content

    const catalog = loadContent(env);

    expect(catalog.trainings).toHaveLength(1);
    expect(catalog.trainings[0].durationSeconds).toBeUndefined();
  });

  it('normalizes an explicit null durationSeconds to absent (wire-leniency for served JSON)', () => {
    const env = validEnvelope();
    env.trainings = [training({ durationSeconds: null })];

    const catalog = loadContent(env);

    expect(catalog.trainings[0].durationSeconds).toBeUndefined();
  });

  it('throws when durationSeconds is not a number', () => {
    const env = validEnvelope();
    env.trainings = [training({ durationSeconds: '90' })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when durationSeconds is negative', () => {
    const env = validEnvelope();
    env.trainings = [training({ durationSeconds: -5 })];
    expect(() => loadContent(env)).toThrow(ContentValidationError);
  });

  it('throws when durationSeconds is not finite (Infinity / NaN)', () => {
    for (const bad of [Infinity, NaN]) {
      const env = validEnvelope();
      env.trainings = [training({ durationSeconds: bad })];
      expect(() => loadContent(env)).toThrow(ContentValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// FALLBACK_CONTENT — world block (003)
// ---------------------------------------------------------------------------
//
// The bundled fallback MUST mirror the identical world block so an
// offline-booting client walks with the same tuning as the served envelope
// (FR-021; 003 data-model §3). RED until T010 mirrors it.

describe('FALLBACK_CONTENT — world block (003)', () => {
  it('mirrors the placeholder world tuning so offline boot walks identically', () => {
    expect(FALLBACK_CONTENT.world).toEqual(world());
  });

  it('the entire fallback catalog passes loadContent validation (world + durations included)', () => {
    // The fallback is shaped exactly like a served envelope; running it
    // through the real validator guards the mirror against silent drift
    // (world block present + valid, every durationSeconds within bounds).
    const catalog = loadContent(FALLBACK_CONTENT as unknown as ContentEnvelope);
    expect(catalog.world).toEqual(world());
  });
});

// ---------------------------------------------------------------------------
// FALLBACK_CONTENT — office_2_unlock milestone (T082 gate contract)
// ---------------------------------------------------------------------------
//
// The HUD switch-office affordance is gated on this exact milestone id
// (OFFICE_2_UNLOCK_MILESTONE in ui/hudPanel.ts). If the id ever drops out of
// the catalog, Office #2 becomes unreachable — this pins content to the gate.

describe('FALLBACK_CONTENT — office_2_unlock milestone (T082)', () => {
  it('carries the milestone the switch-office gate reads, valid per loadContent', () => {
    const milestone = FALLBACK_CONTENT.milestones.find((m) => m.id === OFFICE_2_UNLOCK_MILESTONE);
    expect(milestone).toBeDefined();
    expect(milestone?.requirement).toEqual({
      type: 'resourceGte',
      targetId: 'loc',
      threshold: '50000',
    });
  });
});
