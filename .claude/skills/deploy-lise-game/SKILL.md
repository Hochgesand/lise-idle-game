---
name: deploy-lise-game
description: Deploy the Lise idle game to the Unraid prod host (Neulaender / schmitz.gg:2222) by pulling CI-built images from GHCR, and verify it is live. Use whenever a deploy task says "deploy to prod & verify", or when redeploying main.
---

# Deploy Lise Game

Source of truth for the prod environment at `https://lise-game.schmitz.gg`.

This is a **pull-based** deploy: GitHub Actions builds the images on push to
`main` and publishes them to GHCR; the Unraid host then **pulls** those
images. There is **no `git checkout` and no on-host build** for a normal
deploy (a local build is only the fallback, §2).

## 0. Golden rule: PUSH FIRST

A code change is shipped only via the GHCR image, and that image is built by
`.github/workflows/docker-publish.yml` **off `origin/main`**. What is checked
out locally is irrelevant — only what is on GitHub gets built and deployed.

**Before running any deploy command you MUST:**

1. Commit the changes.
2. `git push origin main` and confirm `origin/main` advanced.
3. Confirm the GitHub Actions **"Build and publish Docker images"** run for
   that push went **green** — only then does `:latest` advance. A failed or
   still-running run means `docker compose pull` fetches the *previous*
   image.

Sanity-check before you SSH in:

```bash
git status                 # expect: clean working tree, on main
git log -1 origin/main     # confirm this is the commit you intend to ship
```

> Note: the host **no longer runs `git pull`** during a normal deploy. The
> repo is not checked out on the prod host anymore (the old
> `/root/lise-idle-game` checkout is **deprecated** — `/root` is not
> reboot-persistent on Unraid). The deploy dir `/mnt/user/appdata/lise-game`
> holds `docker-compose.yml` + `.env` directly; `docker compose pull` reads
> the `image:` refs from it and fetches from GHCR.

## 1. Procedure (pull-based)

Two equivalent forms. Prefer the one-liner.

**One-liner** — the host runs the whole chain:

```bash
ssh -p 2222 root@schmitz.gg "cd /mnt/user/appdata/lise-game && docker compose pull && docker compose up -d"
```

**Stepped** — interactive, for debugging:

```bash
ssh -p 2222 root@schmitz.gg
# on the host:
cd /mnt/user/appdata/lise-game
docker compose pull      # fetch the :latest images from GHCR (no build)
docker compose up -d     # recreate changed containers; /data volume untouched
exit
```

What each step does:

- `docker compose pull` — pulls the **CI-built** images from GHCR
  (`ghcr.io/hochgesand/lise-game-backend:latest` and
  `…/lise-game-frontend:latest`). Because `docker-compose.yml` sets BOTH
  `image:` and `build:` per service, `pull` fetches the prebuilt image (no
  Maven/Node toolchain needed on the host).
- `docker compose up -d` — recreates changed containers with the freshly
  pulled images, leaving the bind-mounted `/data` (H2 db) intact.

### GHCR package visibility (REQUIRED for unauthenticated pulls)

For the host to `docker compose pull` **without** authenticating, the two
packages must be **PUBLIC** in GitHub: `ghcr.io/hochgesand/lise-game-backend`
and `ghcr.io/hochgesand/lise-game-frontend` → (package page) **Package
settings → Change visibility → Public**. If they stay private, every pull
fails until either (a) they are made public, or (b) the host runs, **once**,
an authenticated GHCR login. Do NOT pass the PAT on the command line
(`-p <PAT>` leaks it into shell history + the process list); pipe it via
stdin instead:
`printf '%s' "<PAT>" | docker login ghcr.io -u Hochgesand --password-stdin`
(a PAT with `read:packages`).

## 2. Fallback: `pull` failed → build on the host

If `docker compose pull` fails (GHCR down, package not yet public, image not
yet built), **fall back to building locally on the host**. The repo lives in
git, so clone it to a **persistent** path and build there (do NOT use
`/root` — it is not reboot-persistent on Unraid):

```bash
ssh -p 2222 root@schmitz.gg
# on the host:
cd /mnt/user/appdata/lise-game
# if no repo checkout is present yet:
git clone https://github.com/Hochgesand/lise-idle-game.git repo
cd repo
git pull           # make sure it's on the commit you pushed
# Pin the project name so the fallback-managed containers match the ones the
# pull-based flow and the verification `ps` query (§5) expect (project
# `lise-game`). Otherwise Compose derives `project=repo` from the dir and the
# §5 `docker compose -f …/docker-compose.yml ps` reports nothing.
docker compose -p lise-game build
docker compose -p lise-game up -d
exit
```

This works because every service keeps its `build:` block. The frontend
`build` bakes `VITE_API_BASE_URL` / `VITE_WS_BASE_URL` at build time (they
come from `docker-compose.yml` `build.args`), so the locally built image is
identical to the CI one. Use this fallback only when `pull` is blocked;
prefer `pull` for normal deploys.

> **First-ever pull deploy** needs one green CI run first: the images do not
> exist in GHCR until `.github/workflows/docker-publish.yml` succeeds on
> `main`. Until then `pull` 404s — use the build fallback for that one
> deploy.

## 3. Host facts (Neulaender)

- **Unraid server** hostname **`Neulaender`**, reachable as
  **`root@schmitz.gg`** on **port `2222`** (**key auth only**).
- **Deploy dir (persistent):** `/mnt/user/appdata/lise-game/`. Holds
  `docker-compose.yml`, the `.env` secret, and a `data/` subfolder. This is
  on the Unraid `appdata` share, so it survives reboots. The old
  `/root/lise-idle-game` checkout is deprecated (and `/root` is NOT
  reboot-persistent on Unraid).
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
- **DB:** H2 **file** at `jdbc:h2:file:/data/gamedb` (host file
  `/mnt/user/appdata/lise-game/data/gamedb.mv.db`). The `data/` subfolder is
  bind-mounted to `/data` in the backend container. Keeping the DB in `data/`
  (rather than mounting the deploy dir at `/data`) means the container does
  NOT see the deploy dir's `docker-compose.yml` / `.env`. `ddl-auto: update`.
- **Backend container:** `SPRING_PROFILES_ACTIVE=prod`. Runs as non-root user
  **`lise`** (`uid=100`, `gid=101`), who owns `/data` (H2 must be able to
  write the `gamedb.*` files there). Container security is **not** weakened
  — the image sets `USER lise`. On the host, before the first `up`:
  `mkdir -p /mnt/user/appdata/lise-game/data && chown -R 100:101 …/data`.
- **Frontend image** bakes, as compose build-args (and identically in CI):
  - `VITE_API_BASE_URL=https://lise-game-api.schmitz.gg`
  - `VITE_WS_BASE_URL=wss://lise-game-api.schmitz.gg/ws`

## 4. Keycloak environment expectations

- **Issuer URI:** `https://keycloak.novitasoft.de/realms/LiseIdler`
  (configured in the backend prod profile as the OAuth2 resource-server
  issuer).
- **Backend client id:** `lise-idler-backend` (confidential client). Its
  **secret comes from the host `.env`** — never from any tracked file.
  `docker-compose.yml` interpolates it as
  `KEYCLOAK_BACKEND_CLIENT_SECRET=${KEYCLOAK_BACKEND_CLIENT_SECRET}`.
- **Secret policy:** the secret lives **only** in the UNTRACKED, gitignored
  file **`/mnt/user/appdata/lise-game/.env`**. **NEVER `cat`, `echo`, log,
  or paste the secret value.** To rotate it: generate a new client secret in
  the Keycloak admin console, then write the new value to that host `.env`
  (only) and `docker compose up -d` to pick it up.
- **CURRENT STATE (as of this refinement):** the `.env` does **NOT** exist on
  the host yet — Keycloak realm/client/user configuration is an owner task
  that has not been completed. Compose therefore warns about the unset
  `KEYCLOAK_BACKEND_CLIENT_SECRET` and substitutes a blank value. This is
  **harmless until the backend actually needs the secret** (login flows from
  Phase 4 onward); the app boots and serves anonymous content fine.
- The Keycloak realm/client/user configuration itself (realm `LiseIdler`,
  clients `lise-idler-frontend` / `lise-idler-backend`, test users
  `alice`/`bob`, protocol mappers, redirect URIs / web origins) is
  **owner-managed in the Keycloak admin console** — it is **NOT** part of
  this deploy. If a Keycloak endpoint 404s or token validation fails after a
  deploy, check the realm/client config in the console, not the deploy
  procedure.

## 5. Verification checklist

Run **after** `docker compose up -d` returns. Do them in order; the first
failure is the bug to chase.

1. **Frontend loads** — `curl -fsS https://lise-game.schmitz.gg` (or open it
   in a browser). Expect the SPA HTML (HTTP 200).
2. **API is up and serving content:**

   ```bash
   curl -fsS https://lise-game-api.schmitz.gg/api/v1/content
   ```

   Expect **HTTP 200** with the content JSON envelope, including the `coop`
   block.
3. **Anonymous surface is gated** (no token → 401):

   ```bash
   curl -o /dev/null -s -w '%{http_code}\n' https://lise-game-api.schmitz.gg/api/v1/me      # 401
   curl -o /dev/null -s -w '%{http_code}\n' https://lise-game-api.schmitz.gg/api/v1/presence # 401
   ```

   `/api/v1/me` and `/api/v1/presence` must return **401** without a bearer
   token — this confirms the OAuth2 resource-server gate is wired.
4. **WebSocket / STOMP upgrade succeeds:**

   ```bash
   curl -s -o /dev/null -i -w '%{http_code}\n' \
     -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     -H 'Sec-WebSocket-Version: 13' \
     https://lise-game-api.schmitz.gg/ws
   ```

   Expect **HTTP/1.1 101** (Switching Protocols). A failure here usually
   means "Websockets Support" got toggled off on the NPM API proxy host.
5. **Backend container is healthy:**

   ```bash
   ssh -p 2222 root@schmitz.gg "docker compose -f /mnt/user/appdata/lise-game/docker-compose.yml ps"
   ```

   Expect both `lise-game-backend` and `lise-game-frontend` `Up`, and the
   backend **not** restarting in a loop.
6. **(From Phase 4 onward)** **Login round-trips via Keycloak** — from
   `https://lise-game.schmitz.gg`, the sign-in flow redirects to
   `keycloak.novitasoft.de` (realm `LiseIdler`) and, after login, returns to
   the SPA authenticated. Requires Keycloak configured (owner task, §4) and
   the frontend presence wiring. Before Phase 4 this step is N/A.

If a phase's deploy task lists extra phase-specific checks (two-browser
`alice`/`bob` presence, phone-portrait spot-checks, etc.), run those too —
they live in the task, not here.

## 6. Rollback

A broken deploy is rolled back by **pinning to an older image tag**. Each CI
build also publishes `:sha-<short>` (and, on `v*` tags, `:<git-tag>`), so
edit `/mnt/user/appdata/lise-game/docker-compose.yml` on the host and replace
`:latest` with an older `:sha-<short>` for the offending service(s):

```bash
ssh -p 2222 root@schmitz.gg
cd /mnt/user/appdata/lise-game
# edit image: …ghcr.io/hochgesand/lise-game-frontend:sha-abcdef   (older tag)
docker compose up -d
exit
```

(If you built via the §2 fallback instead, re-run that fallback pointed at an
older `git` commit and `docker compose build && up -d`.) The H2 `/data`
volume is untouched by a tag change.

## 7. Caveat: browser-only verification

The Phase 3 frontend overhaul (CampusScene + DOM overlay) and later presence
UI ship in the `:latest` image, but the parts that matter (canvas rendering,
overlay interaction, two-client presence) **cannot be verified headlessly**.
A deploy can pass every checklist item above (200s, 401s, WS 101, healthy
containers) and still have a broken frontend in the browser. So for any
frontend-touching deploy, also run the manual quickstart scenarios
(especially **Scenario 8** and the two-browser presence check) in a real
browser. If the frontend is broken, roll back per §6.

## 8. Troubleshooting (quick)

- **Deploy serves old code after a push:** either the GitHub Actions run for
  that push is still running/failed (so `:latest` didn't advance — check the
  Actions tab), or `docker compose pull` was skipped. Re-`pull` after a green
  run.
- **`docker compose pull` fails (404 / manifest unknown / unauthorized):**
  (1) the Actions run for the push is **green**; (2) the packages
  `ghcr.io/hochgesand/lise-game-{backend,frontend}` are **PUBLIC** (§1) or
  the host ran `docker login ghcr.io` once; (3) otherwise **fall back to
  `docker compose build`** (§2) for this deploy.
- **Frontend shows stale API/WS URLs:** the values are **baked into the
  image at build time**. CI rebuilds on every push to `main`; re-`pull` after
  the green run. `up -d` alone (no `pull`/`build`) is **never** enough.
- **`docker compose up` warns about unset `KEYCLOAK_BACKEND_CLIENT_SECRET`:**
  expected today — the `.env` does not exist yet (§4). Harmless until the
  backend needs the secret. When Keycloak is configured, create
  `/mnt/user/appdata/lise-game/.env` with the value (do not print it).
- **WS won't connect but `/api` is fine:** "Websockets Support" on the NPM
  proxy host for `lise-game-api.schmitz.gg` is OFF — re-enable it in the NPM
  UI.
- **Backend restart-loop / can't write `/data`:** the `data/` dir ownership
  drifted off `uid 100 / gid 101`; on the host run
  `chown -R 100:101 /mnt/user/appdata/lise-game/data`.
