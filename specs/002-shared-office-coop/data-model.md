# Data Model: Shared Office Co-op Presence

**Feature**: 002-shared-office-coop
**Date**: 2026-07-01

This feature is an **additive overlay** on the Spec 001 model (Constitution
Principle VI). The authoritative simulation remains the single pure,
deterministic function `advance(state, dt, content) -> state` defined in
Spec 001; this document restates the complete model and marks every 002
addition explicitly with **(002)**. Every Spec 001 entity, field, and
invariant is kept intact. All big-number fields are serialized as
**strings**, never `double`; all timestamps are **ISO-8601 UTC strings**
(see 001 data-model.md and 002 research.md).

> **Dependency callout — the 001 office/commute gap.** Spec 001's spec
> (FR-014/FR-016; Key Entities "Save State": *"the dev's active office and
> any in-progress commute timer"*) requires the save to carry the active
> office and commute state, but the current 001 data model and
> implementation (`frontend/src/sim/types.ts`) have **no such fields**, and
> no office-switch mechanic exists in code. 002's presence/co-op design
> consumes exactly this state (heartbeat body, co-op grouping key, commute
> rendering and suspension), so this feature **closes the gap in the same
> v1→v2 migration**: `GameState` gains `activeOffice` and `commute` below,
> the `switchOffice` mutator and `advance`'s commute resolution are part of
> this feature's workstream (plan.md), and the commute duration becomes
> content data (`CoopConfig.commuteSeconds`).

Three storage tiers exist after this feature, and only the first is ever
required to play:

1. **The save** (`GameState`) — local-first, client-authoritative,
   loadable and migratable with zero online capability.
2. **Server-side social entities** (002) — identity and presence, held by
   the backend, a **read-only overlay** for viewers (FR-008).
3. **Content & world data** — versioned, served/shipped data read by the
   sim and the renderer, never stored in the save (Principle II).

## Entity Overview

```text
┌────────────────────────────────────────────────────────────┐
│ GameState  (the saveable, advanceable root — Spec 001)     │
│  ├── resources: ResourceSet                                │
│  │     ├── loc      (Lines of Code — primary)              │
│  │     ├── cash     (spendable)                            │
│  │     └── aiTokens (accelerator fuel)                     │
│  ├── ownedProducers:  Set<producerId>                      │
│  ├── ownedUpgrades:   Set<upgradeId>                       │
│  ├── ownedTrainings:  Set<trainingId>                      │
│  ├── activeBurner:    BurnerState | null                   │
│  ├── earnedMilestones:Set<milestoneId>                     │
│  ├── lastAdvancedAt:  ISO-8601 timestamp (UTC)             │
│  ├── schemaVersion:   integer (bumps 1 → 2 here)           │
│  ├── settings:        PlayerSettings                       │
│  ├── activeOffice:    officeId                   ◄── (002) │
│  ├── commute:         CommuteState | null        ◄── (002) │
│  └── coopSegments:    CoopSegment[]              ◄── (002) │
└────────────────────────────────────────────────────────────┘

Server-side social entities (002) — server-authoritative, NOT in the save:
  PlayerIdentity ──1:1── PresenceRecord ──projected to──► Avatar
                                                (client render only)

Content (versioned JSON, served by backend, NOT in the save):
  Producer, Upgrade, Training, Milestone, Burner        (Spec 001)
  CoopConfig                                            (002)

World data (Tiled campus map, shipped frontend asset, NOT in the save):
  tile layers + object layers Rooms / SeatAnchors / CommutePaths  (002)
```

## Entities (the save)

### GameState *(Spec 001, extended by 002)*
The complete saveable snapshot. Still the **only** thing persisted per
player and the only input/output of `advance`.

| Field | Type | Notes |
|-------|------|-------|
| `resources` | ResourceSet | current resource totals (big numbers) |
| `ownedProducers` | `Set<string>` | ids of producers the player owns |
| `ownedUpgrades` | `Set<string>` | ids of upgrades owned |
| `ownedTrainings` | `Set<string>` | ids of trainings owned |
| `activeBurner` | `BurnerState \| null` | active token-burner, else null |
| `earnedMilestones` | `Set<string>` | ids of milestones reached |
| `lastAdvancedAt` | `string` (ISO-8601 UTC) | when state was last advanced |
| `schemaVersion` | `integer` | save format version; **1 → 2** (002) |
| `settings` | `PlayerSettings` | UI prefs (not gameplay) |
| `activeOffice` | `string` (office id) | **(002, closes 001 FR-014/016 gap)** the dev's active office; default `"office_1"` |
| `commute` | `CommuteState \| null` | **(002, closes 001 FR-016 gap)** in-progress commute, else `null`; default `null` |
| `coopSegments` | `CoopSegment[]` | **(002)** server-issued co-op lease segments; default `[]` |

**Invariant (Spec 001, unchanged)**: `lastAdvancedAt` is the clock anchor.
On load, `advance(state, now - lastAdvancedAt)` honors offline progress
(Constitution I).

**Invariant (002)**: `coopSegments` contains only **closed,
server-authored** segments (see CoopSegment). An empty array is the
baseline: a save that has never been online behaves byte-identically to
Spec 001. Loading, migrating, and playing a save MUST NEVER require the
online overlay (Principle VI). Compaction inside `advance` keeps the array
bounded. Merge rule (server, `StateMerger`): **union keyed by `from`,
taking `max(until)` AND `max(multiplier)`** — deterministic and
conflict-free like the existing max/union rules, and **identical by
contract to the client-side `applyCoopPresence` upsert rule**
(contracts §1) so client merge and server merge cannot disagree; because
segment multipliers are ≥ 1, resources stay monotonic under `advance` and
the Spec 001 per-field max merge stays sound. `activeOffice` and `commute`
merge **as a pair from whichever input state has the later
`lastAdvancedAt`** (client copy on a tie) — deterministic, and consistent
with the sim owning that state.

### CommuteState *(002 — new; implements 001 FR-016's saved commute)*
The in-progress office switch, part of the save so it resolves from
elapsed time on load (001 spec: "Closing the game mid-commute: on return,
the commute resolves from elapsed" time).

| Field | Type | Notes |
|-------|------|-------|
| `fromOffice` | `string` | origin office id |
| `toOffice` | `string` | destination office id |
| `startedAt` | `string` (ISO-8601 UTC) | **sim-timeline** timestamp written by the `switchOffice` mutator from `lastAdvancedAt` — never wall clock, never sent in the heartbeat body (the server stamps its own transition time for observers; contracts §3) |

**Invariants**: while `commute != null` the dev is present in **no**
office (`activeOffice` still holds the origin, but the heartbeat reports
`office: null` and the co-op bonus is suspended — spec edge case).
`advance` resolves the commute when the timeline reaches
`startedAt + CoopConfig.commuteSeconds`: `activeOffice := toOffice`,
`commute := null` — a pure function of state + content. Commutes do not
affect production (001: producers keep producing in both offices) and add
no rate split point.

### ResourceSet *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `loc` | BigNumber (string) | Lines of Code produced |
| `cash` | BigNumber (string) | spendable currency |
| `aiTokens` | BigNumber (string) | fuel consumed by the burner |

**Invariant**: all three are non-negative and monotonic over `advance` for
a given ownership set. The co-op multiplier is ≥ 1, so 002 preserves this
(production only adds; spending happens via explicit player actions).

### BurnerState *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `definitionId` | `string` | references a Burner content def |
| `startedAt` | `string` (ISO-8601) | when activated |
| `fuelRemaining` | BigNumber (string) | tokens left to burn |

**State transition (unchanged)**: `advance` consumes fuel at the burner's
rate while active, applying its production multiplier; on exhaustion it
sets `activeBurner = null`. **(002 note)**: the co-op lease multiplier
applies to **production only, never to `burnRate`** — fuel burn stays
linear across segment boundaries, preserving the 001 two-segment closed
form and its associativity argument.

### PlayerSettings *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `reducedMotion` | `boolean` | accessibility |
| `muted` | `boolean` | audio |

**(002 note)**: the visibility/consent setting (FR-003) is deliberately
NOT stored here. It lives server-side on PlayerIdentity, because the save
MUST load and play without any online capability and the server must be
able to filter hidden colleagues without reading anyone's save (FR-009).
This **intentionally supersedes** spec.md's Key Entities wording ("Save
State (extended) … carrying the player's visibility/consent setting"):
storing consent in a client-authoritative save would let a tampered save
flip visibility and would force the server to read saves to filter hidden
colleagues. This paragraph is the authoritative statement; the spec's Key
Entities entry should be amended to reference it.

### CoopSegment *(002 — new)*
A **closed, server-timestamped lease segment**: the only channel through
which presence affects the simulation (FR-012, Constitution Principles I
and VI). Stored inside `GameState.coopSegments`.

| Field | Type | Notes |
|-------|------|-------|
| `from` | `string` (ISO-8601 UTC) | segment start, **server clock** |
| `until` | `string` (ISO-8601 UTC) | bounded lease end, **server clock** |
| `multiplier` | `number` | production multiplier, `1 ≤ m ≤ CoopConfig.maxMultiplier` |

**Invariants**:

- **Closed lease**: `until` is always concrete. Each presence heartbeat the
  server confirms extends `until` by `CoopConfig.leaseSeconds`; it is never
  open-ended. No heartbeat → the lease lapses; there is no "colleague left"
  close event to miss (fail-safe for FR-013).
- **Server-authored**: the client never writes segment times; it only
  merges server-issued segments into its save at the established safe
  mutation points. A skewed client clock can shift where a segment
  overlaps the local timeline but can never grow the covered duration
  (clock-skew edge case; see research.md).
- **Clipped on integration**: `advance` clips each segment to
  `[lastAdvancedAt, lastAdvancedAt + dt]`; any span not covered by a
  segment integrates at multiplier 1 (baseline). Offline spans send no
  heartbeats, are covered by no segment, and therefore compute at baseline
  with no special offline branch (FR-013).
- **Capped twice**: the server issues multipliers already capped at
  `maxMultiplier`; `advance` clamps against the content cap again when
  integrating — defense in depth against a tampered save (FR-011).
- **Compacted**: segments with `until <= lastAdvancedAt` are fully
  integrated and are pruned during `advance`; pruning is idempotent and
  expired segments contribute nothing, so state stays bounded and
  associativity is preserved.
- **Bounded acceptance**: `applyCoopPresence(state, segment, content)`
  drops any segment whose `from` lies more than one lease beyond the
  sim's now (`from > lastAdvancedAt + content.coop.leaseSeconds` — the
  content catalog is a parameter of the mutator precisely so this horizon
  is readable) — a correct server never issues one, and accepting it
  would park a never-compacted segment in the save (unbounded-growth
  hole; contracts §1).

## Server-side social entities (002 — NOT in the save)

These live on the backend only (in-memory live registry plus one durable
row per colleague — see research.md, "Presence storage"). They are a
**read-only overlay** for everyone but their owner (FR-008): no viewer,
and no server code path, uses them to mutate any player's save or sim.

### PlayerIdentity *(002 — new)*
A stable, authenticated lise colleague identity (FR-001), established via
OIDC sign-in against Keycloak realm `LiseIdler` (research.md, "Identity &
authentication provider").

| Field | Type | Notes |
|-------|------|-------|
| `colleagueId` | `string` | the Keycloak `sub` claim (a stable UUID) — the stable social key |
| `displayName` | `string` | from the **access token's** `name`/`preferred_username` claims, captured and refreshed on each authenticated request — a pure resource server sees no sign-in event; the first authenticated write creates the `player_presence` row (contracts §2: the SPA requests scope `openid profile`, the client's protocol mappers put the claims in the access token); what colleagues see (FR-004) |
| `avatarId` | `string` | **assigned** avatar sprite id — deterministic default derived from a stable hash of `colleagueId` onto the avatar frame set; no avatar picker is in scope for 002 (selection would add `avatarId` to `PUT /api/v1/presence/settings`) |
| `visibility` | `"visible" \| "hidden"` | appear/hide toggle, changeable anytime (FR-003) |
| `consentAt` | `string` (ISO-8601) `\| null` | first-login consent timestamp; `null` = not yet consented |

**Invariants**: only `colleagueId` (the opaque IdP subject UUID — a
technical key carrying no personal data; safe to expose only under the
contracts §2 identity-bound ownership rule), `displayName`, `avatarId`,
and in-game status (office, activity, commute state, live/last-seen,
lastSeenAt) are ever exposed to other players —
no private or sensitive personal data (FR-004). A player whose
`visibility` is `"hidden"` (or whose `consentAt` is `null`) is filtered
server-side out of both the presence snapshot and the broadcast, and is
excluded from every other player's co-op computation (FR-009).
Unauthenticated players have no PlayerIdentity at all and play the full
Spec 001 experience (FR-002).

### PresenceRecord *(002 — new)*
Per colleague — where they are and whether they are live. Keyed by
`colleagueId`, which is what makes duplicate-session collapse structural.

| Field | Type | Notes |
|-------|------|-------|
| `colleagueId` | `string` | key; references PlayerIdentity |
| `office` | `string \| null` | office id the colleague is (or was last) present in; **`null` while commuting** (matches the wire shape, contracts §2/§3) |
| `activity` | `string` | current or last-known activity label (client-derived display label, contracts §3) |
| `commute` | `{ fromOffice, toOffice, startedAt } \| null` | set while commuting (FR-007); `startedAt` is **server-stamped on the first heartbeat reporting the transition** — never a client timestamp — and lets observers render route progress against `CoopConfig.commuteSeconds` (FR-022) |
| `liveOrLastSeen` | `"live" \| "lastSeen"` | drives green vs red avatar state (FR-023); serialized as `status`: `"live" \| "last_seen"` on the wire (contracts §2) |
| `lastSeenAt` | `string` (ISO-8601) | server-stamped on every heartbeat / on expiry |
| `leaseExpiresAt` | `string` (ISO-8601) | live tier only: last accepted heartbeat + `leaseSeconds` |

**Lease expiry semantics**: a client heartbeats every
`CoopConfig.heartbeatSeconds` (~20 s); each accepted heartbeat sets
`leaseExpiresAt = serverNow + leaseSeconds` (~60 s). A scheduled server
sweep expires any record past its lease: **live → lastSeen**, flushing
`lastSeenAt` to the durable row and broadcasting the delta. Live records
are ephemeral (in-memory); after a backend restart every connected client
re-heartbeats within one interval and the live tier rebuilds itself. The
durable last-seen row is what renders offline colleagues "idle at their
desk" (FR-006).

**Retention & offboarding (002)**: a durable last-seen row is rendered
only while `lastSeenAt` is within `CoopConfig.lastSeenRetentionDays`
(tunable content data; placeholder 14). Rows older than the window are
filtered out of the snapshot and broadcasts and deleted by a daily sweep —
colleagues do not render as red avatars forever. This window is also the
**offboarding path**: a disabled/removed Keycloak account simply stops
heartbeating and ages out of the world within the window, with no
Keycloak-side integration required (FR-004 privacy; research "Presence
storage"). It also bounds the rendered last-seen population that the
SeatAnchors capacity below must absorb.

### Avatar *(002 — client projection, not an entity of record)*
The in-world representation of a colleague. A **pure projection** of
(PlayerIdentity, PresenceRecord) onto the campus world data — computed by
the renderer, never persisted, never sent back, and carrying **no
authority** over any player's state (spec Key Entities; FR-008).

| Field | Type | Notes |
|-------|------|-------|
| `colleagueId` | `string` | from PresenceRecord |
| `label` | `string` | `displayName` — rendered persistently at or above the label-zoom threshold, on tap/hover below it (FR-005 with the FR-024 legibility rule; research "Art direction") |
| `spriteId` | `string` | from `avatarId` |
| `stateStyle` | `"live" \| "lastSeen"` | green vs red/desaturated styling (FR-023) |
| `activityIcon` | `string` | derived from `activity` |
| `position` | seat anchor `\|` commute-path progress | resolved from world data (below); overflow → standing spot |

## Content entities (versioned JSON data, NOT in the save)

These are **data**, not state (Constitution Principle II). The five
Spec 001 content entities are **unchanged**; 002 adds a sixth, additive
entry to the same served envelope (existing arrays, `schemaVersion`,
`contentVersion`, and per-version immutability untouched).

### Producer *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique, e.g. `"manual_typing"` |
| `name` | `string` | display name |
| `description` | `string` | flavor |
| `baseRate` | BigNumber | LOC/sec granted when owned |
| `cost` | Cost | purchase cost |
| `costGrowth` | `number` | cost multiplier per purchase |
| `unlockRequirement` | `Requirement \| null` | gating |

### Upgrade *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | display name |
| `cost` | Cost | purchase cost |
| `effect` | Effect | what it changes |
| `prerequisite` | `Requirement \| null` | gating |

### Training *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | display name |
| `description` | `string` | flavor (lise Academy course) |
| `cost` | Cost | purchase cost |
| `permanentMultiplier` | `number` | multiplies base production |
| `prerequisite` | `Requirement \| null` | gating |

### Milestone *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | e.g. "ISO 9001 Certified" |
| `requirement` | `Requirement` | what earns it |
| `reward` | `Reward` | granted when earned |

### Burner *(Spec 001, unchanged)*
| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | unique |
| `name` | `string` | display name |
| `fuelCostToActivate` | BigNumber | AI tokens to start |
| `burnRate` | BigNumber | tokens consumed / sec |
| `productionMultiplier` | `number` | LOC/sec × while active |

### CoopConfig *(002 — new)*
Co-op bonus tuning: magnitude, cap, and lease timing as **tunable content
data** (FR-015, Principle II; Principle VI's bounded-tunable requirement).
A single object (`coop.json`), also mirrored into the bundled fallback
content so an offline-booting client holds identical values.

| Field | Type | Notes |
|-------|------|-------|
| `perColleagueMultiplier` | `number` | bonus per distinct present colleague, additive before capping |
| `maxMultiplier` | `number` | hard cap on the total multiplier (FR-011) |
| `leaseSeconds` | `number` | how far each heartbeat extends a lease / presence TTL |
| `heartbeatSeconds` | `number` | client heartbeat interval |
| `commuteSeconds` | `number` | **(002)** duration of an office-switch commute (001 FR-016); consumed by `advance`'s commute resolution and by observers rendering route progress — kept in this block rather than a new content entry (the only 002 content block) |
| `lastSeenRetentionDays` | `number` | rendering/retention window for durable last-seen rows (see PresenceRecord) |

Placeholder values, to be tuned during balancing (research.md):

```json
{
  "perColleagueMultiplier": 0.10,
  "maxMultiplier": 1.5,
  "leaseSeconds": 60,
  "heartbeatSeconds": 20,
  "commuteSeconds": 30,
  "lastSeenRetentionDays": 14
}
```

The server derives each issued segment's multiplier as
`min(1 + n × perColleagueMultiplier, maxMultiplier)`, where `n` is the
number of **distinct, visible** colleagueIds present in the player's
active office, self excluded (FR-010, FR-011, FR-014).

## World data (002 — Tiled campus map, shipped asset, NOT in the save)

The shared world is **data-authored** map content, not code and not save
state: one orthogonal Tiled map containing both lise buildings (preserved
footprints and named rooms — corkscrew, spiderweb, skier, frog, bongo,
bridge, deco-office-chair, the Offices, both circulation cores) and the
streets between them as the visible commute route (FR-020). Tilesets are
embedded in the export; base tile 16×16 CC0 art (research.md).

| Layer | Kind | Notes |
|-------|------|-------|
| ground / streets / floors / furniture | tile layers | draw-ordered visual world; exact set fixed during authoring |
| `Rooms` | object layer (named polygons) | one per named space; drives room labels and presence grouping |
| `SeatAnchors` | object layer (points) | desk/seat positions avatars snap to; each tagged with its building |
| `CommutePaths` | object layer (polylines) | routes between the building entrances that commuting avatars travel (FR-022) |

**Seat capacity invariant (FR-021)**: each building MUST author clearly
more SeatAnchors than its **expected rendered population** — peak live
crowd (design target ~30 concurrent) **plus** the last-seen avatars
retained within `CoopConfig.lastSeenRetentionDays` (the retention window
is what bounds the last-seen population; see PresenceRecord). Authoring
targets (placeholders, finalized during Tiled authoring — research.md
open item): Office #1 ≥ **20** anchors against a peak live share of ~10;
Office #2, which carries the greater share, ≥ **40** anchors against a
peak live share of ~20 — ≥ 60 total. If the retained last-seen population
approaches anchor counts, either the retention window is shortened (a
content-only tune) or anchor counts grow in Tiled — last-seen colleagues
render seated ("idle at their desk", FR-006) and must not be pushed into
permanent standing overflow. Live presence beyond authored anchors
degrades to standing/roaming spots rather than hiding colleagues or
stacking them illegibly (spec edge cases "peak crowd" / "more colleagues
than seats").

**Visibility vs unlock (002)**: the campus map always renders **both**
buildings and **all** visible presence, regardless of the viewer's own
Spec 001 unlock state. The Office #2 unlock (Spec 001 FR-014) gates only
the viewer's **own** producers, slots, and office switching; presence
rendering reads no unlock state, and seeing colleagues in a locked
building neither unlocks it nor changes the viewer's milestones (spec
edge case "colleague present in an office the viewer has not unlocked";
validated in quickstart Scenario 7).

## Shared value types *(Spec 001, unchanged)*

### Cost
| Field | Type | Notes |
|-------|------|-------|
| `resource` | `"cash" \| "aiTokens" \| "loc"` | what it costs |
| `amount` | BigNumber | how much |

### Requirement
| Field | Type | Notes |
|-------|------|-------|
| `type` | `"resourceGte" \| "ownsProducer" \| "ownsUpgrade" \| "ownsTraining" \| "ownsMilestone"` | |
| `targetId` | `string \| null` | id ref for owns-* types |
| `threshold` | BigNumber \| null | for `resourceGte` |

### Effect / Reward
Polymorphic modifiers applied by `advance` / on milestone earn:
`globalMultiplier`, `producerRateMultiplier`, `grantResource`. Unchanged
by 002 — the co-op bonus is deliberately NOT an Effect: it is time-bounded
per-player input (CoopSegment), not owned content, so it never enters the
ownership-derived rate stack.

## State transitions

### The sim mutator: `advance` *(Spec 001 order, extended by 002)*

`advance(state, dt, content) -> state` is pure and applies, in order:

1. **(002)** Resolve an in-progress commute: if `commute != null` and
   `commute.startedAt + content.coop.commuteSeconds` falls at or before
   `lastAdvancedAt + dt`, set `activeOffice = commute.toOffice` and
   `commute = null` (001 FR-016: resolved from elapsed time — works
   across offline spans). Commutes do not affect production and add no
   rate split point.
2. **(002)** Prune fully-integrated coopSegments
   (`until <= lastAdvancedAt`) — idempotent compaction.
3. **(002)** Split the interval `[lastAdvancedAt, lastAdvancedAt + dt]` at
   every remaining segment boundary (clipped to the interval) **and** at
   the Spec 001 burner fuel-exhaustion point. All split points are pure
   functions of state — never wall clock.
4. Per sub-interval `i`: compute `rate_i` exactly as in Spec 001 (base
   rate scaled by upgrades/trainings; burner multiplier and fuel
   consumption while fuel lasts, fuel burn unaffected by lease
   multipliers), then apply the covering segment's multiplier (clamped to
   `CoopConfig.maxMultiplier`) or 1 where uncovered:
   `gain = Σ rate_i × multiplier_i × len_i`.
5. Add `gain` to `resources.loc`.
6. Check milestone requirements after the total gain (single pass, as in
   Spec 001); append newly-earned ids and apply rewards.
7. Update `state.lastAdvancedAt = old + dt`.

With `coopSegments = []` and `commute = null`, the steps reduce exactly
to the Spec 001 transitions. The 001 associativity invariant
`advance(advance(s, a), b) == advance(s, a + b)` is preserved: gain is
linear within each sub-interval and every split point derives from state
(research.md carries the full argument, including the inherited ULP caveat
at the fuel-exhaustion boundary).

Player actions (purchase, activate burner, cash out, and **(002)** the
new `switchOffice` mutator that starts a commute — `commute :=
{ fromOffice: activeOffice, toOffice, startedAt: lastAdvancedAt }`,
landing 001 FR-016) remain **not** part of `advance`. **(002)** Merging
server-issued segments into the save is likewise a discrete state
assignment at the established safe mutation points — `advance` then
integrates whatever segments the state contains.

### Presence lifecycle *(002 — server-side; never touches any save)*

- **live → lastSeen (lease expiry)**: no accepted heartbeat for
  `leaseSeconds` → the sweep expires the record, stamps `lastSeenAt`,
  persists the durable row, and broadcasts the delta; observers see the
  avatar transition smoothly to last-seen (no pop, no error).
- **lastSeen → live**: any accepted heartbeat after sign-in/reconnect.
- **hide**: `visibility := "hidden"` → the colleague is immediately
  filtered from snapshot and broadcast and stops contributing to every
  other player's co-op computation (FR-009, SC-006): the server
  **proactively pushes recomputed downgrade segments**
  (`from = serverTime`) to every affected colleague in that office — the
  stop does not wait for their next heartbeat or lease expiry (contracts
  §3 "Multiplier changes"); their own play is unaffected.
- **show**: `visibility := "visible"` → reappears on the next broadcast
  and contributes again.
- **Duplicate-session collapse**: presence is keyed by `colleagueId`;
  any number of concurrent sessions refresh the **same** record, and a
  colleague goes lastSeen only when **all** sessions stop heartbeating
  (max-of-heartbeats). One entry per colleague in every payload — no ghost
  avatars, no double-counting toward anyone's bonus.
- **Commute**: switching the active office (Spec 001 FR-016 — the
  `switchOffice` sim mutator, see CommuteState) is reported by the next
  heartbeat; the server sets `office = null` and
  `commute = { fromOffice, toOffice, startedAt }` with `startedAt`
  **server-stamped on that first commuting heartbeat**; observers render
  the avatar traveling the `CommutePaths` route with progress computed
  against `CoopConfig.commuteSeconds` (FR-022, SC-010); arrival clears
  `commute` and sets `office = toOffice`. While commuting, the colleague
  is present in **no** office: they contribute to no one's co-op bonus and
  their own bonus is suspended (spec edge case "co-op bonus during a
  commute").

## Save migration

`schemaVersion` bumps **1 → 2**. The migration is **additive**:

- v1 → v2 defaults `coopSegments: []`, `activeOffice: "office_1"`, and
  `commute: null` (baseline) and changes nothing else. Structural
  validation on load treats the missing fields leniently (defaults them
  before the migration chain runs), so every existing v1 save stays
  loadable — the online overlay is never required to load or migrate a
  single-player save (spec Key Entities "Save State").
- The same leniency applies **on the backend**: a persisted
  (`player_state.state_json`) or incoming `GameState` with absent/`null`
  `coopSegments` is read as `[]`, and absent `activeOffice`/`commute`
  default to `"office_1"`/`null` (normalized in
  `PlayerStateService`/`StateMerger`) — otherwise the segment-union merge
  would NPE on the first sync of any pre-existing player and
  `POST /api/v1/session` would return `coopSegments: null` to a v2
  client.
- The new fields ride the existing wire mappings: the private
  `WireGameState` in `restClient.ts`/`stompClient.ts` and the backend
  `GameState.java` record all gain `coopSegments`, `activeOffice`, and
  `commute`; `StateMerger` applies the rules stated under the GameState
  invariant above.
- A migration MUST be total: produce a valid new-version state or fail
  safely, never partially mutate (Constitution IV — never wipe progress).
- Unknown future versions on an older client: refuse to load with a clear
  message rather than corrupt (unchanged 001 rule). The server keeps the
  Spec 001 posture of rejecting a newer `schemaVersion` (409); the backend
  schema bump lands first, and until it does the best-effort sync fails
  harmlessly while local play continues.
- An empty `coopSegments` array is behaviorally identical to Spec 001
  everywhere — save round-trips (save → load → save) remain lossless with
  the new field included.
