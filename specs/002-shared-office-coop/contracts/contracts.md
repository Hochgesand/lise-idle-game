# Contracts: Shared Office Co-op Presence

**Feature**: 002-shared-office-coop
**Date**: 2026-07-01

This document **extends** the Spec 001 contracts
([../../001-dev-idle-game/contracts/contracts.md](../../001-dev-idle-game/contracts/contracts.md));
every 001 clause remains binding and nothing here changes an existing wire
shape, endpoint semantic, or destination. Four contract surfaces:

1. **Pure simulation contract extension** — `advance` with `coopSegments`
   piecewise integration and the new `applyCoopPresence` mutator (TS).
2. **Backend REST extension** — authentication (OIDC via Keycloak) and the
   presence snapshot / settings endpoints.
3. **Backend STOMP extension** — presence deltas, the client heartbeat, the
   co-op lease channel, and reconnect semantics.
4. **Error & degradation contract** — every social failure is non-fatal
   (FR-016..018).

Global wire rules carry over from 001: big numbers are serialized as
**strings** everywhere (never `double`); timestamps are ISO-8601 UTC
strings. Co-op **multipliers and lease timings are small bounded tuning
scalars**, not resources — they travel as plain JSON numbers, and MUST
never be resource-valued.

---

## 1. Pure simulation contract extension (frontend, TypeScript)

001 wrote the sim contract as `advance(state, deltaTimeMs)`; the
implemented signature (`frontend/src/sim/advance.ts`) takes the injected
`ContentCatalog` as a third parameter. This document writes it out because
co-op tuning now flows through content.

### `advance(state, deltaTimeMs, content) -> state` — extended

| Param | Type | Notes |
|-------|------|-------|
| `state` | `GameState` | input snapshot; now carries `coopSegments`, `activeOffice`, and `commute` (see data-model.md) |
| `deltaTimeMs` | `number` (integer ≥ 0) | elapsed time in ms |
| `content` | `ContentCatalog` | injected content; now carries the `coop` tuning block |

**Returns**: a **new** `GameState` advanced by `deltaTimeMs`. The input is
**not** mutated. With `coopSegments: []` the result MUST be byte-identical
to the 001 behavior — the extension is strictly additive.

**Piecewise integration** (the FR-012 mechanism): let
`T0 = Date.parse(state.lastAdvancedAt)` and the integration interval be
`[T0, T0 + dt]`. The interval is split at every `coopSegments` boundary
(`from`/`until`, clipped to the interval) **and** at the existing burner
fuel-exhaustion instant. Per sub-interval,
`gain_i = rate_i × multiplier_i × len_i`, where `rate_i` is the existing
001 rate (burner or base, unchanged) and `multiplier_i` is the effective
co-op multiplier for that sub-interval.

**Postconditions** (testable invariants, additive to 001's):
- **Baseline outside segments**: any instant not covered by a segment has
  effective multiplier exactly `1`. An offline span sends no heartbeats
  and extends no lease; the **only** above-baseline coverage an offline
  span can carry is the residual lease issued before the player went
  offline — a bounded tail of ≤ `content.coop.leaseSeconds` (default
  60 s), earned while online. Beyond that tail, offline progress computes
  at baseline with no special branch (FR-013 with the documented
  ≤ one-lease carve-out recorded in plan.md Complexity Tracking;
  Constitution Principle VI).
- **Commute resolution (002-landed 001 FR-016)**: `advance` resolves an
  in-progress `commute` when the timeline reaches
  `commute.startedAt + content.coop.commuteSeconds`
  (`activeOffice := toOffice`, `commute := null`) — a pure function of
  state and content that works across offline spans. Commutes do not
  affect production and add no rate split point (data-model
  CommuteState).
- **Overlap rule**: at an instant covered by more than one segment, the
  segment with the **latest `from`** applies (deterministic; lets a
  server-issued downgrade segment override remaining coverage of an older,
  higher one).
- **Cap clamp**: every segment multiplier is clamped into
  `[1, content.coop.maxMultiplier]` before use — defense in depth against
  a tampered save (FR-011); post-clamp multipliers are ≥ 1, so
  `result.resources.loc >= state.resources.loc` (monotonicity) is
  preserved and the 001 monotonic merge stays sound.
- **Production only**: the multiplier scales LOC production; it MUST NOT
  scale burner `burnRate` or fuel consumption, so fuel math stays linear
  across segment boundaries.
- **Clock-skew clamping**: segment times are server-authored; `advance`
  clips each segment to `[T0, T0 + dt]`. A skewed client clock can shift
  where a segment overlaps the local timeline but can never lengthen
  coverage beyond the lease durations the server actually issued;
  worst-case skew artifact ≤ one lease (`content.coop.leaseSeconds`).
- **Compaction**: `result.coopSegments` contains no segment with
  `until <= result.lastAdvancedAt` — fully-integrated segments are pruned.
  Pruning is idempotent and expired segments contribute nothing, so
  compaction preserves associativity.
- **Associativity**: `advance(advance(s, a), b)` equals `advance(s, a + b)`
  under the same clause as 001 — exact for `lastAdvancedAt`,
  `activeBurner`, ownership sets, milestones, `coopSegments`, and
  `activeOffice`/`commute` (segment and commute-resolution boundaries are
  pure functions of state, never wall clock); the
  `resources.loc` accumulator carries the same ~1e-15 relative ULP caveat
  when a split lands a non-integer-second `dt` on a segment or
  fuel-exhaustion boundary. Exact for multiples of 1000 ms.
- **Complexity**: cost is O(active features + #segments overlapping the
  interval), never O(dt) — the constitution's time-skip constraint holds;
  compaction keeps the segment list bounded.
- `dt = 0` remains an exact no-op (no pruning, timestamp unchanged).

**Errors**: none thrown on valid input, as in 001.

### `computeRate(state, content) -> BigNumber` — extended

The HUD preview applies the effective multiplier of the segment covering
`state.lastAdvancedAt` (latest-`from` rule, cap-clamped) — the sim's only
notion of "now", keeping the function pure. `manualBoost` is derived from
`computeRate`, so lease multipliers apply to manual boosts identically to
the preview (consistency is contractual: preview and boost MUST agree).

### `applyCoopPresence(state, segment, content) -> state` — new pure mutator

The only entry point by which server-issued co-op leases reach the save.
Discrete and non-time-based like the 001 mutators (`sim/actions.ts`); it
never touches `lastAdvancedAt` or resources.

| Param | Type | Notes |
|-------|------|-------|
| `state` | `GameState` | input snapshot |
| `segment` | `CoopSegment` | `{ from, until, multiplier }`, server-authored (see §3 `coop.segment`) |
| `content` | `ContentCatalog` | injected content — the bounded-acceptance horizon below reads `content.coop.leaseSeconds`, so the catalog is a parameter of the function |

**Returns**: a new `GameState` with the segment merged into
`coopSegments`, **upserted by `from`**: an existing segment with the same
`from` takes `until = max(existing.until, segment.until)` and
`multiplier = max(existing.multiplier, segment.multiplier)` — the same
deterministic, conflict-free rule `sync/StateMerger.java` applies
server-side, so client merge and server merge cannot disagree. Repeated
delivery of the same heartbeat extension is idempotent.

**Postconditions**:
- The client never authors or rewrites segment times — `from`/`until`
  pass through verbatim (clock-skew posture, see §1 clamping rule and §3).
- A stale segment (`until <= state.lastAdvancedAt`, fully in the past) is
  a no-op: the state is returned unchanged. Already-integrated time is
  never re-credited.
- A segment with `from` in the **near** future
  (`from <= state.lastAdvancedAt + content.coop.leaseSeconds`) is stored
  and integrates when the timeline reaches it. A segment beyond that
  horizon is **dropped** (state returned unchanged): a correct server
  never issues one, and accepting it would park a segment that never
  reaches the compaction condition — an unbounded state-growth hole.

**Errors**: none thrown — a malformed segment (unparseable timestamps,
`until <= from`, non-finite or negative multiplier) returns the state
unchanged. Social input MUST NOT be able to corrupt the sim or throw into
the game loop (FR-017/018); affordances like `InsufficientResourcesError`
do not apply here.

### Content loader (frontend) — extended

`loadContent(contentJson) -> ContentCatalog` additionally validates the
`coop` block (see §2): all six fields present,
`perColleagueMultiplier >= 0`, `maxMultiplier >= 1`, `leaseSeconds > 0`,
`0 < heartbeatSeconds < leaseSeconds`, `commuteSeconds > 0`,
`lastSeenRetentionDays > 0`. Malformed → throws
`ContentValidationError`, as in 001. The bundled fallback
(`frontend/src/sim/fallbackContent.ts`) mirrors the block so an
offline-booting client integrates with identical values.

---

## 2. Backend contract: REST

Base path for game/presence endpoints: `/api/v1`. All bodies are JSON.
The backend exposes no authentication endpoints of its own — sign-in is
an SPA↔Keycloak exchange (see "Authentication" below), and the backend
only validates the resulting JWTs (`com.lise.liseidle.security`).

### Unchanged 001 endpoints (binding)

`GET /api/v1/content`, `POST /api/v1/session`, and
`PUT /api/v1/session/{playerId}/state` keep their exact 001 semantics.
Additive changes only:

- The content envelope gains a sixth entry, `"coop"` (loaded fail-fast by
  `content/ContentLoader.java` from
  `backend/src/main/resources/content/coop.json`); the five existing
  arrays, `schemaVersion`, `contentVersion`, and immutability-per-version
  are untouched; the hand-maintained `CONTENT_VERSION` bumps:
  ```json
  "coop": {
    "perColleagueMultiplier": 0.10,   /* +10% per distinct colleague */
    "maxMultiplier": 1.5,             /* hard cap, FR-011 */
    "leaseSeconds": 60,
    "heartbeatSeconds": 20,
    "commuteSeconds": 30,             /* office-switch travel time, 001 FR-016 */
    "lastSeenRetentionDays": 14       /* last-seen rendering/retention window */
  }
  ```
- `GameState` on the wire gains `coopSegments`, `activeOffice`, and
  `commute` (schemaVersion 1 → 2, see data-model.md);
  `CURRENT_SCHEMA_VERSION` in `SessionController` bumps to 2 with 409
  semantics unchanged; `sync/StateMerger.java` gains the segment merge
  rule (union keyed by `from`, max `until`, max `multiplier` — identical
  to `applyCoopPresence`, §1) and takes `activeOffice`/`commute` as a
  pair from the input with the later `lastAdvancedAt`. On the backend, a
  persisted or incoming state with absent/`null` `coopSegments` is
  normalized to `[]` (and absent `activeOffice`/`commute` to
  `"office_1"`/`null`) before merging — mirroring the frontend leniency
  rule, so pre-existing v1 rows never NPE the merge or leak `null` to a
  v2 client.
- Anonymous play is untouched **for ids never claimed by an identity**:
  without a bearer token the 001 client-generated-UUID path works exactly
  as before (FR-002 — sign-in gates only the overlay). When a request
  carries a valid bearer token, the server derives the save identity from
  the JWT's `sub` claim; a path/body `playerId` that does not match it →
  **403** `player_mismatch`.
- **Identity-bound ownership rule (binding)**: once a `playerId` has been
  bootstrapped or written under a valid bearer token whose `sub` matches
  it — i.e. the id is a known colleague identity (a `player_presence` row
  exists for it) — **all** subsequent session endpoints for that id
  REQUIRE a matching bearer: an unauthenticated `POST /api/v1/session` or
  `PUT /api/v1/session/{id}/state` against an identity-bound id → **401**
  `not_authenticated`. The anonymous path stays open **only** for ids
  never claimed by an identity. This rule is load-bearing: presence
  payloads broadcast every signed-in colleague's `sub` as `colleagueId`,
  so a signed-in player's `playerId` is public, not a guessable secret —
  without this rule any colleague could read a victim's full server-side
  save or PUT an inflated state that the monotonic max-merge would fold
  into the victim's real save (FR-004/FR-008/FR-014). Implemented in
  `SessionController` (tasks.md T031), tested in T015.
- **Identity adoption after sign-in (binding)**: once signed in, the
  client MUST stop using its anonymous localStorage UUID and adopt
  `colleagueId` — the Keycloak `sub` claim of its JWT, as echoed by
  `GET /api/v1/me` — as its `playerId`: it
  re-bootstraps with `POST /api/v1/session` under that id and pushes its
  local state via `PUT /api/v1/session/{colleagueId}/state` — the
  `StateMerger` union against the (initially absent) server row preserves
  all anonymous progress server-side. Without this switch, every
  authenticated `PUT` would 403 `player_mismatch` forever. The previously
  synced anonymous-UUID row is **orphaned** — never wiped, never merged
  automatically (restoring it is a manual/support action). The local save
  content itself is unchanged by sign-in. Validated in quickstart
  Scenario 2 step 5.

### Authentication (OIDC Authorization Code + PKCE, Keycloak)

The SPA authenticates **directly against Keycloak** — realm `LiseIdler`,
issuer `https://keycloak.novitasoft.de/realms/LiseIdler` — as the public
client `lise-idler-frontend` (PKCE, no client secret), using
`oidc-client-ts` to run the Authorization Code + PKCE flow and manage the
token lifecycle in the browser. The authorization, token, and end-session
endpoints are **Keycloak's, not ours**: the client discovers them from
the issuer's `/.well-known/openid-configuration`, and this document
references rather than respecifies them. The backend is a stateless
**OAuth2 resource server** validating `LiseIdler`-issued JWTs against the
issuer URI: it issues no browser-managed credential, holds no HTTP
session, and serves no login, callback, or logout endpoint. Signing out
is a client-side action — drop the stored tokens (optionally redirecting
through Keycloak's end-session endpoint) — after which the client plays
signed-out solo; the local save is untouched. Signing in is always
optional (FR-002).

**Bearer-token contract (binding)**: every call to an authenticated
endpoint carries `Authorization: Bearer <access_token>`
(`frontend/src/net/restClient.ts` attaches the header whenever it holds a
valid token).

- **401** `not_authenticated` — the bearer token is missing, expired, or
  invalid (bad signature, wrong issuer). The client treats this as
  signed-out and continues solo play or re-authenticates — never
  blocking.
- **403** `player_mismatch` — the token is valid but the path/body
  `playerId` does not match its `sub` claim.

**Security configuration (binding — Spring Security's defaults are
neither of these)**:

1. **Anonymous access stays open**: `SecurityConfig` MUST permit
   unauthenticated access to `GET /api/v1/content`,
   `POST /api/v1/session`, `PUT /api/v1/session/**`, and the `/ws`
   handshake — FR-002 requires the full 001 experience without sign-in.
   Session endpoints additionally enforce the identity-bound ownership
   rule above (an identity-bound id requires a matching bearer even on
   these otherwise-anonymous routes). `/api/v1/me` and
   `/api/v1/presence/**` require a bearer token. Under the `dev` profile,
   `/api/v1/dev/**` is permitted **without** a token (the endpoints are
   `@Profile("dev")` and do not exist in prod — the quickstart seeder
   depends on this). Every other unlisted path defaults to
   `anyRequest().authenticated()` — nothing becomes anonymously reachable
   by omission.
2. **CSRF: not applicable.** Authentication is a bearer token that client
   code attaches explicitly to each request; the browser holds no ambient
   credential that it would attach to a cross-site request, so there is
   nothing for a CSRF attacker to ride. CSRF protection is disabled for
   the stateless API, with no token plumbing and no compensating header
   scheme contracted.
3. **CORS**: the `CorsConfigurationSource` bean allows the origins
   `https://lise-game.schmitz.gg` (prod frontend),
   `http://localhost:5173` (Vite dev server), and
   `http://localhost:8087` (local compose frontend, tasks.md T006), with
   the `Authorization` request header permitted so authenticated
   cross-origin calls preflight cleanly. Credentialed CORS is not used —
   the token travels in an explicit header.

### `GET /api/v1/me` — current identity

Requires a bearer token.

**200** —
```json
{
  "colleagueId": "keycloak-sub-uuid",
  "displayName": "Ada Example",
  "avatar": "avatar-id-or-url",
  "consentGiven": true,
  "visible": true
}
```
`colleagueId` is the JWT's `sub` claim (a stable UUID — the social key
everywhere); `displayName` derives from the **access token's**
`name`/`preferred_username` claims, captured and refreshed **on each
authenticated request** — a pure resource server sees no sign-in event,
so the first authenticated write creates the `player_presence` row and
later requests refresh it. Prerequisites: the SPA requests scope
`openid profile` (tasks.md T057) and the frontend client's protocol
mappers put `name`/`preferred_username` into the access token (tasks.md
T003). `consentGiven`/`visible` are read from the player's
`player_presence` row (app-side state, FR-003 — never delegated to
Keycloak).

**401** — `not_authenticated`; the client treats this as signed-out and
continues solo play (never blocking).

### Test identities & backend service account

Two realm test users, **`alice`** and **`bob`**, are provisioned in
`LiseIdler` (tasks.md **T004** is the single authoritative creation
procedure — they do not pre-exist) for manual two-browser validation
(quickstart) — validation needs two independent colleagues and the
first-run consent flow, and app-side consent (`player_presence`) starts
empty for a fresh user, so both are exercisable against the real realm.
The frontend client's redirect URIs / web origins are provisioned
(tasks.md T003) to include `https://lise-game.schmitz.gg/*`,
`http://localhost:5173/*`, and `http://localhost:8087/*`, so dev servers
and the local compose frontend sign in against the same realm as prod.

Contract tests for §2/§3 and the two-session integration tests (plan.md
Testing) do **not** call Keycloak: they run with `spring-security-test`
mock JWTs under two identities (`alice`, `bob`) — no network required.

The confidential client **`lise-idler-backend`** (service accounts
enabled) is a **reserved capability** for backend→Keycloak service calls
(user-directory sync, token-introspection fallback): a hand-rolled
client-credentials token fetch — one plain `RestClient` POST to the
realm's token endpoint — with no extra dependency. Nothing in the MVP
surface above requires it.

### `GET /api/v1/presence` — presence snapshot

Requires authentication. One read on load delivers the whole visible
office population (SC-001); live deltas then arrive via STOMP (§3).

**200** —
```json
{
  "serverTime": "2026-07-01T09:00:00Z",
  "self":       { /* PresenceRecord — the viewer's own record, echoed
                     even while hidden, so the UI can show own status */ },
  "colleagues": [ /* PresenceRecord per VISIBLE colleague, self excluded;
                     hidden players are filtered server-side (FR-009) */ ]
}
```

`PresenceRecord` (read-only to everyone except its owner, FR-008):
```json
{
  "colleagueId": "keycloak-sub-uuid",
  "displayName": "Ada Example",
  "avatar": "avatar-id-or-url",
  "office": "office_1",             /* office id, or null while commuting */
  "activity": "coding",
  "commute": {                       /* null unless commuting (FR-007/022) */
    "fromOffice": "office_1",
    "toOffice": "office_2",
    "startedAt": "2026-07-01T08:59:30Z"
  },
  "status": "live",                  /* "live" | "last_seen" (FR-006/023) */
  "lastSeenAt": "2026-07-01T09:00:00Z"
}
```
No field beyond the above may be exposed — no email, no tokens, no save
data (FR-004).

**401** — `not_authenticated`.

### `PUT /api/v1/presence/settings` — consent & visibility

Request: `{ "consentGiven": true, "visible": true }`

**200** — `{ "consentGiven": true, "visible": true }` (the stored result).

**409** — `consent_required` if `visible: true` is requested while consent
is neither stored nor granted in the same request (FR-003).

Effects of hiding (`visible: false`) take hold server-side immediately
(SC-006): the colleague is dropped from subsequent snapshots, a
`presence.remove` delta is broadcast, and the server **immediately pushes
recomputed, capped downgrade segments** (`from = serverTime`, §3
"Multiplier changes") to every affected colleague in the hider's office —
the contribution stops within delta propagation (< 2 s target), not at
the next heartbeat or lease expiry. Hiding never
affects the player's own ability to play, see colleagues, or receive
segments — visibility gates being seen and being counted, not seeing
(FR-009).

### Error envelope (all endpoints)

Identical to 001: `{ "error": { "code": "string", "message": "string" } }`.
New codes introduced by this feature: `not_authenticated` (401),
`player_mismatch` (403), `consent_required` (409).
001's `no_save` and `schema_too_new` are unchanged.

---

## 3. Backend contract: WebSocket / STOMP (presence channel)

- **Endpoint**: unchanged — `ws(s)://<host>/ws` (STOMP over raw WebSocket,
  no SockJS). Authentication rides the **STOMP CONNECT frame**: the client
  passes its access token in the CONNECT headers
  (`Authorization: Bearer <access_token>`); a `ChannelInterceptor`
  (`security/StompBearerAuthInterceptor`) validates the JWT against the
  `LiseIdler` issuer and installs a `Principal` whose name is the
  `colleagueId` (the token's `sub`) — which, together with the
  broker-prefix correction below, makes `convertAndSendToUser`
  deliverable **to authenticated sessions**. A CONNECT without a token —
  or with an **invalid or expired** one — is treated identically: the
  frame is **accepted** with **no** Principal installed (never rejected
  with an ERROR frame, which would break 001's anonymous reconnect
  guarantee — FR-002); such a socket gets 001 behavior only: presence
  destinations deliver nothing to it and its heartbeat frames are ignored
  (presence subscriptions and heartbeats require the `Principal`).
- **Deliverability decision (binding)**: without a `Principal`,
  `SimpUserRegistry` cannot resolve a user destination, so `/user/queue/*`
  pushes — including 001's `/user/queue/state` corrections — are
  deliverable **only to authenticated sessions**. For anonymous sessions
  the de-facto 001 status quo (corrections undeliverable) persists and is
  **accepted**; the broker-prefix fix alone does not restore them, and no
  anonymous client-supplied Principal is assigned (tasks.md T032).
- **Token freshness (binding)**: access tokens live minutes while the
  socket lives hours, so the client MUST supply a **fresh** access token
  per connection attempt via `beforeConnect` updating
  `client.connectHeaders` (from the `oidc-client-ts` renewal) — static
  CONNECT headers would replay a stale token on every library-driven
  reconnect and silently degrade presence after the first expiry
  (tasks.md T061).
- **Broker**: `WebSocketConfig` changes to
  `enableSimpleBroker("/queue", "/topic")`, keeping
  `setUserDestinationPrefix("/user")`. Rationale: Spring rewrites a
  `/user/queue/coop` subscription to `/queue/coop-user{sessionId}`, and
  the simple broker only routes destinations matching its configured
  prefixes — the 001 value `enableSimpleBroker("/user")` was a **latent
  misconfiguration** under which neither `/user/queue/state` nor
  `/user/queue/coop` is deliverable (`convertAndSendToUser` resolves to
  `/queue/...` too); this feature corrects it. The **client-facing**
  destinations `/user/queue/state` and `/user/queue/coop` and the 001
  `state.correction` / `content.update` message shapes are untouched and
  MUST NOT change.
- **Subscribe**: `/topic/presence` — broadcast presence deltas, visible
  colleagues only, exactly one record per `colleagueId`.
- **Subscribe**: `/user/queue/coop` — per-player co-op lease segments
  (user-addressed; never broadcast).

### Server → Client messages

`presence.update` — full-record upsert on `/topic/presence`; one message
type covers join, office move, activity change, commute start/end, and the
live → last-seen transition (observers replace the record by
`colleagueId`):
```json
{ "type": "presence.update",
  "serverTime": "2026-07-01T09:00:00Z",
  "record": { /* PresenceRecord, §2 */ } }
```

`presence.remove` — the colleague hid themselves (or revoked consent);
observers drop the avatar entirely (unlike last-seen, which keeps
rendering):
```json
{ "type": "presence.remove", "colleagueId": "keycloak-sub-uuid" }
```

`coop.segment` — on `/user/queue/coop`; a server-authored lease segment
for the receiving player only:
```json
{ "type": "coop.segment",
  "segment": { "from": "2026-07-01T09:00:00Z",
               "until": "2026-07-01T09:01:00Z",
               "multiplier": 1.2 } }
```
The client applies it via `applyCoopPresence` (§1) and then persists via
the established safe-mutation template in `frontend/src/main.ts`.
`multiplier` is a plain JSON number (bounded scalar, not a resource) and
is already capped server-side at `coop.maxMultiplier`.

All three message records live in `com.lise.liseidle.presence` and follow
the 001 `TYPE`-discriminator + static-factory style
(`StateCorrection`/`ContentUpdate`); pushes go through a
`PresencePushService` mirroring `session/SessionPushService.java`.

### Client → Server: `/app/presence.heartbeat`

The overlay's only client→server frame. Body:
```json
{ "office": "office_1",            /* or null while commuting */
  "activity": "coding",
  "commute": { "fromOffice": "office_1",
               "toOffice": "office_2" }  /* or null */ }
```
- `office` and `commute` mirror the save's `activeOffice`/`commute` state
  (data-model): `office` is `null` and `commute` is set while a commute is
  in progress. `activity` is a client-derived **display label** computed
  from sim state (e.g. commuting → `"commuting"`, active burner →
  `"burning tokens"`, else `"coding"`) — never stored in the save.
- **No client timestamps, no colleagueId** — identity comes exclusively
  from the STOMP `Principal`, and all times are stamped by the server
  clock on receipt (`Instant.now().toString()`, the house convention).
  In particular the commute object carries **no `startedAt`**: the server
  stamps `PresenceRecord.commute.startedAt = serverTime` on the **first**
  heartbeat reporting the commuting transition, so presence timestamps
  never mix clock domains (spec clock-skew edge case). A client cannot
  spoof another colleague or stretch a lease.
- Cadence: every `coop.heartbeatSeconds` (~20 s) while the game runs,
  driven from `main.ts` (the clock-owning module) via
  `stompClient.publishHeartbeat(payload)`, guarded by `isConnected`.
- Server effects of one heartbeat: (1) mark the colleague live and extend
  their presence lease to `serverTime + leaseSeconds`; (2) update
  office/activity/commute in the `PresenceRegistry`, broadcasting
  `presence.update` when the record materially changed; (3) issue or
  extend the sender's `coop.segment` when at least one **other, distinct,
  visible** colleague is present in the sender's active office (self
  excluded). No segment is issued while the sender is commuting — the
  bonus is suspended in transit (spec edge case).
- The heartbeat is advisory: it can never mutate another player's record
  or resources (FR-008/FR-014), and losing it merely lets leases lapse.
  REST `PUT .../state` remains the **only** save path — presence frames
  are never required for saving.

### Lease & expiry contract

- **Live** means: lease not expired, where lease = last heartbeat +
  `coop.leaseSeconds` (content-tunable). Heartbeat ≈ 20 s against a 60 s
  TTL tolerates two dropped beats.
- A `@Scheduled` sweep in `PresenceService` (requires `@EnableScheduling`,
  new to this feature) expires **live → last-seen**: it broadcasts a
  `presence.update` with `status: "last_seen"` and persists `lastSeenAt`
  to the `player_presence` row. Observers see the transition within
  `leaseSeconds` plus one sweep interval of the final heartbeat — the
  bounded, defined time of SC-005/SC-006.
- Co-op decay: on expiry the server simply stops extending; issued
  segments run out within one lease, so a remaining player's bonus decays
  to baseline within `leaseSeconds` (SC-005). No revocation message exists
  or is needed — closed leases fail safe.
- Multiplier changes (a colleague joins, leaves, hides, or revokes
  consent): the server issues and **proactively pushes** a **new**
  segment with `from = serverTime` and the recomputed, capped multiplier
  to every affected player in that office — triggered by the change
  itself, never deferred to the affected player's next heartbeat.
  `advance`'s latest-`from`-wins overlap rule (§1) makes the new value
  effective from that instant even where the old segment still has
  coverage — downgrades do not wait for the old lease. This is what makes
  SC-006's "immediately stops contributing" hold at delta-propagation
  speed (< 2 s target).

### Duplicate-session collapse

Presence is keyed by **colleagueId**, never by WebSocket session. Any
session's heartbeat refreshes the same registry record
(max-of-heartbeats); office/activity take the latest-arriving heartbeat;
snapshots and broadcasts contain exactly one record per colleague; the
colleague goes last-seen only when **all** their sessions stop
heartbeating; and co-op multipliers count **distinct visible
colleagueIds**, so a second tab or device can neither render a ghost
avatar nor double-count toward anyone's bonus (spec edge case).

### Reconnect & snapshot refresh

- Both subscriptions are created inside the existing `client.onConnect`
  callback in `frontend/src/net/stompClient.ts`, which re-fires on every
  library-driven reconnect — subscriptions self-heal, as in 001. Each
  reconnect attempt carries a **fresh** access token (`beforeConnect`
  updates `client.connectHeaders`, see the token-freshness clause above),
  so the presence subscriptions keep self-healing past token expiry.
- After every (re)connect the client MUST re-fetch `GET /api/v1/presence`
  and replace its presence model wholesale; the snapshot is authoritative
  as of its `serverTime`. Deltas then apply last-write-wins per
  `colleagueId`; a delta older than the snapshot's `serverTime` MAY be
  discarded.
- Missed `coop.segment` messages during a disconnect are **not**
  retroactively issued: uncovered spans integrate at baseline by design
  (FR-013). A disconnect can only cost bonus, never inflate it.
- Heartbeats resume automatically once `isConnected` is true again.

---

## 4. Error & degradation contract (FR-016..018)

- **Every social failure is non-fatal.** Keycloak unreachable or `401` →
  signed-out solo play with a sign-in offer; presence snapshot failure →
  empty presence, retry permitted; STOMP drop → library auto-reconnect
  while the game continues solo at baseline. In every case the Spec 001
  core loop, offline catch-up, and the local save are untouched
  (Constitution Principles IV and VI; SC-002, SC-008).
- **Malformed payloads are dropped silently.** The 001 posture of
  `stompClient.ts` ("the channel is advisory; never throw into the game
  loop") extends to both new subscriptions: unknown `type` values and
  unparseable bodies are ignored, and `applyCoopPresence` returns the
  state unchanged on bad input (§1).
- **Staleness is tolerated.** Presence data is display-only: stale,
  delayed, duplicated, or out-of-order snapshots/deltas may at worst
  misplace an avatar or delay a status flip until the next delta or
  snapshot refresh; they MUST NOT affect the integrity of the player's own
  saved state (FR-018, FR-008).
- **Failures fail toward baseline.** Every failure mode — lapsed lease,
  dropped heartbeat, missed segment, clock skew — reduces or delays the
  bonus; no **protocol-level failure, network manipulation, or clock
  skew** can inflate the bonus or offline gains (closed leases +
  server-authored, clipped timestamps, §1/§3). Scope note: direct save
  tampering is out of scope per the 001 client-authoritative trust model
  (a tamperer can edit `loc` directly); the cap clamp bounds a tampered
  multiplier's *magnitude*, and `applyCoopPresence`'s future-`from`
  horizon (§1) bounds accepted segment growth, but hand-written segment
  *coverage* inside a tampered save is not defended beyond that.
- **Non-blocking offline indicator.** While social features are down the
  client MUST show a clear but non-blocking "social offline" indication
  (FR-016) that never intercepts input or pauses the loop.
- **Save-path isolation.** REST `PUT .../state` remains the only save
  path; authentication, consent, visibility, and presence are never
  required to load, migrate, or save a single-player save (spec Key
  Entities, "Save State").

## Non-functional contract clauses (additive; 001's remain binding)

- **Determinism**: the co-op bonus enters the sim only as deterministic,
  server-timestamped, bounded segments stored in the save; replaying a
  save reproduces identical results (Constitution I & VI, FR-012).
- **Privacy**: the wire exposes only `colleagueId` (the opaque IdP
  subject UUID — a technical key carrying no personal data), display
  name, avatar, office, activity, commute state, live/last-seen status,
  and lastSeenAt — never e-mail, tokens, or another player's save
  (FR-004). Exposing the raw `sub` as `colleagueId` is safe **only**
  because the identity-bound ownership rule (§2) rejects unauthenticated
  session access to identity-bound ids.
- **Boundedness**: the multiplier cap is enforced twice — server-side at
  segment issuance and client-side by the clamp in `advance` (FR-011).
- **Read-only overlay**: no endpoint or message allows one player to
  mutate another player's state, record, or resources (FR-008, FR-014,
  Constitution VI).
- **Numeric integrity**: resources stay big-number strings end-to-end;
  co-op multipliers and lease timings are bounded tuning scalars carried
  as plain JSON numbers and are never resource-valued (Constitution
  Additional Constraints).
