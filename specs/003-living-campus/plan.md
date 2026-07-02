# Implementation Plan: Living Campus — Player Character, Activities on the Map, Visible Timed Jobs

**Branch**: `003-living-campus` | **Date**: 2026-07-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-living-campus/spec.md`

## Summary

Feature 003 puts the player *inside* the 002 campus. Three slices: **US1** —
a visible, visually distinct player avatar (highlight ring, "Du"/display-name
label) seated at a deterministic reserved desk in the active office, rendered
as a **pure local projection of the save** (works fully offline/signed-out),
visibly riding the tram commute on `switchOffice` via the same
`commuterPosition` math observers use, plus a find-me HUD affordance built on
the existing camera math. **US2** — the game's activities become physical
stations in their thematic rooms (Academy in `skier`, burner at Break-Room
coffee points, cash-out in `Office`/`the executive Office`, boost at the
player's own desk), defined as a new Tiled `Stations` object layer; tapping a
station walks the avatar there over a short, **data-driven, presentation-only
delay** (`world.walkSeconds` — the sim's `advance` is untouched by walking)
and then opens the corresponding **existing DOM panel on demand** (panels
stop being an always-on stack; a fallback list menu keeps every panel
directly reachable for accessibility). **US3** — running jobs render as
in-world progress indicators above their stations (pure derivations of state
+ elapsed time), and trainings gain **data-driven durations**: the feature's
only sim change, an `activeTraining` save field resolved by piecewise
`advance` at `startedAt + durationSeconds` — the exact commute-resolution
pattern 002 proved — so offline completion and save replay stay deterministic.
Save schema v2 → v3 (additive), content gains `world.json` +
`Training.durationSeconds`, backend involvement is passthrough-only (**no new
endpoints**), and the 002 social overlay is untouched (no new online
capability).

Full rationale in [research.md](research.md); data shapes in
[data-model.md](data-model.md); validation in [quickstart.md](quickstart.md).
No `contracts/` document: this feature adds no REST/STOMP surface — the
interface deltas are the sim-internal shapes fixed in data-model.md.

## Technical Context

**Language/Version**: TypeScript (frontend, Phaser 4 + Vite 8) + Java 25
(backend, Spring Boot 4.1) — unchanged from 001/002. **No new dependencies**
on either side (the whole feature is buildable with what 002 installed).

**Primary Dependencies / touched modules** (grounded in the code on `main`):

- `frontend/src/sim/types.ts` — `GameState` gains `activeTraining`
  (`ActiveTrainingState`), `Training` gains optional `durationSeconds`,
  `ContentCatalog` gains `world?: WorldConfig` (data-model §§1–3).
- `frontend/src/sim/actions.ts` — new pure `startTraining` mutator
  (cost-at-start, one-at-a-time, zero-duration = instant); it **supersedes
  `purchaseTraining`** and takes over its call sites (research Decision 4).
- `frontend/src/sim/advance.ts` — training-completion boundary in the
  existing piecewise interval-splitting machinery (alongside coop-segment
  boundaries, fuel exhaustion, and commute resolution); `computeRate`
  excludes an in-progress training's multiplier until resolution.
- `frontend/src/sim/content.ts` + `fallbackContent.ts` — validate/mirror the
  `world` block and `durationSeconds`.
- `frontend/src/save/migrations.ts` + `localStorage.ts` — v2→v3 additive
  migration (`activeTraining: null`) + lenient defaults.
- `frontend/src/scenes/world/seats.ts` — `assignSeats` gains the reserved
  player anchor (first anchor of the office in the existing `(y, x)` stable
  order); colleagues fill the rest (research Decision 2).
- `frontend/src/scenes/world/commute.ts` — reused as-is
  (`commuteProgress`/`commuterPosition`/`laneOffset`) for the player's own
  commute rendering — one math module for observer and self (FR-004).
- `frontend/src/scenes/world/camera.ts` — reused (`clampZoom`,
  `clampToMap`, `CameraState`) plus a pure find-me derivation (center on
  avatar at `FIND_ME_ZOOM ≥ LABEL_ZOOM_THRESHOLD`).
- `frontend/src/scenes/world/avatars.ts` — sprite/label building blocks
  (`AVATAR_TEXTURE`, `HIT_TARGET_PX`, `LABEL_ZOOM_THRESHOLD`) reused by the
  new player layer; `AvatarLayer` itself (colleague rendering) unchanged.
- **New** `frontend/src/scenes/world/player.ts` — the player layer: pure
  `PlayerProjection` derivation (seated/commuting/walking/occupied,
  precedence per data-model §5) + Phaser rendering (ring, label, distinct
  styling).
- **New** `frontend/src/scenes/world/stations.ts` — pure `extractStations`
  over the new Tiled `Stations` object layer (the `seats.ts` conventions:
  property-array parsing, lenient drops, `[]` on missing layer).
- **New** `frontend/src/scenes/world/walk.ts` — pure walk-intent math
  (interpolation, retarget-from-current-position, reduced-motion resolve);
  `WalkIntent` lives in scene memory, never in the save (research Decision 3).
- **New** `frontend/src/scenes/world/jobs.ts` — pure job-indicator
  derivation (burner fraction from `BurnerState` + content; training progress
  mirroring `commuteProgress`) + world-space progress-bar rendering.
- `frontend/src/scenes/world/CampusScene.ts` — wires stations (tap targets),
  the player layer, walk updates, and job indicators into the render loop.
- `frontend/src/ui/overlay.ts` — panel-manager state (`openPanel` /
  `closePanel` / `getOpenPanel`); sections render `null` unless open (the
  existing hidden-panel-collapse contract does the collapsing).
- **New** `frontend/src/ui/menuPanel.ts` — fallback activity list menu
  (FR-013), riding the overlay's `data-action` delegation + keyboard `click`
  fallback.
- `frontend/src/ui/hudPanel.ts` — find-me button; training-in-progress
  affordance state (start button disabled with reason while one runs).
- `frontend/src/ui/academyPanel.ts` — start-training flow for timed
  trainings (duration shown, in-progress state, FR-020 second-training gate).
- `frontend/src/main.ts` — action wiring (`startTraining` replaces
  `purchaseTraining` at the established safe mutation points), overlay
  panel-manager hookup, walk/office-switch cancellation ordering.
- Backend (passthrough only, **no new endpoints**):
  `content/WorldConfig.java` + `content/world.json` + `ContentLoader`
  fail-fast load + `CONTENT_VERSION` `1.3.0 → 1.4.0`;
  `state/GameState.java` + `PlayerStateService` null-normalization for
  `activeTraining`; `sync/StateMerger.java` — `activeTraining` joins the
  later-`lastAdvancedAt` pair rule (with `activeOffice`/`commute`);
  `session/SessionController.java` `CURRENT_SCHEMA_VERSION` `2 → 3`;
  `content/trainings.json` gains `durationSeconds` values.
- Assets: `frontend/public/assets/campus.json` gains the `Stations` object
  layer (added in the generator `scripts/gen_placeholder_assets.py` — or its
  successor `scripts/gen_campus_assets.py` once 002's real-map task T040
  lands; the layer contract is identical either way).

**Storage**: Client localStorage save (`schemaVersion` **2 → 3**, additive
migration defaulting `activeTraining: null`) + the unchanged JPA layer
(`player_state` passthrough; `player_presence` untouched). No DB schema
change.

**Testing**: Vitest (frontend, co-located `*.test.ts` — repo convention;
baseline **501 tests green**, the suite MUST stay green at every GREEN
commit): v2→v3 migration; `startTraining` (cost-at-start, one-at-a-time,
zero-duration instant path, supersedes-`purchaseTraining` call-site tests);
piecewise `advance` with a training boundary incl. large-`dt` offline spans
and the associativity property; content validation (`world` block,
`durationSeconds`); `assignSeats` reservation; `PlayerProjection` precedence;
walk math (retarget, reduced motion); find-me camera math; `extractStations`;
job-indicator derivations; overlay panel-manager + menu panel. JUnit 5 +
Spring Boot Test (backend): content envelope carries `world`; fail-fast on
malformed `world.json`; `StateMerger` `activeTraining` rule;
`PlayerStateService` null-normalization; bootstrap responds
`activeTraining: null` for v2 rows; schema-version 3 acceptance/409. Manual
[quickstart.md](quickstart.md) Scenarios 1–12.

**Target Platform**: unchanged — modern desktop and mobile browsers as
co-equal (002 FR-019 rules apply to every new marker/panel/affordance);
backend in Docker on the Unraid host; per-phase deploys via the
`deploy-lise-game` skill (GHCR pull-based, per the 002-refined procedure).

**Project Type**: unchanged 2-project monorepo (web-app frontend +
web-service backend). This feature adds frontend modules and content files,
not projects.

**Performance Goals**:
- 60 fps at the 002 design load **plus** the player avatar, ≤ 5 station
  markers, and ≤ 2 active job indicators (SC-006) — the additions are O(1)
  render objects, pooled like the 002 avatar containers.
- `advance(state, dt, content)` stays **O(active features + segment/boundary
  count overlapping the interval)**, never O(dt): the training adds at most
  one boundary per call (Constitution Additional Constraints).
- Find-me completes (camera settled) in < 2 s (SC-001); station tap → panel
  open in `walkSeconds` + < 1 s UI latency (SC-003).

**Constraints**:
- **Sim purity**: only `activeTraining` (+ `durationSeconds` content) enter
  the sim; `WalkIntent`, find-me, indicators, and the player projection are
  views. The data-model §9 table is the enforceable checklist — nothing in
  `sim/` may import from `scenes/` or read a wall clock (unchanged 001/002
  rule).
- **Offline/signed-out completeness**: every 003 affordance functions with
  no network and no identity (FR-023; quickstart Scenario 1/11); the label
  is the only identity-aware pixel, with "Du" fallback.
- **No new backend surface**: content files + state passthrough + schema
  bump only. Anything needing a new endpoint is out of scope by spec.
- **Additive save**: v2 saves load losslessly; save→load→save byte-identical
  (FR-022; Principle IV).
- **Legibility**: station markers and the player avatar obey the 002 rules —
  ≥ 44 px effective touch targets, label-zoom threshold, `reducedMotion`
  honored on every new animation (FR-024).
- **Numeric stability unchanged**: durations are bounded plain scalars
  (seconds); resources stay big-number strings; no `double` on the wire.

**Scale/Scope**: one new save field, one content block + one content field,
one map object layer (~5 points), four new frontend modules + one new panel,
~6 extended modules, backend passthrough in 4 files. No new services, no new
deps, no new endpoints.

## Constitution Check

*GATE: v1.1.0. Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Deterministic, Pure Game Simulation | ✅ PASS | The only sim additions are `activeTraining` (state) + `durationSeconds` (content), resolved by piecewise `advance` at `startedAt + duration` — a pure state+elapsed-time boundary identical in kind to 002's commute resolution; offline completion uses the same path as online (no divergent branch), and the associativity property is retained as a test (FR-018; data-model §1, §9). Walking, find-me, and indicators are presentation-layer views that never feed `advance` — `WalkIntent` is structurally outside `GameState` (research Decisions 3, 8). The wall-clock walk timer is recorded as a borderline note in **Complexity Tracking**. |
| II | Data-Driven Content & Balance | ✅ PASS | Training durations live in `trainings.json` entries; the walk duration lives in the new additive `world.json` content block (fallback-mirrored); station placement is map data (the `Stations` Tiled object layer). Retuning any of them is a data-only change; no balance number lands in logic (FR-007/016/021; data-model §§2–4). |
| III | Test-First (NON-NEGOTIABLE) | ✅ PASS | Every behavior lands RED-first per tasks.md: migration, `startTraining`, the `advance` training boundary (incl. large-`dt` offline and associativity property tests — the Principle III "offline-progress and large-delta" requirement), seat reservation, projection precedence, walk/retarget math, stations extraction, indicator derivations, panel manager, and the backend merge/normalization/envelope tests. Suite baseline 501 stays green at every GREEN commit. |
| IV | Player State Integrity & Persistence | ✅ PASS | Additive v2→v3 migration defaulting `activeTraining: null`; lenient pre-migration defaults keep every v1/v2 save loadable; lossless round-trip retained; backend normalization prevents `null` leaks on pre-existing rows; unknown `trainingId` at resolution degrades safely without corrupting the save (FR-022; data-model §8; SC-007). Offline progress is honored *more* visibly, never capped or faked. |
| V | Simplicity & YAGNI | ✅ PASS | Every story is prioritized and independently deliverable; the design maximally reuses 002 machinery (commute math, seat assignment, camera math, overlay collapse/delegation, piecewise `advance`, migration pattern) and adds **zero dependencies**. Deliberately rejected complexity: sim-modeled walking, pathfinding, generic job queues, presence-echoed self, routing libraries (research, every "Alternatives considered"). `startTraining` replaces `purchaseTraining` rather than coexisting with it. One-training-at-a-time bounds the new state to a single nullable field. |
| VI | Online & Multiplayer as an Additive Overlay | ✅ PASS (no online capability added) | This feature introduces **no** online input, endpoint, or social behavior; the player avatar is a local save projection that renders identically offline and signed-out (FR-001/006/023), and the 002 overlay's degradation story is unchanged (quickstart Scenario 11). The principle's justification duty is not triggered; the check documents non-applicability. |

**Additional Constraints**: offline-capable core — 003 is 100% offline-capable
by requirement ✅; numeric stability — durations are bounded scalars, resources
untouched ✅; time-skip performance — one extra boundary per `advance` call,
never O(dt) ✅; minimal dependencies — zero new libraries ✅; determinism over
real-time — the sim consumes only `dt` and state; the sole wall-clock timer
(walk) is outside the sim and gated as a view (borderline note below) ✅.

**Post-design re-check (after Phase 1)**: all six principles hold as above.
The Complexity Tracking table carries no violation rows — two borderline
items are recorded for the paper trail per the gate's instruction to note
anything borderline.

## Project Structure

### Documentation (this feature)

```text
specs/003-living-campus/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions 1–8 (player projection, walk, timed trainings, …)
├── data-model.md        # Phase 1 — save v3, content extensions, stations, projections
├── quickstart.md        # Phase 1 — browser validation Scenarios 1–12
└── tasks.md             # Phase 2 — /speckit.tasks
```

(No `contracts/` — no new REST/STOMP surface; the sim-internal interfaces are
fixed in data-model.md.)

### Source Code (repository root)

Additive layout on the 001/002 monorepo — `(003)` marks new files, `(002→)`
marks existing files that are extended:

```text
backend/
├── src/main/java/com/lise/liseidle/
│   ├── content/
│   │   ├── WorldConfig.java              # (003) world tuning record (walkSeconds)
│   │   └── ContentLoader.java            # (002→) load world.json fail-fast; CONTENT_VERSION 1.4.0
│   ├── state/
│   │   ├── GameState.java                # (002→) + activeTraining (nullable)
│   │   └── PlayerStateService.java       # (002→) null-normalize activeTraining for v1/v2 rows
│   ├── sync/StateMerger.java             # (002→) activeTraining joins the later-lastAdvancedAt pair rule
│   └── session/SessionController.java    # (002→) CURRENT_SCHEMA_VERSION 2 → 3
├── src/main/resources/content/
│   ├── world.json                        # (003) { "walkSeconds": 2 }
│   └── trainings.json                    # (002→) + durationSeconds per timed training
└── src/test/java/...                     # (003) world-block, merger, normalization, schema-v3 tests

frontend/
├── src/
│   ├── sim/
│   │   ├── types.ts                      # (002→) ActiveTrainingState; Training.durationSeconds; WorldConfig
│   │   ├── actions.ts                    # (002→) startTraining (supersedes purchaseTraining)
│   │   ├── advance.ts                    # (002→) training-completion boundary (piecewise)
│   │   ├── content.ts                    # (002→) validate world block + durationSeconds
│   │   └── fallbackContent.ts            # (002→) mirror world block + durations
│   ├── save/
│   │   ├── migrations.ts                 # (002→) v2 → v3 (activeTraining: null)
│   │   └── localStorage.ts               # (002→) lenient default for activeTraining
│   ├── scenes/world/
│   │   ├── player.ts                     # (003) player layer: projection derivation + rendering
│   │   ├── stations.ts                   # (003) extractStations (pure, seats.ts conventions)
│   │   ├── walk.ts                       # (003) pure walk-intent math (presentation only)
│   │   ├── jobs.ts                       # (003) job-indicator derivation + progress bars
│   │   ├── seats.ts                      # (002→) reserved player anchor in assignSeats
│   │   ├── camera.ts                     # (002→) findMeCamera derivation (FIND_ME_ZOOM)
│   │   └── CampusScene.ts                # (002→) wire stations/player/walk/jobs
│   ├── ui/
│   │   ├── overlay.ts                    # (002→) panel manager: openPanel/closePanel/getOpenPanel
│   │   ├── menuPanel.ts                  # (003) fallback activity list menu (FR-013)
│   │   ├── hudPanel.ts                   # (002→) find-me button; training-running state
│   │   ├── academyPanel.ts               # (002→) timed-training start flow, FR-020 gate
│   │   └── styles.css                    # (002→) menu/on-demand panel styles
│   └── main.ts                           # (002→) startTraining wiring; panel-manager hookup
├── public/assets/campus.json             # (002→) + Stations object layer
└── scripts/gen_placeholder_assets.py     # (002→) emit the Stations layer (or gen_campus_assets.py once 002 T040 lands)
```

**Structure Decision**: purely additive on the 002 layout — new pure modules
sit beside their 002 siblings in `scenes/world/` (the established
"pure math + thin Phaser consumer" split), the one new panel joins `ui/`, and
the sim/save/backend deltas ride the exact files 002 already extended for the
commute. No new packages, projects, or directories.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No Constitution violations. Two **borderline items** are recorded per the
gate instruction (anything borderline gets a paper trail), with the analysis
of why each stays on the right side of the line:

| Borderline item | Why it is not a violation | Guardrail that keeps it so |
|-----------------|---------------------------|----------------------------|
| **Presentation-layer walk timer uses the wall clock** (US2): tapping a station starts a `WalkIntent` timed with the render clock, and a user affordance (the panel opening) waits on it. "Determinism over real-time" forbids wall-clock APIs *feeding the simulation* — this timer never does: its sole effect is `overlay.openPanel(...)`; the sim action still happens through unchanged Spec 001 mutators whenever the player acts in the panel. Same class as the 002 boost float-text/camera animations. | `WalkIntent` is structurally outside `GameState` (scene memory, never serialized, never an `advance` input — data-model §6, §9); FR-010 pins it normatively; the fallback menu (FR-013) means no gameplay capability is ever *only* reachable through the timed path. | Tests assert `advance`/state equality across walk start/retarget/cancel; `sim/` keeps its no-`scenes/`-import, no-wall-clock rule; reduced motion collapses the delay, proving nothing depends on it. |
| **Timed trainings extend the sim** (US3): a new save field (`activeTraining`) and a new `advance` boundary — the first gameplay-mechanic change to the deterministic core since 002's justified co-op segments. | Principle I explicitly blesses progression as a pure function of state + elapsed time, which is exactly what the boundary is (no online input, no randomness, no wall clock — unlike 002's coop case there is no external feed, so no Principle VI entry is needed); Principle V's "justified by a prioritized user story" is satisfied by US3 (P3), and the shape is the already-proven commute-resolution pattern. | Associativity + large-`dt` offline property tests (RED-first); additive v3 migration with lossless round-trip; one nullable field bounds the state (no queues); cost-at-start/effect-at-completion fixed in FR-017/018 so balance can never depend on when the client rendered. |
