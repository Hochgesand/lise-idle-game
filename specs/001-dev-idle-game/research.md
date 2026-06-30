# Research: Lise Dev Idle Game

**Feature**: 001-dev-idle-game
**Date**: 2026-06-30
**Purpose**: Resolve all deferred tech decisions required by the constitution
(language/runtime, persistence/save format, target platform, theme scope).

## Decision Summary

| Area | Decision | Key alternative rejected |
|------|----------|--------------------------|
| Frontend engine | **Phaser 4 + TypeScript** | PixiJS (renderer only) |
| Simulation core | **Pure TS function `advance(state, dt)`**, client-side | Server-authoritative tick |
| Backend | **Spring Boot 4.1 (Java 25)** | Node/Express |
| Backend role | **Persistence + sync + content-serving** (not the tick loop) | Backend runs sim |
| Client persistence | **localStorage** | IndexedDB |
| Big numbers (client) | **break_eternity.js** | decimal.js |
| Big numbers (server) | **BigDecimal** (Java stdlib) | double |
| Live channel | **WebSocket / STOMP** | Polling REST |
| Content/balance data | **JSON served from backend** | Hardcoded in client |
| Tilemap authoring | **Tiled** (.tmx/.json export) | Hand-authored maps |
| Build/bundler | **Vite 8** | Webpack |
| Frontend tests | **Vitest** | Jest |
| Backend tests | **JUnit 5 + Spring Boot Test** | — |
| Deployment | **Docker on Unraid (schmitz.gg)** behind Traefik | Bare metal |

---

## Architectural Decision: Where does the simulation live?

### Decision
The idle-game core is a **single pure, deterministic TypeScript function**
`advance(state, deltaTime) -> state`, running **client-side**. The Spring
Boot backend does **not** run the tick loop; it is responsible for
**authoritative persistence, multi-device sync, and serving content/balance
data as JSON**.

### Rationale
- **Constitution Principle I** demands the simulation be pure and
  deterministic so offline progress and save round-trips are trivially
  correct. A pure client function satisfies this directly and makes the
  simulation fully unit-testable (Principle III).
- **Constitution Principle IV** requires the core loop to be playable
  offline. The client must therefore be able to advance its own state from
  a local snapshot + elapsed time without a server round-trip. If the
  server were the sole tick source, offline play would be impossible.
- **Single source of truth:** because only the client runs the sim, the
  advance logic exists in exactly one place (TypeScript). Putting it also in
  Java would duplicate the core and risk determinism divergence on
  reconciliation — rejected.
- The user-specified **Spring Boot backend** is fully honored, but in its
  highest-value role for an idle game: durable saves, cross-device sync, and
  data-driven content (Principle II), where a typed Java/SQL backend excels.

### Alternatives considered
- **Server-authoritative tick (backend advances state):** rejected — breaks
  offline play (Principle IV) and forces the pure sim to be duplicated in
  two languages.
- **Client-only, no backend:** rejected — user explicitly requires a Spring
  Boot backend, and durable/cross-device saves need server persistence.

---

## Decision: Multi-device / conflict reconciliation

### Decision
Because `advance` is deterministic and idle resources are monotonic
(production only adds; upgrades are additive), sync reconciliation is a
**deterministic monotonic merge**:

1. Client connects, sends local `{state, lastAdvancedAt}`.
2. Server loads authoritative `{serverState, serverLastAdvancedAt}`.
3. Advance **both** states to wall-clock `now` using the pure rule (done
   client-side for the client copy; the server stores pre-computed
   snapshots).
4. Merge per field: **max** for scalar resources/counts; **union** for owned
   upgrades/trainings; **max(lastAdvancedAt)** for the timestamp.
5. Persist merged result; return to client.

### Rationale
Idle-game state is monotonic by genre, so "max + union" is conflict-free and
deterministic — no last-writer-wins data loss (Principle IV integrity).

### Alternatives considered
- **Last-write-wins:** rejected — loses accumulated progress on conflict.
- **Server recomputes from scratch:** rejected — would require the sim in
  Java (duplication) and full event log (over-engineered for MVP, violates
  Principle V).

---

## Decision: Numeric representation across the wire

### Decision
Resources can grow astronomically (idle genre). Use **break_eternity.js**
on the client (represents numbers beyond `Number.MAX_VALUE`). Across the
REST/WebSocket boundary and in the DB, **serialize big numbers as strings**
(parseable by both sides). The Java side stores/validates them as
`BigDecimal` (or a string column), never as `double`.

### Rationale
`double` would lose precision and break determinism (Principle I) and
integrity (Principle IV). String serialization is lossless and
language-agnostic.

---

## Decision: Frontend engine — Phaser 4

### Decision
**Phaser 4** (TypeScript) for the top-down pixel-art world: scene
management, sprite/animation, tilemap loading (Tiled `.json` export), and
input. Vite 8 as the dev server/bundler; Vitest for unit tests of the pure
sim core (Phaser is the renderer, not the sim).

### Rationale
Phaser is a complete, batteries-included 2D game framework (40k★, actively
maintained, current v4) purpose-built for browser games. For a top-down
pixel-art office with sprites and tilemaps it provides everything needed,
unlike PixiJS which is renderer-only and would require hand-rolling scene,
input, and animation systems.

### Alternatives considered
- **PixiJS (47k★):** rejected — renderer only; we'd rebuild Phaser's
  scene/input/tilemap layer. More code for no gain.
- **melonJS / ct.js:** rejected — smaller ecosystems, less mainstream.

---

## Decision: Content & balance data

### Decision
All game content (producers, upgrades, training, milestones, formulas) is
authored as **JSON data**, versioned in the repo, and **served by the Spring
Boot backend**. The client fetches it on load and the pure sim reads it.
Changing a balance number never touches control-flow code.

### Rationale
Directly implements **Constitution Principle II** (data-driven content) and
centralizes the single source of truth for balance on the backend.

---

## Decision: Deployment target

### Decision
Deploy as **Docker containers on the Unraid host** (`root@schmitz.gg:2222`,
host "Neulaender"), app data under `/mnt/user/appdata/lise-game`, fronted by
the existing **Traefik** reverse proxy. Two containers: `backend` (Spring
Boot) and the static frontend (served by Traefik directly or a small nginx).
Host has Docker 29.5.2, Node 22 (build only), no host Java — so the backend
runs inside its container.

### Rationale
Matches the available infrastructure exactly. Docker keeps the JVM off the
host and makes the Spring Boot service self-contained.

---

## Decision: Theme scope ("Lise")

### Decision
Lore is flavor only, themed on real lise.de assets: the dev works at
**lise GmbH**; **lise Academy** = the training/skill tree; credential
milestones reuse real themes (**ISO 9001** quality certification,
**Microsoft Gold Partner**, **AI Design Sprint Facilitator**, "bester
Arbeitgeber"); the token-burner tiers map to the company's AI-solution
ladder (Copilot → autonomous AI agent). No private lise repos are used
(the named repos are 404/private; only public `mongomigration` and
`fluxflow` exist, neither needed here).

### Rationale
Grounds the game in recognizable, on-brand flavor without depending on
private material. Adjust freely.

---

## Open visual item (deferred to clarify, not blocking)

The reference concept image is not machine-readable in this environment.
Exact office layout / sprite scale (16×16 vs 32×32) is confirmed during
`/speckit.clarify` and asset creation — it does not affect the architecture
or contracts above.
