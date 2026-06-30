# Contracts: Lise Dev Idle Game

**Feature**: 001-dev-idle-game
**Date**: 2026-06-30

Two contract surfaces:
1. **Frontend internal contract** — the pure `advance` simulation (TS).
2. **Backend HTTP/WebSocket contract** — persistence, sync, content.

Big numbers are serialized as **strings** everywhere (never `double`).
Timestamps are ISO-8601 UTC strings.

---

## 1. Pure simulation contract (frontend, TypeScript)

The core of the game. Pure, deterministic, no I/O. This is what
Constitution Principle I mandates and Principle III requires to be tested.

### `advance(state, deltaTimeMs) -> state`

| Param | Type | Notes |
|-------|------|-------|
| `state` | `GameState` | input snapshot (see data-model.md) |
| `deltaTimeMs` | `number` (integer ≥ 0) | elapsed time in ms |

**Returns**: a **new** `GameState` advanced by `deltaTimeMs`. The input is
**not** mutated (purity / referential transparency).

**Postconditions** (testable invariants):
- `result.lastAdvancedAt == advanceTime(state.lastAdvancedAt, deltaTimeMs)`.
- `result.resources.loc >= state.resources.loc` (production is monotonic).
- If `state.activeBurner` had enough fuel for the whole `dt`, the multiplier
  applied for the full interval; otherwise applied only until fuel exhausted
  and `result.activeBurner == null`.
- All eligible milestones in `result.earnedMilestones ⊇ state.earnedMilestones`.
- Calling `advance(advance(s, a), b)` equals `advance(s, a + b)` for all
  non-negative `a, b` (associativity = determinism = offline-correct).

**Errors**: none thrown on valid input; invalid `state` (bad schema) → the
caller's save-migration concern, not `advance`.

### Player-action mutators (pure helpers, not time-based)

These transform state on discrete user input; `advance` is then called to
catch up. Each returns a new state and is independently testable.

| Function | Signature | Effect |
|----------|-----------|--------|
| `purchaseProducer` | `(state, producerId) -> state` | deducts Cost, adds id to ownedProducers |
| `purchaseUpgrade` | `(state, upgradeId) -> state` | deducts Cost, adds id to ownedUpgrades |
| `purchaseTraining` | `(state, trainingId) -> state` | deducts Cost, adds id to ownedTrainings |
| `activateBurner` | `(state, burnerId) -> state` | deducts fuelCost, sets activeBurner |
| `cashOut` | `(state, amount) -> state` | converts LOC → Cash at rate |

Each throws `InsufficientResourcesError` if the player can't afford it (so
the UI can disable/notify). No partial mutation on error.

### Validation helpers
- `canAfford(state, cost) -> boolean`
- `isUnlocked(state, requirement) -> boolean`
- `computeRate(state, content) -> BigNumber` (preview LOC/sec, used by UI
  and internally by `advance`).

### Content loader (frontend)
- `loadContent(contentJson) -> ContentCatalog` — parses & validates the
  served JSON into typed producers/upgrades/trainings/milestones/burners.
  Malformed content → throws `ContentValidationError`; the game never runs
  with half-parsed balance data.

---

## 2. Backend contract: REST

Base path: `/api/v1`. All bodies are JSON. All big-number fields are strings.

### `GET /api/v1/content`
Fetch versioned game content (producers, upgrades, trainings, milestones,
burners).

**200** —
```json
{
  "schemaVersion": 1,
  "contentVersion": "1.0.0",
  "producers":   [ { "id": "...", "baseRate": "1", ... } ],
  "upgrades":    [ ... ],
  "trainings":   [ ... ],
  "milestones":  [ ... ],
  "burners":     [ ... ]
}
```
Cachable by the client; immutable per `contentVersion`.

### `POST /api/v1/session` — register / load a player
Request: `{ "playerId": "string" }` (anonymous UUID generated client-side
for MVP; auth deferred per constitution single-player MVP).

**200** —
```json
{
  "playerId": "...",
  "state": { /* full GameState, big numbers as strings */ }
}
```
**404** — no save for this player (client starts fresh at zero).

### `PUT /api/v1/session/{playerId}/state` — save/sync
Request: `{ "state": { /* GameState */ }, "clientTime": "ISO-8601" }`

The server performs the **deterministic monotonic merge** described in
research.md (max for scalars, union for ownership sets, max timestamp),
persists the result, and returns the authoritative merged state.

**200** — `{ "state": { /* merged authoritative GameState */ } }`

**409** — `schemaVersion` newer than server supports (client must update).

### Error envelope (all endpoints)
```json
{ "error": { "code": "string", "message": "string" } }
```

---

## 3. Backend contract: WebSocket / STOMP (live channel)

Used to push **content changes** and **server-corrections** to a connected
client; not used to run the tick (the client advances locally).

- **Endpoint**: `ws(s)://<host>/ws` (STOMP over WebSocket).
- **Subscribe**: `/user/queue/state` — receives authoritative state
  corrections after a sync merge.

### Server → Client messages

`StateCorrection`:
```json
{ "type": "state.correction",
  "state": { /* authoritative merged GameState */ },
  "reason": "multi_device_sync | admin | migration" }
```
On receipt the client replaces its local state and re-anchors
`lastAdvancedAt` to now (then continues advancing locally).

`ContentUpdate`:
```json
{ "type": "content.update", "contentVersion": "1.0.0" }
```
Signals the client to re-fetch `/api/v1/content`.

### Client → Server
No gameplay messages; the client uses REST `PUT .../state` to save. The
socket is push-only for corrections/content notifications (keeps the model
simple and the sim client-side).

---

## Non-functional contract clauses

- **Determinism**: identical `(state, dt)` MUST yield identical results
  across reloads, devices, and the merge step (Constitution I).
- **Integrity**: no endpoint or message may reduce or wipe accumulated
  progress except an explicit, logged migration (Constitution IV).
- **Offline-capable**: the frontend MUST remain fully playable with the
  backend unreachable; sync is best-effort, the local save is authoritative
  for play (Constitution IV).
- **Numeric integrity**: big numbers as strings end-to-end; no `double`.
