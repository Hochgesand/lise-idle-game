# Research: Living Campus — Player Character, Activities on the Map, Visible Timed Jobs

**Feature**: `003-living-campus` | **Date**: 2026-07-02 | **Spec**: [spec.md](spec.md)

Phase 0 output. Each decision below is grounded in the code as it exists on
`main` after the 002 workstream (Phases 1–3 shipped; US1 partially landed) —
module references name real files.

## Decision Summary

| # | Topic | Decision |
|---|-------|----------|
| 1 | Player avatar data source | Pure local projection of the save (`activeOffice`, `commute`, walk, training) — never a presence echo |
| 2 | Player seat | Reserved deterministic anchor via an `assignSeats` extension (player claims first, colleagues fill the rest) |
| 3 | Walk model | Presentation-layer only: flat, data-driven duration; straight-line interpolation; wall clock allowed (it never touches the sim) |
| 4 | Timed trainings | `GameState.activeTraining` resolved by `advance` at `startedAt + durationSeconds` — the exact commute-resolution pattern from 002 |
| 5 | Station data | New Tiled object layer `Stations` in `campus.json` + a `world` content block (`world.json`) for tuning scalars |
| 6 | On-demand panels | Extend the existing `OverlaySection` machinery with a panel-manager open/close state; sections already collapse on `render() → null` |
| 7 | Find-me camera | Reuse `bootCamera`/`clampToMap` math centered on the avatar's interpolated position at a fixed readable zoom |
| 8 | Save schema | v2 → v3, additive (`activeTraining: null`), backend passthrough via the existing session sync — no new endpoints |

---

## Decision 1: Where does the player avatar come from?

### Decision

The player avatar is a **pure local projection of the player's own save
state**, rendered by a new `frontend/src/scenes/world/player.ts` layer next to
(not inside) the 002 `AvatarLayer` (`frontend/src/scenes/world/avatars.ts`):

- **Seat**: derived from `state.activeOffice` + the reserved seat anchor
  (Decision 2).
- **Commute**: derived from `state.commute` (`fromOffice`, `toOffice`,
  `startedAt` — sim-timeline ms, written by `switchOffice` in
  `frontend/src/sim/actions.ts`) interpolated along the same `CommutePaths`
  polyline math observers use (`commuterPosition` in
  `frontend/src/scenes/world/commute.ts`) against `coop.commuteSeconds`.
- **Walk** (US2): a presentation-layer `WalkIntent` (Decision 3).
- **Occupation** (US3): derived from `state.activeTraining` (Decision 4).
- **Label**: display name from the 002 identity (`/api/v1/me` model held by
  `restClient.ts`) when signed in; the literal "Du" otherwise. The label is a
  render input, never save state.

### Rationale

- FR-001/FR-023 demand full offline/signed-out function; only the local save
  is always available. The presence pipeline is authenticated, best-effort,
  and network-bound — wiring the player's own body to it would break the
  offline guarantee and violate the spec's Principle VI boundary ("this
  feature adds no online capability").
- Reusing `commuterPosition` for the player's own commute makes FR-004's
  "matches what observers see" property true by construction — one math
  module, two consumers.
- A separate `player.ts` layer (instead of injecting a fake presence into
  `AvatarLayer`) keeps the 002 presence contract untouched: `AvatarLayer`
  continues to render exactly the colleague set from the presence model, and
  the "duplicate self" bug class (player rendered twice: once local, once via
  their own presence echo) is handled where it belongs — the presence model
  already excludes `self` from the colleague list (`GET /api/v1/presence`
  returns `self` separately; contracts 002 §2).

### Alternatives considered

- **Echo the player through the presence model** (inject self as a synthetic
  PresenceRecord): breaks offline/signed-out rendering, couples the player's
  body to network freshness, and double-renders when signed in. Rejected.
- **Extend `AvatarLayer` with an `isSelf` flag**: workable, but mixes two data
  sources (presence vs save) inside one layer and complicates the 002 tests;
  a sibling layer that *reuses* the sprite/label building blocks is simpler
  (Principle V).

## Decision 2: Player seat reservation

### Decision

Extend the pure seat assignment (`assignSeats` in
`frontend/src/scenes/world/seats.ts`) with an optional **reserved-anchor**
input: the player's seat is the **first anchor of the active office in the
existing stable ordering** (`(y, x)` sort — top-left first), and colleague
assignment proceeds over the remaining anchors exactly as today. The function
stays pure and Phaser-free; the reservation is a parameter, not hidden state.

### Rationale

- FR-003 needs "never overlap, at any crowd size" — making the reservation
  part of the same pure function as the colleague assignment makes the
  invariant provable in one unit test file (`seats.test.ts`), not an emergent
  property of two independent systems.
- "First anchor in stable order" is deterministic across sessions, devices,
  and reloads with zero new data. A dedicated `player: true` anchor property
  in the map was considered (nicer authoring control) and remains open as
  content polish; the ordering rule is the behavior-defining default so the
  feature never depends on map edits.
- Colleague capacity drops by exactly one anchor per building; the 002
  capacity invariant (≥ 20 / ≥ 40 anchors, FR-021 of 002) has ample slack.

### Alternatives considered

- **Player uses the overflow/standing spots**: makes the *player* the least
  legible figure on the map — inverted priorities. Rejected.
- **Collision-avoidance at render time** (nudge whoever collides):
  non-deterministic-feeling, breaks the "colleague k takes anchor k" 002
  contract, harder to test. Rejected.

## Decision 3: Walk model (US2)

### Decision

Walking is **pure presentation** owned by the world layer:

- A `WalkIntent { targetStation, fromX, fromY, startedAtMs }` lives in the
  scene (never in `GameState`, never serialized).
- Position = linear interpolation from start position to station anchor over
  `world.walkSeconds` (content data, default ~2 s). Straight line; no
  pathfinding (spec assumption "walk may take a simple deterministic path").
- The intent's clock is the **wall clock** (`performance.now()`/RAF time) —
  explicitly allowed because the sim never reads it: on arrival the only
  effect is `overlay.openPanel(station.panel)`. The sim action still happens
  only when the player acts inside the panel, via the unchanged Spec 001
  mutators (`frontend/src/sim/actions.ts`).
- Retarget rule (FR-011): a new tap replaces the intent (new start = current
  interpolated position); an office switch clears it. Reduced motion
  (FR-012): intent resolves immediately.

### Rationale

- Constitution "Determinism over real-time" forbids wall-clock APIs *feeding
  the simulation*. A walk that only schedules a DOM panel-open is UI
  choreography, same class as the 002 boost float-text animation. Keeping
  `WalkIntent` out of `GameState` makes the boundary structural rather than
  disciplinary — there is nothing to leak.
- Flat duration (not path-length-proportional): predictable interaction cost,
  trivially testable, and tunable as one scalar (Principle II).
- This is the borderline item the plan records in Complexity Tracking: it is
  *not* a violation (the sim is untouched), but it is the first wall-clock
  animation that gates a user affordance (panel opening), so it deserves the
  paper trail.

### Alternatives considered

- **Model the walk in the sim** (a `walk` field like `commute`): maximal
  purity but pointless state — the walk has zero gameplay effect, would bloat
  the save, and would make every save written mid-walk differ. YAGNI
  (Principle V). Rejected.
- **Pathfinding along corridors**: visual polish disproportionate to value;
  new algorithmic surface; the straight-line walk over seconds reads fine at
  campus zoom. Rejected (revisit as polish if it ever bothers anyone).
- **No walk — tap opens panel instantly**: loses the entire "activities live
  in rooms" fantasy US2 exists for; the walk *is* the feature. Rejected.

## Decision 4: Timed trainings (US3) — the one sim change

### Decision

Mirror the 002 commute-resolution pattern exactly:

- `Training` (content) gains optional **`durationSeconds >= 0`** (absent/0 =
  instant Spec 001 behavior). Validated in `frontend/src/sim/content.ts`,
  mirrored in `fallbackContent.ts`, served from
  `backend/src/main/resources/content/trainings.json`.
- `GameState` gains **`activeTraining: { trainingId, startedAt } | null`**
  (`startedAt` = sim-timeline ms from `lastAdvancedAt`, exactly like
  `CommuteState.startedAt`).
- A new pure mutator **`startTraining`** in `frontend/src/sim/actions.ts`:
  deducts the cost immediately (unchanged affordability semantics), then
  sets `activeTraining` for nonzero durations or grants ownership instantly
  for zero durations. Throws if a training is already in progress.
  **`startTraining` supersedes the existing `purchaseTraining`** — the
  zero-duration branch *is* the old behavior, so `purchaseTraining` is
  replaced (removed, with its call sites in `frontend/src/main.ts` and the
  `onPurchaseTraining` wiring behind `frontend/src/ui/academyPanel.ts`
  repointed at `startTraining`); two overlapping mutators must not coexist.
- **`advance`** (`frontend/src/sim/advance.ts`) resolves completion at
  `startedAt + durationSeconds * 1000`: the interval is split at the
  completion boundary (the same piecewise machinery 002 added for coop
  segments and fuel exhaustion), `ownedTrainings` gains the id from that
  point, and the permanent multiplier affects only the post-completion
  sub-interval. Associativity (`advance(advance(s,a),b) === advance(s,a+b)`)
  must hold with an in-progress training — same property-test approach as
  T011 of 002.
- Save schema **v2 → v3** (additive migration defaulting
  `activeTraining: null`), backend `GameState.java` passthrough +
  `StateMerger` rule (pair with the later `lastAdvancedAt`, like
  `activeOffice`/`commute`), `CURRENT_SCHEMA_VERSION` 2 → 3 in
  `SessionController.java`. No new endpoints.

### Rationale

- Principle I: completion as a boundary inside piecewise `advance` keeps
  progression a pure function of state + elapsed time; offline completion
  (FR-018, SC-004) falls out for free — no special offline path.
- The commute precedent means the codebase already has every pattern this
  needs: sim-timeline `startedAt` (no `Date.now()`), boundary resolution in
  `advance`, additive migration, backend passthrough, merge rule. Lowest-risk
  shape for the only sim change in the feature.
- Cost-at-start / effect-at-completion (FR-017) is the CoC-familiar contract
  and avoids retroactive multiplier questions inside offline spans.
- One-at-a-time (FR-020) bounds state to a single nullable field — no queue,
  no array, no cancellation semantics (cancel/refund is out of scope; a
  duration is seconds-to-minutes, waiting is cheap).

### Alternatives considered

- **Derive completion from a purchase timestamp without new state** (e.g.
  reuse `ownedTrainings` + a timestamp map): ownership-with-delay semantics
  get murky (is it owned during the run?); a dedicated in-progress field is
  the honest model. Rejected.
- **Timed jobs as UI-only fake timers** (grant instantly, animate a bar):
  breaks FR-017/FR-018 (effect timing is gameplay-relevant), lies to the
  player, and desyncs with offline spans. Rejected.
- **Generic job-queue system** (N slots, arbitrary job types): YAGNI — US3
  needs exactly one training slot; burner runs already have their own state.
  Rejected (Principle V).

## Decision 5: Station data — map layer + `world` content block

### Decision

Two data surfaces, matching where each datum lives naturally:

- **Positions**: a new Tiled object layer **`Stations`** in
  `frontend/public/assets/campus.json` — point objects with custom properties
  `panel` (`academy` | `burner` | `cashout`) and `building` (`office_1` |
  `office_2`), using the exact property-array convention `SeatAnchors`
  already uses. Placement per spec's world-anchor table (skier, Break Room
  coffee points, Office / the executive Office). The **boost** station is not
  a map object — it *is* the player's reserved seat (Decision 2), resolved at
  runtime. A pure extraction module `frontend/src/scenes/world/stations.ts`
  mirrors `seats.ts` (`extractStations`, tolerant of missing layer → empty
  list, so the world never crashes on an older map).
- **Tuning**: a new content block **`world.json`** (an additive entry in the
  served envelope + fallback mirror, exactly like 002's `coop.json`):
  `{ "walkSeconds": 2 }` — plus training `durationSeconds` values living
  inside `trainings.json` entries where they belong.

### Rationale

- FR-007/FR-021 (Principle II): positions are world data → the map; scalars
  are balance data → content. Both editable without logic changes.
- The `SeatAnchors` conventions (property array form, building tags, pure
  extraction with lenient fallbacks) are proven by 002's tests — copying the
  shape means copying the test discipline too.
- Graceful degradation on a station-less map keeps 003's frontend deployable
  independently of map regeneration (the 002 T040 real-map task is still
  open; spec assumption "may still be placeholder art").

### Alternatives considered

- **Stations hardcoded as coordinates in TS**: violates Principle II, breaks
  the moment the real map lands with different room positions. Rejected.
- **Derive stations from `Rooms` polygons by name** (e.g. center of "skier"):
  clever but fragile (rooms are polygons; centers can land on walls or
  furniture) and gives no per-station `panel` binding for unnamed coffee
  points. An explicit point layer is one authoring step and fully general.
  Rejected.
- **Fold `walkSeconds` into `coop.json`**: wrong ownership — coop is the 002
  social tuning block; presentation/world tuning deserves its own file so
  social and world balance evolve independently. Rejected.

## Decision 6: On-demand panels (FR-014)

### Decision

Extend the existing overlay (`frontend/src/ui/overlay.ts`) with a small
**panel-manager** state: `openPanel(id)` / `closePanel()` / `getOpenPanel()`
on the `Overlay` handle, driving which registered `OverlaySection` renders.
Sections already fully collapse when `render()` returns `null` (the 002
hidden-panel-collapse contract + `.ui-panel:empty { display: none }`), so
on-demand behavior is: economy/academy sections return `null` unless they are
the open panel; the HUD section stays always-on (LOC counter, rate, co-op
badge, find-me button). A new `frontend/src/ui/menuPanel.ts` renders the
fallback list menu (FR-013): an always-reachable button opening a list of all
activities, each entry calling `openPanel(...)` directly — keyboard- and
screen-reader-accessible via the overlay's existing `click` fallback
delegation path.

### Rationale

- Zero new machinery: the null-render collapse and the `data-action`
  delegation bus were built for exactly this in 002 (T047); the panel manager
  is state + three methods, not a framework.
- Keeping HUD always-on preserves the idle-game glanceability (SC-001 needs
  find-me always reachable).
- The accessibility fallback rides the overlay's documented keyboard/`click`
  path — no parallel a11y system (Principle V).

### Alternatives considered

- **Routing/modal library**: absurd overkill for four panels (Principle V).
- **Keep the always-on stack and just add stations**: fails FR-014 and the
  phone-portrait experience the vision targets (panels-on-demand is what
  makes room for the world). Rejected.

## Decision 7: Find-me camera (FR-005)

### Decision

A HUD button that recenters the camera on the player avatar's **current
interpolated position** (seat, walk, or commute — one position accessor on
the player layer) at a fixed readable zoom (`FIND_ME_ZOOM`, tuned ≥ the 002
`LABEL_ZOOM_THRESHOLD` of 2.5 so the label is persistent when you land),
clamped by the existing `clampZoom`/`clampToMap` math
(`frontend/src/scenes/world/camera.ts`). With reduced motion: an instant jump;
otherwise a short camera glide (Phaser camera pan). Pure math (target
`CameraState` from viewport + avatar position) is unit-tested next to the
existing camera tests.

### Rationale

- `bootCamera`/`clampToMap` already encode fit/clamp; find-me is one more
  pure derivation over the same types — the cheapest possible implementation
  of SC-001.
- Landing above the label threshold guarantees the "clearly readable" clause
  of FR-005 without a new legibility rule.

### Alternatives considered

- **Always-on player marker at screen edge** (offscreen indicator arrow):
  nice-to-have, more render surface, not required by any FR. Deferred as
  polish. 
- **Auto-follow camera**: fights the pan/zoom freedom that defines the CoC
  feel. Rejected.

## Decision 8: Job progress indicators (US3)

### Decision

A pure derivation module `frontend/src/scenes/world/jobs.ts` computes the
set of visible job indicators from `(state, content, nowMs)`:

- Burner: `remainingFraction = fuelRemaining / fuelCostToActivate` — already
  derivable from `BurnerState` + content; drains via elapsed time exactly as
  `advance` burns it (read-only derivation, no new state; FR-015).
- Training: `progress = clamp((nowMs - startedAt) / (durationSeconds*1000))`
  from `activeTraining` (FR-019) — the same progress shape as
  `commuteProgress` in `commute.ts`.

Rendering: lightweight world-space progress bars anchored above the station
markers, drawn by the world layer (Phaser graphics), honoring
`reducedMotion` (no pulse animation, still visible). `nowMs` is the render
clock — indicators are a *view* of sim state, and the sim itself only ever
consumes `dt` (unchanged).

### Rationale

- "Progress = pure function of state + elapsed time" is the spec's own
  wording (FR-015/FR-018); putting the derivation in a Phaser-free module
  makes that a unit test rather than a screenshot check.
- Mirroring `commuteProgress` keeps one mental model for every timed thing in
  the world (commute, training, burner).

### Alternatives considered

- **DOM-overlay indicators positioned over the canvas**: fights the camera
  transform (would need per-frame world→screen sync for every indicator);
  world-space graphics are simpler and scale/pan for free. Rejected.
