# Quickstart & Validation: Lise Dev Idle Game

**Feature**: 001-dev-idle-game
**Date**: 2026-06-30

This is a **validation guide**, not a build tutorial. It describes how to
prove each user story works end-to-end once implemented. Implementation
steps belong in `tasks.md`. Contract and data-model details are referenced,
not duplicated — see [contracts/contracts.md](contracts/contracts.md) and
[data-model.md](data-model.md).

## Prerequisites

- Node 22+ and npm (frontend dev/build).
- JDK 25+ and Maven/Gradle (backend) — OR Docker to run the backend image.
- A modern desktop browser.
- Access to the repo (already public: `Hochgesand/lise-idle-game`).

## Scenario 0 — Services come up (US0, infra)

**Proves**: backend serves content; frontend loads; both containers run.

1. From repo root, start backend + frontend dev servers (exact commands in
   `tasks.md`). For a full-stack check, bring up the Docker compose stack.
2. **Expected**:
   - `GET /api/v1/content` returns valid JSON with `producers`, `upgrades`,
     `trainings`, `milestones`, `burners` (see contracts §2).
   - Opening the frontend URL in a browser shows the top-down pixel-art
     office scene with no console errors.
3. **Pass when**: backend returns content and the frontend renders the scene.

## Scenario 1 — The Dev at Work (US1, MVP) 🎯

**Proves**: idle production over real time + offline progress + persistence.

1. Load the game as a new player (clear localStorage / fresh playerId).
2. Watch the LOC counter for ~30s; note `loc` increases monotonically.
3. Click/interact with the scene; confirm an immediate LOC boost.
4. Note the current LOC and the wall-clock time; **close the tab**.
5. Wait **N minutes** (e.g. 2 min), reopen the game.
6. **Expected** (validates [contracts §1](contracts/contracts.md) `advance`
   and Constitution Principle I/IV):
   - On load, `advance(state, elapsedMs)` ran; LOC grew by ~`rate × N`.
   - `lastAdvancedAt` re-anchored to now.
   - State restored identically (no progress lost).
7. **Pass when**: offline progress is credited within a small tolerance and
   no progress is lost across reload.

## Scenario 2 — Cash & the Token Burner (US2)

**Proves**: the reinvest loop LOC → Cash → burner → multiplied LOC.

1. From a state with accumulated LOC, perform `cashOut` (contracts §1).
2. **Expected**: `resources.cash` increases, `resources.loc` decreases by
   the converted amount.
3. Buy the AI-token burner upgrade with Cash; **activate** it
   (`activateBurner`).
4. **Expected**:
   - `activeBurner` is set; `aiTokens` reduced by the activation cost.
   - LOC/sec visibly multiplies (rate preview via `computeRate` jumps).
   - `resources.aiTokens` decreases over time as fuel burns.
5. Wait until fuel is exhausted.
6. **Expected**: `activeBurner` becomes `null`; rate returns to baseline.
7. **Pass when**: the full loop runs end-to-end and the multiplier only
   applies while fuel remains.

## Scenario 3 — lise Academy Progression (US3)

**Proves**: permanent training boosts + credential milestones.

1. Buy a **lise Academy** training item (`purchaseTraining`).
2. **Expected**:
   - `ownedTrainings` gains the id; Cash deducted.
   - `computeRate` permanently increases (multiplier persists across
     reloads and offline).
3. Reach a milestone's requirement (e.g. total LOC ≥ threshold).
4. **Expected**:
   - The milestone is appended to `earnedMilestones`.
   - Its reward is applied.
   - It is displayed as a earned credential (e.g. "ISO 9001 Certified").
5. Reload; confirm the training and milestone both persist.
6. **Pass when**: permanent boosts apply and milestones register and persist.

## Scenario 4 — Save integrity & migration (edge cases)

**Proves**: Constitution Principle IV (never silently destroy progress).

1. Export/copy the current localStorage save JSON; note `schemaVersion`.
2. Produce a synthetic older-schema save (or use a migration test fixture);
   load it.
3. **Expected**: the migration chain runs and produces a valid
   current-schema state with all progress preserved.
4. Corrupt a copy of the save (invalid JSON); load it.
5. **Expected**: the game refuses to load that slot safely (clear message)
   **without** touching other valid data.
6. **Pass when**: old saves migrate forward and corruption is contained.

## Cross-cutting checks (run during every scenario)

- **Numeric integrity**: with large numbers (push LOC high), values display
  and advance correctly — no `NaN`/`Infinity`, no precision loss altering
  gameplay (big numbers stay strings end-to-end per contracts).
- **Offline-capable core**: with the backend unreachable, Scenarios 1–3
  still work from the local save (sync deferred, play continues).
- **Determinism test**: for any state `s`, `advance(advance(s, a), b) ===
  advance(s, a + b)` (verifies Constitution Principle I; covered by unit
  tests, spot-checked manually).
