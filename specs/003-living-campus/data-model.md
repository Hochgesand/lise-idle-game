# Data Model: Living Campus — Player Character, Activities on the Map, Visible Timed Jobs

**Feature**: `003-living-campus` | **Date**: 2026-07-02 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

Phase 1 output. Field names are authoritative for the implementation; the
TypeScript source of truth is `frontend/src/sim/types.ts`, mirrored by
`backend/src/main/java/com/lise/liseidle/state/GameState.java` for sync
passthrough. Save schema moves **v2 → v3**. All conventions from 001/002 hold:
big numbers as strings, sim-timeline milliseconds for in-save timestamps
(never wall clock), additive migrations, deterministic merge.

---

## 1. GameState (extended) — save schema v3

One new field. Everything else is byte-identical to v2 (002).

```ts
interface GameState {
  // ... all v2 fields unchanged (resources, ownedProducers, ownedUpgrades,
  //     ownedTrainings, activeBurner, earnedMilestones, lastAdvancedAt,
  //     schemaVersion, settings, coopSegments, activeOffice, commute) ...

  /** (003) The one in-progress Academy training, else null. */
  activeTraining: ActiveTrainingState | null;
}
```

### ActiveTrainingState

```ts
interface ActiveTrainingState {
  /** References a Training content definition (must exist in content). */
  trainingId: string;
  /**
   * Sim-timeline ms, written by the startTraining mutator from
   * Date.parse(state.lastAdvancedAt) — the same deterministic conversion
   * CommuteState.startedAt uses. NEVER Date.now().
   */
  startedAt: number;
}
```

**Invariants**

- At most one `activeTraining` exists (`null` when idle) — FR-020's single
  Academy seat.
- `trainingId` MUST reference a training with `durationSeconds > 0`
  (zero-duration trainings never enter this state; they resolve instantly in
  the mutator, Spec 001 behavior).
- `trainingId` MUST NOT already be in `ownedTrainings` (startTraining rejects
  re-training; ownership is permanent).
- The cost has already been deducted when this record exists (cost-at-start,
  FR-017); the permanent multiplier does NOT apply while the record exists —
  it applies from resolution (below).
- **Resolution** (owned by `advance`, nowhere else): at sim time
  `startedAt + durationSeconds * 1000` the interval is split (piecewise
  machinery shared with coop segments / fuel exhaustion / commute), the id
  moves into `ownedTrainings`, `activeTraining := null`, and the training's
  `permanentMultiplier` affects only production after the boundary.
  Resolution works identically inside offline spans (FR-018) and preserves
  the associativity property `advance(advance(s,a),b) === advance(s,a+b)`.
- Unknown `trainingId` at resolution time (content removed a training):
  resolve safely — drop the record without granting ownership and without
  throwing (content drift never corrupts a save; Principle IV). The load-time
  content validation makes this practically unreachable.

## 2. Training (content, extended)

```ts
interface Training {
  id: string;
  name: string;
  description: string;
  cost: Cost;
  permanentMultiplier: number;
  prerequisite: Requirement | null;
  /**
   * (003) Optional run duration in seconds. Absent or 0 → Spec 001 instant
   * purchase. Nonzero → timed job (US3). Validation: number, >= 0, finite.
   * Tuning band per spec: seconds-to-minutes (soft guidance, not validated).
   */
  durationSeconds?: number;
}
```

- Lives in `backend/src/main/resources/content/trainings.json` entries;
  validated in `frontend/src/sim/content.ts` (`loadContent`) and the backend
  `ContentLoader` fail-fast pass; mirrored into
  `frontend/src/sim/fallbackContent.ts`.
- Existing content (no `durationSeconds`) stays valid unchanged — FR-016
  backward compatibility.

## 3. WorldConfig (content, new block `world.json`)

The additive seventh entry in the served content envelope (exactly the
`coop.json` pattern from 002), mirrored into the bundled fallback.

```ts
interface WorldConfig {
  /** Station-walk duration in seconds (> 0, finite). Default tuning: 2. */
  walkSeconds: number;
}
```

- `ContentCatalog.world?: WorldConfig` (typed optional for partial test
  fixtures, enforced-present by `loadContent` — same convention as `coop`).
- Consumed ONLY by the presentation layer (walk interpolation, US2). Nothing
  in `advance` reads it — the sim/presentation boundary from research
  Decision 3 is visible in the data flow.
- Backend: `WorldConfig.java` record + `world.json` loaded fail-fast by
  `ContentLoader`; `CONTENT_VERSION` bumps (currently `1.3.0` → `1.4.0`).

## 4. Stations (map data, new Tiled object layer)

New object layer **`Stations`** in `frontend/public/assets/campus.json`,
following the `SeatAnchors` conventions exactly (point objects; custom
properties in the Tiled array form `[{name, type, value}]`).

| Object | `panel` property | `building` property | Placement (campus-layout.md) |
|---|---|---|---|
| Academy | `academy` | `office_1` | room `skier` |
| Burner (o1) | `burner` | `office_1` | `Break Room` coffee point |
| Burner (o2) | `burner` | `office_2` | coffee point (60,30) area |
| Cash-out (o1) | `cashout` | `office_1` | room `Office` |
| Cash-out (o2) | `cashout` | `office_2` | room `the executive Office` |

```ts
/** Normalized station (output of extractStations, stations.ts — pure). */
interface Station {
  x: number;            // world px
  y: number;            // world px
  panel: StationPanel;  // 'academy' | 'burner' | 'cashout'
  building: string;     // 'office_1' | 'office_2'
}
```

**Invariants**

- `panel` values are a closed set; unknown values are dropped by
  `extractStations` (lenient, mirrors `readBuildingProperty` tolerance).
- A missing `Stations` layer yields `[]` — the world renders without station
  markers and the fallback menu (FR-013) carries the full activity surface
  (graceful degradation on older/placeholder maps).
- The **boost** activity has no map object: its station is the player's
  reserved seat (research Decision 2), resolved at runtime.
- Per-building activities (`burner`, `cashout`) resolve to the station whose
  `building` equals `state.activeOffice`; `academy` exists only in
  `office_1` (spec world-anchor table).

## 5. Player projection (derived, never persisted)

The player avatar renders from a pure position derivation — no new save
fields beyond `activeTraining` (§1):

```ts
/** Input slice (all pre-existing save state + presentation intent). */
type PlayerPositionInput = {
  activeOffice: string;
  commute: CommuteState | null;      // 002
  activeTraining: ActiveTrainingState | null; // §1 (occupation, US3)
  walk: WalkIntent | null;           // §6 (presentation, US2)
  nowMs: number;                     // render clock (view-only)
};

/** Output: where the player avatar is and what it is doing. */
type PlayerProjection =
  | { kind: 'seated'; x: number; y: number }        // reserved seat
  | { kind: 'commuting'; x: number; y: number }     // commuterPosition(...)
  | { kind: 'walking'; x: number; y: number }       // walk interpolation
  | { kind: 'occupied'; x: number; y: number };     // at Academy station
```

**Precedence** (deterministic): `commuting` > `walking` > `occupied` >
`seated`. Rationale: the commute is sim state and cancels walks (FR-011);
occupation (US3) shows only when no walk is active and the player is present
in the Academy's building (spec edge case "office switch while a training
runs").

**Label**: `displayName` from the 002 identity model when signed in, literal
`"Du"` otherwise — render input only, never stored.

## 6. WalkIntent (presentation-layer, never persisted, never in the sim)

```ts
interface WalkIntent {
  target: Station;       // where we're going (or the seat, for 'boost')
  panel: StationPanel | 'boost';
  fromX: number;         // interpolation start (current position at tap)
  fromY: number;
  startedAtMs: number;   // WALL clock (render timeline) — allowed: view-only
}
```

- Lives in the world scene / player layer. NOT in `GameState`, NOT
  serialized, NOT read by `advance` (research Decision 3 — the structural
  purity boundary).
- Completion at `startedAtMs + world.walkSeconds * 1000` → sole effect:
  `overlay.openPanel(panel)`.
- Replaced wholesale on retarget (new intent starts at the current
  interpolated position); cleared on office switch; resolved immediately
  under `settings.reducedMotion`.

## 7. Overlay panel-manager state (UI, never persisted)

```ts
type PanelId = 'economy' | 'academy' | 'social' | null;
// Overlay handle gains: openPanel(id), closePanel(), getOpenPanel()
```

- `null` = HUD-only default (FR-014). Sections return `null` from `render`
  unless open (the 002 hidden-panel-collapse contract does the rest).
- The HUD section and the fallback-menu button are always-on.
- Station `panel` → `PanelId` mapping: `academy → 'academy'`,
  `burner → 'economy'`, `cashout → 'economy'` (both live in the economy
  panel), `boost` → no panel (the boost action fires directly on arrival —
  it is a one-tap action, not a panel).

## 8. Save migration v2 → v3

- **Migration** (`frontend/src/save/migrations.ts`): add
  `activeTraining: null`. Nothing else changes. Total: valid v3 output or
  safe failure, never partial mutation (FR-022; the T010 pattern from 002).
- **Lenient defaults** (`frontend/src/save/localStorage.ts` `toGameState`):
  absent `activeTraining` → `null` before the migration chain runs, so every
  v1/v2 save loads.
- **Round-trip**: save → load → save is byte-identical for migrated saves
  (Principle IV).
- **Backend**:
  - `GameState.java` gains `activeTraining` (nullable record field);
  - `PlayerStateService` normalizes absent/`null` on read (pre-existing
    v1/v2 rows never NPE and never leak `null`-shaped v3 fields — bootstrap
    responds with `activeTraining: null`);
  - `StateMerger`: `activeTraining` merges as part of the
    later-`lastAdvancedAt` snapshot rule (the same pair rule that carries
    `activeOffice`/`commute` — the training is timeline state, so the newer
    timeline wins wholesale; client copy on tie);
  - `SessionController.CURRENT_SCHEMA_VERSION` 2 → 3 (409 semantics
    unchanged).

## 9. Consistency & determinism summary

| Datum | Where it lives | Clock | Read by advance? |
|---|---|---|---|
| `activeTraining.startedAt` | save (v3) | sim-timeline ms | **yes** (resolution boundary) |
| `Training.durationSeconds` | content | — (scalar) | **yes** (boundary math) |
| `world.walkSeconds` | content | — (scalar) | no (presentation only) |
| `WalkIntent.startedAtMs` | scene memory | wall clock | no (never) |
| Station positions | map (`campus.json`) | — | no |
| Job-indicator progress | derived per frame | render clock over sim state | no (pure view) |
| Player projection | derived per frame | render clock over sim state | no (pure view) |

The only sim-visible additions are `activeTraining` + `durationSeconds`, both
deterministic state/content — everything else is a view. This table is the
Constitution Check's Principle I evidence.
