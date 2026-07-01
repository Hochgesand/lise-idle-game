// T013 — Shared TypeScript types for the pure simulation + content layer.
//
// The authoritative field reference is data-model.md; the API surface is fixed
// by contracts §1 (sim) and §2 (REST content envelope). This module is a
// type-only barrel: zero runtime code, zero I/O (Constitution Principle I —
// the sim stays pure and unit-testable in isolation).
//
// ## Big numbers
// All monetary/resource fields are big numbers serialized as **strings**
// (data-model.md "all three are non-negative and monotonic"; contracts §1
// "big numbers are serialized as strings everywhere (never double)"). They are
// declared `string` here, not `BigNumber`, because `GameState` is the saveable
// wire/serialized snapshot (JSON has no BigNumber). The `BigNumber` opaque type
// from `./bigNumber` is used inside `advance.ts` for in-memory arithmetic only.
//
// ## Content vs. state
// GameState (below) is the ONLY thing persisted/advanced. Content entities
// (Producer/Upgrade/Training/Milestone/Burner) are versioned JSON data served
// by the backend (Constitution Principle II); they are injected into
// `advance(state, dt, content)` as a separate argument, never stored in state.

export type { BigNumber } from './bigNumber';

// ── Resource & core state ────────────────────────────────────────────────

/** The three tracked resources. Used as keys in ResourceSet and Cost.resource. */
export type ResourceType = 'loc' | 'cash' | 'aiTokens';

/** Current resource totals (big-number strings; never double). */
export interface ResourceSet {
  loc: string; // Lines of Code — the primary produced resource
  cash: string; // spendable currency (from cashing out LOC)
  aiTokens: string; // fuel consumed by the burner
}

/** An active AI-token burner, or null when none is running. */
export interface BurnerState {
  definitionId: string; // references a Burner content definition
  startedAt: string; // ISO-8601 UTC
  fuelRemaining: string; // big-number string (tokens left to burn)
}

/** UI preferences (not gameplay). */
export interface PlayerSettings {
  reducedMotion: boolean; // accessibility
  muted: boolean; // audio
}

// ── Co-op presence (002 — additive overlay on the Spec 001 model) ─────────

/**
 * A closed, server-authored co-op lease segment — the only channel through
 * which presence affects the simulation (data-model.md "CoopSegment").
 *
 * `from`/`until` are **sim-timeline timestamps in milliseconds** (the same
 * numeric timeline `advance` derives from `Date.parse(lastAdvancedAt)`); the
 * client never authors them — they arrive server-stamped and are merged
 * verbatim into the save. `multiplier` is a bounded scalar
 * (`1 <= multiplier <= CoopConfig.maxMultiplier`), never a resource.
 */
export interface CoopSegment {
  from: number; // segment start, sim-timeline ms (server clock)
  until: number; // bounded lease end, sim-timeline ms (server clock)
  multiplier: number; // production multiplier, capped at content.coop.maxMultiplier
}

/**
 * An in-progress office switch (data-model.md "CommuteState"; closes the
 * 001 FR-016 saved-commute gap). `startedAt` is a **sim-timeline timestamp in
 * milliseconds**, written by the `switchOffice` mutator from `lastAdvancedAt`
 * (never wall clock) so `advance` can resolve it from elapsed time on load at
 * `startedAt + content.coop.commuteSeconds`. While `commute != null` the dev is
 * present in no office.
 */
export interface CommuteState {
  fromOffice: string; // origin office id
  toOffice: string; // destination office id
  startedAt: number; // sim-timeline ms, derived from lastAdvancedAt
}

/**
 * The complete saveable snapshot — the ONLY input/output of `advance`.
 * See data-model.md "GameState".
 *
 * The 002 co-op overlay adds `coopSegments`, `activeOffice`, and `commute`
 * (all additive; an empty `coopSegments` + `"office_1"` + `null` commute is
 * byte-identical to Spec 001 behavior). See data-model.md "GameState (extended)".
 */
export interface GameState {
  resources: ResourceSet;
  ownedProducers: Set<string>; // producer ids owned
  ownedUpgrades: Set<string>; // upgrade ids owned
  ownedTrainings: Set<string>; // training ids owned
  activeBurner: BurnerState | null; // active burner, else null
  earnedMilestones: Set<string>; // milestone ids earned
  lastAdvancedAt: string; // ISO-8601 UTC — the clock anchor
  schemaVersion: number; // save format version for migrations
  settings: PlayerSettings;
  coopSegments: CoopSegment[]; // (002) server-issued co-op lease segments; default []
  activeOffice: string; // (002) the dev's active office; default "office_1"
  commute: CommuteState | null; // (002) in-progress office switch; default null
}

// ── Content entities (versioned JSON data, NOT in the save) ──────────────

/** The cost to purchase a producer/upgrade/training. */
export interface Cost {
  resource: ResourceType;
  amount: string; // big-number string
}

/** Predicate type gating an unlock or milestone. */
export type RequirementType =
  'resourceGte' | 'ownsProducer' | 'ownsUpgrade' | 'ownsTraining' | 'ownsMilestone';

/** A predicate gating an unlock / milestone (data-model.md "Requirement"). */
export interface Requirement {
  type: RequirementType;
  targetId: string | null; // id ref for owns-* types
  threshold: string | null; // big-number string for resourceGte
}

/**
 * Polymorphic modifier applied by upgrades / milestone rewards
 * (data-model.md "Effect / Reward"). A discriminated union on `type`:
 *  - globalMultiplier:        multiply total LOC/sec by `multiplier`
 *  - producerRateMultiplier:  multiply a specific producer's rate by `multiplier`
 *  - grantResource:           grant `amount` of `resource` (used by rewards)
 *
 * The wire format (served by the backend / built by test fixtures) uses the
 * `multiplier` field name for the multiplier variants.
 */
export type Effect =
  | { type: 'globalMultiplier'; multiplier: number }
  | { type: 'producerRateMultiplier'; producerId: string; multiplier: number }
  | { type: 'grantResource'; resource: ResourceType; amount: string };

/** A reward is just an Effect applied when a milestone is earned. */
export type Reward = Effect;

/** A source of LOC/sec (themed dev activity tier). */
export interface Producer {
  id: string;
  name: string;
  description: string;
  baseRate: string; // big-number string (LOC/sec granted when owned)
  cost: Cost;
  costGrowth: number; // cost multiplier per purchase (e.g. 1.15)
  unlockRequirement: Requirement | null; // gating
}

/** A purchasable multiplier or modifier. */
export interface Upgrade {
  id: string;
  name: string;
  cost: Cost;
  effect: Effect;
  prerequisite: Requirement | null; // gating
}

/** A lise Academy training: a permanent production boost. */
export interface Training {
  id: string;
  name: string;
  description: string;
  cost: Cost;
  permanentMultiplier: number; // multiplies base production (persists)
  prerequisite: Requirement | null; // gating
}

/** A long-term goal themed on lise GmbH credentials. */
export interface Milestone {
  id: string;
  name: string; // e.g. "ISO 9001 Certified"
  requirement: Requirement; // what earns it
  reward: Reward; // granted when earned
}

/** A burner content definition (referenced by BurnerState.definitionId). */
export interface Burner {
  id: string;
  name: string;
  fuelCostToActivate: string; // big-number string (AI tokens to start)
  burnRate: string; // big-number string (tokens consumed / sec)
  productionMultiplier: number; // LOC/sec × while active
}

// ── Aggregates ───────────────────────────────────────────────────────────

/** Validated, typed game content (the output of loadContent in content.ts). */
export interface ContentCatalog {
  schemaVersion: number;
  contentVersion: string;
  producers: Producer[];
  upgrades: Upgrade[];
  trainings: Training[];
  milestones: Milestone[];
  burners: Burner[];
}

/**
 * The raw envelope shape received over the wire (contracts §2 GET /api/v1/content)
 * BEFORE validation/type-narrowing by loadContent. Array elements are `unknown`
 * until the loader validates and narrows them.
 */
export interface ContentEnvelope {
  schemaVersion: number;
  contentVersion: string;
  producers: unknown[];
  upgrades: unknown[];
  trainings: unknown[];
  milestones: unknown[];
  burners: unknown[];
}
