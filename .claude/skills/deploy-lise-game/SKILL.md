---
name: deploy-lise-game
description: Deploy the Lise idle game to the Unraid prod host (Neulaender / schmitz.gg:2222) and verify it is live. Use whenever a deploy task (T009, T036, T052, T067, T075, T083, T090) says "deploy to prod & verify", or when redeploying main.
---

# Deploy Lise Game

Encodes the full deploy procedure so every later deploy task can invoke it.
Source of truth for the prod environment at `https://lise-game.schmitz.gg`.

## 0. Golden rule: PUSH FIRST

The prod host **pulls from `origin main`**
(`https://github.com/Hochgesand/lise-idle-game.git`). What is checked out
locally is irrelevant — only what is on GitHub gets deployed.

**Before running any deploy command you MUST:**

1. Commit all changes for this phase.
2. `git push origin main` and confirm `origin/main` advanced.

Sanity-check before you SSH in:

```bash
git status                 # expect: clean working tree, on main
git log -1 origin/main     # confirm this is the commit you intend to ship
```

Do **not** deploy off an unpushed local branch, off `main` without confirming
the push landed, or off a tag the host doesn't fetch. If `git push` fails
(rejected, behind, permissions) — **stop** and resolve it: deploying a stale
tree wastes a build and serves old code.

## 1. Procedure

Two equivalent forms. Prefer the one-liner.

**One-liner** — the host runs the whole chain:

```bash
ssh -p 2222 root@schmitz.gg "cd /mnt/user/appdata/lise-game && git pull && docker compose pull && docker compose up -d"
```

**Stepped** — interactive, for debugging:

```bash
ssh -p 2222 root@schmitz.gg
# on the host:
cd /mnt/user/appdata/lise-game
git pull
docker compose pull
docker compose up -d
exit
```

What each step does:

- `git pull` — fast-forwards `/mnt/user/appdata/lise-game` to `origin/main`. This is
  still required: `docker-compose.yml` is the source of the `image:` refs,
  the env, the ports, and the host `.env` secret. The repo MUST match the
  images you are about to pull.
- `docker compose pull` — pulls the **CI-built** images from GHCR
  (`ghcr.io/hochgesand/lise-game-backend:latest` and
  `…/lise-game-frontend:latest`), built by `.github/workflows/docker-publish.yml`
  on every push to `main`. Because `docker-compose.yml` sets BOTH `image:`
  and `build:` per service, `pull` fetches the prebuilt image (no local
  build, no toolchain on the host).
- `docker compose up -d` — recreates changed containers with the freshly
  pulled images, leaving volumes (`/data`) intact.

### FALLBACK: `pull` failed → `docker compose build`

If `docker compose pull` fails (image not yet built, package not public, or
  GHCR unreachable), **fall back to building locally on the host**:

```bash
ssh -p 2222 root@schmitz.gg "cd /mnt/user/appdata/lise-game && git pull && docker compose build && docker compose up -d"
```

This is the pre-GHCR procedure and still works because every service keeps
its `build:` block. The frontend `build` bakes `VITE_API_BASE_URL` /
`VITE_WS_BASE_URL` at build time, so the locally built image is identical to
the CI one. Use the fallback only when `pull` is blocked; prefer `pull` for
normal deploys (faster, no Maven/Node on the host).

> **NOTE — GHCR package visibility (REQUIRED for unauthenticated pulls).**
> For the host to `docker compose pull` **without** authenticating, the two
> packages must be set to **PUBLIC** in GitHub:
> `ghcr.io/hochgesand/lise-game-backend` and
> `ghcr.io/hochgesand/lise-game-frontend` → (package page) **Package
> settings → Change visibility → Public**. If they stay private, every pull
> fails until either (a) they are made public, or (b) the host runs, **once**,
> an authenticated GHCR login. Do NOT pass the PAT on the command line
> (`-p <PAT>` leaks it into shell history + the process list); pipe it via
> stdin instead:
> `printf '%s' "<PAT>" | docker login ghcr.io -u Hochgesand --password-stdin`
> (a PAT with `read:packages`).
>
> **NOTE — first deploy after enabling this requires a green CI run.** The
> images do not exist in GHCR until `.github/workflows/docker-publish.yml`
> runs successfully on `main`. The very first deploy with the pull-based
> procedure must happen **after** the owner confirms the GitHub Actions run
> (triggered by the push that added the workflow + `image:` refs) completed
> and published both packages. Until then, `pull` will 404/manifest-unknown —
> use the `build` fallback above for that one deploy.

## 2. Host facts (Neulaender)

- **Unraid server** hostname **`Neulaender`**, reachable as
  **`root@schmitz.gg`** on **port `2222`** (**key auth only**).
- The repo lives at **`/mnt/user/appdata/lise-game`** on the host.
- **Reverse proxy is Nginx Proxy Manager (NPM), NOT Traefik.** There is no
  shared proxy Docker network. Containers simply publish host ports and NPM
  maps the public domains onto them:
  - `lise-game.schmitz.gg` → host **`:8087`** — frontend (nginx static,
    container port 80).
  - `lise-game-api.schmitz.gg` → host **`:8086`** — backend (container port
    8080), serving `/api` + `/ws`. **"Websockets Support" must be enabled**
    on that NPM proxy host for the STOMP `/ws` endpoint.
  - **SSL terminates at NPM** (Let's Encrypt certs, configured in the NPM
    UI/API). All traffic from NPM to the containers is plain HTTP.
- **Frontend image** bakes, as compose build-args:
  - `VITE_API_BASE_URL=https://lise-game-api.schmitz.gg`
  - `VITE_WS_BASE_URL=wss://lise-game-api.schmitz.gg/ws`
- **Backend image/container:**
  - `SPRING_PROFILES_ACTIVE=prod`.
  - H2 **file** DB at `jdbc:h2:file:/data/gamedb`, under the bind-mounted
    `/data` (host path **`/mnt/user/appdata/lise-game`**).
  - `ddl-auto: update`.
  - Runs as non-root user **`lise`** (`uid 100`, `gid 101`), who owns `/data`
    (H2 must be able to write the `gamedb.*` files there). Container security
    is **not** weakened to achieve this — the image sets `USER lise`.
- **Backend secret on the host** — the UNTRACKED, gitignored file
  **`/mnt/user/appdata/lise-game/.env`** holds:

  ```
  KEYCLOAK_BACKEND_CLIENT_SECRET=<the value — DO NOT echo it>
  ```

  `docker-compose.yml` interpolates this variable into the backend
  environment (added in T005). **Document this location.** **NEVER `cat`,
  `echo`, log, or paste the secret value.** If the file/variable is missing
  on the host, **compose interpolation fails** and the deploy aborts — so the
  `.env` **must exist on the host** (it is not part of this repo; it never
  gets committed).

## 3. Keycloak environment expectations

- **Issuer URI:** `https://keycloak.novitasoft.de/realms/LiseIdler`
  (configured in the backend prod profile as the OAuth2 resource-server
  issuer).
- **Backend client id:** `lise-idler-backend` (confidential client). Its
  **secret comes from the host `.env`** (`KEYCLOAK_BACKEND_CLIENT_SECRET`,
  see §2 / T005) — never from any tracked file.
- The Keycloak realm/client/user configuration itself (realm `LiseIdler`,
  clients `lise-idler-frontend` / `lise-idler-backend`, test users
  `alice`/`bob`, protocol mappers, redirect URIs / web origins) is
  **owner-managed in the Keycloak admin console** — it is **NOT** part of
  this deploy. If a Keycloak endpoint 404s or token validation fails after a
  deploy, check the realm/client config in the console, not the deploy
  procedure.

## 4. Verification checklist

Run **after** `docker compose up -d` returns. Do them in order; the first
failure is the bug to chase.

1. **Frontend loads** — open `https://lise-game.schmitz.gg` in a browser
   (the SPA shell should render).
2. **API is up and serving content:**

   ```bash
   curl -fsS https://lise-game-api.schmitz.gg/api/v1/content
   ```

   Expect **HTTP 200** with the content JSON (including the `coop` block
   from Phase 2 onward).
3. **WebSocket / STOMP connects** — connect to
   `wss://lise-game-api.schmitz.gg/ws` and confirm the STOMP handshake
   succeeds. Easiest via the running frontend; otherwise a small STOMP
   client script. A failure here usually means "Websockets Support" got
   toggled off on the NPM API proxy host.
4. **Backend container is healthy:**

   ```bash
   ssh -p 2222 root@schmitz.gg "docker compose -f /mnt/user/appdata/lise-game/docker-compose.yml ps"
   ```

   Expect both `lise-game-backend` and `lise-game-frontend` `Up`, and the
   backend **not** restarting in a loop.
5. **(From Phase 4 onward — T067 and later)** **Login round-trips via
   Keycloak** — from `https://lise-game.schmitz.gg`, the sign-in flow
   redirects to `keycloak.novitasoft.de` (realm `LiseIdler`) and, after
   login, returns to the SPA authenticated. Before Phase 4 this step is N/A.

If a phase's deploy task lists extra phase-specific checks (e.g. the `coop`
block present, anonymous session round-trips at `schemaVersion` 2,
`/api/v1/me` → 401 without a token, two-browser `alice`/`bob` presence,
phone-portrait spot-checks), run those too — they live in the task, not here.

## 5. Troubleshooting (quick)

- **Deploy serves old code after a push:** the host `git pull` didn't
  advance — re-check `git log -1 origin/main` vs the commit you pushed. You
  must have pushed to `origin main` (push-first rule). With the pull-based
  flow, also confirm the GitHub Actions run for that push **succeeded**
  (the `:latest` image only advances after a green build); a failed/skipped
  CI run means `pull` fetches the previous image.
- **`docker compose pull` fails (404 / manifest unknown / unauthorized):**
  either the image isn't published yet, the GHCR package is private, or the
  CI run is still running/failed. Check: (1) the GitHub Actions run for the
  push is **green**; (2) the packages
  `ghcr.io/hochgesand/lise-game-{backend,frontend}` are **PUBLIC** (see §1
  NOTE) or the host ran `docker login ghcr.io` once; (3) if you can't fix it
  now, **fall back to `docker compose build`** (see §1 FALLBACK) for this
  deploy.
- **Frontend shows stale API/WS URLs:** the values are **baked into the
  image at build time**. With CI, the image is rebuilt on every push to
  `main`; re-`pull` after the green run. If you fell back to a local
  `docker compose build`, that build also bakes the prod URLs (they come
  from `docker-compose.yml` `build.args`), so `up -d` after the build is
  enough — but `up -d` alone (no `pull`/`build`) is **never** enough.
- **`docker compose pull`/`build`/`up` fails on interpolation
  (`KEYCLOAK_BACKEND_CLIENT_SECRET`):** the host `.env` is missing or lacks
  the var — confirm `/mnt/user/appdata/lise-game/.env` exists (**do not print it**).
- **WS won't connect but `/api` is fine:** "Websockets Support" on the NPM
  proxy host for `lise-game-api.schmitz.gg` is OFF — re-enable it in the
  NPM UI.
- **Backend restart-loop / can't write `/data`:** the appdata dir ownership
  drifted off `uid 100 / gid 101`; on the host run
  `chown -R 100:101 /mnt/user/appdata/lise-game`.
