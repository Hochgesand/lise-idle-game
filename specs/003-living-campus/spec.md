# Feature Specification: Living Campus — Player Character, Activities on the Map, Visible Timed Jobs

**Feature Branch**: `003-living-campus`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description (Andre, 2026-07-02): "The game stays an IDLE game.
Look-and-feel: Clash of Clans / Pokémon — one big living campus you pan and
zoom. Feature 003 adds: (1) a visible player character — your own dev avatar
sits at a desk in your active office, visibly commutes when you switch
offices, and a 'find me' affordance centers the camera on it; works fully
offline/signed-out. (2) Activities live in rooms — the Academy in 'skier',
the token burner at a Break Room coffee point, cash-out at the Office /
executive Office, manual boost at your own desk; tapping a station walks
your avatar there, then the existing panel opens contextually. (3) Visible
timed jobs (CoC-lite) — burner runs and trainings render as in-world progress
indicators above their station; a training visually occupies your avatar at
the Academy until it completes; durations are seconds-to-minutes, data-driven,
and never hard-gate other actions."

## Vision & Relationship to Specs 001/002

Spec 001 built the deterministic idle core (LOC production, cash-out,
upgrades, burner, Academy trainings, milestones, offline progress). Spec 002
built the campus world it plays in — both lise buildings as one big pannable,
zoomable map with named rooms, seat anchors, the tram commute route, colleague
presence avatars, and the responsive DOM overlay UI.

**Feature 003 makes the player exist inside that world.** Today the campus
shows everyone *except you*: colleagues sit at desks, commute along the tram,
and carry activity labels, while the player is a disembodied set of panels.
This feature gives the player a body (US1), moves the game's activities out of
an always-on panel stack onto physical stations in the rooms they thematically
belong to (US2), and makes running jobs visible in the world the way a
Clash-of-Clans builder hut shows its timer (US3).

Three boundaries are fixed up front:

- **The game stays an idle game.** Progression remains a pure function of
  state + elapsed time (Constitution Principle I). Walking to a station is
  presentation plus a short deterministic delay before a panel opens — it
  never feeds, delays, or modifies the core `advance` step.
- **Everything here works fully offline and signed-out.** The player character
  is *your* character — presence/sign-in is not required for any part of this
  feature. The 002 social overlay stays an additive overlay (Constitution
  Principle VI) and is untouched: this feature adds no online capability.
- **Non-goals**: no new backend endpoints; no PvP or social mechanics beyond
  Spec 002; no monetization; the mechanics remain the deterministic idle core.

## Clarifications

### Session 2026-07-02

- Q: Is the player avatar a presence feature (needs sign-in)? → A: No. It is a
  purely local rendering of the player's own save state (`activeOffice`,
  `commute`, current activity). Signed-out players see it labeled "Du";
  signed-in players see their display name. Colleagues continue to see the
  player exclusively through the unchanged 002 presence pipeline.
- Q: Does walking to a station change the simulation? → A: No. Walking is a
  presentation-layer animation with a short, deterministic, data-driven
  duration (seconds). The station's panel opens when the walk completes; the
  sim action (cash-out, burner start, …) happens only when the player takes it
  in the panel, with unchanged semantics. `advance` is not modified by walking.
- Q: Do timed trainings change the simulation? → A: Yes — deliberately and
  minimally. Trainings gain a data-driven duration; an in-progress training is
  saved state resolved by `advance` at `startedAt + duration`, exactly like the
  002 commute resolution. Completion (including across offline spans) is a pure
  function of state + elapsed time. This is the feature's only sim change and
  is recorded in the plan's Complexity Tracking.
- Q: Can timed jobs block the player? → A: Never hard-gate. While a training
  runs, all other actions (boost, cash-out, upgrades, burner, office switch)
  stay available; only starting a *second* training is unavailable until the
  first completes (one Academy seat — visible, thematic, and bounded to
  seconds-to-minutes).

## World anchors (from the 002 campus)

The stations live in rooms the 002 campus already defines
(`specs/002-shared-office-coop/campus-layout.md`):

| Activity | Station room / spot | Building |
|---|---|---|
| Academy (trainings) | **skier** (the trophy-shelf room) | office_1 |
| Token burner | **Break Room** coffee point (office_1) / a coffee point (office_2) | both |
| Cash-out | **Office** (office_1) / **the executive Office** (office_2) | both |
| Manual boost | the player's **own desk** | player's active office |

Activities available in both buildings resolve to the station in the player's
**active office**; the Academy has a single campus-wide home in `skier`
(office_1) — a player based in office_2 can still open the Academy via the
fallback menu (FR-013) without commuting.

## User Scenarios & Testing *(mandatory)*

<!--
  Stories ordered as independently shippable slices.
  P1 = the player exists in the world (the feature's identity).
  P2 = activities live in rooms (the world becomes the interface).
  P3 = visible timed jobs (the world shows what's running).
-->

### User Story 1 - My Own Dev in the World (Priority: P1) 🎯 MVP

As a player, I want to see my own dev avatar sitting at a desk in my active
office, watch it commute along the tram route when I switch offices, and have
a "find me" affordance that centers the camera on it, so that the campus is
*my* place and not just a map of other people.

**Why this priority**: The player character is the identity of the whole
feature — every later story (walking to stations, being occupied at the
Academy) needs a body to act with. On its own it already transforms the feel
of the game: the world stops being a spectator view.

**Independent Test**: Launch the game signed-out and offline. Confirm a
visually distinct avatar labeled "Du" sits at a deterministic desk in the
active office; trigger an office switch and watch the avatar travel the
street/tram route for the whole commute; tap "find me" from a far-panned,
far-zoomed camera and confirm the camera centers on the avatar.

**Acceptance Scenarios**:

1. **Given** a fresh or existing save, signed-out and offline, **When** the
   campus renders, **Then** the player's avatar is seated at a deterministic
   desk in the active office, visually distinct from colleague avatars
   (highlight ring, distinct sprite styling, "Du" label).
2. **Given** a signed-in player, **When** the campus renders, **Then** the
   player avatar carries the player's display name instead of "Du".
3. **Given** the player triggers an office switch, **When** the commute is in
   progress, **Then** the player's own avatar visibly travels the commute
   route between the buildings (no teleport), with progress derived purely
   from the saved commute state and elapsed time, and is seated at a desk in
   the destination office after arrival.
4. **Given** any camera position and zoom, **When** the player uses the
   "find me" affordance, **Then** the camera centers on the player avatar
   (seated, walking, or commuting) at a zoom where the avatar is clearly
   readable.
5. **Given** colleagues occupy desks in the same office (002 presence),
   **When** seats are assigned, **Then** the player's seat and colleague seats
   never overlap: the player's seat is reserved deterministically and
   colleagues fill the remaining anchors.

---

### User Story 2 - Activities Live in Rooms (Priority: P2)

As a player, I want the game's activities to be physical stations in the rooms
where they belong — the Academy in "skier", the token burner at a coffee
point, cash-out in the Office — so that playing the game means moving through
the campus like a Pokémon town instead of operating a stack of always-open
panels.

**Why this priority**: This is what makes the campus the *interface* rather
than a backdrop. It depends on US1 (the avatar must exist to walk) and
delivers the Clash-of-Clans "tap the building, use the building" loop.

**Independent Test**: Tap the Academy station in "skier": the player avatar
walks there over a few seconds and the Academy panel opens on arrival. Tap
another station mid-walk and confirm the walk retargets (latest tap wins, no
queued panels). Enable reduced motion and confirm the panel opens without the
walk animation. Open every panel from the fallback list menu without any
walking.

**Acceptance Scenarios**:

1. **Given** the campus is rendered, **When** the player looks at "skier", the
   Break Room coffee point, the Office / executive Office, and their own desk,
   **Then** each shows a recognizable station marker for Academy, token
   burner, cash-out, and manual boost respectively.
2. **Given** the player taps a station in their active office, **When** the
   tap lands, **Then** the player avatar walks to the station over a short,
   deterministic, data-driven duration and the corresponding existing DOM
   panel opens on arrival.
3. **Given** the player taps a different station (or the same one again)
   while a walk is in progress, **When** the new tap lands, **Then** the walk
   retargets to the new station — the latest tap wins, no panel opens for the
   abandoned target, and no taps queue up.
4. **Given** reduced motion is enabled, **When** the player taps a station,
   **Then** the panel opens promptly without the walk animation.
5. **Given** any device (phone portrait through desktop), **When** the player
   opens the fallback list menu, **Then** every activity panel can be opened
   directly, without walking, with keyboard and screen-reader access.
6. **Given** a panel was opened via a station, **When** the player closes it
   (or taps elsewhere), **Then** the panel closes and the overlay returns to
   the unobtrusive HUD-only state — panels are on-demand, not an always-on
   stack.
7. **Given** the player takes a sim action from a station-opened panel (e.g.
   cash-out), **When** the action applies, **Then** the result is exactly the
   Spec 001 action semantics — walking changed presentation and timing of the
   panel opening, never the simulation.

---

### User Story 3 - Visible Timed Jobs, CoC-lite (Priority: P3)

As a player, I want running jobs — an active token-burner run and an
in-progress Academy training — to be visible in the world as progress
indicators above their stations, and I want starting a training to visibly
occupy my avatar at the Academy until it completes, so that glancing at the
campus tells me what is running, like a Clash of Clans village at a glance.

**Why this priority**: This story completes the living-campus fantasy and
adds the one new mechanic (timed trainings). It builds on US1 (avatar) and
US2 (stations) and is the least essential to ship first — the game is already
transformed by P1+P2.

**Independent Test**: Start a burner run and confirm a progress indicator
renders above the burner station, draining as fuel burns. Start a training
with a data-driven duration: confirm the cost is deducted at start, a
progress indicator renders above the Academy, the player avatar relocates to
the Academy for the duration, the training's permanent multiplier applies
only from completion, and every other action stays available meanwhile. Close
the game mid-training, reopen after the duration has passed, and confirm the
training completed during the offline span with deterministic results.

**Acceptance Scenarios**:

1. **Given** an active burner run, **When** the campus renders, **Then** a
   progress indicator above the burner station shows the run's remaining
   fraction, derived purely from saved burner state + elapsed time.
2. **Given** the player starts a training with a nonzero duration, **When**
   the training is in progress, **Then** a progress indicator renders above
   the Academy station and the player avatar is visually occupied at the
   Academy until completion, after which it returns to its desk.
3. **Given** a training is in progress, **When** the player uses any other
   action (manual boost, cash-out, upgrade purchase, burner activation,
   office switch), **Then** the action works normally — timed jobs never
   hard-gate other actions; only starting a second training waits for the
   first.
4. **Given** a training is in progress, **When** the player closes the game
   and returns after the training's end time, **Then** the training is
   complete: the permanent multiplier applied from the completion point
   within the offline span, and replaying the same save with the same elapsed
   time yields identical results.
5. **Given** training durations are content data, **When** a balance change
   retunes a duration, **Then** no logic change is required (data-only
   change), and durations stay in the seconds-to-minutes band that keeps a
   free game fun.

---

### Edge Cases

- **Reduced motion**: with `settings.reducedMotion` enabled, station walks,
  the find-me camera glide, avatar occupation transitions, and progress-bar
  animations all reduce to immediate or minimal-motion equivalents; every
  outcome (panel opens, camera centered, indicator visible) still occurs.
- **Phone portrait (375×812)**: station markers and the player avatar stay
  tappable (≥ 44 px effective targets); on-demand panels open as bottom
  sheets without covering the find-me affordance; the fallback menu is
  reachable one-handed.
- **Player seat vs colleague seats**: the player's reserved seat is excluded
  from the colleague assignment deterministically — a colleague never renders
  on the player's seat and vice versa, at any crowd size including overflow
  (002 standing/roaming fallback unaffected).
- **Walk interrupted by another tap**: latest tap wins; the abandoned
  station's panel never opens; rapid tap sequences settle on the last target
  with no queued walks or panels.
- **Walk interrupted by an office switch**: a commute cancels any in-progress
  walk and pending panel-open; the avatar enters the commute route.
- **Office switch while a training runs**: the training keeps running (it is
  sim state, not presentation); the Academy indicator keeps showing progress;
  the avatar-occupation visual applies only while the player is present in
  the Academy's building — the training itself is never interrupted.
- **Offline completion of timed jobs**: a training (or burner run) whose end
  falls inside an offline span completes exactly at its end point within the
  span — production before/after the completion point uses the correct
  multipliers; results are identical to having stayed online (Principle I).
- **Training in progress at save/load**: the in-progress training
  round-trips losslessly; loading mid-training resumes the indicator and the
  occupied avatar at the correct progress.
- **v2 save (002) loads under 003**: additive migration defaults the new
  field(s); nothing else changes; the save round-trips losslessly.
- **Station in the other building**: activities with per-building stations
  (cash-out, burner) resolve to the active office's station; the Academy
  (office_1 only) is reachable from office_2 via the fallback menu without a
  commute — tapping the Academy station itself requires being in office_1.
- **Burner fuel runs out mid-walk to the burner station**: the panel still
  opens on arrival and shows the normal Spec 001 idle/empty burner state — no
  error, no stale progress indicator.
- **Zero/absent training duration**: a training without a duration (or with
  duration 0) behaves exactly like Spec 001 instant purchase — backward
  compatible content.
- **Signed-out vs signed-in label**: the label switches between "Du" and the
  display name without touching the save or the seat assignment.
- **Find-me during commute or walk**: the camera centers on the avatar's
  current interpolated position, not the stale seat.

## Requirements *(mandatory)*

### Functional Requirements

#### Player Character (US1)

- **FR-001**: The system MUST render a player avatar in the campus world,
  seated at a deterministic desk anchor in the player's active office,
  derived purely from local save state — fully functional offline and
  signed-out (no presence, no sign-in required).
- **FR-002**: The player avatar MUST be visually distinct from colleague
  avatars at a glance: a highlight ring, a distinct sprite styling, and a
  label reading "Du" when signed out or the player's display name when signed
  in.
- **FR-003**: The player's seat MUST be reserved deterministically and
  excluded from colleague seat assignment, so the player's avatar and
  colleague avatars never overlap on one anchor, at any crowd size.
- **FR-004**: When the player switches offices, the player's own avatar MUST
  visibly travel the commute route between the buildings for the whole
  commute (no teleport), with route progress a pure function of the saved
  commute state and elapsed time, consistent with the 002 commute mechanic
  and observers' view of the same commute.
- **FR-005**: The HUD MUST offer a "find me" affordance that centers the
  camera on the player avatar's current position (seated, walking, or
  commuting) at a zoom level where the avatar is clearly readable, on both
  touch and pointer devices.
- **FR-006**: The player avatar MUST be purely presentational with respect to
  others: it changes nothing about what colleagues see (the 002 presence
  pipeline is the unchanged, sole channel of the player's visibility to
  others) and nothing about the save beyond what Spec 001/002 already store.

#### Activities on the Map (US2)

- **FR-007**: The campus map MUST define named activity stations as map data:
  Academy in room "skier" (office_1), a token-burner station at a Break Room
  coffee point in each building, a cash-out desk in "Office" (office_1) and
  "the executive Office" (office_2), and the manual-boost spot at the
  player's own desk. Station placement is content/map data, not code.
- **FR-008**: Each station MUST render a recognizable, tappable marker in the
  world meeting the 002 legibility rules (individually tappable across the
  supported zoom range, effective touch target ≥ 44 px).
- **FR-009**: Tapping a station in the player's active office MUST walk the
  player avatar to the station over a short, deterministic, data-driven
  duration (seconds), then open the corresponding existing DOM panel
  (Academy, economy/burner, economy/cash-out, boost) contextually on arrival.
- **FR-010**: Walking MUST be presentation-only: the core `advance` step is
  not modified by walking, no resource or state change occurs from the walk
  itself, and the sim action taken in the opened panel keeps its exact
  Spec 001 semantics.
- **FR-011**: A new station tap during a walk MUST retarget the walk (latest
  tap wins); the abandoned target's panel never opens; taps never queue. An
  office switch cancels any in-progress walk and pending panel-open.
- **FR-012**: With reduced motion enabled, the walk animation MUST be skipped
  or minimized while preserving the outcome (panel opens promptly).
- **FR-013**: A fallback list menu MUST allow opening every activity panel
  directly without walking, usable with keyboard and assistive technology,
  on phone and desktop alike (covers accessibility and activities whose
  station is in the other building).
- **FR-014**: Panels MUST become on-demand: opened contextually (via station
  or menu), closable, and closed by default — replacing the always-on panel
  stack while keeping the persistent HUD (LOC counter, rate, find-me).

#### Visible Timed Jobs (US3)

- **FR-015**: An active burner run MUST render an in-world progress indicator
  above the burner station, its progress a pure function of saved burner
  state + elapsed time (no new sim state, no wall-clock feeding the sim).
- **FR-016**: Trainings MUST support a data-driven duration (content data;
  seconds-to-minutes band). A training without a duration (or duration 0)
  keeps Spec 001 instant-purchase behavior — existing content stays valid.
- **FR-017**: Starting a training with a nonzero duration MUST deduct its cost
  immediately and record an in-progress training in the save; the training's
  permanent multiplier MUST apply only from the completion point.
- **FR-018**: Training completion MUST be resolved by the core `advance` step
  at `startedAt + duration` as a pure function of state + elapsed time —
  including completions that fall inside offline spans, which MUST credit
  production before/after the completion point with the correct multipliers
  and replay deterministically.
- **FR-019**: An in-progress training MUST render an in-world progress
  indicator above the Academy station and visually occupy the player avatar
  at the Academy while the player is present in that building, returning the
  avatar to its desk on completion.
- **FR-020**: Timed jobs MUST never hard-gate other actions: manual boost,
  cash-out, upgrades, burner activation, and office switching all remain
  available while a training runs. Only starting a second training is
  unavailable until the first completes.
- **FR-021**: All timed-job tuning (training durations, walk duration,
  indicator thresholds if any) MUST be defined as tunable content data,
  never hardcoded in logic (Constitution Principle II).

#### Persistence & Compatibility (cross-cutting)

- **FR-022**: The save format extension for the in-progress training MUST be
  additive with a lossless migration: every existing v2 (002) save loads with
  the new field defaulted, round-trips losslessly, and the migration is total
  (valid result or safe failure, never partial mutation).
- **FR-023**: The full feature MUST work offline and signed-out with zero
  feature loss; nothing in this feature may require the network, the social
  backend, or sign-in (Constitution Principles IV and VI untouched).
- **FR-024**: All world/UI additions MUST meet the 002 responsive and
  legibility requirements (phone portrait/landscape through desktop, 60 fps
  at design load, reduced-motion support).

### Key Entities

- **Player Avatar**: the local, presentational projection of the player's own
  save state (active office, commute, current walk, running training) into
  the campus world — seat position, route position, occupation state, label
  ("Du" / display name), and distinct styling. Never part of a Presence
  Record; carries no authority; renders identically offline.
- **Activity Station**: a named point in the campus map data binding a world
  position (in a specific room/building) to an activity panel (academy,
  burner, cashout, boost). Map/content data, not code.
- **Walk Intent**: the presentation-layer record of an in-progress walk —
  target station, start position, deterministic duration. Lives outside the
  save and outside the sim; canceled by retarget or office switch.
- **Active Training (state)**: the one new saveable record — the in-progress
  training's id and start point on the sim timeline. Resolved by `advance` at
  `startedAt + duration`; at most one exists at a time; `null` when idle.
- **Training (content, extended)**: gains an optional duration (seconds).
  Absent/zero = Spec 001 instant behavior.
- **World tuning (content)**: the data block holding the walk duration and
  any future world/presentation tuning scalars.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any camera position, a player locates their own avatar in
  a single interaction ("find me") in under 2 seconds.
- **SC-002**: A player switching offices sees their own avatar travel the
  full commute route with no teleport, matching what a colleague observing
  them sees (002 SC-010) in timing and route.
- **SC-003**: Tapping a station opens the correct panel within the data-driven
  walk duration plus at most 1 second of UI latency; with reduced motion, within
  1 second flat.
- **SC-004**: A training completing during an offline span yields, on return,
  exactly the same resources as an online session over the same elapsed time
  (deterministic replay, within the Spec 001 tolerance).
- **SC-005**: 100% of this feature's functionality is available signed-out
  and offline (feature parity check across US1–US3).
- **SC-006**: The campus holds 60 fps at the 002 design load (~30 live + ~20
  last-seen colleagues) with the player avatar, station markers, and two
  active job indicators rendered, on phone and desktop.
- **SC-007**: Every existing v2 save loads under 003 with zero data loss and
  byte-identical behavior until the player uses a 003 feature.
- **SC-008**: The full 001/002 regression surface stays green: anonymous play,
  presence, co-op bonus, and offline progress are unchanged by this feature.
- **SC-009**: All panels reachable in ≤ 2 interactions from the default view
  via the fallback menu (accessibility path), verified with keyboard-only
  navigation.

## Assumptions

- **Builds on Spec 002's world**: the campus map with `Rooms`, `SeatAnchors`,
  and `CommutePaths` object layers, the camera model, `AvatarLayer`, the seat
  assignment, the commute polyline math, and the DOM overlay are prerequisites
  and are extended, not replaced. Station data joins the map as a new object
  layer following the same conventions.
- **The 002 map may still be placeholder art**: 002's T040/T041 real-map
  authoring may land before or alongside this feature; this spec depends only
  on the object-layer contracts (rooms/anchors/paths + the new stations), not
  on final art.
- **Player identity is optional garnish**: the display-name label uses the 002
  identity when present; "Du" otherwise. No new identity capability is added.
- **One in-progress training at a time** is a deliberate design bound (one
  Academy seat), not a technical limitation; durations stay in the
  seconds-to-minutes band so the bound never frustrates (free-game-fun tuning
  per the vision).
- **Walk duration is short and flat** (a few seconds, data-driven), not
  path-length-proportional — predictability beats realism for an idle game's
  interaction loop; the exact value is content tuning.
- **No new backend endpoints**: the backend's involvement is limited to
  serving extended content data and round-tripping the extended save through
  the existing session sync (state passthrough + merge), plus the schema
  version bump — no new REST/STOMP surface.
- **Out of scope**: pathfinding around walls (the walk may take a simple
  deterministic path), free avatar roaming/controls (this is not a movement
  game), NPC behaviors, decorating/base-building, and any monetization.
- **Balance values deferred**: exact training durations and the walk duration
  are tunable content data set during planning/balancing (Constitution
  Principle II).
