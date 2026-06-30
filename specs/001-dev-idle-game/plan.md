# Implementation Plan: Lise Dev Idle Game

**Branch**: `001-dev-idle-game` | **Date**: 2026-06-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-dev-idle-game/spec.md`

## Summary

A browser-based top-down pixel-art idle game. The player is a software
developer at lise GmbH producing Lines of Code (LOC) over real time. The
core is a **pure, deterministic TypeScript function `advance(state, dt)`**
running client-side, so offline progress and save integrity are trivially
correct. LOC → Cash → AI-token burner forms the reinvest loop; the lise
Academy provides permanent progression and credential milestones give
long-term goals. A **Spring Boot** backend handles durable persistence,
multi-device sync, and serves versioned content/balance JSON. Deployed as
Docker containers on the Unraid host behind Traefik.

Full rationale in [research.md](research.md); data shape in
[data-model.md](data-model.md); interfaces in [contracts/contracts.md](contracts/contracts.md);
validation in [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: TypeScript (frontend) + Java 25 (backend, Spring Boot 4.1)

**Primary Dependencies**:
- Frontend: Phaser 4 (2D game engine, top-down/sprites/tilemaps), Vite 8
  (bundler/dev server), break_eternity.js (big numbers), Vitest (unit tests).
- Backend: Spring Boot 4.1 (Spring Framework 7, Jakarta EE 11) —
  `spring-boot-starter-web` (REST), `spring-boot-starter-websocket` (STOMP),
  `spring-boot-starter-data-jpa` (persistence), a database driver
  (H2 for dev, PostgreSQL for prod). Requires Java 17+; targeting Java 25.
- Content tooling: Tiled (author office tilemap → `.json` export).

**Storage**: Client localStorage (local authoritative save) + Spring Boot
persistence layer (durable/cross-device). Big numbers stored as strings.

**Testing**: Vitest (pure `advance` sim + mutators, determinism property
tests), JUnit 5 + Spring Boot Test (REST/sync/migration), manual
quickstart.md scenarios for end-to-end.

**Target Platform**: Modern desktop browsers (Chrome/Firefox/Edge/Safari).
Backend runs in Docker on the Unraid host.

**Project Type**: web-service (backend) + web-app (frontend) — a 2-project
monorepo.

**Performance Goals**:
- Frontend renders at 60 fps with the scene active.
- `advance(state, dt)` runs in O(active features), **not** O(dt) — a
  multi-day offline catch-up is as cheap as a 1s tick (Constitution
  "Additional Constraints").
- Backend sync round-trip < 300 ms p95 on the LAN host.

**Constraints**:
- Offline-capable core loop (playable with backend unreachable).
- Numeric stability over long play (big-number strings, no `double`).
- < 100 MB memory for the frontend bundle in browser; backend container
  modest (idle traffic).

**Scale/Scope**: Single-player MVP (no multiplayer/social). Hundreds of
content entries; one office scene; one save per player.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Deterministic, Pure Game Simulation | ✅ PASS | Sim is one pure TS function `advance(state, dt)`; offline uses the same path; associativity required/tested. research.md + contracts §1. |
| II | Data-Driven Content & Balance | ✅ PASS | All content is versioned JSON served by backend; sim reads it; number changes need no code. data-model.md "Content entities". |
| III | Test-First (NON-NEGOTIABLE) | ✅ PASS | Vitest property tests for `advance` determinism/associativity; JUnit for sync/migration; tests written first per `/speckit.tasks`. |
| IV | Player State Integrity & Persistence | ✅ PASS | Lossless save round-trip; deterministic monotonic merge; migration chain; corruption contained; offline-capable. contracts §2/§3 + quickstart Scenario 4. |
| V | Simplicity & YAGNI | ✅ PASS | Single-player MVP, one scene, anonymous playerId. No auth/multiplayer/social in scope. |

**Additional Constraints**: numeric stability via big-number strings ✅;
O(features) time-skip (no per-tick loop over dt) ✅; minimal deps ✅;
determinism over wall-clock (only `dt` feeds sim) ✅.

**Post-design re-check (after Phase 1)**: all five principles still PASS.
No violations to justify → **Complexity Tracking table left empty**.

## Project Structure

### Documentation (this feature)

```text
specs/001-dev-idle-game/
├── plan.md              # This file
├── research.md          # Phase 0 — tech decisions
├── data-model.md        # Phase 1 — entities & state
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/
│   └── contracts.md     # Phase 1 — advance + REST/WS surface
└── tasks.md             # Phase 2 — /speckit.tasks (not yet created)
```

### Source Code (repository root)

Two-project monorepo (web-service backend + web-app frontend):

```text
backend/                         # Spring Boot 4.1 (Java 25)
├── src/main/java/.../liseidle/
│   ├── content/                 # content entities + JSON loader/controller
│   ├── state/                   # GameState DTO + big-number handling
│   ├── sync/                    # monotonic merge + save/load
│   ├── session/                 # REST + WebSocket/STOMP endpoints
│   └── LiseIdleApplication.java
├── src/main/resources/
│   ├── content/                 # versioned balance JSON (producers, ...)
│   ├── application.yml
│   └── db/migration/            # Flyway-style save migrations
├── src/test/java/...            # JUnit 5 + Spring Boot Test
├── Dockerfile
└── pom.xml (or build.gradle)

frontend/                        # Phaser 4 + TypeScript + Vite
├── src/
│   ├── sim/                     # PURE core: advance + mutators (NO I/O)
│   │   ├── advance.ts           # the deterministic idle core
│   │   ├── actions.ts           # purchase/cashOut/activateBurner ...
│   │   ├── content.ts           # loadContent + validation
│   │   └── bigNumber.ts         # break_eternity.js wrapper
│   ├── scenes/                  # Phaser scenes (office, UI overlays)
│   ├── game/                    # game loop wiring (advance on tick + catch-up)
│   ├── net/                     # REST client + STOMP client
│   ├── save/                    # localStorage + migration
│   └── main.ts
├── public/assets/               # sprites, tilemap export, audio
├── tests/                       # Vitest (sim property tests, etc.)
├── vite.config.ts
├── tsconfig.json
└── package.json

docker-compose.yml               # backend + frontend (static) + proxy
```

**Structure Decision**: Two-project monorepo reflecting the two distinct
concerns — a typed backend (persistence/sync/content) and a game frontend
(renderer + pure sim). The pure sim lives under `frontend/src/sim/` and is
deliberately isolated (no Phaser, no network imports) so it is unit-testable
in isolation and could be extracted later. A root `docker-compose.yml`
binds them for the Docker/Traefik deployment on the Unraid host.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  |            |                                     |
