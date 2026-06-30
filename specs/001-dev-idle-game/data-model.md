# Data Model: Lise Dev Idle Game

**Feature**: 001-dev-idle-game
**Date**: 2026-06-30

The authoritative simulation is a single pure, deterministic function
`advance(state, dt) -> state` (see research.md). This document defines the
shape of that state and the persisted content. All monetary/resource fields
are **big numbers** — serialized as strings, never `double`.

## Entity Overview

```text
┌─────────────────────────────────────────────────────┐
│ GameState  (the saveable, advanceable root)         │
│  ├── resources: ResourceSet                         │
│  │     ├── loc      (Lines of Code — primary)       │
│  │     ├── cash     (spendable)                     │
│  │     └── aiTokens (accelerator fuel)              │
│  ├── ownedProducers:  Set<producerId>               │
│  ├── ownedUpgrades:   Set<upgradeId>                │
│  ├── ownedTrainings:  Set<trainingId>               │
│  ├── activeBurner:    BurnerState | null            │
│  ├── earnedMilestones:Set<milestoneId>              │
│  ├── lastAdvancedAt:  ISO-8601 timestamp (UTC)      │
│  ├── schemaVersion:   integer (for migrations)      │
│  └── settings:        PlayerSettings                │
└─────────────────────────────────────────────────────┘

Content (versioned JSON, served by backend, NOT in the save):
  Producer, Upgrade, Training, Milestone
```

## Entities

### GameState
The complete saveable snapshot. This is the **only** thing persisted and
the only input/output of `advance`.

| Field | Type | Notes |
|-------|------|-------|
| `resources` | ResourceSet | current resource totals (big numbers) |
| `ownedProducers` | `Set<string>` | ids of producers the player owns |
| `ownedUpgrades` | `Set<string>` | ids of upgrades owned |
| `ownedTrainings` | `Set<string>` | ids of trainings owned |
| `activeBurner` | `BurnerState \| null` | active token-burner, else null |
| `earnedMilestones` | `Set<string>` | ids of milestones reached |
| `lastAdvancedAt` | `string` (ISO-8601 UTC) | when state was last advanced |
| `schemaVersion` | `integer` | save format version for migrations |
| `settings` | `PlayerSettings` | UI prefs (not gameplay) |

**Invariant**: `lastAdvancedAt` is the clock anchor. On load, `advance(state,
now - lastAdvancedAt)` is called to honor offline progress (Constitution I).

### ResourceSet
| Field | Type | Notes |
|-------|------|-------|
| `loc` | BigNumber (string) | Lines of Code produced |
| `cash` | BigNumber (string) | spendable currency |
| `aiTokens` | BigNumber (string) | fuel consumed by the burner |

**Invariant**: all three are non-negative and monotonic over `advance` for a
given ownership set (production only adds; spending happens via explicit
player actions, not via `advance`).

### BurnerState
Represents an active AI-token burner.

| Field | Type | Notes |
|-------|------|-------|
| `definitionId` | `string` | references a Burner content def |
| `startedAt` | `string` (ISO-8601) | when activated |
| `fuelRemaining` | BigNumber (string) | tokens left to burn |

**State transition**: `advance` consumes fuel at the burner's rate while
active, applying its production multiplier. When `fuelRemaining` hits 0,
`advance` sets `activeBurner = null` and drops the multiplier.

### PlayerSettings
| Field | Type | Notes |
|-------|------|-------|
| `reducedMotion` | `boolean` | accessibility |
| `muted` | `boolean` | audio |

## Content entities (versioned JSON data, NOT in the save)

These are **data**, not state. They live in the repo, are served by the
backend, and are read by the pure sim (Constitution Principle II).

### Producer
A source of LOC/sec (themed dev activity tiers).

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique, e.g. `"manual_typing"` |
| `name` | `string` | display name |
| `description` | `string` | flavor |
| `baseRate` | BigNumber | LOC/sec granted when owned |
| `cost` | Cost | purchase cost |
| `costGrowth` | `number` | cost multiplier per purchase (e.g. 1.15) |
| `unlockRequirement` | `Requirement \| null` | gating |

Example tier ladder (lise-themed):
`manual_typing` → `stack_overflow` → `copilot` → `autonomous_agent`.

### Upgrade
A purchasable multiplier or modifier.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | display name |
| `cost` | Cost | purchase cost |
| `effect` | Effect | what it changes |
| `prerequisite` | `Requirement \| null` | gating |

### Training (lise Academy)
A permanent boost. Once bought, always applies.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | display name |
| `description` | `string` | flavor (lise Academy course) |
| `cost` | Cost | purchase cost |
| `permanentMultiplier` | `number` | multiplies base production |
| `prerequisite` | `Requirement \| null` | gating |

### Milestone
A long-term goal themed on lise GmbH credentials.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | e.g. "ISO 9001 Certified" |
| `requirement` | `Requirement` | what earns it |
| `reward` | `Reward` | granted when earned |

### Burner (content definition)
Referenced by `BurnerState.definitionId`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | display name |
| `fuelCostToActivate` | BigNumber | AI tokens to start |
| `burnRate` | BigNumber | tokens consumed / sec |
| `productionMultiplier` | `number` | LOC/sec × while active |

## Shared value types

### Cost
A cost to purchase something.

| Field | Type | Notes |
|-------|------|-------|
| `resource` | `"cash" \| "aiTokens" \| "loc"` | what it costs |
| `amount` | BigNumber | how much |

### Requirement
A predicate gating an unlock / milestone.

| Field | Type | Notes |
|-------|------|-------|
| `type` | `"resourceGte" \| "ownsProducer" \| "ownsUpgrade" \| "ownsTraining" \| "ownsMilestone"` | |
| `targetId` | `string \| null` | id ref for owns-* types |
| `threshold` | BigNumber \| null | for `resourceGte` |

### Effect / Reward
Polymorphic modifiers applied by `advance` / on milestone earn. Examples:
`globalMultiplier`, `producerRateMultiplier`, `grantResource`. Exact shapes
defined in contracts/ alongside `advance`.

## State transitions (the only mutator: `advance`)

`advance(state, dt) -> state` is pure and applies, in order:

1. Compute `baseRate = Σ ownedProducer.baseRate`, scaled by owned upgrades
   and trainings.
2. If `activeBurner != null`: consume `min(burnRate*dt, fuelRemaining)`
   tokens; multiply rate by `productionMultiplier`; if fuel exhausted, set
   `activeBurner = null`.
3. Add `rate * dt` to `resources.loc`.
4. Check milestone requirements; append newly-earned ids to
   `earnedMilestones` and apply rewards.
5. Update `state.lastAdvancedAt = old + dt`.

Player actions (purchase, activate burner, cash out) are **not** part of
`advance` — they are discrete mutations applied on user input, then `advance`
catches up using `dt`. This keeps the sim pure and offline-correct.

## Save migration

`schemaVersion` enables forward-compatible saves. On load:
- If `save.schemaVersion < CURRENT`, run the migration chain in order.
- A migration MUST be total: produce a valid new-version state or fail
  safely, never partially mutate (Constitution IV — never wipe progress).
- Unknown future versions on an older client: refuse to load with a clear
  message rather than corrupt.
