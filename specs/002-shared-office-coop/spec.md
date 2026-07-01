# Feature Specification: Shared Office Co-op Presence

**Feature Branch**: `002-shared-office-coop`

**Created**: 2026-07-01

**Status**: Draft

**Input**: User description: "Das Idle-Game soll ein Multiplayer-Spiel werden, in
dem man sich gegenseitig im Büro sehen kann." → Refined to: an additive online
layer over the unchanged single-player core (Spec 001) in which players sign in
as real lise colleagues, see each other in the shared top-down office (live and
last-seen), and gain cooperative production bonuses from being present together.

## Clarifications

### Session 2026-07-01

- Q: Who does a player see, and how are players identified? → A: Real lise
  colleagues via sign-in — players authenticate with a lise identity and appear
  to one another by display name. This is a company-internal, authenticated
  feature.
- Q: Do you see only players who are simultaneously online, or also idle/offline
  colleagues? → A: Both — active colleagues appear live; offline colleagues
  appear as "idle at their desk" using their last-seen office/activity snapshot.
- Q: How much interaction between players, and may presence affect the idle
  game? → A: Cooperative bonuses — presence of colleagues grants a bounded
  production bonus. This deliberately touches the deterministic single-player
  core, so it MUST be designed to preserve determinism/offline integrity and
  MUST be recorded as a Complexity Tracking justification in the plan
  (Constitution Principles I, V, VI).

### Relationship to Spec 001 and the Constitution

This feature is the project's **first online capability**, and the first
exercise of Constitution **Principle VI (Online & Multiplayer as an Additive
Overlay)**, which was added in constitution v1.1.0 to govern exactly this kind
of feature. It is an **additive overlay**, not a replacement:

- The single-player idle core from Spec 001 is unchanged and remains fully
  playable offline. All social/co-op behavior is gated behind connectivity and
  sign-in.
- When offline or when the social backend is unreachable, the game degrades to
  the Spec 001 experience with no loss of progress and with the co-op bonus at
  baseline.

## User Scenarios & Testing *(mandatory)*

<!--
  Stories are ordered as independently shippable slices.
  P1 = the social office (see your colleagues) — the feature's identity.
  P2 = the co-op bonus (presence has gameplay meaning).
  P3 = live real-time presence (the office feels alive as you watch).
-->

### User Story 1 - See Your Colleagues in the Shared Office (Priority: P1) 🎯 MVP

As a player, I want to sign in as a lise colleague and see my colleagues'
avatars in the same top-down office — both those online now and those recently
active — so that the office feels shared rather than empty.

**Why this priority**: Seeing each other in the office is the headline value of
the whole feature. On its own it delivers the "we work here together" feeling
and requires identity, presence read, and rendering — the foundation everything
else builds on.

**Independent Test**: Sign in from two separate sessions as two different
colleagues; confirm each session sees the other's avatar placed in the office
that colleague is present in, labeled with their display name and current
activity. Sign one session out and confirm the other still sees it as a
last-seen "idle at desk" colleague.

**Acceptance Scenarios**:

1. **Given** a player who has signed in as a lise colleague, **When** they open
   the shared office, **Then** other colleagues are shown as avatars placed in
   the office each is present in, each labeled with a display name and current
   activity.
2. **Given** a colleague who is offline, **When** the player views the office,
   **Then** that colleague appears as "idle at their desk" using their
   last-known office/activity, with an indication that it is a last-seen state.
3. **Given** a player who has not signed in, **When** they play, **Then** the
   full single-player experience from Spec 001 works unchanged and they are
   offered (but never forced) to sign in to see colleagues.
4. **Given** a signed-in player, **When** they choose to hide themselves,
   **Then** they no longer appear to other colleagues while still playing
   normally.

---

### User Story 2 - Cooperative Production Bonus (Priority: P2)

As a player, I want the presence of colleagues in my office to grant a bounded
bonus to my production, so that being "at the office together" is rewarding and
gives me a reason to show up.

**Why this priority**: This turns presence from cosmetic into meaningful. It is
the mechanic the user explicitly asked for, and it must be added carefully so it
never compromises deterministic offline progress or save integrity.

**Independent Test**: With two colleagues present in the same office, confirm
each player's LOC-per-second is multiplied by the co-op bonus; have one leave and
confirm the remaining player's bonus reduces toward baseline; go offline and
confirm offline progress is computed at baseline (no co-op) and matches the
Spec 001 offline result.

**Acceptance Scenarios**:

1. **Given** at least one other colleague present in the player's active office,
   **When** production is calculated, **Then** the player's production receives a
   bounded cooperative bonus above baseline.
2. **Given** many colleagues present, **When** the bonus is calculated, **Then**
   it never exceeds its defined cap regardless of how many colleagues are
   present.
3. **Given** the player is alone in the office (or offline), **When** production
   is calculated, **Then** the bonus is at baseline (no co-op effect).
4. **Given** a player returns after an offline absence, **When** offline
   progress is credited, **Then** it is computed at baseline for the offline span
   and matches, within tolerance, the Spec 001 offline result — presence during
   the absence never retroactively inflates offline gains.
5. **Given** the co-op bonus is active, **When** it changes (a colleague joins or
   leaves), **Then** the change is applied to the ongoing simulation as a
   deterministic, timestamped input segment — not by live wall-clock polling — so
   that replaying the save reproduces identical results.

---

### User Story 3 - Live Presence That Feels Alive (Priority: P3)

As a player, I want the office to update in real time as colleagues arrive,
leave, commute between offices, and change activity, so that the shared space
feels alive while I am watching.

**Why this priority**: Real-time liveliness is a strong enhancement but not
required for value — the MVP (US1) already delivers a populated office via
last-seen snapshots. This story upgrades that to live updates.

**Independent Test**: With two sessions open, have one colleague commute from
Office #1 to Office #2; confirm the other session sees the avatar leave, enter a
commute state, and appear in Office #2 without a manual refresh.

**Acceptance Scenarios**:

1. **Given** two colleagues viewing the shared office, **When** one comes online,
   goes offline, or changes activity, **Then** the other sees the change without
   reloading.
2. **Given** a colleague commutes between offices, **When** the commute starts
   and completes, **Then** observers see the avatar transition consistently with
   the Spec 001 commute mechanic (present → commuting → present at destination).
3. **Given** a live colleague goes offline, **When** their session ends, **Then**
   their avatar transitions smoothly from live to last-seen without disappearing
   abruptly or erroring.

---

### Edge Cases

- **Backend unreachable at load**: the game runs single-player, shows no
  presence, applies the baseline (no co-op) bonus, and clearly but
  non-blockingly indicates social features are offline; when connectivity
  returns, presence and co-op resume.
- **Colleague goes offline mid-view**: their avatar transitions from live to
  last-seen without popping or errors.
- **Duplicate sessions for one colleague** (two tabs/devices): that colleague is
  represented once, with no ghost avatar and no double-counting toward anyone's
  co-op bonus.
- **Opted-out colleague**: remains invisible to others even while online, and
  their presence never contributes to another player's co-op bonus.
- **Client/server clock skew**: presence timestamps and co-op input segments
  stay consistent; a client clock cannot inflate the co-op bonus or offline
  gains.
- **Colleague present in an office the viewer has not unlocked**: the viewer can
  still see them there (viewing presence does not require having unlocked that
  office); it does not unlock the office for the viewer.
- **Co-op bonus during a commute**: while the player's dev is commuting (not
  present in any office), the co-op bonus is suspended, consistent with Spec 001
  presence-based effects being tied to the active office.
- **More colleagues in an office than desk slots**: overflow is rendered without
  breaking the layout or blocking the player; desk-slot limits from Spec 001
  apply only to the viewer's own placed producers, not to visiting avatars.
- **Social failure never harms the core**: a dropped connection, malformed
  presence data, or backend error never blocks, corrupts, or wipes the local
  save or the single-player loop.

## Requirements *(mandatory)*

### Functional Requirements

#### Identity & Access

- **FR-001**: The system MUST let a player authenticate as a lise colleague and
  obtain a stable identity (display name and avatar) before they are visible to
  others or receive co-op effects.
- **FR-002**: The single-player core loop from Spec 001 MUST remain fully
  playable WITHOUT signing in; authentication gates only the social/co-op
  overlay.
- **FR-003**: On first sign-in the system MUST obtain the player's consent to be
  shown to colleagues, and the player MUST be able to change their visibility
  (appear / hide) at any time.
- **FR-004**: The system MUST expose to other players only a display name,
  avatar, and in-game status (office, activity, live/last-seen) — no private or
  sensitive personal data.

#### Presence

- **FR-005**: The system MUST render other colleagues as avatars within the
  shared top-down office(s), each placed in the office they are present in and
  labeled with display name and current activity.
- **FR-006**: The system MUST show both live colleagues (currently online) and
  last-seen colleagues (offline, shown "idle at their desk" using their
  last-known office and activity with a last-seen indication).
- **FR-007**: Presence MUST reflect a colleague's current office and commute
  state consistently with the Spec 001 commute mechanic.
- **FR-008**: Presence MUST be a read-only overlay: viewing or being viewed MUST
  NOT read, alter, or expose another player's private save or simulation state.
- **FR-009**: A player who has hidden themselves (FR-003) MUST NOT appear to
  others and MUST NOT contribute to any other player's co-op bonus.

#### Cooperative Bonus

- **FR-010**: When one or more other colleagues are present in the player's
  active office, the player's production MUST receive a bounded cooperative
  bonus above baseline; when the player is alone or offline, the bonus MUST be at
  baseline (no effect).
- **FR-011**: The cooperative bonus MUST be capped so it never exceeds a defined
  maximum regardless of how many colleagues are present (anti-exploit,
  balance-safe).
- **FR-012**: The cooperative bonus MUST enter the simulation only as a
  deterministic, timestamped input to the core advance step — never as live
  wall-clock polling — so that offline progress and save replay remain
  deterministic and reproducible (Constitution Principle I).
- **FR-013**: Offline progress MUST be computed at baseline (no co-op) for the
  offline span; presence during a player's absence MUST NEVER retroactively
  inflate offline gains, and offline results MUST match the Spec 001 rule within
  the same tolerance.
- **FR-014**: The cooperative bonus MUST grant each present player only their own
  multiplier; no player's actions MUST be able to mutate another player's
  resources (no shared wallet, no transfers, no griefing).
- **FR-015**: The cooperative bonus magnitude, cap, and thresholds MUST be
  defined as tunable content data, not hardcoded in logic (Constitution
  Principle II).

#### Resilience & Degradation

- **FR-016**: If the social/presence backend is unreachable, the game MUST
  degrade gracefully to the single-player Spec 001 experience — core loop
  unaffected, baseline production, progress fully preserved — with a clear but
  non-blocking indication that social features are offline.
- **FR-017**: A social or network failure MUST NEVER block, corrupt, or wipe the
  local save or the single-player loop (Constitution Principle IV).
- **FR-018**: The system MUST tolerate stale, delayed, or inconsistent presence
  data without any effect on the integrity of the player's own saved state.

#### Cross-cutting

- **FR-019**: The presence and co-op UI MUST meet the same responsive,
  touch-and-pointer, mobile-and-desktop co-equal requirements established in
  Spec 001 (phone portrait/landscape through desktop).

### Key Entities

- **Player Identity (lise colleague)**: a stable, authenticated identity with a
  display name, avatar, and a visibility/consent setting controlling whether the
  player is shown to others.
- **Presence Record**: per colleague — current or last-known office, activity
  state, commute state, a live-or-last-seen flag, and a last-seen timestamp.
  Read-only to everyone except its owner.
- **Cooperative Bonus**: a bounded production multiplier derived from the set of
  other colleagues present in the player's active office, expressed as a
  deterministic, timestamped input segment consumed by the core advance step;
  baseline when alone or offline; parameters are tunable content data.
- **Save State (extended)**: the Spec 001 save state, optionally linked to a
  Player Identity and carrying the player's visibility/consent setting. The
  online overlay MUST NOT be required to load or migrate an existing
  single-player save.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in player sees their present colleagues' avatars in the
  shared office within a few seconds of opening it.
- **SC-002**: With the social backend unavailable, the single-player core loop
  and offline progress work with zero regressions versus Spec 001.
- **SC-003**: Offline progress with this feature enabled matches offline progress
  without it, within the same tolerance as Spec 001 — the co-op bonus never
  distorts offline math.
- **SC-004**: The cooperative bonus never exceeds its defined cap for any number
  of present colleagues.
- **SC-005**: Two colleagues online in the same office each observe the co-op
  bonus active; when one leaves, the remaining player's bonus adjusts toward
  baseline within a bounded, defined time.
- **SC-006**: A player who hides themselves stops appearing to other colleagues
  within a bounded, defined time, and immediately stops contributing to their
  co-op bonuses.
- **SC-007**: The shared office renders presence for the full expected lise
  colleague population without dropping the core interaction responsiveness
  established in Spec 001 (SC-003 of Spec 001).
- **SC-008**: A returning player never loses progress as a result of any social
  or network failure (zero save-loss incidents attributable to the overlay).

## Assumptions

- **Builds on Spec 001**: the single-player idle core is a prerequisite and is
  unchanged; this feature is an additive online overlay and the single-player
  experience is the fallback whenever offline or disconnected.
- **First online capability**: this spec is the first exercise of Constitution
  Principle VI (Online & Multiplayer as an Additive Overlay), added in
  constitution v1.1.0, and carries the prioritized-user-story justification that
  principle requires; it does not weaken the offline-capable, deterministic core.
- **Company-internal identity**: players are lise colleagues, so real display
  names are acceptable within the company context, subject to first-run consent
  and per-player visibility control (FR-003).
- **Determinism preserved by design**: the co-op bonus affects gameplay but is
  modeled to preserve determinism and offline integrity (bounded, data-tunable,
  entered as a timestamped input to `advance`, baseline while offline). The
  concrete synchronization/model is a plan-level decision and MUST be recorded in
  the plan's Complexity Tracking table (Constitution Principles I, V, VI).
- **Out of scope**: free-form chat or messaging, direct economy transfers or
  shared wallets between players, competitive/leaderboard mechanics, and any
  form of player-vs-player interference. These keep the moderation and griefing
  surface out of this feature.
- **No monetization** in this feature.
- **Stack is a plan decision**: the authentication provider, real-time transport,
  and presence store are chosen in `plan.md`. The feature MAY reuse existing
  sync infrastructure, but no specific technology is fixed by this spec.
- **Balance values deferred**: exact co-op bonus magnitude, cap, and presence
  thresholds are tunable content data set during planning/balancing, not fixed
  here (Constitution Principle II).
