// T012 — RED tests for `applyCoopPresence(state, segment, content)` (contracts §1).
//
// `applyCoopPresence` is the ONLY entry point by which server-issued co-op
// lease segments reach the save. It is a discrete, non-time-based pure mutator
// (like the 001 mutators in `sim/actions.ts`): it merges a server-authored
// `CoopSegment` into `state.coopSegments` and NEVER touches `lastAdvancedAt`
// or resources. The third `content` parameter is required because the
// bounded-acceptance horizon reads `content.coop.leaseSeconds` (contracts §1).
//
// ## Timestamp convention (data-model.md "CoopSegment"; types.ts)
// `CoopSegment.from`/`until` are **sim-timeline timestamps in milliseconds**
// (the same numeric timeline `advance` derives from
// `Date.parse(state.lastAdvancedAt)`). `state.lastAdvancedAt` is an ISO-8601
// UTC string. The horizon is therefore
//   `Date.parse(state.lastAdvancedAt) + content.coop.leaseSeconds * 1000`.
// `coop.leaseSeconds` is in seconds (placeholder 60).
//
// This file imports `./coop`, which exists only as a RED stub (T012); the real
// implementation lands in T023. The stub returns the state unchanged, so every
// assertion that expects a segment to be stored FAILS — the correct TDD RED.

import { describe, it, expect } from 'vitest';
import { applyCoopPresence } from './coop';
import type { ContentCatalog, CoopSegment, GameState } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fixed sim "now" anchor (ISO-8601 UTC) — keeps segment times deterministic. */
const NOW_ISO = '2026-07-01T09:00:00.000Z';
/** The same instant as a sim-timeline ms number (what CoopSegment.from uses). */
const NOW_MS = Date.parse(NOW_ISO);
/** `coop.leaseSeconds` (60) expressed in ms — the bounded-acceptance horizon. */
const LEASE_MS = 60_000;

/**
 * A minimal valid GameState. Defaults to an EMPTY `coopSegments` (baseline) at
 * `NOW_ISO`; pass overrides to seed existing segments or move the clock.
 */
function makeState(
  overrides: { coopSegments?: CoopSegment[]; lastAdvancedAt?: string } = {},
): GameState {
  return {
    resources: { loc: '100', cash: '50', aiTokens: '10' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings: new Set<string>(),
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: overrides.lastAdvancedAt ?? NOW_ISO,
    schemaVersion: 2,
    settings: { reducedMotion: false, muted: false },
    coopSegments: (overrides.coopSegments ?? []).map((s) => ({ ...s })),
    activeOffice: 'office_1',
    commute: null,
  };
}

/**
 * A content catalog carrying only the (002) `coop` block — the only content
 * `applyCoopPresence` reads (it consumes `coop.leaseSeconds` for the horizon).
 * Placeholder values mirror data-model.md / fallbackContent.ts.
 */
function makeContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    producers: [],
    upgrades: [],
    trainings: [],
    milestones: [],
    burners: [],
    coop: {
      perColleagueMultiplier: 0.1,
      maxMultiplier: 1.5,
      leaseSeconds: 60,
      heartbeatSeconds: 20,
      commuteSeconds: 30,
      lastSeenRetentionDays: 14,
    },
  };
}

/** A server-issued lease segment starting 1s from now, running one lease. */
function freshSegment(multiplier = 1.2): CoopSegment {
  return { from: NOW_MS + 1_000, until: NOW_MS + LEASE_MS, multiplier };
}

/** Deterministic value-comparison of two GameStates (Set order insignificant). */
function normalize(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Set) {
      return Array.from(value).sort();
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// applyCoopPresence — upsert by `from`
// ---------------------------------------------------------------------------

describe('applyCoopPresence — upsert by `from`', () => {
  it('stores a new server-issued segment in coopSegments', () => {
    const state = makeState();
    const segment = freshSegment();

    const result = applyCoopPresence(state, segment, makeContent());

    expect(result.coopSegments).toHaveLength(1);
    expect(result.coopSegments[0]).toEqual(segment);
  });

  it('upserts an existing `from`: incoming larger until/multiplier are taken (max)', () => {
    const existing: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + 30_000,
      multiplier: 1.1,
    };
    const state = makeState({ coopSegments: [existing] });
    const incoming: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS, // larger
      multiplier: 1.4, // larger
    };

    const result = applyCoopPresence(state, incoming, makeContent());

    expect(result.coopSegments).toHaveLength(1);
    expect(result.coopSegments[0]).toEqual({
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS, // max
      multiplier: 1.4, // max
    });
  });

  it('upsert does not regress: existing larger until/multiplier are kept (max)', () => {
    const existing: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS,
      multiplier: 1.5,
    };
    const state = makeState({ coopSegments: [existing] });
    const incoming: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + 30_000, // smaller
      multiplier: 1.2, // smaller
    };

    const result = applyCoopPresence(state, incoming, makeContent());

    expect(result.coopSegments).toHaveLength(1);
    expect(result.coopSegments[0]).toEqual({
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS, // existing kept
      multiplier: 1.5, // existing kept
    });
  });

  it('keeps unrelated segments untouched (union keyed by from)', () => {
    const other: CoopSegment = {
      from: NOW_MS + 20_000,
      until: NOW_MS + 50_000,
      multiplier: 1.3,
    };
    const state = makeState({ coopSegments: [other] });

    const result = applyCoopPresence(state, freshSegment(), makeContent());

    expect(result.coopSegments).toHaveLength(2);
    expect(result.coopSegments).toContainEqual(other);
    expect(result.coopSegments).toContainEqual(freshSegment());
  });
});

// ---------------------------------------------------------------------------
// applyCoopPresence — idempotent redelivery
// ---------------------------------------------------------------------------

describe('applyCoopPresence — idempotent redelivery', () => {
  it('applying the same segment twice yields one segment equal to a single apply', () => {
    const segment = freshSegment();
    const content = makeContent();

    const once = applyCoopPresence(makeState(), segment, content);
    const twice = applyCoopPresence(once, segment, content);

    expect(twice.coopSegments).toHaveLength(1);
    expect(twice.coopSegments[0]).toEqual(segment);
    expect(normalize(twice)).toEqual(normalize(once));
  });
});

// ---------------------------------------------------------------------------
// applyCoopPresence — stale / bounded-acceptance horizon
// ---------------------------------------------------------------------------

describe('applyCoopPresence — stale / bounded-acceptance horizon', () => {
  it('a stale segment (until <= lastAdvancedAt) is a no-op', () => {
    const state = makeState();
    const stale: CoopSegment = {
      from: NOW_MS - 10_000,
      until: NOW_MS, // == lastAdvancedAt → fully in the past
      multiplier: 1.2,
    };

    const result = applyCoopPresence(state, stale, makeContent());

    expect(normalize(result)).toEqual(normalize(state));
    expect(result.coopSegments).toHaveLength(0);
  });

  it('drops a segment whose from is beyond lastAdvancedAt + leaseSeconds', () => {
    const state = makeState();
    const tooFar: CoopSegment = {
      from: NOW_MS + LEASE_MS + 1, // beyond the horizon
      until: NOW_MS + LEASE_MS + 60_000,
      multiplier: 1.2,
    };

    const result = applyCoopPresence(state, tooFar, makeContent());

    expect(normalize(result)).toEqual(normalize(state));
    expect(result.coopSegments).toHaveLength(0);
  });

  it('accepts a segment whose from is exactly at the horizon boundary (<=)', () => {
    const state = makeState();
    const atHorizon: CoopSegment = {
      from: NOW_MS + LEASE_MS, // == horizon → accepted (boundary inclusive)
      until: NOW_MS + LEASE_MS + 30_000,
      multiplier: 1.2,
    };

    const result = applyCoopPresence(state, atHorizon, makeContent());

    expect(result.coopSegments).toHaveLength(1);
    expect(result.coopSegments[0]).toEqual(atHorizon);
  });
});

// ---------------------------------------------------------------------------
// applyCoopPresence — malformed input never throws
// ---------------------------------------------------------------------------

describe('applyCoopPresence — malformed input returns state unchanged, never throws', () => {
  it('an unparseable timestamp (NaN from) returns state unchanged', () => {
    const state = makeState();
    const bad: CoopSegment = {
      from: Number.NaN, // e.g. Date.parse('garbage')
      until: NOW_MS + LEASE_MS,
      multiplier: 1.2,
    };

    const fn = () => applyCoopPresence(state, bad, makeContent());
    expect(fn).not.toThrow();
    expect(normalize(fn())).toEqual(normalize(state));
  });

  it('an unparseable timestamp (NaN until) returns state unchanged', () => {
    const state = makeState();
    const bad: CoopSegment = {
      from: NOW_MS + 1_000,
      until: Number.NaN,
      multiplier: 1.2,
    };

    expect(() => applyCoopPresence(state, bad, makeContent())).not.toThrow();
    expect(normalize(applyCoopPresence(state, bad, makeContent()))).toEqual(normalize(state));
  });

  it('until <= from returns state unchanged', () => {
    const state = makeState();
    const zeroLength: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + 1_000, // until == from
      multiplier: 1.2,
    };
    const inverted: CoopSegment = {
      from: NOW_MS + 30_000,
      until: NOW_MS + 1_000, // until < from
      multiplier: 1.2,
    };

    expect(() => applyCoopPresence(state, zeroLength, makeContent())).not.toThrow();
    expect(() => applyCoopPresence(state, inverted, makeContent())).not.toThrow();
    expect(normalize(applyCoopPresence(state, zeroLength, makeContent()))).toEqual(normalize(state));
    expect(normalize(applyCoopPresence(state, inverted, makeContent()))).toEqual(normalize(state));
  });

  it('a non-finite multiplier (NaN / Infinity) returns state unchanged', () => {
    const state = makeState();
    const nanMult: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS,
      multiplier: Number.NaN,
    };
    const infMult: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS,
      multiplier: Number.POSITIVE_INFINITY,
    };

    expect(() => applyCoopPresence(state, nanMult, makeContent())).not.toThrow();
    expect(() => applyCoopPresence(state, infMult, makeContent())).not.toThrow();
    expect(normalize(applyCoopPresence(state, nanMult, makeContent()))).toEqual(normalize(state));
    expect(normalize(applyCoopPresence(state, infMult, makeContent()))).toEqual(normalize(state));
  });

  it('a negative multiplier returns state unchanged', () => {
    const state = makeState();
    const neg: CoopSegment = {
      from: NOW_MS + 1_000,
      until: NOW_MS + LEASE_MS,
      multiplier: -0.5,
    };

    expect(() => applyCoopPresence(state, neg, makeContent())).not.toThrow();
    expect(normalize(applyCoopPresence(state, neg, makeContent()))).toEqual(normalize(state));
  });
});

// ---------------------------------------------------------------------------
// applyCoopPresence — purity / non-mutation of the sim clock & resources
// ---------------------------------------------------------------------------

describe('applyCoopPresence — purity (never touches lastAdvancedAt or resources)', () => {
  it('returns a new state object (does not return the input reference)', () => {
    const state = makeState();

    const result = applyCoopPresence(state, freshSegment(), makeContent());

    expect(result).not.toBe(state);
  });

  it('does not mutate the input state', () => {
    const state = makeState();
    const before = normalize(state);

    applyCoopPresence(state, freshSegment(), makeContent());

    expect(normalize(state)).toEqual(before);
  });

  it('never touches lastAdvancedAt or resources on a successful merge', () => {
    const state = makeState();
    // Snapshot ONLY the fields that must be invariant across a merge (the
    // merge legitimately grows `coopSegments`, so a whole-state compare would
    // invert — passing in RED, failing in GREEN).
    const invariantBefore = {
      lastAdvancedAt: state.lastAdvancedAt,
      resources: { ...state.resources },
    };

    const result = applyCoopPresence(state, freshSegment(), makeContent());

    // The merge DID happen (sanity: this is a successful-merge path, not a
    // no-op) — and yet the clock + resources stay byte-identical.
    expect(result.coopSegments).toHaveLength(1);
    expect(result.lastAdvancedAt).toBe(state.lastAdvancedAt);
    expect(result.resources).toEqual(state.resources);
    expect({ lastAdvancedAt: result.lastAdvancedAt, resources: result.resources }).toEqual(
      invariantBefore,
    );
  });
});
