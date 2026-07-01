# Implementation Plan: Shared Office Co-op Presence

**Branch**: `002-shared-office-coop` | **Date**: 2026-07-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-shared-office-coop/spec.md`

## Summary

The project's first online capability: an **additive overlay** (Constitution
Principle VI) over the unchanged Spec 001 idle core in which players sign in
as real lise colleagues via **OIDC (Authorization Code + PKCE against the
existing Keycloak realm `LiseIdler` at keycloak.novitasoft.de)**, see each
other as live (green) and last-seen (red) avatars in a shared top-down
campus of both lise office buildings, and earn a **bounded co-op production
bonus** from being present together. Identity travels as **bearer JWTs** —
the SPA performs the PKCE flow via `oidc-client-ts`, the backend validates
tokens as a stateless OAuth2 resource server; presence flows as a REST snapshot plus
STOMP deltas over the existing `/ws` channel with a heartbeat lease
(~20 s beat / ~60 s TTL, server-expired); and — the critical design — the
bonus enters the deterministic sim **only** as closed, server-timestamped
lease segments stored in `GameState.coopSegments`, integrated piecewise by
`advance`, so save replay stays deterministic, offline spans compute at
baseline with no special branch (sole bounded exception: a residual lease
issued before going offline may cover the first ≤ `leaseSeconds` of the
span — earned while online; recorded in **Complexity Tracking**), and a
client clock can never inflate gains. All social behavior is best-effort:
any failure degrades to the Spec 001 experience at baseline bonus.

This plan also **closes a Spec 001 gap it depends on**: 001's spec
(FR-014/FR-016, Key Entities "Save State") requires the save to carry the
dev's active office and any in-progress commute, but the current model and
implementation lack both fields and no office-switch mechanic exists in
code. The presence heartbeat, co-op grouping key, and commute rendering
all consume exactly that state, so this feature adds
`GameState.activeOffice`/`commute`, the `switchOffice` mutator, and
`advance`'s commute resolution in the same v1→v2 migration (data-model.md,
dependency callout).

One thing is explicit up front: the **world/rendering/UI overhaul is a
first-class workstream of this plan**, not an increment. The live-site
visual baseline recorded in [research.md](research.md) (a 640×480 8-tile
placeholder room, top-left-pinned camera, in-canvas text panels that are
unreachable on phones) supports none of FR-019..FR-024. This plan therefore
delivers a new Tiled campus map (both buildings, named rooms, seat anchors,
commute streets), CC0 pixel-art tilesets with lise touches, a real camera
model (fit/center, pan, clamped pinch/wheel zoom), and a responsive DOM
overlay UI replacing the in-canvas text panels.

Full rationale in [research.md](research.md); data shape in
[data-model.md](data-model.md); interfaces in [contracts/contracts.md](contracts/contracts.md);
validation in [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: TypeScript (frontend) + Java 25 (backend, Spring Boot
4.1) — unchanged from Spec 001; no new frameworks.

**Primary Dependencies**:
- Frontend (existing): Phaser 4, Vite 8, break_eternity.js, @stomp/stompjs,
  Vitest. **New (002)**: `oidc-client-ts` — the browser-side OIDC
  Authorization Code + PKCE flow against the public Keycloak client
  `lise-idler-frontend` (small, well-maintained; hand-rolling the token
  lifecycle is error-prone security code — research: Identity decision).
  The DOM overlay UI itself is deliberately framework-free TS + CSS over
  the existing pure view derivations (research: UI architecture — SPA
  framework rejected).
- Backend (existing): `spring-boot-starter-web`, `-websocket` (STOMP),
  `-data-jpa`. **New (002)**: `spring-boot-starter-security` +
  `spring-boot-starter-oauth2-resource-server` — validates `LiseIdler`
  JWTs from the existing Keycloak (issuer URI
  `https://keycloak.novitasoft.de/realms/LiseIdler`); no session state.
  The real realm is reachable from dev: two realm test users
  (`alice`/`bob`, provisioned per tasks.md T004; fresh identities start
  un-consented) cover the two-colleague and
  consent scenarios, and Spring integration tests use
  `spring-security-test` mock JWTs — no network (research: Identity
  decision; contracts §2).
- Content/asset tooling (002): Tiled (campus map with `Rooms`,
  `SeatAnchors`, `CommutePaths` object layers; tilesets embedded in the
  export); CC0 pixel-art tilesets — Kenney **"Roguelike Modern City"** +
  **"Roguelike Indoors"** (16×16, one author, consistent palette; fallback
  Kenney "Tiny Town") plus small custom lise touches (logo signage, skier
  trophy shelf, room-name plates) — research: Art direction decision.

**Storage**: Client localStorage save (`schemaVersion` **1 → 2**, additive
migration defaulting `coopSegments: []`, `activeOffice: "office_1"`,
`commute: null` — the latter two close the 001 FR-014/016 gap) + the
existing JPA layer: `player_state`
(unchanged) plus a new **`player_presence`** table (one durable last-seen
row per colleague, keyed by the Keycloak `sub`: display name, avatar,
office, activity, `last_seen_at`, consent/visibility flag — FR-003 consent
and visibility stay app-side here). Live presence lives in an **in-memory
`PresenceRegistry`** (`ConcurrentHashMap` keyed by colleagueId) that
rebuilds itself from heartbeats after a restart. Database unchanged from
001: H2 in-memory (dev) / **file-backed H2** in PostgreSQL-compatibility
mode under the bind-mounted `/data` volume (prod —
`SPRING_DATASOURCE_URL=jdbc:h2:file:/data/gamedb` in `docker-compose.yml`;
the PostgreSQL driver in `pom.xml` is present but unused — no PostgreSQL
runs anywhere in the deployment). Big numbers remain strings; co-op
multipliers are bounded plain scalars, never resources.

**Testing**: Vitest (piecewise `advance` over segment boundaries,
`applyCoopPresence` merge/idempotence, associativity + compaction property
tests with `coopSegments` present, cap clamp, `switchOffice` +
commute-resolution across offline spans, v1→v2 migration, fallback
`coop` block); JUnit 5 + Spring Boot Test with `spring-security-test`
mock JWTs — no network to Keycloak
(presence REST/STOMP contract, heartbeat → lease extension, `@Scheduled`
sweep live→last-seen, duplicate-session collapse, hidden-player filtering,
`StateMerger` segment rule, fail-fast `coop.json` load); **two-session
integration tests** — two authenticated clients that see each other's
presence, receive segments, and collapse duplicate sessions (backing
quickstart Scenarios 1, 4, 9); manual [quickstart.md](quickstart.md)
Scenarios 0–9 end-to-end, including the phone-portrait legibility checks.

**Target Platform**: Modern desktop **and mobile** browsers as co-equal
(FR-019: phone portrait/landscape through desktop — the audit shows the
current implementation fails this; the DOM overlay + camera workstream is
the fix). Backend runs in Docker on the Unraid host behind the existing
reverse proxy (**Nginx Proxy Manager** — not Traefik; the API proxy host
already has "Websockets Support" enabled for 001's `/ws` — no new proxy
work). Each implementation phase ends with a deploy to this stack
(per-phase deploy tasks in tasks.md, executed via a to-be-created
`deploy-lise-game` Claude Code skill).

**Project Type**: unchanged 2-project monorepo (web-service backend +
web-app frontend). The overlay adds packages and directories, not projects.

**Performance Goals**:
- Frontend renders at **60 fps** with the campus scene at design load —
  ~30 live avatars plus the last-seen population (SC-007, SC-009).
- Presence freshness: snapshot visible within a few seconds of opening
  (SC-001); STOMP delta propagation **< 2 s** on the LAN host; live →
  last-seen within `leaseSeconds` + one sweep interval — the bounded,
  defined times of SC-005/SC-006.
- `advance(state, dt, content)` stays **O(active features + segments
  overlapping the interval)**, never O(dt); segment compaction inside
  `advance` keeps the list bounded (Constitution Additional Constraints).
- Backend sync round-trip unchanged from 001: < 300 ms p95 on the LAN host.

**Constraints**:
- Offline-capable core: every social call is best-effort like 001's
  `restClient`/`stompClient`; on failure → Spec 001 experience + baseline
  bonus + non-blocking "social offline" indicator (FR-016..018).
- Determinism: only server-authored ISO-8601 timestamps on segments and
  presence; `advance` clips segments to its interval, so a skewed client
  clock can never inflate coverage (worst case ≤ one lease, ~60 s).
- Legibility: avatars ≥ ~24 CSS px and tappable at minimum zoom
  (`minZoom = 24/16 = 1.5` with 16 px frames, `maxZoom ≈ 4`,
  `pixelArt: true`); combined tileset atlas well below 4096×4096 (FR-024).
- Cross-origin deploy (`lise-game.schmitz.gg` ↔ `lise-game-api.schmitz.gg`):
  authenticated calls carry `Authorization: Bearer <access_token>`
  (`restClient.ts`); a `CorsConfigurationSource` bean allows the
  `Authorization` header for the frontend origin plus
  `http://localhost:5173` and `http://localhost:8087` for dev. STOMP
  passes the bearer token in the `CONNECT` frame headers, validated in a
  `ChannelInterceptor` → session `Principal` (authenticated sessions
  only; anonymous sessions get no Principal — contracts §3).
- Security configuration (contracts §2, binding): `SecurityConfig` keeps
  the 001 surface anonymous (`GET /api/v1/content`, `POST /api/v1/session`,
  `PUT /api/v1/session/**`, `/ws` handshake — FR-002; session endpoints
  additionally enforce the contracts §2 **identity-bound ownership rule**:
  ids once claimed under a matching bearer reject unauthenticated access)
  and validates
  `LiseIdler` JWTs as an OAuth2 resource server (issuer-URI config). CSRF
  protection is not applicable and disabled: authentication travels only
  in the explicit `Authorization` header, no ambient credential
  accompanies cross-site requests, and the API holds no session state.
- Numeric stability unchanged: big-number strings end-to-end; no `double`.

**Scale/Scope**: ~**30 concurrent colleagues** as the design target (a
target, not a hard cap — graceful degradation beyond), plus last-seen
avatars of the wider colleague population; one campus map containing both
buildings and the commute streets; one additive content entry
(`coop.json`); save `schemaVersion` 2.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Deterministic, Pure Game Simulation | ✅ PASS (deliberate, justified touch) | The co-op bonus enters the sim only as closed, server-timestamped `coopSegments` stored in `GameState`, integrated piecewise by the same pure `advance`; boundaries are pure functions of state, never wall clock; associativity preserved (research "Co-op determinism"; contracts §1 postconditions; data-model CoopSegment invariants). Recorded in **Complexity Tracking** below, as constitution v1.1.0 requires. |
| II | Data-Driven Content & Balance | ✅ PASS | Bonus magnitude, cap, and lease timing are tunable content data: new `coop.json` as an additive sixth entry in the served envelope, mirrored into the bundled fallback; no balance number lives in logic (FR-015; data-model CoopConfig; contracts §2). |
| III | Test-First (NON-NEGOTIABLE) | ✅ PASS | RED-first Vitest for piecewise `advance`, `applyCoopPresence`, associativity/compaction properties, and the v1→v2 migration; JUnit + Spring Boot Test for presence/lease/merge with `spring-security-test` mock JWTs; two-session integration tests; per `/speckit.tasks` ordering. |
| IV | Player State Integrity & Persistence | ✅ PASS | Additive migration 1→2 defaults `coopSegments: []`; every v1 save stays loadable with zero online capability; social failure never blocks, corrupts, or wipes the save (REST `PUT` remains the only save path); lossless round-trip retained (data-model "Save migration"; contracts §4; quickstart Scenarios 5–6; SC-002/003/008). |
| V | Simplicity & YAGNI | ✅ PASS (two justified additions) | Reuses the existing STOMP channel, push-message idiom, and JPA layer; in-memory registry + one durable row instead of Redis/event history; framework-free DOM overlay; the already-operated Keycloak realm is reused rather than standing up new identity infrastructure — Entra ID and magic-link auth rejected. The two genuinely new complexities — an online gameplay effect and an external IdP — are justified in **Complexity Tracking** (research: every "Alternatives considered" block). |
| VI | Online & Multiplayer as an Additive Overlay | ✅ PASS (one documented, bounded deviation) | First exercise of the principle, justified by prioritized stories US1–US3: core loop fully playable signed-out (FR-002); presence is a read-only overlay, server never authoritative over any save (FR-008/014); the one gameplay input is deterministic, timestamped, bounded, tunable content data; offline spans integrate at baseline **except the ≤ one-`leaseSeconds` residual-lease tail earned while online** — an explicit, documented deviation recorded in Complexity Tracking (FR-010..018; contracts §1/§3/§4; quickstart Scenarios 2, 5, 6). |

**Additional Constraints**: offline-capable core with the overlay strictly
optional ✅; numeric stability — big-number strings, multipliers as bounded
scalars ✅; O(features + overlapping segments) time-skip with compaction,
never O(dt) ✅; minimal deps — two Spring Security starters (backend) and
`oidc-client-ts` (frontend OIDC token lifecycle — hand-rolling it is
error-prone) are the only new libraries ✅; determinism over real-time — only
`dt` and state-resident segments feed the sim, never `Date.now()` ✅.

**Post-design re-check (after Phase 1)**: all six principles still hold as
above. Unlike 001, the Complexity Tracking table is **not** empty this
time: the two justified entries below are required by Principles I, V, and
VI and by the constitution v1.1.0 Sync Impact Report follow-up.

## Project Structure

### Documentation (this feature)

```text
specs/002-shared-office-coop/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions incl. live-site visual audit
├── data-model.md        # Phase 1 — save extension + social entities + world data
├── quickstart.md        # Phase 1 — validation scenarios 0–9
├── contracts/
│   └── contracts.md     # Phase 1 — advance extension + REST/STOMP surfaces
└── tasks.md             # Phase 2 — /speckit.tasks (not yet created)
```

### Source Code (repository root)

Additive layout on the 001 two-project monorepo — `(002)` marks new files,
`(001→)` marks existing files that are extended:

```text
backend/                                  # Spring Boot 4.1 (Java 25)
├── src/main/java/com/lise/liseidle/
│   ├── content/                          # (001→) ContentLoader/-Catalog gain the coop block
│   │   └── CoopConfig.java               # (002) coop tuning record
│   ├── state/
│   │   └── GameState.java                # (001→) + coopSegments, activeOffice, commute; schemaVersion 2
│   ├── sync/
│   │   └── StateMerger.java              # (001→) + segment union rule (max until/multiplier),
│   │                                     #   activeOffice/commute by later lastAdvancedAt,
│   │                                     #   null-coopSegments normalization
│   ├── session/
│   │   ├── WebSocketConfig.java          # (001→) enableSimpleBroker("/queue", "/topic") —
│   │   │                                 #   corrects the latent "/user" broker-prefix
│   │   │                                 #   misconfig (contracts §3)
│   │   └── SessionController.java        # (001→) principal-derived identity, schema bump
│   ├── security/                         # (002) NEW package — identity (FR-001..004)
│   │   ├── SecurityConfig.java           #   OAuth2 resource server (LiseIdler JWTs) + CORS
│   │   │                                 #   + anonymous 001 surface (identity-bound ids
│   │   │                                 #   excepted — contracts §2 ownership rule)
│   │   ├── StompBearerAuthInterceptor.java # STOMP CONNECT bearer validation →
│   │   │                                 #   session Principal (authenticated only)
│   │   └── MeController.java             #   GET /api/v1/me
│   └── presence/                         # (002) NEW package — presence + co-op leases
│       ├── PresenceRegistry.java         #   in-memory live records, keyed by colleagueId
│       ├── PresenceRecord.java           #   wire/domain record (contracts §2)
│       ├── PresenceService.java          #   heartbeat → lease; @Scheduled expiry sweep
│       ├── PresenceController.java       #   GET /api/v1/presence, PUT .../presence/settings
│       ├── PresencePushService.java      #   /topic/presence + /user/queue/coop pushes
│       ├── PresenceUpdate.java           #   TYPE-discriminated messages
│       ├── PresenceRemove.java           #   (mirrors session/StateCorrection style)
│       ├── CoopSegmentMessage.java       #   server-authored lease segments
│       ├── CoopService.java              #   distinct-visible-colleague multiplier, capped
│       ├── PlayerPresenceEntity.java     #   durable last-seen row (player_presence)
│       ├── PresenceRepository.java       #   JpaRepository
│       └── DevPresenceSeeder.java        #   @Profile("dev") seed endpoints (quickstart)
├── src/main/resources/
│   ├── content/coop.json                 # (002) sixth content entry (FR-015)
│   └── application.yml                   # (001→) Keycloak issuer-uri (resource server)
│                                         #   + @EnableScheduling
└── src/test/java/...                     # (002) security/presence/lease/merge tests

frontend/                                 # Phaser 4 + TypeScript + Vite
├── index.html                            # (001→) + #ui overlay div + stylesheet
├── src/
│   ├── sim/                              # PURE core (still no I/O, no Phaser)
│   │   ├── advance.ts                    # (001→) piecewise segment integration + compaction
│   │   │                                 #   + commute resolution (001 FR-016 gap closed)
│   │   ├── actions.ts                    # (001→) + switchOffice mutator (starts a commute)
│   │   ├── coop.ts                       # (002) applyCoopPresence + segment clip/overlap helpers
│   │   ├── types.ts                      # (001→) + coopSegments, activeOffice, commute on GameState
│   │   ├── content.ts                    # (001→) validate coop block
│   │   └── fallbackContent.ts            # (001→) mirror coop block
│   ├── save/
│   │   ├── migrations.ts                 # (001→) v1 → v2 (coopSegments: [],
│   │   │                                 #   activeOffice: "office_1", commute: null)
│   │   └── localStorage.ts               # (001→) lenient defaults for missing fields
│   ├── net/
│   │   ├── restClient.ts                 # (001→) Authorization: Bearer on authenticated
│   │   │                                 #   calls; /me; adopts the sub-derived colleagueId
│   │   │                                 #   as playerId after sign-in (contracts §2
│   │   │                                 #   identity adoption)
│   │   ├── stompClient.ts                # (001→) bearer token in CONNECT headers +
│   │   │                                 #   onPresence + publishHeartbeat
│   │   ├── auth.ts                       # (002) oidc-client-ts PKCE login (public client
│   │   │                                 #   lise-idler-frontend), token lifecycle
│   │   └── presenceClient.ts             # (002) snapshot fetch + presence model
│   ├── scenes/
│   │   ├── OfficeScene.ts                # (001→) superseded by world/ (see below)
│   │   └── world/                        # (002) NEW — the campus workstream
│   │       ├── CampusScene.ts            #   renders the Tiled campus map
│   │       ├── camera.ts                 #   fit/center, pan, clamped pinch/wheel zoom
│   │       ├── avatars.ts                #   green/red states, labels, activity icons
│   │       ├── seats.ts                  #   SeatAnchors assignment + standing overflow
│   │       └── commute.ts                #   CommutePaths traversal (FR-022)
│   ├── ui/                               # (002) NEW — DOM overlay (FR-019)
│   │   ├── overlay.ts                    #   mount + per-frame refresh from view models
│   │   ├── hudPanel.ts                   #   replaces HudScene (retired)
│   │   ├── economyPanel.ts               #   replaces EconomyScene (retired)
│   │   ├── academyPanel.ts               #   replaces AcademyScene (retired)
│   │   ├── socialPanel.ts                #   sign-in offer, consent, hide/show, offline badge
│   │   └── styles.css                    #   bottom-sheet/tab-bar (phone) ↔ side panels (desktop)
│   ├── game/                             # (001→) loop wiring + heartbeat interval in main.ts
│   └── main.ts                           # (001→) segment merge at safe mutation points;
│                                         #   re-bootstraps session under colleagueId
│                                         #   after sign-in (contracts §2)
├── public/assets/                        # (002) placeholder set replaced
│   ├── campus.json                       #   Tiled export: both buildings + streets,
│   │                                     #   Rooms/SeatAnchors/CommutePaths object layers
│   ├── campus_tileset.png                #   Kenney CC0 16×16 + custom lise touches
│   ├── avatars.png                       #   avatar frames incl. live/last-seen styling
│   └── README.md                         #   (001→) rewritten for the new assets
└── src/**/*.test.ts                      # (002) Vitest tests co-located next to their
                                          # modules (sim/coop/migration/world — the repo
                                          # convention; no separate tests/ directory)

docker-compose.yml                        # (001→) the PROD deployment stack
                                          # (SPRING_PROFILES_ACTIVE=prod; adds Keycloak env:
                                          # issuer URI + backend client id lise-idler-backend
                                          # + its secret interpolated from the UNTRACKED
                                          # host-side .env — never committed, tasks.md
                                          # T003a/T005).
                                          # Nginx Proxy Manager (not Traefik): unchanged —
                                          # the API proxy host already forwards /ws.
docker-compose.dev.yml                    # (002) NEW override for local validation
                                          # (tasks.md T006): SPRING_PROFILES_ACTIVE=dev —
                                          # enables only the DevPresenceSeeder profile;
                                          # swaps the datasource to in-memory H2 (the /data
                                          # bind mount exists only on the Unraid host) and
                                          # re-points the frontend build-args at
                                          # http://localhost:8086; auth uses the real
                                          # LiseIdler realm everywhere.
```

**Structure Decision**: Keep the 001 two-project monorepo and grow it
additively along existing package conventions: one new backend package per
concern (`security/`, `presence/` — flat feature packages like
`content/`/`session/`), one new content file, and two new frontend
directories (`scenes/world/` for the campus workstream, `ui/` for the DOM
overlay). The pure sim stays isolated under `frontend/src/sim/` with zero
I/O — co-op arrives there only as data (`coopSegments` in state, `coop`
block in content). The three retired Phaser UI scenes are replaced, not
extended, per the research UI decision and the live-site audit.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Two entries — both mandated: Principle VI requires any online gameplay
effect and any material online capability to be justified here, and the
constitution v1.1.0 Sync Impact Report names this feature's co-op bonus
explicitly.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Presence-driven co-op bonus touches the deterministic core** (Principles I, V, VI): an online input now feeds `advance`, via `coopSegments` in the save and piecewise integration. | The bonus is the explicitly requested mechanic (US2, P2; FR-010..015) — it is what turns presence from cosmetic into "being at the office together is rewarding". The design confines the touch: closed, server-timestamped, bounded lease segments stored in state; integration piecewise and pure; offline spans uncovered → baseline automatically, **with one documented, bounded deviation**: a residual lease issued while the player was still online may cover the first ≤ `leaseSeconds` (default 60 s) of an offline span — the coverage was earned online, and eliminating it would require client-rewritten segment times on persist. This deviates from the strict letter of FR-013/SC-003, which need a matching carve-out amendment ("baseline beyond the ≤ one-lease residual tail"); until amended, quickstart Scenario 5 tests the carve-out form. Cap and timings tunable in `coop.json`; associativity and O(features+segments) preserved (research "Co-op determinism"; contracts §1). | *Cosmetic-only presence* (no gameplay effect) keeps the core untouched but rejects the requested mechanic and strips US2's value. *Live wall-clock multiplier at tick time* is less code but breaks `advance` purity and replay (Principle I, FR-012) and makes offline spans ambiguous (FR-013). *Server-computed bonus crediting resources* makes the server authoritative over the sim (Principle VI), duplicates `advance` in Java (rejected already in 001), and breaks offline play. *Clipping persisted segments at save time* (to make offline strictly baseline) was rejected: it puts client-authored `until` values into the save, breaking the "client never writes segment times" invariant. |
| **External IdP dependency** (the existing Keycloak at keycloak.novitasoft.de, realm `LiseIdler`, via OIDC + Spring Security) — new auth infrastructure for FR-001, and this project's first third-party runtime dependency for sign-in. | FR-001/003/004 need a *real*, stable lise-colleague identity with consent and visibility control; the `LiseIdler` realm is already provisioned and self-administered — nothing new to operate. The SPA performs Authorization Code + PKCE (public client `lise-idler-frontend`, via `oidc-client-ts`); the backend validates the JWTs as a stateless resource server, and the authenticated principal closes 001's trust-the-client `playerId` hole (together with the contracts §2 identity-bound ownership rule) and gives **authenticated** STOMP sessions a `Principal` via CONNECT-frame bearer validation (which — together with the `/queue` broker-prefix correction, contracts §3 — makes `convertAndSendToUser` deliverable to authenticated sessions; anonymous sessions carry no Principal and keep 001's de-facto undeliverable status quo, accepted in contracts §3). The confidential client `lise-idler-backend` (service-account roles) is reserved for backend→Keycloak service calls — not required for MVP. Dev and CI use the real realm (test users `alice`/`bob`) plus `spring-security-test` mock JWTs for network-free tests (research "Identity & authentication provider"). | *Microsoft Entra ID*: no usable lise Entra tenant/app registration exists for this internal project, while the Keycloak realm is already provisioned and self-administered. *@lise.de magic-link auth* means hand-rolling token issuing, expiry, and email delivery for a weaker result — a second identity system parallel to the IdP already running. *Anonymous play + self-claimed display name* makes impersonating a colleague trivial, violating FR-001/004 and the trust assumption behind showing real names. *A backend-held session (BFF pattern, `oauth2Login`)* adds an ambient-credential CSRF surface and server session state; bearer + resource server keeps the backend stateless (Principle V). |

**Classification note (Principle V)**: the world/rendering/UI overhaul
declared a first-class workstream in the Summary (Tiled campus pipeline,
camera model, seats/commute systems, DOM overlay replacing three retired
Phaser scenes) is **story-mandated scope, not a Principle V deviation**,
which is why it carries no violation row above: FR-019..FR-024 require it
directly, and the live-site audit (research.md) shows the placeholder
scene supports none of them; the rejected simpler alternative (extending
the placeholder scene and the in-canvas text UI) is documented in
research's World/Camera/UI decisions.
