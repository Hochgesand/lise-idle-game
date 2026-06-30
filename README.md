# Lise Dev Idle Game

A browser-based idle game with a top-down pixel-art view, where you play a
software developer working at the [lise GmbH](https://www.lise.de).

Watch your dev produce Lines of Code (LOC) over real time — even while
you're away — cash them out, and reinvest in AI-token accelerators that burn
fuel for a massive production boost. Train up via the **lise Academy** and
chase credential milestones (ISO 9001, Microsoft Gold Partner, …).

The core is a **pure, deterministic `advance(state, dt)`** simulation that
runs client-side, so offline progress and save integrity are trivially
correct. A Spring Boot backend handles durable persistence, multi-device
sync, and serves versioned content/balance JSON.

> 🚧 **Work in progress.** Built per the spec-kit workflow in
> [`.specify/`](.specify) — see [specification](specs/001-dev-idle-game/).

## Repository Structure

Two-project monorepo:

```text
lise-idle-game/
├── backend/              # Spring Boot 4.1 (Java 25): persistence, sync, content
├── frontend/             # Phaser 4 + TypeScript + Vite: renderer + pure sim
├── docker-compose.yml    # backend + frontend services behind Traefik
├── specs/001-dev-idle-game/   # spec, plan, research, data-model, contracts
└── .specify/             # spec-kit workflow tooling
```

The pure simulation lives under `frontend/src/sim/` and is deliberately
isolated (no Phaser, no network imports) so it is unit-testable in isolation.

## Prerequisites (local dev)

- **Node.js 22+** and **npm** (frontend dev / build)
- **JDK 25+** and **Maven 3.9+** (backend), or Docker to run the image
- A modern desktop/mobile browser

## Local Development

### Frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run test       # Vitest (pure sim property tests)
npm run build      # production build to frontend/dist
```

### Backend (`backend/`)

```bash
cd backend
./mvnw spring-boot:run    # Spring Boot on http://localhost:8080
./mvnw test               # JUnit 5 + Spring Boot Test
./mvnw clean package      # builds target/*.jar
```

`GET http://localhost:8080/api/v1/content` returns the versioned content JSON
(producers, upgrades, trainings, milestones, burners).

## Deploy

Production runs as **Docker containers on the Unraid host**
(`root@schmitz.gg:2222`), app data under `/mnt/user/appdata/lise-game`,
behind the existing **Traefik** reverse proxy. Two containers:

- `backend` — Spring Boot (container port 8080)
- `frontend` — static Vite build served by nginx (container port 80)

```bash
# On the host (or locally to validate):
docker compose up --build -d
```

Routing is defined via Traefik labels in
[`docker-compose.yml`](docker-compose.yml):

- Frontend → `https://lise-game.schmitz.gg`
- Backend  → `https://lise-game-api.schmitz.gg` (`/api`, `/ws`)

Backend state (H2/Postgres files, saves) is persisted to the
`/mnt/user/appdata/lise-game:/data` bind mount.

> Final routing/deploy steps live in
> [specs/001-dev-idle-game/quickstart.md](specs/001-dev-idle-game/quickstart.md).

## Validation

End-to-end scenarios (services up, idle production + offline progress,
cash/token-burner loop, Academy progression, save integrity & migration) are
documented in
[specs/001-dev-idle-game/quickstart.md](specs/001-dev-idle-game/quickstart.md).
