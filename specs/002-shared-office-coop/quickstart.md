# Quickstart & Validation: Shared Office Co-op Presence

**Feature**: 002-shared-office-coop
**Date**: 2026-07-01

This is a **validation guide**, not a build tutorial. It describes how to
prove each user story of the online overlay works end-to-end once
implemented, using the dev setup (Docker compose stack or dev servers)
against the real Keycloak realm `LiseIdler` at
`https://keycloak.novitasoft.de` — the realm is reachable from dev, so no
local IdP runs. Implementation
steps belong in `tasks.md`. Contract and data-model details are referenced,
not duplicated — see [contracts/contracts.md](contracts/contracts.md) and
[data-model.md](data-model.md).

The Spec 001 scenarios
([../001-dev-idle-game/quickstart.md](../001-dev-idle-game/quickstart.md))
remain valid and MUST still pass unchanged — this feature is an additive
overlay (Constitution Principle VI) and every scenario below assumes the
single-player core already works.

## Prerequisites

- Node 22+ and npm (frontend dev/build).
- JDK 25+ and Maven (backend) — OR Docker with the **dev override**
  (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`):
  the base `docker-compose.yml` is the **prod** stack
  (`SPRING_PROFILES_ACTIVE=prod`); the override (tasks.md T006) selects
  the dev profile, swaps the datasource to in-memory H2 (the prod bind
  mount `/mnt/user/appdata/lise-game` exists only on the Unraid host),
  and re-points the frontend build-args at the local backend
  (`VITE_API_BASE_URL=http://localhost:8086`,
  `VITE_WS_BASE_URL=ws://localhost:8086/ws`). When running the Vite dev
  server (`:5173`) against the compose backend instead, set the same two
  values in `frontend/.env.local` — the code default is
  `http://localhost:8080`, while compose publishes the backend on
  `8086:8080`. Dev and prod authenticate against the **same** real
  Keycloak realm.
- **Keycloak reachable** — realm `LiseIdler`, issuer
  `https://keycloak.novitasoft.de/realms/LiseIdler` (research: Identity
  decision; contracts §2). The backend needs **only the issuer URI** env
  for JWT validation
  (`SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI=https://keycloak.novitasoft.de/realms/LiseIdler`),
  plus — optionally, for the reserved backend→Keycloak service calls,
  needed by no scenario below — the confidential client credentials:
  client id `lise-idler-backend` with its secret supplied via
  `KEYCLOAK_BACKEND_CLIENT_SECRET` from the **untracked** host-side
  `.env` (current value in tasks.md, Keycloak reference block; rotation
  per tasks.md T003a/T005).
- **Two realm test users**, written `alice` and `bob` throughout. Create
  them once in the Keycloak admin console
  (<https://keycloak.novitasoft.de/admin/master/console/#/LiseIdler> →
  Users → Add user, then set a password under Credentials). App-side
  first-run consent (FR-003) lives in `player_presence`, so a fresh user
  starts **un-consented** and the consent flow is exercisable.
- **Frontend client** `lise-idler-frontend` (public, PKCE): its valid
  redirect URIs and web origins must include
  `https://lise-game.schmitz.gg/*`, `http://localhost:5173/*`, **and**
  `http://localhost:8087/*` (the local compose frontend, tasks.md
  T003/T006; admin console → Clients → `lise-idler-frontend`) — otherwise
  the local login round-trip is rejected by Keycloak.
- **Two separate browser profiles** (or one normal + one private window) so
  `alice` and `bob` hold independent Keycloak logins and token sessions.
  Scenario 9 additionally needs two tabs of the **same** profile (shared
  login).
- A phone, or browser devtools device emulation at 375×812 (phone
  portrait), for the FR-019/FR-024 checks.
- **Dev presence seeder** (dev tool this guide requires; gated to
  `@Profile("dev")`, never present in prod): a backend endpoint
  `POST /api/v1/dev/presence/seed` with body
  `{ "live": n, "lastSeen": n, "commuting": n, "office": "office_1" }`
  that fills the in-memory presence registry with synthetic colleagues —
  distributed across both buildings and the commute route by default, or
  placed entirely in one building when the **optional `office` field** is
  given (needed by Scenario 4's cap test and Scenario 7's locked-office
  check). Seeded live entries heartbeat server-side and age out through
  the normal lease sweep; `DELETE /api/v1/dev/presence/seed` clears them
  immediately. The seeder needs **no bearer token** on the dev stack:
  `/api/v1/dev/**` is permitted without a token under the `dev` profile
  (contracts §2 — the endpoints do not exist in prod).
- For Scenario 7: a save with Office #2 unlocked (Spec 001 FR-014).

## Scenario 0 — Overlay services come up (infra)

**Proves**: content carries the co-op tuning block; presence REST + STOMP
surfaces exist; sign-in round-trips through the real Keycloak realm.

1. From repo root, start backend (dev profile) + frontend dev servers, or
   bring up Docker compose **with the dev override**
   (`-f docker-compose.yml -f docker-compose.dev.yml` — the base file
   alone is the prod stack; exact commands in `tasks.md`).
2. **Expected**:
   - `GET /api/v1/content` returns the 001 envelope **plus** the additive
     `coop` block (`perColleagueMultiplier`, `maxMultiplier`,
     `leaseSeconds`, `heartbeatSeconds` — contracts §2); the five 001
     arrays and `schemaVersion`/`contentVersion` are intact.
   - Signing in as `alice` performs a full-page redirect to
     `keycloak.novitasoft.de` (realm `LiseIdler` login page) and returns
     to the game holding tokens; `GET /api/v1/presence` with her bearer
     token returns a presence snapshot (possibly empty) with the shape in
     contracts §2 — and **401** `not_authenticated` without one.
   - The STOMP endpoint `/ws` accepts a subscription to `/topic/presence`
     alongside the untouched 001 `/user/queue/state` (contracts §3).
   - Opening the frontend shows the campus scene with no console errors.
3. **Pass when**: content, presence snapshot, and the presence topic all
   respond, and the frontend renders.

## Scenario 1 — Two Colleagues See Each Other (US1, MVP) 🎯

**Proves**: authenticated presence, live avatars, and the live → last-seen
transition — the headline of the feature.

1. Browser 1: sign in as `alice` via the Keycloak login page (then accept
   the first-run consent, FR-003). Browser 2: sign in as `bob`.
2. **Expected** (validates FR-001/004/005/006 and SC-001):
   - Within a few seconds, `alice` sees `bob`'s **green** avatar seated in
     the office `bob` is present in, labeled with his display name and
     current activity (labels render persistently at or above the
     label-zoom threshold — research: Art direction; below it they appear
     on tap/hover, checked in Scenario 8) — and vice versa.
   - Only `colleagueId` (the opaque IdP subject UUID — it carries no
     personal data), display name, avatar, office, activity, commute
     state, live/last-seen status, and `lastSeenAt` are exposed (FR-004);
     no other data appears anywhere in the presence payloads (check the
     network tab).
3. Sign `bob` out (or close his browser). Wait past the presence lease TTL
   (`leaseSeconds`, default ~60 s).
4. **Expected**:
   - `alice` sees `bob` transition live → last-seen without popping or
     errors: his avatar turns **red/desaturated**, shown "idle at his
     desk" with his last-known office/activity and a last-seen indication
     (FR-006, FR-023).
5. **Pass when**: both directions are live-visible within seconds, and the
   signed-out colleague remains visible as a last-seen avatar at his desk.

## Scenario 2 — Anonymous Play Unaffected + Sign-in Offer (US1, FR-002/003)

**Proves**: sign-in gates only the overlay; the Spec 001 core is untouched;
first sign-in obtains explicit consent.

1. In a fresh browser profile (clear localStorage), load the game and do
   **not** sign in.
2. Play the Spec 001 loop: production ticks, manual boost, cash-out,
   close-and-reopen for offline credit (Spec 001 quickstart Scenario 1).
3. **Expected**:
   - Everything behaves exactly as in Spec 001 — zero feature loss, zero
     nagging (FR-002).
   - No colleague avatars are shown; a clear but **non-blocking** offer to
     sign in "to see your colleagues" is visible (US1 acceptance 3).
4. Take the sign-in offer; authenticate through Keycloak as a realm user
   who has not yet consented in-app (create a fresh test user in the
   admin console if `alice`/`bob` have already consented).
5. **Expected**:
   - A first-run **consent** step asks whether to be shown to colleagues
     (FR-003) — sign-in does not silently publish presence.
   - After consenting, the player appears to others (verify from the
     `bob` browser); the anonymous local save continues seamlessly — no
     progress lost by signing in (Key Entities, Save State).
   - **Identity adoption** (contracts §2): the client now uses
     `colleagueId` (from `GET /api/v1/me`) as its `playerId` — it
     re-bootstraps `POST /api/v1/session` under that id and the next
     `PUT /api/v1/session/{colleagueId}/state` succeeds (**no**
     `403 player_mismatch` in the network tab), pushing the anonymous
     progress to the server under the new identity. The old
     anonymous-UUID server row is orphaned, never wiped.
6. Repeat step 4 in another fresh profile with another not-yet-consented
   realm user, but **decline** consent.
7. **Expected**: play continues normally, signed in but invisible to
   others (equivalent to the hidden state, Scenario 3).
8. **Pass when**: anonymous play is regression-free and visibility is
   opt-in via explicit consent.

## Scenario 3 — Hide Me (US1, FR-009)

**Proves**: per-player visibility control, honored by both presence and
the co-op bonus.

1. With `alice` and `bob` signed in, visible, and in the same office
   (co-op bonus active on both — see Scenario 4), have `alice` toggle
   "hide me" in the settings/social UI.
2. **Expected**:
   - `bob` stops seeing `alice` within the bounded time defined for
     visibility changes (SC-006) — no ghost, no error.
   - `alice`'s contribution to `bob`'s co-op bonus ends **immediately**:
     the server pushes `bob` a recomputed downgrade segment
     (`from = serverTime`, contracts §3 "Multiplier changes"), so his rate
     drops to the recomputed multiplier within the delta-propagation time
     (< 2 s target) — **not** after lease expiry (FR-009, SC-006).
   - `alice` keeps playing completely normally while hidden.
3. Toggle `alice` back to visible.
4. **Expected**: she reappears to `bob` (live, green) within seconds.
5. **Pass when**: a hidden player is invisible to and uncounted by others,
   at no cost to their own play.

## Scenario 4 — Co-op Bonus On/Off & Cap (US2)

**Proves**: presence grants a bounded production bonus; the cap holds; the
bonus returns to baseline when colleagues leave.

1. Sign in as `alice`, alone in her office. Note her LOC/sec preview —
   this is the **baseline rate** `r` (Spec 001 `computeRate`).
2. Sign in as `bob` in the **same** office.
3. **Expected** (validates FR-010/012/015, contracts §1):
   - Within one heartbeat/lease grant, `alice`'s rate preview rises to
     ~`r × (1 + perColleagueMultiplier)` (default +10%).
   - Her localStorage save now contains `coopSegments` entries with
     **server-authored** ISO-8601 `from`/`until`, and every segment's
     `until` is at most `leaseSeconds` beyond the last accepted heartbeat
     (practically: `until ≤ now + leaseSeconds`, and `until` stops
     advancing once heartbeats stop) — the lease **horizon** is bounded,
     never open-ended. (Note: `until − from` grows with continuous
     presence — extensions upsert the same `from`, contracts §1/§3 — so
     segment *length* is not the bounded quantity.)
4. Seed a crowd into the same office (alice is in Office #1 here):
   `POST /api/v1/dev/presence/seed {"live": 30, "office": "office_1"}` —
   the `office` target guarantees all 30 land in `alice`'s active office,
   which the cap test requires.
5. **Expected**: the multiplier climbs with distinct colleagues but
   **never exceeds `maxMultiplier`** (default ×1.5) no matter how many are
   present (FR-011, SC-004).
6. Clear the seeds (`DELETE /api/v1/dev/presence/seed`) and sign `bob`
   out.
7. **Expected**: `alice`'s bonus decays to baseline within a bounded,
   defined time — at most one lease length after the last extension
   (SC-005); her rate preview reads `r` again.
8. **Pass when**: the bonus tracks presence, caps hard, and returns to
   baseline when alone.

## Scenario 5 — Offline Baseline & Replay Determinism (US2, FR-013)

**Proves**: offline spans are computed at baseline exactly as in Spec 001;
presence during an absence never inflates offline gains; the credit is a
deterministic function of the save.

1. With `alice` and `bob` in the same office and the bonus active on
   `alice`, note `alice`'s **baseline** rate `r` (her rate before `bob`
   arrived, or preview at multiplier 1) and her current LOC.
2. Copy `alice`'s localStorage save JSON aside (for step 6).
3. Close `alice`'s tab; note the wall-clock time. Keep `bob` signed in and
   present for the whole absence.
4. Wait **N minutes** (e.g. 5), then reopen `alice`'s game.
5. **Expected** (validates FR-012/013, SC-003, Constitution I/VI):
   - Offline credit ≈ `r × N` — the Spec 001 baseline math, within the
     Spec 001 tolerance. The only above-baseline coverage permitted is the
     residual lease issued **before** the tab closed (≤ `leaseSeconds`,
     default 60 s, tunable in `coop.json`) — the bounded deviation
     recorded in plan.md Complexity Tracking (FR-013/SC-003 carve-out).
   - `bob`'s continued presence during the absence contributed **nothing**
     — no heartbeats from `alice`, no lease extensions, no segment covers
     the absence (research: offline baseline for free).
   - The save's `coopSegments` confirm it: no segment `until` later than
     the pre-close lease horizon.
6. **Replay determinism**: restore the step-2 save copy and reload with
   the backend stopped (no new segments can arrive).
7. **Expected**: the catch-up credit is recomputed from the identical
   saved `coopSegments` — same baseline math, differing only by the extra
   wall-clock elapsed at baseline rate. Presence enters the result only
   through the saved segments, never live (FR-012; exact associativity
   `advance(advance(s, a), b) === advance(s, a + b)` with `coopSegments`
   present is covered by unit tests, contracts §1).
8. **Pass when**: offline credit matches Spec 001 baseline within
   tolerance (plus at most one lease tail) and replays deterministically
   from the save.

## Scenario 6 — Backend-down Degradation (FR-016..018)

**Proves**: the overlay fails soft; the core never notices.

1. While `alice` plays signed-in with colleagues visible and the bonus
   active, stop the backend (`docker compose stop backend`, or kill the
   dev server).
2. **Expected** (validates FR-016/017/018, SC-002, SC-008):
   - The core loop continues uninterrupted — production, boosts,
     purchases, local saves all keep working.
   - A clear but **non-blocking** "social offline" indicator appears; no
     modal, no error loop, no console exception that halts play.
   - The co-op bonus decays to baseline as the segments already in the
     save expire; presence stops updating (avatars go stale/last-seen or
     are marked offline — never a crash).
3. Reload the page with the backend still down.
4. **Expected**: the game boots from bundled fallback content + the local
   save into the full Spec 001 experience at baseline bonus — zero
   progress lost.
5. Restart the backend.
6. **Expected**: within the reconnect window (STOMP auto-reconnect plus
   one heartbeat) presence and the co-op bonus resume without a reload.
7. **Pass when**: social failure is invisible to the core and recovery is
   automatic.

## Scenario 7 — Live Commute Between Buildings (US3, FR-022)

**Proves**: real-time presence updates and the visible street commute.

1. `alice` and `bob` signed in; `bob` has Office #2 unlocked (Spec 001
   FR-014). `alice` pans her camera to see the streets between the
   buildings.
2. `bob` switches his active office (Spec 001 FR-016 commute).
3. **Expected** (validates FR-007/022, SC-010, US3 acceptance 1–2), all
   without `alice` refreshing:
   - `bob`'s avatar leaves Building 1, travels the street/commute route
     between the buildings for the duration of the commute — never
     teleporting — and arrives seated in Office #2.
   - His presence shows the commute state (present → commuting → present
     at destination), and his activity label updates live.
   - During the commute `bob`'s own co-op bonus is suspended (he is
     present in no office — spec edge case), and he stops counting toward
     `alice`'s bonus if they shared an office.
4. Seed simultaneous commuters: `POST /api/v1/dev/presence/seed
   {"commuting": 5}`.
5. **Expected**: all commuters render on the route without unreadable
   overlap — each gets its deterministic per-colleague lane offset
   (research: World & tilemap, CommutePaths) — edge case "commute rush".
6. **Locked-office viewer** (spec edge case "colleague present in an
   office the viewer has not unlocked"): in a **fresh** profile (Office #2
   locked), sign in as a third realm test user (created like
   `alice`/`bob`) and seed colleagues into the
   locked building: `POST /api/v1/dev/presence/seed
   {"live": 3, "office": "office_2"}`.
7. **Expected**: both buildings render regardless of unlock state; the
   seeded colleagues are visible seated in Office #2; the viewer's own
   milestone/unlock state is **unchanged** — seeing presence there neither
   unlocks the office nor changes the save (data-model "Visibility vs
   unlock").
8. **Pass when**: the whole commute is visible on the street in real time,
   presence states transition cleanly, and locked-office presence is
   visible without affecting the viewer's unlock state.

## Scenario 8 — Campus World & Peak-Crowd Legibility (FR-019/020/021/024)

**Proves**: the new campus world, the camera model, and legibility at the
~30-concurrent design load on both phone and desktop.

1. Load the game on desktop.
2. **Expected** (validates FR-020, research: World & tilemap decision):
   - Both lise buildings render with their recognizable footprints and
     named rooms — Office #1 with **corkscrew**, **spiderweb**, **skier**;
     Office #2 with **deco-office-chair**, **frog**, **bongo**,
     **bridge** — joined by the streets/tram edge that form the commute
     route.
   - On boot the camera fits/centers on the player's active office
     (research: Camera decision); no dead top-left pinning.
3. Exercise the camera: drag to pan across the whole campus; zoom with the
   mouse wheel through the clamped range.
4. **Expected**: pan stays within map bounds; zoom clamps at
   `[minZoom, maxZoom]`; pixel art stays crisp at every zoom
   (`pixelArt: true`).
5. Seed the design load:
   `POST /api/v1/dev/presence/seed {"live": 30, "lastSeen": 20}`.
6. **Expected** (validates FR-021/023/024, SC-007, SC-009):
   - Seeded colleagues occupy **distinct** seat anchors across both
     buildings; overflow beyond anchors stands/roams legibly — no
     illegible stacking on one desk (edge case "peak crowd").
   - Green (live) vs red (last-seen) reads at a glance from a zoomed-out
     view.
   - At **minimum zoom** (below the label-zoom threshold, so labels are
     on-demand — research: Art direction), each avatar is ≥ ~24 CSS px and
     individually clickable — clicking/tapping any avatar shows its name
     label; zooming in past the threshold shows labels persistently.
   - Frame rate and interaction responsiveness hold at the full crowd
     (SC-007 / Spec 001 SC-003).
7. Repeat steps 2–6 at 375×812 phone portrait (device or emulation): pan
   by touch drag, zoom by pinch, tap avatars.
8. **Expected** (validates FR-019/024):
   - The HUD/Economy/Academy/social panels are DOM overlay UI, reachable
     and usable in phone portrait (bottom-sheet/tab-bar per research: UI
     decision) — nothing hangs off-screen.
   - Panel gestures never fight camera gestures; avatars stay tappable at
     minimum zoom.
9. **Pass when**: the campus reads as the two real buildings, the camera
   behaves on both form factors, and a 30-avatar crowd stays readable and
   tappable everywhere.

## Scenario 9 — Duplicate-Session Collapse (edge case)

**Proves**: one colleague is one presence, regardless of session count.

1. Sign in as `alice` in two tabs of the **same** browser profile (and/or
   a second device with the same identity). Keep `bob` observing.
2. **Expected** (validates research: Duplicate-session decision):
   - `bob` sees exactly **one** `alice` avatar — no ghost.
   - `bob`'s co-op bonus counts `alice` **once**: his rate does not change
     when her second tab opens (distinct-colleagueId semantics).
3. Close one of `alice`'s tabs.
4. **Expected**: `alice` stays **live** — the remaining tab keeps
   heartbeating (max-of-heartbeats semantics).
5. Close her last tab and wait past the lease TTL.
6. **Expected**: only now does `alice` transition to last-seen.
7. **Pass when**: N sessions collapse to one avatar and one bonus
   contribution, and last-seen begins only when the last session stops.

## Cross-cutting checks (run during every scenario)

- **Core never harmed**: at any point, killing the backend, dropping the
  WebSocket, or receiving malformed presence data never blocks, corrupts,
  or wipes the local save or the single-player loop (FR-017/018,
  Constitution Principles IV & VI).
- **Read-only overlay**: nothing any other player does ever changes the
  observed player's resources or save; presence payloads carry no private
  state (FR-008/014, Principle VI).
- **Server-authored time**: every `coopSegments` boundary and presence
  timestamp on the wire is a server-authored ISO-8601 UTC string; skewing
  the client clock shifts rendering at most, never total bonus-covered
  time (spec clock-skew edge case; research: Clock-skew decision).
- **Determinism**: `advance(advance(s, a), b) === advance(s, a + b)` holds
  with `coopSegments` present (Constitution Principle I; covered by unit
  tests, spot-checked manually).
- **Numeric integrity**: big numbers remain strings end-to-end through the
  new presence/co-op surfaces; no `NaN`/`Infinity` at any bonus level.
- **Both form factors**: every scenario's UI interactions work in phone
  portrait and on desktop alike (FR-019).
