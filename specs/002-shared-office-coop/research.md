# Research: Shared Office Co-op Presence

**Feature**: 002-shared-office-coop
**Date**: 2026-07-01
**Purpose**: Resolve all deferred plan-level decisions for the project's
first online overlay: identity provider, presence transport and lease model,
the co-op bonus determinism model (the critical design touching Constitution
Principles I, V, VI), presence storage, the campus world/tilemap and art
strategy, camera/legibility (FR-024), and the UI architecture required by
FR-019.

## Decision Summary

| Area | Decision | Key alternative rejected |
|------|----------|--------------------------|
| Co-op determinism | **Closed, server-timestamped lease segments in `GameState` (`coopSegments`)** | Live wall-clock multiplier |
| Identity / auth | **OIDC Auth Code + PKCE against the existing Keycloak realm `LiseIdler`**, bearer JWTs + resource server | Microsoft Entra ID |
| Presence transport | **Reuse STOMP `/ws`: REST snapshot + `/topic/presence` deltas** | SSE / REST polling |
| Liveness model | **Heartbeat lease (~20 s beat, ~60 s TTL), server-expired** | Socket lifecycle only |
| Duplicate sessions | **Collapse by colleagueId server-side** | Per-session avatars |
| Clock skew | **Server-authored timestamps; `advance` clips segments** | Trust client clock |
| Presence storage | **In-memory registry + JPA `player_presence` last-seen row** | Event history / Redis |
| Co-op tuning data | **New `coop.json` content + bundled fallback, hard cap** | Hardcoded constants |
| World / tilemap | **New Tiled campus map with object layers** | Enlarging 001 placeholder |
| Art / assets | **Kenney CC0 16×16 packs + custom lise touches** | Full custom commission |
| Camera | **Fit/center on boot, pan + clamped pinch/wheel zoom** | Fixed 1:1 top-left (status quo) |
| UI architecture | **DOM overlay panels; canvas renders world only** | Extend in-canvas Phaser text |

## Current visual baseline (live-site audit, 2026-07-01)

A visual audit of the deployed game (lise-game.schmitz.gg, identical to
current `main`) establishes the starting point for every world/UI decision
below:

- **World**: a single 20×15-tile (640×480 px) abstract room built from 8
  flat-color placeholder tiles; semi-transparent tiles let a checkerboard
  alpha pattern show through. No lise buildings, no named rooms, one
  barely-visible dev sprite. `frontend/public/assets/README.md` documents
  the assets as "MVP-quality placeholders".
- **Layout**: the map is pinned to the canvas top-left at fixed 1:1 scale;
  on desktop ~85% of the viewport is empty dark blue. No camera centering,
  fit, pan, or zoom exists (`OfficeScene.ts` contains no camera code beyond
  a background color).
- **UI**: HUD, Economy, and Academy panels are raw Phaser text drawn over
  the map with no backgrounds; text overlaps tiles and is tiny.
- **Mobile (375×812)**: the map is cropped and the Economy/Academy panels
  (hardcoded at `PANEL_X = 520`) are entirely off-screen — cash-out,
  upgrades, burner, and academy are unreachable on a phone. Spec 001's
  mobile/desktop co-equal requirement is not met by the current
  implementation.

**Conclusion**: spec 002's World & Setting section (two real lise buildings,
campus streets, ~30 readable avatars, a zoom range, phone+desktop
legibility — FR-019..FR-024) requires a ground-up world/rendering/UI
workstream. The plan MUST treat this as an explicit workstream, not an
increment on the placeholder scene.

---

## Architectural Decision: How does the co-op bonus enter the deterministic sim?

### Decision
The cooperative bonus (FR-010..015) enters the simulation as **closed,
server-timestamped lease segments stored in `GameState`**:

```ts
coopSegments: Array<{ from: string; until: string; multiplier: number }>
```

- `from`/`until` are **ISO-8601 UTC strings authored by the server** when
  it confirms presence. `until` is a **bounded lease**: each presence
  heartbeat extends it by a fixed window (e.g. +60 s), never open-ended.
- The client merges server-issued segments into its local state at the
  established safe mutation points in `frontend/src/main.ts` (the same
  `state = next; loop.load(state, Date.now()); saveGame(state)` template
  the existing `onStateCorrection` handler uses).
- `advance(state, dt, content)` in `frontend/src/sim/advance.ts` integrates
  production **piecewise**: the interval
  `[lastAdvancedAt, lastAdvancedAt + dt]` is split at every segment
  boundary (clipped to the interval) and at the existing burner
  fuel-exhaustion point; per sub-interval,
  `gain = rate_i × multiplier_i × len_i`, with `multiplier = 1` for any
  span not covered by a segment. The lease multiplier applies to
  **production only**, never to burner `burnRate`, so fuel math stays
  linear across segment boundaries.
- Fully-integrated segments (`until <= lastAdvancedAt`) are **compacted**
  (pruned) during `advance` so state stays bounded; pruning is idempotent
  and expired segments contribute nothing.
- `computeRate` (the HUD preview) applies the multiplier of the segment
  containing `state.lastAdvancedAt` — the sim's only notion of "now" — so
  the preview stays pure.

Persistence plumbing: `schemaVersion` bumps 1 → 2 with an additive
migration defaulting `coopSegments: []`, `activeOffice: "office_1"`, and
`commute: null` (the latter two close the 001 FR-014/016 gap — the save
must carry the active office and in-progress commute the heartbeat and
co-op grouping consume; see data-model.md's dependency callout).
Registered in `frontend/src/save/migrations.ts`; `toGameState` in
`frontend/src/save/localStorage.ts` defaults the missing fields leniently
so every v1 save stays loadable; `cloneState` in both `sim/advance.ts` and
`sim/actions.ts` copies the fields; the private `WireGameState` mappings in
`frontend/src/net/restClient.ts` and `net/stompClient.ts` pass them
through; the backend `state/GameState.java` record gains the fields and
`SessionController`'s `CURRENT_SCHEMA_VERSION` bumps (backend first, or the
best-effort PUT harmlessly 409s until it lands). The merge rule in
`sync/StateMerger.java` is **union of segments keyed by `from`, taking
max(`until`) AND max(`multiplier`)** — deterministic and conflict-free
like the existing max/union rules, and required to match the client-side
`applyCoopPresence` upsert rule exactly so client merge and server merge
cannot disagree (contracts §1); multipliers are ≥ 1, so resources stay
monotonic under `advance` and the per-field max merge remains sound.
`activeOffice`/`commute` merge as a pair from the input with the later
`lastAdvancedAt`.

### Rationale
- **Determinism / replay (Principle I, FR-012)**: segments live *in the
  save*, and boundaries are evaluated against absolute time derived from
  `lastAdvancedAt` — never `Date.now()`. Replaying a save reproduces
  identical results. The 001 associativity invariant
  `advance(advance(s, a), b) == advance(s, a + b)` is preserved because
  gain is linear within each sub-interval and the split points are pure
  functions of state — the same argument that already covers the burner's
  two-segment closed form (with the same documented ULP caveat at the
  fuel-exhaustion boundary).
- **Offline baseline (FR-013, Principle VI)**: an offline player sends no
  heartbeats, so no lease is extended; beyond the **residual lease issued
  before the player went offline** — a bounded tail of ≤ `leaseSeconds`
  (default 60 s), earned while online and recorded as an explicit,
  documented deviation in plan.md's Complexity Tracking — the offline span
  is not covered by any segment and integrates at multiplier 1. No special
  offline branch exists to get wrong.
- **Anti-exploit (clock skew edge case)**: `from`/`until` are server
  clocks and `until` is a bounded lease, so a manipulated client clock can
  shift where a segment overlaps the local timeline but can never grow the
  covered duration beyond what the server issued.
- **Complexity budget stays honored**: integration cost is O(#segments
  overlapping the interval), never O(dt) — the constitution's O(active
  features) time-skip constraint holds, and compaction keeps the segment
  list short.
- **Principle VI**: presence data remains a read-only overlay; the server
  issues bonus *inputs*, it never becomes authoritative over the sim or
  mutates resources.
- This is a deliberate, justified touch on the deterministic core and is
  recorded in `plan.md`'s **Complexity Tracking** table, as constitution
  v1.1.0's Sync Impact Report explicitly requires (Principles I, V, VI).

### Alternatives considered
- **Live multiplier read at tick time** (advance consults "who is here
  now" via a mutable flag or network state): rejected — wall clock and
  network state feeding `advance` breaks purity (Principle I) and the
  constitution's "wall-clock never feeds sim directly" constraint; save
  replay becomes non-reproducible (FR-012 fails) and offline spans become
  ambiguous.
- **Server-computed production bonus** (server credits resources
  directly): rejected — makes the server authoritative over the sim
  (violates Principle VI), duplicates `advance` in Java (already rejected
  in 001 research), and breaks offline play.
- **Open-ended segments closed by an explicit "colleague left" event**:
  rejected — a crash, closed tab, or dropped connection never delivers the
  close; the dangling segment would silently cover the player's offline
  span and retroactively inflate offline gains (violates FR-013). The
  bounded lease fails safe: no heartbeat, lease lapses.

---

## Decision: Identity & authentication provider

### Decision
**OIDC Authorization Code + PKCE against the existing Keycloak instance**
at `https://keycloak.novitasoft.de`, realm **`LiseIdler`** (issuer URI
`https://keycloak.novitasoft.de/realms/LiseIdler`) — an already-operated
instance; nothing new to run. Two realm clients split the roles:

- **`lise-idler-frontend`** — public client (client auth OFF, PKCE
  enabled): the SPA performs the Authorization Code + PKCE flow in the
  browser via **`oidc-client-ts`** (small, well-maintained; see the
  frontend-dependency note in the Rationale) and attaches the resulting
  access token to authenticated calls as
  `Authorization: Bearer <access_token>`.
- **`lise-idler-backend`** — confidential client (client auth ON,
  service-account roles enabled): reserved for backend→Keycloak service
  calls (optional user-directory sync, token introspection fallback) via
  a tiny hand-rolled client-credentials token fetch — a plain `RestClient`
  POST to the realm token endpoint. Not required for MVP; recorded as a
  reserved capability.

The backend is a pure **OAuth2 resource server**
(`spring-boot-starter-security` +
`spring-boot-starter-oauth2-resource-server`, new package
`com.lise.liseidle.security`): it validates `LiseIdler`-issued JWTs by
issuer URI and holds **no session state** — bearer tokens keep the backend
stateless. The social `playerId` becomes the Keycloak `sub` claim, derived
from the authenticated principal in `SessionController` instead of
trusting the body/path UUID; the display name comes from the `name` /
`preferred_username` claims. First-login consent and the visibility
(appear/hide) flag (FR-003) stay app-side in `player_presence`, keyed by
the Keycloak `sub`. The 001 surface stays anonymous (`GET
/api/v1/content`, `POST /api/v1/session`, `PUT /api/v1/session/**`, `/ws`
handshake — FR-002: sign-in gates only the overlay).

**STOMP identity**: the client passes the bearer token in the STOMP
`CONNECT` frame headers; a `ChannelInterceptor` validates it and assigns
the session `Principal` — which (combined with the `/queue` broker-prefix
correction, see "Presence transport", Required config change) is what
makes `SessionPushService.convertAndSendToUser(...)` deliverable **to
authenticated sessions**. Anonymous (tokenless or invalid-token) sessions
carry no Principal, so user-addressed pushes remain undeliverable to them
— the de-facto 001 status quo, explicitly accepted in contracts §3.

**CSRF: not applicable.** Authentication travels only in the explicit
`Authorization` header; no ambient credential accompanies cross-site
requests, so there is no CSRF surface to defend, and Spring Security's
CSRF protection is disabled for the stateless API. What remains is plain
**CORS**: frontend (`lise-game.schmitz.gg`) and API
(`lise-game-api.schmitz.gg`) are cross-origin, so a
`CorsConfigurationSource` bean allowing the `Authorization` header for the
frontend origin (plus `http://localhost:5173` and `http://localhost:8087`
for dev) is required — the REST API has no CORS configuration today.

**Dev/test story**: the real realm is reachable from dev, so local
development and tests authenticate against it directly. Two realm test
users (**alice**/**bob**, fresh identities starting un-consented) are
provisioned (tasks.md **T004** is the single authoritative creation
procedure) because validation (quickstart Scenarios 1–3, 9; the
two-session integration tests) needs two independent colleagues and the
FR-003 first-run consent flow; the frontend client's redirect URIs / web
origins must include `https://lise-game.schmitz.gg/*`,
`http://localhost:5173/*`, and `http://localhost:8087/*` (the local
compose frontend). Spring integration tests use
`spring-security-test` **mock JWTs** — no network to Keycloak. Note the
base `docker-compose.yml` is the **prod** stack
(`SPRING_PROFILES_ACTIVE=prod`, Nginx Proxy Manager host); local compose
validation needs the `docker-compose.dev.yml` override (tasks.md T006)
that selects the dev profile (enabling the `DevPresenceSeeder` — presence
seeding, not identity), swaps the datasource to in-memory H2 (the prod
bind mount exists only on the Unraid host), and re-points the frontend
build-args at the local backend (`http://localhost:8086`).

Deployment notes: the resource server needs only the issuer URI; the
Keycloak env (issuer URI; backend client id `lise-idler-backend` plus its
secret for the service-account calls) joins the backend `environment:`
block like the existing datasource env vars — the secret itself is
interpolated from the **untracked** host-side `.env` and never appears in
a tracked file (tasks.md T003a/T005).

### Rationale
- The `LiseIdler` realm at keycloak.novitasoft.de is **already provisioned
  and self-administered** — FR-001's "authenticate as a lise colleague"
  maps onto a directory we fully control (account lifecycle included), and
  FR-004's display name/avatar come from standard OIDC claims
  (`name`/`preferred_username`).
- Bearer JWTs validated by a resource server keep the backend
  **stateless**: no server-held session, no ambient credential, no CSRF
  machinery — the smallest auth surface for a cross-origin SPA + API pair.
- Closes an existing hole: today identity is a trust-the-client UUID —
  anyone who guesses a `playerId` can read/overwrite that save. Principal-
  derived identity **plus the contracts §2 identity-bound ownership rule**
  fixes this for signed-in players: once an id has been claimed under a
  matching bearer, unauthenticated session calls to it are rejected (401).
  The ownership rule is essential, not optional — the presence overlay
  broadcasts every signed-in colleague's `sub` as `colleagueId`, so a
  signed-in `playerId` is public knowledge, not a guessable secret.
  Unauthenticated solo play keeps the 001 anonymous UUID path for ids
  never claimed by an identity (FR-002: sign-in gates only the overlay).
- Structural win (scoped): nothing assigns a STOMP `Principal` today, so
  the existing `SessionPushService.convertAndSendToUser(...)` is
  undeliverable. Validating the CONNECT-frame bearer token in a
  `ChannelInterceptor` gives every **authenticated** STOMP session a
  `Principal` — combined with the `/queue` broker-prefix correction (see
  "Presence transport", Required config change), user-addressed pushes
  and per-colleague presence identity work for signed-in players.
  Anonymous sessions still have no Principal, so 001's
  `/user/queue/state` corrections stay undeliverable to exactly the
  anonymous players 001 serves — accepted as the unchanged de-facto 001
  status quo (contracts §3 records the decision).
- **Frontend dependency note**: `oidc-client-ts` is this feature's one new
  frontend runtime dependency, accepted deliberately under the
  minimal-deps constraint — hand-rolling the OIDC token lifecycle (PKCE
  challenge, redirect callback, token storage, renewal, expiry) is exactly
  the error-prone security code a small, well-maintained library exists to
  own.
- The new external IdP dependency is recorded in `plan.md`'s **Complexity
  Tracking** table (auth infrastructure for FR-001).

### Alternatives considered
- **Microsoft Entra ID**: rejected — no usable lise Entra tenant/app
  registration exists for this internal project, whereas the `LiseIdler`
  Keycloak realm is already provisioned and self-administered; adopting
  Entra would mean waiting on directory admin work for no functional gain.
- **@lise.de magic-link email auth**: rejected — hand-rolled token
  issuing, expiry, and email deliverability for a *weaker* result: no
  central account lifecycle, and a second identity system parallel to the
  OIDC IdP already running.
- **Anonymous play + self-claimed display name**: rejected — impersonating
  a colleague is trivially possible, violating FR-001 (authenticated
  identity) and the company-internal trust assumption behind showing real
  names (FR-004).
- **BFF session pattern** (backend-side `oauth2Login`, HTTP-only session
  cookie): rejected — a `SameSite=None; Secure` cross-origin cookie is an
  ambient credential that drags in a CSRF-defense surface plus server-held
  session state; bearer tokens validated by a resource server keep the
  backend stateless and need only CORS.

---

## Decision: Presence transport & lease model

### Decision
**Reuse the existing STOMP-over-WebSocket channel** (`/ws`, raw WebSocket,
no SockJS — matching `frontend/src/net/stompClient.ts`):

- **Initial snapshot via REST**: `GET /api/v1/presence` returns all visible
  colleagues (live and last-seen) in one read on load.
- **Live deltas via STOMP broadcast**: a new destination
  `/topic/presence`, published by a new `PresencePushService` mirroring
  `session/SessionPushService.java` (same `TYPE`-discriminated record +
  static-factory message style as `StateCorrection`/`ContentUpdate`).
- **Client heartbeats over STOMP**: the client publishes to
  `/app/presence.heartbeat` (the `setApplicationDestinationPrefixes("/app")`
  prefix already exists in `session/WebSocketConfig.java` and is unused
  today). `stompClient.ts` gains a second subscription inside the existing
  `client.onConnect` callback (which re-fires on reconnect, so both
  subscriptions self-heal), a new `StompHandlers.onPresence` handler, and a
  `publishHeartbeat(payload)` guarded by `isConnected`; the heartbeat
  interval is driven from `main.ts`, the clock-owning module, matching the
  existing 30 s save / 60 s sync `setInterval` pattern.
- **Lease expiry server-side**: heartbeat every ~20 s; `PresenceService`
  holds a lease of ~60 s per colleague; a `@Scheduled` sweep expires
  **live → last-seen** and flushes `last_seen_at`. This requires
  `@EnableScheduling`, which is not enabled anywhere today.
- **Required config change**: `WebSocketConfig.configureMessageBroker`
  currently enables only `enableSimpleBroker("/user")` — it must become
  `enableSimpleBroker("/queue", "/topic")` (keeping
  `setUserDestinationPrefix("/user")`). Spring rewrites `/user/queue/...`
  subscriptions to `/queue/...-user{sessionId}`, so the 001 `"/user"`
  broker prefix was a latent misconfiguration under which
  `convertAndSendToUser` was never deliverable; `"/queue"` fixes
  user-addressed delivery and `"/topic"` enables the broadcast. The
  client-facing 001 destination `/user/queue/state` and its message shapes
  are untouched; presence is a new, additive destination. The Nginx Proxy
  Manager host for `lise-game-api.schmitz.gg` already needs "Websockets
  Support" for 001's `/ws`; no new proxy work.

Presence stays **read-only for viewers** (FR-008): no client→server
message can alter another colleague's record, and hidden players are
filtered server-side before both the snapshot and the broadcast (FR-009).
All presence calls are best-effort like the existing
`restClient`/`stompClient` posture: on failure the game degrades to the
Spec 001 experience, baseline bonus, plus a non-blocking "social offline"
indicator (FR-016..018). REST `PUT` remains the only save path — presence
frames never become required for saving.

### Rationale
- The socket, the client wrapper, reconnect behavior (library defaults in
  `@stomp/stompjs`), and the push-message idiom all exist and are proven;
  presence adds destinations, not infrastructure (Principle V).
- Snapshot-then-deltas gives SC-001 ("see colleagues within a few
  seconds") without requiring the socket to be up before first paint.
- An application-level heartbeat doubles as the co-op **lease
  confirmation**: the same server-side receipt that marks a colleague live
  extends the viewer-facing presence lease and issues/extends
  `coopSegments` — one liveness mechanism feeds both features.

### Alternatives considered
- **SSE**: rejected — one-directional; heartbeats would need a parallel
  REST channel, and it adds a second live transport next to the STOMP one
  001 already runs.
- **REST polling**: rejected — already rejected in 001 for the live
  channel; strictly worse latency and load than the existing socket for
  ~30 concurrent clients.
- **STOMP connection lifecycle only** (`SessionConnectedEvent` /
  `SessionDisconnectEvent`, no app heartbeat): rejected as the sole
  signal — a proxied TCP session can linger half-open, and a connected
  socket says nothing about which office/activity the colleague is in.
  Kept as a supplementary hook for fast disconnect detection.

---

## Decision: Duplicate-session collapse

### Decision
Presence is keyed by **colleagueId** (the Keycloak `sub`), never by WebSocket
session. The in-memory `PresenceRegistry` maps
`colleagueId → lease/record`; any number of concurrent sessions (two tabs,
phone + desktop) refresh the *same* record, and broadcast payloads contain
exactly one entry per colleague. A colleague goes last-seen only when *all*
their sessions stop heartbeating (max-of-heartbeats semantics). The co-op
segment a player receives is computed from the **set of distinct visible
colleagueIds** in their active office, self excluded — duplicates can
neither render ghost avatars nor double-count toward anyone's bonus
(spec edge case "Duplicate sessions for one colleague").

### Rationale
Collapsing at the registry key makes the invariant structural: there is no
code path that *could* emit two avatars or count a colleague twice, so no
client-side dedup logic can regress it.

### Alternatives considered
- **Per-session records with client-side dedup**: rejected — ghost avatars
  during session overlap, double counting the server cannot prevent, and
  it moves an anti-exploit rule (FR-011 adjacent) into untrusted code.

---

## Decision: Clock-skew handling

### Decision
Every presence timestamp and every co-op segment boundary (`from`,
`until`, `lastSeenAt`) is authored by the **server clock**
(`Instant.now().toString()` — the house convention, cf.
`PlayerStateService.lastSavedAt` and string ISO-8601 timestamps
throughout). The client never writes segment times; it only merges
server-issued segments into its save. On integration, `advance` **clips**
each segment to `[lastAdvancedAt, lastAdvancedAt + dt]`.

### Rationale
A skewed client clock can only shift *where* a segment overlaps the local
timeline; it can never lengthen coverage, because total bonus-covered time
is bounded by the sum of lease durations the server actually issued. The
worst-case skew artifact is one lease length (~60 s), tunable in
`coop.json`. This satisfies the spec's clock-skew edge case ("a client
clock cannot inflate the co-op bonus or offline gains") without any
client/server time negotiation.

### Alternatives considered
- **Trusting client timestamps**: rejected — exactly the inflation exploit
  the edge case forbids.
- **NTP-style offset negotiation**: rejected — bounded leases already cap
  the damage; extra protocol for no requirement (Principle V).

---

## Decision: Presence storage

### Decision
Two tiers, mirroring existing backend idioms in a new flat feature package
`com.lise.liseidle.presence`:

- **Live registry, in-memory**: `PresenceRegistry` (`@Component`) holding a
  `ConcurrentHashMap<String colleagueId, PresenceRecord>` — the same
  cached-singleton style as `content/ContentLoader.java`. Live presence is
  ephemeral by nature: after a backend restart every client re-heartbeats
  within one interval and the registry rebuilds itself.
- **Durable last-seen snapshot, JPA**: `PlayerPresenceEntity`
  (`@Entity @Table(name = "player_presence")`) with `player_id` (String
  `@Id`), display name, avatar, office, activity, `last_seen_at` (String
  ISO-8601 per house convention, cf. `PlayerStateEntity.lastSavedAt`), and
  the visibility/consent flag (FR-003). Created by the existing
  `ddl-auto: update` path like `player_state`; `PresenceRepository extends
  JpaRepository`; `PresenceService` bridges registry ↔ JPA, mirroring
  `PlayerStateService`.

### Rationale
Last-seen colleagues ("idle at their desk", FR-006) must survive restarts;
live liveness must not touch the database 30 times per heartbeat interval.
One row per colleague is the minimal durable footprint that satisfies both.

### Alternatives considered
- **Full presence event history in DB**: rejected — nothing in the spec
  reads history; pure YAGNI (Principle V).
- **Redis (or another broker) for presence pub/sub**: rejected — new
  infrastructure for ≤ ~30 concurrent colleagues; the Spring simple broker
  plus one map is sufficient at this scale.

---

## Decision: Co-op bonus content data (`coop.json`)

### Decision
Bonus magnitude, cap, and lease timing are **tunable content data**: a new
`backend/src/main/resources/content/coop.json`, loaded in
`ContentLoader`'s existing fail-fast `@PostConstruct` pass and added to the
`ContentCatalog` envelope as an additive sixth entry (the five existing
arrays, `schemaVersion`, `contentVersion`, and per-version immutability are
untouched; the hand-maintained `CONTENT_VERSION`, currently `"1.2.0"`,
bumps). Placeholder values, to be tuned during balancing:

```json
{
  "perColleagueMultiplier": 0.10,
  "maxMultiplier": 1.5,
  "leaseSeconds": 60,
  "heartbeatSeconds": 20,
  "commuteSeconds": 30,
  "lastSeenRetentionDays": 14
}
```

i.e. +10% production per distinct present colleague, hard-capped at ×1.5
total regardless of crowd size (FR-011). `commuteSeconds` (the 001 FR-016
office-switch travel time, consumed by `advance`'s commute resolution and
by observers rendering route progress) and `lastSeenRetentionDays` (the
last-seen rendering/retention window — see data-model PresenceRecord)
ride in this block rather than new content entries. The same block is mirrored into
the bundled fallback (`frontend/src/sim/fallbackContent.ts`) so an
offline-booting client has identical values. The cap is enforced twice:
server-side when issuing segment multipliers, and clamped client-side in
`advance` against the content cap when integrating — defense in depth
against a tampered save.

### Rationale
Directly implements FR-015 and **Constitution Principle II** (balance
changes never touch control-flow code), and Principle VI's requirement
that online gameplay effects be bounded, tunable content data.

### Alternatives considered
- **Hardcoded constants in `advance.ts`**: rejected — violates Principle II
  and FR-015 outright.
- **Per-player server config**: rejected — content is shared and versioned;
  per-player data belongs in `GameState`, not the content envelope.

---

## Decision: World & tilemap strategy (campus map)

### Decision
Author a **new Tiled campus map** — one orthogonal map containing both lise
buildings with their real footprints and named rooms (corkscrew,
spiderweb, skier, frog, bongo, bridge, deco-office-chair, offices, cores)
plus the streets/tram edge between them as the visible commute route
(FR-020, FR-022). It replaces `frontend/public/assets/office.json`, which
the audit confirms is a 20×15 placeholder with two tile layers and **zero
object layers** (`"nextobjectid": 1`). The new map carries three object
layers:

- **Rooms** — named polygons for every named space (labels, presence
  grouping).
- **SeatAnchors** — point objects for desk/seat positions, authored to
  exceed each building's peak concurrent crowd (FR-021); overflow beyond
  anchors falls back to standing spots.
- **CommutePaths** — polylines between the building entrances that avatars
  travel during commutes (FR-022). **Commute-rush legibility** (spec edge
  case, SC-010): simultaneous commuters on the same polyline get a
  deterministic per-colleague perpendicular **lane offset** (stable hash
  of `colleagueId` → one of a few pixel offsets from the path), plus
  label decluttering while in transit (labels on tap/hover only), so N
  near-simultaneous commuters render side-by-side instead of stacking.

Tilesets are **embedded** in the export (Phaser's `tilemapTiledJSON` does
not resolve external `.tsx` references). Code impact lands in the new
`frontend/src/scenes/world/` package — `CampusScene.ts` (with
`camera.ts`/`avatars.ts`/`seats.ts`/`commute.ts`), which **replaces the
retired `OfficeScene.ts`** per plan.md's Project Structure: new
map/tileset keys and layer names (a `create()` that throws on
tileset-name mismatch, as 001's did by design); the 001 hardcoded dev
placement `tileToPixel(2, 5)` is superseded by reading the SeatAnchors
layer via `map.getObjectLayer(...)` — all-new code, since nothing reads
object layers today; `TILE_SIZE` in `frontend/src/scenes/layout.ts`
updates with the new tile size; and `frontend/public/assets/README.md` is
rewritten for the new assets.

### Rationale
- The audit conclusion is binding: there is nothing in the placeholder
  scene to grow from — no rooms, no anchors, no paths, no second building.
- Object layers keep the world **data-authored**: seat counts, room names,
  and commute routes are map data edited in Tiled, not coordinates in code
  (the spirit of Principle II applied to the world).
- One continuous map keeps camera, presence placement, and commute
  animation in a single coordinate system — a commuting avatar simply
  moves along a polyline in world space.

### Alternatives considered
- **Enlarge the 001 placeholder map**: rejected — per the audit it is an
  abstract 8-tile room; "enlarging" it would mean redrawing everything
  anyway while inheriting none of the required structure.
- **Two separate per-building maps with scene switching**: rejected — the
  campus streets are the commute route and must be visible (FR-020/022);
  splitting the world breaks the single coordinate space and makes
  commuters teleport between scenes, which SC-010 forbids.

---

## Decision: Art direction & asset sourcing

### Decision
Replace the 8-tile placeholder tileset (`office_tileset.png`, 128×64) with
a **CC0 pixel-art tileset plus small custom lise touches**. Primary
candidates: **Kenney "Roguelike Modern City"** (streets, buildings,
urban props) combined with **Kenney "Roguelike Indoors"** (office
interiors) — both 16×16, CC0, from one author with a consistent palette;
fallback candidate **Kenney "Tiny Town"** (16×16, CC0). Custom lise touches
(logo signage, the skier trophy shelf, room-name plates, coffee points)
are drawn on top in the same 16×16 grid. Consequences of the 16 px base
tile: `TILE_SIZE` in `scenes/layout.ts` changes, avatar spritesheet frame
sizes change accordingly, and the Phaser game config gains
`pixelArt: true` (not currently set) so scaled pixels stay crisp at every
zoom. The combined tileset atlas stays far below the 4096×4096
mobile-GPU comfort bound.

Avatars get distinct sprites with **green (live) vs red/desaturated
(last-seen)** state styling (FR-023, via tint or dedicated frames), an
activity icon, and a name label. **Label rule** (reconciling FR-005's
"labeled with display name and current activity" with FR-024 legibility
at the ~30-avatar peak crowd): labels render **persistently at or above a
label-zoom threshold** (tuned during authoring, between `minZoom` and
`maxZoom`) and on **tap/hover below it** — so a zoomed-in office reads
fully labeled while a zoomed-out campus never drowns in overlapping text.
Quickstart Scenarios 1 and 8 test both sides of the threshold.

### Rationale
- CC0 removes every licensing question for a company-internal deployment
  and for the public repo.
- Buying/commissioning full custom art is the wrong spend for an internal
  game; concentrating the custom pixel budget on the few lise-specific
  touches is what actually makes the offices recognizable (Principle V).

### Alternatives considered
- **Keep the placeholder tiles**: rejected — the audit and FR-020/023 rule
  it out; the world must read as the real buildings with legible presence
  states.
- **Commission a full custom tileset**: rejected for MVP — cost/time out
  of proportion; revisit only if the CC0 base proves insufficient.
- **LimeZu "Modern Interiors"** (the popular office interior pack):
  rejected — not CC0; its license terms conflict with redistribution in an
  open repository.

---

## Decision: Camera & legibility (FR-024)

### Decision
The new world package gets a real camera model (none exists today) —
implemented in `frontend/src/scenes/world/CampusScene.ts` +
`world/camera.ts`, replacing the retired `OfficeScene.ts` (plan.md
Project Structure):

- **Boot**: `setBounds(0, 0, map.widthInPixels, map.heightInPixels)`, then
  fit the **active building**, not the whole campus:
  `zoom = clamp(min(viewportW / officeBoundsW, viewportH / officeBoundsH),
  minZoom, maxZoom)` centered on the active office's `Rooms` bounds from
  the Tiled object layer (a whole-map fit would always be overridden by
  the `minZoom` clamp — the campus cannot fit a phone viewport, see
  below); recomputed on `this.scale.on('resize', ...)`
  (`Scale.RESIZE` mode already fires it; nothing listens today).
- **Pan**: pointer drag adjusting `camera.scrollX/Y` within bounds.
- **Zoom**: mouse wheel + pinch, clamped to `[minZoom, maxZoom]`.
- **FR-024 math**: avatars must stay individually tappable at ≥ ~24 CSS px
  at minimum zoom. With 16 px avatar frames, `minZoom = 24 / 16 = 1.5`;
  the name label plus a padded pointer hit-area on the avatar container
  push the effective touch target toward the 44 px platform guideline.
  `maxZoom ≈ 4` (64 px tiles) stays crisp under `pixelArt: true`.
- **Consequence accepted**: at minimum zoom the full campus will not fit a
  phone viewport — panning is the designed navigation, and per-building
  quick-jump buttons live in the DOM overlay (see next decision).
- **Input conflict resolved**: `HudScene`'s scene-wide `pointerdown` boost
  handler would fire on every camera drag (parallel overlay scenes receive
  all input); it moves to a DOM button as part of the UI decision, leaving
  canvas input exclusively for camera gestures and avatar taps.

### Rationale
The audit shows the status quo fails both directions at once: ~85% dead
viewport on desktop and a cropped, unreachable map on phones. A clamped
zoom range derived from the avatar tap-size requirement is the only way to
guarantee FR-024/SC-009 at peak crowd on both input modalities.

### Alternatives considered
- **Fixed 1:1 top-left (status quo)**: rejected — see audit.
- **`Scale.FIT` whole-map letterbox**: rejected — squeezing a campus-sized
  map onto a 375 px phone drops avatars far below 24 CSS px, violating
  FR-024; it also forbids the close-up reading of rooms the spec's world
  section is written around.

---

## Decision: UI architecture — DOM overlay

### Decision
Move HUD, Economy, Academy, and the new social/presence panels **out of
the canvas into a DOM overlay**; the Phaser canvas renders only the world.
`index.html` (currently a bare `<div id="game">` with zero CSS) gains a
positioned `<div id="ui">` overlay plus a stylesheet; the overlay container
uses `pointer-events: none` with `pointer-events: auto` on interactive
children, so camera pan/zoom gestures still reach the canvas. Responsive
CSS makes the panels a bottom-sheet/tab-bar in phone portrait and side
panels on desktop (FR-019). The Phaser scenes `HudScene.ts`,
`EconomyScene.ts`, and `AcademyScene.ts` are retired; the boost float-text
becomes a CSS animation that honors `state.settings.reducedMotion`, and
the per-scene color constants consolidate into CSS custom properties.

### Rationale
- **The seam already exists**: the accessor-injection pattern is
  framework-agnostic — `HudSceneInit`/`EconomySceneInit`/`AcademySceneInit`
  are plain `{ getState, getContent, on<Action> }` objects with zero
  Phaser types, and all display logic already routes through pure, tested
  view derivations (`getEconomyView` in `sim/economy.ts`, `getAcademyView`
  in `sim/academy.ts`, `formatLoc`/`formatRate` in `sim/format.ts`,
  `computeRate`). A DOM renderer is a thin `render(view)` over existing
  functions, driven by `ControllerScene.update()` calling `ui.refresh()`
  each frame.
- **It fixes shipped defects**: the audit shows the Economy/Academy panels
  (hardcoded `PANEL_X = 520`) entirely off-screen at 375 px — cash-out,
  upgrades, burner, and academy are unreachable on a phone today. DOM
  layout with real reflow is the direct fix, and it retires the
  create-once sizing bug (text arrays sized from `content` at `create()`
  never grow after the post-boot content fetch) for free, since DOM panels
  re-render lists from `content` each refresh.
- **Canvas text cannot get there from here**: responsive layout,
  scrolling, focus/accessibility, and text legibility are DOM primitives
  that would all need hand-rolling in Phaser text objects.

### Alternatives considered
- **Extend the in-canvas Phaser text UI**: rejected — no layout, reflow,
  scrolling, or accessibility primitives; every responsive behavior FR-019
  demands would be rebuilt by hand, and the audit shows where that path
  leads.
- **A full SPA framework (React/Vue) for the overlay**: rejected — a
  handful of panels re-rendered from pure view models needs no framework;
  the overlay itself adds no dependency (Principle V, minimal-deps
  constraint — the feature's only new frontend dependency is
  `oidc-client-ts`, justified in the Identity decision).

---

## Open items (deferred, not blocking)

- **Co-op balance numbers**: the `coop.json` values above are
  placeholders; tuning is a content-only change (Principle II).
- **Seat counts / final campus pixel dimensions**: fixed during Tiled
  authoring; must satisfy FR-021 sized against the expected **rendered**
  population — peak live crowd plus last-seen avatars retained within
  `lastSeenRetentionDays` (data-model, Seat capacity invariant).
- **Avatar sprite dimensions** (16×16 vs 16×24): confirmed during asset
  creation; only shifts the `minZoom` clamp arithmetic in the FR-024 math.
- **Consent/visibility UX copy** (FR-003 first-run dialog wording):
  clarify-level detail, does not affect architecture or contracts.
