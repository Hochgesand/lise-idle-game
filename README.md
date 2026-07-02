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
> [`.specify/`](.specify) — see [specification](specs/001-dev-idle-game/)
> (Spec 001: core idle loop) and
> [specification](specs/002-shared-office-coop/) (Spec 002: shared-office
> co-op presence + Keycloak auth).

## Repository Structure

Two-project monorepo:

```text
lise-idle-game/
├── backend/              # Spring Boot 4.1 (Java 25): persistence, sync, content, OAuth2 resource server
├── frontend/             # Phaser 4 + TypeScript + Vite: renderer + pure sim + OIDC (oidc-client-ts)
├── docker-compose.yml    # PROD stack: backend + frontend services (host ports :8086/:8087)
├── docker-compose.dev.yml# local-dev override: dev profile + in-memory H2 + local API base URLs
├── .github/workflows/docker-publish.yml  # CI: build + publish images to GHCR on push to main
├── .claude/skills/deploy-lise-game/SKILL.md  # pull-based deploy procedure
├── specs/001-dev-idle-game/   # Spec 001: spec, plan, research, data-model, contracts
├── specs/002-shared-office-coop/  # Spec 002: shared-office co-op presence
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

## Keycloak / OIDC (Spec 002)

Spec 002 adds sign-in via Keycloak (OIDC Authorization Code + PKCE). The
backend is an OAuth2 resource server validating JWTs from the `LiseIdler`
realm. The realm, clients, and test users are **owner-managed in the
Keycloak admin console** — they are NOT part of this repo or the deploy.

| Item | Value |
|------|-------|
| **Realm** | `LiseIdler` |
| **Issuer URI** | `https://keycloak.novitasoft.de/realms/LiseIdler` |
| **Admin console** | <https://keycloak.novitasoft.de/admin/master/console/#/LiseIdler> |
| **Frontend client** | `lise-idler-frontend` — **public** (client auth OFF), **PKCE enabled**, requests scope `openid profile` |
| **Backend client** | `lise-idler-backend` — **confidential** (client auth ON), service-account roles enabled |
| **Test users** | `alice`, `bob` (un-consented on first run; the FR-003 consent flow stays exercisable) |

### Secret policy (IMPORTANT)

The `lise-idler-backend` **client secret is the only secret in the stack**,
and it lives **ONLY** in the untracked, gitignored host-side `.env` at
**`/mnt/user/appdata/lise-game/.env`** on the Unraid host:

```
KEYCLOAK_BACKEND_CLIENT_SECRET=<the value>
```

- `docker-compose.yml` **interpolates** this variable into the backend
  environment (`KEYCLOAK_BACKEND_CLIENT_SECRET=${KEYCLOAK_BACKEND_CLIENT_SECRET}`);
  it **NEVER appears in any tracked file** (no literal in compose, no image,
  no runtime config).
- `.env` is gitignored and **not committed**. If it is missing on the host,
  **compose interpolation fails and the deploy aborts** — that is the safety
  net.
- **Never `cat`, `echo`, log, or paste the secret value.**
- **Rotation is an owner task** (T003a): regenerate in the Keycloak admin
  console (Clients → `lise-idler-backend` → Credentials → Regenerate), then
  update **only** the host `.env`. The new value never lands in any tracked
  file. Note this repo (`Hochgesand/lise-idle-game`) is **public**, so a
  plaintext secret committed anywhere is immediately exposed — hence the
  host-`.env`-only policy.

See [`.claude/skills/deploy-lise-game/SKILL.md`](.claude/skills/deploy-lise-game/SKILL.md)
for the host location and the full deploy procedure.

## Local Development with Docker Compose

The base [`docker-compose.yml`](docker-compose.yml) **IS the prod stack**
(Unraid host, file-backed H2 on the appdata bind mount, frontend baked
against the public `lise-game-api.schmitz.gg` domains). For a
self-sufficient local dev machine, use the
[`docker-compose.dev.yml`](docker-compose.dev.yml) override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
# Validate the merged config (a warning about unset
# KEYCLOAK_BACKEND_CLIENT_SECRET is expected/OK):
docker compose -f docker-compose.yml -f docker-compose.dev.yml config -q
```

The override changes only what must differ for local dev:

- **backend** → Spring **`dev`** profile (enables `DevPresenceSeeder` for
  synthetic crowds/commuters) **+ in-memory H2**
  (`jdbc:h2:mem:gamedb;DB_CLOSE_DELAY=-1;MODE=PostgreSQL`), so the
  Unraid-only `/mnt/user/appdata/lise-game` bind mount is not required.
- **frontend** → baked against the **local** backend
  (`VITE_API_BASE_URL=http://localhost:8086`,
  `VITE_WS_BASE_URL=ws://localhost:8086/ws`), so a locally built frontend on
  `:8087` talks to the local compose backend, never the prod API.

Identity is **NOT stubbed**: the real `LiseIdler` Keycloak realm is used in
dev exactly as in prod. Changing the frontend build args requires rebuilding
the image (`... build frontend`).

> Alternative day-to-day combo: Vite dev server on `:5173` + compose backend
> — set `VITE_API_BASE_URL=http://localhost:8086` /
> `VITE_WS_BASE_URL=ws://localhost:8086/ws` in `frontend/.env.local`
> (code defaults to `http://localhost:8080`).

## CI Image Pipeline (GHCR)

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds both container images and pushes them to the **GitHub Container
Registry** on every push to `main` (and on `v*` tags), so the host deploys
by **pulling** prebuilt images instead of building locally:

- `ghcr.io/hochgesand/lise-game-backend:latest`
- `ghcr.io/hochgesand/lise-game-frontend:latest`

Tags produced: `:latest` (on `main`), `:sha-<short>` (every run), `<git-tag>`
(on `v*`). Platform is pinned to `linux/amd64` (the Unraid host is x86_64).
The frontend build-args (prod API/WS hosts) are baked into the Vite bundle
and mirror `docker-compose.yml` exactly.

> For the host to `docker compose pull` **without auth**, both GHCR packages
> must be set to **PUBLIC** in GitHub (package page → Package settings →
> Change visibility). Otherwise authenticate once via
> `printf '%s' "<PAT>" | docker login ghcr.io -u Hochgesand --password-stdin`.

## Deploy

Production runs as **Docker containers on the Unraid host**
(`root@schmitz.gg:2222`, hostname `Neulaender`), app data under
`/mnt/user/appdata/lise-game`, behind **Nginx Proxy Manager (NPM)**
(**not** Traefik — there is no shared proxy Docker network). Two containers:

- `backend` — Spring Boot (container port 8080, published host `:8086`)
- `frontend` — static Vite build served by nginx (container port 80, published host `:8087`)

NPM proxy hosts map the public domains onto the host ports:

- Frontend → `https://lise-game.schmitz.gg` → `:8087`
- Backend  → `https://lise-game-api.schmitz.gg` → `:8086` (`/api`, `/ws`, with
  **"Websockets Support" ON** for the STOMP `/ws` endpoint). SSL terminates
  at NPM (Let's Encrypt); traffic to the containers is plain HTTP.

Backend state (H2 file DB, saves) is persisted to the
`/mnt/user/appdata/lise-game:/data` bind mount.

### Deploying with the `deploy-lise-game` skill

Every deploy goes through the
[`deploy-lise-game` Claude Code skill](.claude/skills/deploy-lise-game/SKILL.md),
which encodes a **pull-based** procedure. The golden rule is **push first** —
CI builds images off `origin/main`, and the host pulls those prebuilt images
from GHCR, so the host only ever gets new code **after** you push to `main`
(and the GitHub Actions run goes green). In the normal pull flow the repo is
**not** checked out on the prod host — the deploy dir holds only
`docker-compose.yml` + `.env` + `data/`, so there is no `git pull` on the host
(the build-fallback path in the skill clones the repo temporarily):

```bash
# 1. locally: commit + push to origin main
git push origin main

# 2. host pulls the freshly built CI images, then recreates containers
ssh -p 2222 root@schmitz.gg \
  "cd /mnt/user/appdata/lise-game && docker compose pull && docker compose up -d"
```

The skill covers: the push-first rule; the pull-based procedure (with a
`docker compose build` fallback when `pull` fails); host facts (NPM routing,
non-root `lise` user `uid 100`); Keycloak env expectations (issuer URI,
client id, secret-from-`.env`); and the verification checklist (frontend
loads, `GET …/api/v1/content` → 200, STOMP `/ws` connects, containers `Up`,
Keycloak login round-trips from Phase 4 on).

> Final routing/deploy steps live in
> [specs/001-dev-idle-game/quickstart.md](specs/001-dev-idle-game/quickstart.md)
> and
> [specs/002-shared-office-coop/quickstart.md](specs/002-shared-office-coop/quickstart.md).

## Validation

End-to-end scenarios (services up, idle production + offline progress,
cash/token-burner loop, Academy progression, save integrity & migration) are
documented in
[specs/001-dev-idle-game/quickstart.md](specs/001-dev-idle-game/quickstart.md).
Spec 002 validation scenarios (two-browser `alice`/`bob` presence, co-op
bonus, live commutes, backend-down degradation, phone-portrait legibility)
are documented in
[specs/002-shared-office-coop/quickstart.md](specs/002-shared-office-coop/quickstart.md).
