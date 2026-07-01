---
description: "Task list for feature implementation"
---

# Tasks: Lise Dev Idle Game

**Input**: Design documents from `/specs/001-dev-idle-game/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: **MANDATORY** — the project constitution (`.specify/memory/constitution.md` Principle III "Test-First — NON-NEGOTIABLE") requires TDD: tests written, approved, and RED before implementation. Test tasks are included and MUST be completed before their sibling implementation tasks in every phase.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. See spec.md for the three user stories (US1 P1, US2 P2, US3 P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Two-project monorepo (per plan.md): `backend/` (Spring Boot 4.1 / Java 25) and `frontend/` (Phaser 4 / TypeScript / Vite). Paths below are repo-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for both projects.

- [x] T001 Create root repo scaffolding: `docker-compose.yml`, `.dockerignore`, top-level `README.md` update, and `specs/001-dev-idle-game/` already in place
- [x] T002 Initialize Spring Boot 4.1 backend project in `backend/` (Java 25, `pom.xml` with `spring-boot-starter-parent` 4.1.x, starters: web, websocket, data-jpa; H2 + PostgreSQL drivers; folder structure per plan.md)
- [x] T003 [P] Initialize Vite + TypeScript frontend in `frontend/` (`package.json`, `vite.config.ts`, `tsconfig.json`, install `phaser`, `break_eternity.js`, `vitest`)
- [x] T004 [P] Configure frontend linting/formatting (ESLint + Prettier) and add `npm run test` (Vitest) + `npm run build` scripts in `frontend/package.json`
- [x] T005 [P] Configure backend test runner (JUnit 5 + Spring Boot Test) and build in `backend/pom.xml`; add Maven wrapper
- [x] T006 [P] Create placeholder content JSON directory `backend/src/main/resources/content/` with empty `producers.json`, `upgrades.json`, `trainings.json`, `milestones.json`, `burners.json`

**Checkpoint**: Both projects scaffolded; `mvn` and `npm` build cleanly (empty app).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The pure `advance` simulation core and the data/content layer underpin every story.

### Tests for Foundational (write first, ensure RED)

- [x] T007 [P] Write property test for `advance` determinism/associativity: `advance(advance(s, a), b) === advance(s, a+b)` in `frontend/src/sim/advance.test.ts`
- [x] T008 [P] Write unit test for big-number wrapper (string round-trip, no precision loss, add/multiply) in `frontend/src/sim/bigNumber.test.ts`
- [x] T009 [P] Write unit test for content loader validation (malformed JSON throws, valid JSON parses to typed catalog) in `frontend/src/sim/content.test.ts`
- [x] T010 [P] Write backend test for `GET /api/v1/content` returning valid content JSON in `backend/src/test/java/.../content/ContentControllerTest.java`
- [x] T011 Write integration test for save round-trip (serialize → deserialize → serialize == identical) in `backend/src/test/java/.../state/GameStateRoundTripTest.java`

### Implementation for Foundational

- [x] T012 [P] Implement big-number wrapper around break_eternity.js in `frontend/src/sim/bigNumber.ts` (string in/out, arithmetic helpers)
- [x] T013 [P] Implement `GameState` + shared value-type TS types (ResourceSet, BurnerState, Cost, Requirement, Effect) in `frontend/src/sim/types.ts` matching data-model.md
- [x] T014 Implement content loader `loadContent(contentJson) -> ContentCatalog` with validation in `frontend/src/sim/content.ts`
- [x] T015 Implement the pure deterministic `advance(state, dt) -> state` core in `frontend/src/sim/advance.ts` (computeRate, burner fuel consumption, milestone check, lastAdvancedAt update) — NO I/O, NO Phaser imports
- [x] T016 Implement `computeRate(state, content) -> BigNumber` (preview LOC/sec) in `frontend/src/sim/advance.ts` (exported, used by UI and `advance`)
- [x] T017 [P] Implement localStorage save/load + `schemaVersion` migration chain stub in `frontend/src/save/localStorage.ts`
- [x] T018 [P] Implement `GameState` Java DTO + BigDecimal/string big-number handling in `backend/src/main/java/.../state/GameState.java`
- [x] T019 [P] Implement content Java entities (Producer, Upgrade, Training, Milestone, Burner) + JSON loader in `backend/src/main/java/.../content/`
- [x] T020 Implement `ContentController` serving `GET /api/v1/content` from `backend/src/main/resources/content/*.json` in `backend/src/main/java/.../content/ContentController.java`
- [x] T021 Implement JPA persistence layer for player state in `backend/src/main/java/.../state/PlayerStateRepository.java`
- [x] T022 Implement deterministic monotonic merge (max scalars, union ownership sets, max timestamp) in `backend/src/main/java/.../sync/StateMerger.java`
- [x] T023 Implement REST session endpoints (`POST /api/v1/session`, `PUT /api/v1/session/{id}/state`) in `backend/src/main/java/.../session/SessionController.java`
- [x] T024 Implement WebSocket/STOMP config + push-only `StateCorrection`/`ContentUpdate` channels in `backend/src/main/java/.../session/`

**Checkpoint**: Foundational layer ready — pure sim passes property tests, backend serves/saves content and state, merge is correct. User story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - The Dev at Work (Priority: P1) 🎯 MVP

**Goal**: Watch the dev produce LOC over real time in a top-down pixel office; manual boost; offline progress honored; progress persists.

**Independent Test**: Load game → LOC increases per second → interact for boost → close tab, wait N minutes → reopen → LOC grew by ~rate×N, state restored (quickstart.md Scenario 1).

### Tests for User Story 1 (write first, ensure RED)

- [x] T025 [P] [US1] Write property test for offline catch-up: large `dt` (minutes/hours) yields expected LOC within tolerance in `frontend/src/sim/advance.test.ts`
- [x] T026 [P] [US1] Write test for manual-boost mutator (discrete action then `advance` catch-up) in `frontend/src/sim/actions.test.ts`
- [x] T027 [P] [US1] Write integration test for localStorage save → reload restores identical `GameState` in `frontend/src/save/localStorage.test.ts`
- [x] T028 [P] [US1] Write integration test for backend session: save then load returns same state in `backend/src/test/java/.../session/SessionControllerTest.java`

### Implementation for User Story 1

- [x] T029 [P] [US1] Implement manual-boost action mutator in `frontend/src/sim/actions.ts` (pure; `advance` then catches up)
- [x] T030 [P] [US1] Implement REST client (`getContent`, `loadSession`, `saveState`) in `frontend/src/net/restClient.ts`
- [x] T031 [P] [US1] Implement STOMP client (subscribe `StateCorrection`/`ContentUpdate`) in `frontend/src/net/stompClient.ts`
- [x] T032 [US1] Implement game loop wiring: tick `advance` each frame using real elapsed `dt`, re-anchor `lastAdvancedAt` on load, catch up offline on load in `frontend/src/game/gameLoop.ts`
- [x] T033 [P] [US1] Acquire/create top-down pixel-art office tilemap + dev sprite (Tiled export) in `frontend/public/assets/`
- [x] T034 [US1] Implement Phaser office scene: load tilemap, render dev sprite at workstation with idle animation in `frontend/src/scenes/OfficeScene.ts`
- [x] T035 [US1] Implement HUD overlay: LOC counter (live, big-number formatted), manual-boost interaction bound to scene click in `frontend/src/scenes/HudScene.ts`
- [x] T036 [US1] Wire end-to-end: new player starts at zero → fetch content → start loop → render office → save on close/periodically → restore on reload in `frontend/src/main.ts`
- [x] T037 [US1] Seed initial content for US1 (manual_typing + 1-2 early producers, their costs/growth) in `backend/src/main/resources/content/producers.json`

**Checkpoint**: US1 fully functional and independently testable. This is the shippable MVP — the idle core + the visual world.

---

## Phase 4: User Story 2 - Cash & the Token Burner (Priority: P2)

**Goal**: Convert LOC → Cash, buy the AI-token burner, activate it to multiply LOC/sec while burning fuel.

**Independent Test**: Accumulate LOC → cash out → buy burner → activate → LOC/sec multiplies while tokens deplete → returns to baseline when out (quickstart.md Scenario 2).

### Tests for User Story 2 (write first, ensure RED)

- [ ] T038 [P] [US2] Write tests for `cashOut`, `purchaseUpgrade`, `activateBurner` mutators (affordability, `InsufficientResourcesError` on failure, no partial mutation) in `frontend/src/sim/actions.test.ts`
- [ ] T039 [P] [US2] Write `advance` test: active burner multiplies rate and consumes fuel; fuel exhaustion sets `activeBurner=null` in `frontend/src/sim/advance.test.ts`

### Implementation for User Story 2

- [ ] T040 [P] [US2] Implement `cashOut`, `purchaseUpgrade`, `activateBurner` action mutators in `frontend/src/sim/actions.ts`
- [ ] T041 [US2] Implement economy UI panel: cash display, cash-out button, upgrade shop, burner activation with fuel/fuel-remaining display in `frontend/src/scenes/EconomyScene.ts`
- [ ] T042 [US2] Wire economy panel into game loop: `computeRate` reflects active burner multiplier live; bind purchase/activate to mutators in `frontend/src/game/gameLoop.ts`
- [ ] T043 [P] [US2] Seed US2 content (cash conversion rate, AI-token burner def with fuel cost/burn rate/multiplier, at least one economy upgrade) in `backend/src/main/resources/content/`

**Checkpoint**: US1 and US2 both work independently. The reinvest tension loop is complete.

---

## Phase 5: User Story 3 - lise Academy Progression (Priority: P3)

**Goal**: Buy lise Academy trainings for permanent production boosts; reach credential milestones that unlock and reward.

**Independent Test**: Buy training → production permanently increases → reach milestone requirement → it registers as earned and grants reward → both persist across reload (quickstart.md Scenario 3).

### Tests for User Story 3 (write first, ensure RED)

- [ ] T044 [P] [US3] Write tests for `purchaseTraining` (permanent multiplier persists across `advance` and reload) in `frontend/src/sim/actions.test.ts`
- [ ] T045 [P] [US3] Write `advance` test: milestone requirement met → id appended to `earnedMilestones` and reward applied in `frontend/src/sim/advance.test.ts`

### Implementation for User Story 3

- [ ] T046 [P] [US3] Implement `purchaseTraining` mutator in `frontend/src/sim/actions.ts`
- [ ] T047 [US3] Implement milestone evaluation in `advance` (check requirements, append earned, apply reward) in `frontend/src/sim/advance.ts`
- [ ] T048 [US3] Implement Academy UI panel: training list (affordable/locked states), milestones/credentials display (earned lise-themed badges) in `frontend/src/scenes/AcademyScene.ts`
- [ ] T049 [US3] Wire Academy panel into game loop: permanent boosts reflected in `computeRate`, milestones evaluate each tick in `frontend/src/game/gameLoop.ts`
- [ ] T050 [P] [US3] Seed US3 content (lise Academy trainings; credential milestones: "ISO 9001 Certified", "Microsoft Gold Partner", "AI Design Sprint Facilitator") in `backend/src/main/resources/content/`

**Checkpoint**: All three stories independently functional. Permanent progression + long-term goals complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements affecting multiple stories and production readiness.

- [ ] T051 [P] Add numeric-integrity test: very large LOC values display and advance correctly (no NaN/Infinity) in `frontend/src/sim/bigNumber.test.ts`
- [ ] T052 [P] Add offline-capable test: Scenarios 1–3 pass with backend unreachable (sync deferred) in `frontend/tests/offline.test.ts`
- [ ] T053 [P] Add corrupted-save test: invalid JSON refused safely without touching valid data in `frontend/src/save/localStorage.test.ts`
- [ ] T054 [P] Add backend migration test: older `schemaVersion` save migrates forward, progress preserved in `backend/src/test/java/.../state/MigrationTest.java`
- [x] T055 [P] Write backend `Dockerfile` (Java 25 runtime, multi-stage build) in `backend/Dockerfile`
- [x] T056 [P] Write frontend production build + static serve config (Vite build, nginx or Traefik static) in `frontend/Dockerfile`
- [x] T057 Configure root `docker-compose.yml`: backend + frontend services, volumes for `/mnt/user/appdata/lise-game`, NPM-published host ports (8086/8087) in `docker-compose.yml`
- [ ] T058 Deploy to Unraid host (`root@schmitz.gg:2222`): create `/mnt/user/appdata/lise-game`, bring up compose stack behind existing Traefik in `docker-compose.yml`
- [ ] T059 Performance validation: confirm `advance` is O(active features) not O(dt) for multi-day offline catch-up (profile + property test) in `frontend/src/sim/advance.test.ts`
- [ ] T060 [P] Documentation: update `README.md` with run/build/deploy instructions and link to quickstart.md
- [ ] T061 Run full `quickstart.md` validation (Scenarios 0–4) end-to-end on the deployed stack

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T002 blocks backend work; T003 blocks frontend work.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories. T015 (`advance` core) and T022 (merge) are the load-bearing tasks.
- **User Stories (Phase 3+)**: All depend on Phase 2 completion:
  - **US1 (Phase 3)** depends on Phase 2 only — the MVP.
  - **US2 (Phase 4)** depends on Phase 2; integrates with US1's economy but independently testable.
  - **US3 (Phase 5)** depends on Phase 2; integrates with US1/US2 but independently testable.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Start after Phase 2. No dependency on other stories. **= MVP**
- **US2 (P2)**: Start after Phase 2. May integrate with US1 (cash/burner build on LOC) but independently testable.
- **US3 (P3)**: Start after Phase 2. May integrate with US1/US2 but independently testable.

### Within Each User Story (TDD — Constitution Principle III)

- Tests written, approved, and RED **before** implementation (test tasks precede impl tasks in each phase)
- Pure sim / models before scenes/UI
- Backend content seeding before/alongside UI that consumes it
- Story complete (GREEN) before moving to next priority

### Parallel Opportunities

- Phase 1: T003–T006 parallel; T002 independent
- Phase 2: tests T007–T011 parallel; impls T012/T013/T017–T019 parallel
- Phase 3: tests T025–T028 parallel; assets T033 parallel with sim work
- All Foundational-done stories can start in parallel by different devs

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Property test for offline catch-up in frontend/src/sim/advance.test.ts"
Task: "Test for manual-boost mutator in frontend/src/sim/actions.test.ts"
Task: "Integration test for localStorage round-trip in frontend/src/save/localStorage.test.ts"

# Launch independent impl + assets in parallel:
Task: "Implement manual-boost mutator in frontend/src/sim/actions.ts"
Task: "Acquire/create pixel-art office tilemap in frontend/public/assets/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart.md Scenario 1 end-to-end
5. Deploy if ready (T057–T058)

### Incremental Delivery

1. Setup + Foundational → core layer ready
2. Add US1 → test independently → deploy/demo (**MVP!**)
3. Add US2 → test independently → deploy
4. Add US3 → test independently → deploy
5. Polish phase → production hardening

---

## Notes

- **TDD is mandatory** (Constitution Principle III, non-negotiable): every test task must be RED before its sibling implementation.
- The pure `advance` sim (`frontend/src/sim/`) MUST stay I/O-free and Phaser-free so it is unit-testable in isolation and determinism holds (Constitution Principle I).
- Big numbers are strings end-to-end (never `double`) — Constitution integrity + numeric-stability constraint.
- Commit after each task or logical group; one branch per feature (`001-dev-idle-game`).
