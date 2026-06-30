# Feature Specification: Lise Dev Idle Game

**Feature Branch**: `001-dev-idle-game`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Ein Browsergame in Vogelperspektive, in dem wir einen Software-Developer im Pixel-Stil spielen, mit Idle-Game-Mechaniken. Der Dev arbeitet bei der lise GmbH; Fortschritt läuft auch offline weiter. Theme orientiert sich an lise.de (Software-/KI-Haus, lise Academy, Zertifizierungen). Ein 'Token-Burner'-Mechanic (LOC ↔ Cash ↔ AI-Tokens) bildet den wirtschaftlichen Kern."

## Clarifications

### Session 2026-06-30

- Q: How do the two real lise office buildings relate in progression? → A: Start in Office #1; Office #2 unlocks as a major milestone that expands producer/desk capacity (lise "growing into a second location").
- Q: What does navigating between the two offices mean mechanically? → A: A timed commute — switching the dev's active office starts a short, state-tracked travel delay before the dev is "present" at the destination; autonomous producers keep producing in both offices throughout.
- Q: Are the floor-plan rooms/desks tied to the economy or just backdrop? → A: Desks host producers — each producer occupies a desk/room; the two offices provide a finite, expandable number of placement slots, and Office #2's unlock raises the cap.
- Q: How should "mobile-first, desktop also" shape requirements? → A: Mobile and desktop are co-equal first-class targets via a responsive layout (touch and pointer input, phone portrait/landscape through desktop); neither is treated as secondary.

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are ordered as independently shippable MVP slices.
  P1 = the idle core + the visual world (the game's identity).
  P2 = the economic tension (the token-burner reinvest loop).
  P3 = permanent progression + long-term goals (retention).
-->

### User Story 1 - The Dev at Work (Priority: P1) 🎯 MVP

As a player, I want to watch my developer character work in a top-down pixel
office and see Lines of Code (LOC) accumulate over real time, so that the
game makes progress even when I only check in occasionally.

**Why this priority**: This is the idle core — production driven by elapsed
time — plus the top-down pixel world that defines the game's identity.
Without it there is no game.

**Independent Test**: Load the game, observe LOC increasing second by second,
interact to give a manual boost, close the tab, reopen after a few minutes,
and confirm LOC grew by the expected offline amount.

**Acceptance Scenarios**:

1. **Given** a brand-new player, **When** they open the game for the first
   time, **Then** a top-down pixel-art scene of a developer at a workstation
   is shown and LOC begins accumulating from zero.
2. **Given** the dev is working, **When** the player interacts (e.g., taps or
   clicks the scene), **Then** production receives an immediate manual boost.
3. **Given** the player closes the game, **When** they return after N
   minutes, **Then** LOC has increased by roughly the amount the dev would
   have produced in N minutes (offline progress honored).
4. **Given** the player refreshes or reopens the browser, **When** the game
   loads, **Then** their previous LOC and state are restored.

---

### User Story 2 - Cash & the Token Burner (Priority: P2)

As a player, I want to turn my LOC into spendable Cash and buy an "AI Token"
accelerator that burns tokens to massively speed up LOC, so that I face a
meaningful reinvest decision between saving and accelerating.

**Why this priority**: This introduces the core economic tension — the
token-burner loop — that gives the idle game depth beyond passive
accumulation.

**Independent Test**: Accumulate enough LOC, cash it out, purchase the
token-burner upgrade, and verify LOC-per-second multiplies while the burner
is active and consuming a resource.

**Acceptance Scenarios**:

1. **Given** the player has accumulated LOC, **When** they cash out,
   **Then** they receive spendable Cash proportional to the LOC.
2. **Given** the player has enough Cash, **When** they buy the AI Token
   burner, **Then** it becomes available to activate.
3. **Given** the burner is active, **When** time passes, **Then** LOC
   production is multiplied while a token resource is being consumed.
4. **Given** the burner runs out of tokens, **When** production resumes
   normally, **Then** the multiplier returns to baseline.

---

### User Story 3 - lise Academy Progression (Priority: P3)

As a player, I want to spend resources on training (the "lise Academy") and
pursue credential milestones, so that I have long-term goals and permanent
power growth.

**Why this priority**: Permanent progression and milestone goals give the
game retention beyond the initial loop, themed around lise GmbH's real
credentials.

**Independent Test**: Buy a training entry and confirm production permanently
increases; reach a credential milestone and confirm it unlocks/registers.

**Acceptance Scenarios**:

1. **Given** the player has resources, **When** they purchase a lise Academy
   training item, **Then** their base production permanently increases.
2. **Given** the player meets a milestone's requirements, **When** the
   milestone triggers, **Then** it is recorded as an earned credential
   (e.g., quality certification, partner status) and grants its reward.
3. **Given** the player owns several trainings, **When** production is
   calculated, **Then** all permanent boosts are correctly applied.
4. **Given** the player reaches the Office #2 unlock milestone, **When** it
   triggers, **Then** the second office becomes available and the total
   number of producer/desk slots increases.

---

### Edge Cases

- First-ever load with no save: game starts cleanly at zero with a friendly
  intro.
- Extremely long offline absence: offline progress is honored by the same
  time-based rule (no silent cap), with numbers staying accurate.
- Save from an older version after an update: the game upgrades/migrates the
  save and never wipes progress silently.
- Browser tab backgrounded/inactive: production stays correct because it is
  computed from elapsed time, not from live ticking while away.
- Very large resource numbers: values keep growing, displaying, and behaving
  correctly (no overflow that changes gameplay).
- Corrupted save: the game falls back safely without destroying other
  progress.
- Closing the game mid-commute: on return, the commute resolves from elapsed
  time (the dev arrives if the travel delay has passed); autonomous
  production is unaffected because it does not depend on the dev's presence.
- Active office's desk slots all full: further producer placements are
  blocked with clear feedback pointing to the Office #2 unlock; the game
  never soft-locks.
- Small or rotated mobile viewport: the layout stays fully playable in both
  portrait and landscape, and all controls remain reachable without
  horizontal scrolling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game MUST run in a standard web browser with no
  installation required, on both mobile and desktop devices as co-equal
  first-class targets, via a responsive layout that adapts from phone
  portrait/landscape through desktop and supports both touch and pointer
  input.
- **FR-002**: The game MUST present a top-down, pixel-art world based on the
  two real lise GmbH office buildings (derived from the studio's floor
  plans), each laid out as rooms — e.g., open office areas, lounge, kitchen,
  conference room, elevator, stairs, garage, restrooms — populated with desk
  workstations where the developer and producers work.
- **FR-003**: The game MUST accumulate a primary resource ("Lines of Code" /
  LOC) as a function of elapsed real time.
- **FR-004**: The player MUST be able to manually boost production through
  direct interaction.
- **FR-005**: The game MUST continue producing while the player is offline
  and MUST credit that production on return (offline progress), using the
  same time-based rule as online play.
- **FR-006**: The game MUST persist player progress across browser sessions
  (save on close/periodically, restore on load).
- **FR-007**: The game MUST allow the player to convert production into
  spendable value ("Cash") and to spend it on upgrades.
- **FR-008**: The game MUST include at least one accelerator upgrade ("AI
  Token burner") that, while active, consumes a resource to multiply
  production.
- **FR-009**: The game MUST offer a training/skill progression ("lise
  Academy") whose purchases permanently increase production.
- **FR-010**: The game MUST expose long-term milestone objectives themed
  around lise GmbH credentials (e.g., quality certification, partner status).
- **FR-011**: The game MUST NEVER silently destroy or wipe player progress;
  saves MUST survive updates via migration or a safe fallback.
- **FR-012**: Resource values MUST remain numerically accurate as they grow
  very large (no precision loss that alters gameplay).
- **FR-013**: The core loop MUST remain playable without a live network
  connection once loaded (offline-capable).
- **FR-014**: The game MUST model two distinct office buildings. The player
  MUST begin in Office #1, and Office #2 MUST be unlockable as a long-term
  milestone that expands the number of available producer/desk slots.
- **FR-015**: Producers MUST occupy desk/room slots within an office. Each
  office MUST provide a finite number of placement slots; when the active
  office is full, the game MUST clearly indicate that more capacity requires
  unlocking the next office (no silent failure, no soft-lock).
- **FR-016**: The player MUST be able to switch the developer's active
  office. Switching MUST incur a timed commute: a state-tracked travel delay
  after which the developer becomes "present" at the destination. The commute
  timer MUST be part of saved state and computed from elapsed time (the same
  time-based rule as all other progress), so it resolves correctly across
  offline absence and reloads.
- **FR-017**: Autonomous producers MUST keep producing in BOTH offices
  regardless of which office is currently active or whether a commute is in
  progress; only the developer's presence-based effects (e.g., manual boost
  and any presence bonus) depend on the active office and commute state.
- **FR-018**: All interactive controls MUST be operable by both touch and
  pointer, and MUST remain reachable and legible across the supported viewport
  range (phone portrait/landscape through desktop).

### Key Entities

- **Developer (Dev)**: the player's character; the visual subject whose
  activity represents production. The dev has a current location (which of
  the two offices they are "present" in) and may commute between offices,
  tracked as a travel-timer in state.
- **Resources**: LOC (primary production), Cash (spendable value), AI Tokens
  (accelerator fuel consumed by the burner).
- **Producers / Upgrades**: themed sources of LOC or multipliers (e.g.,
  manual typing, community Q&A, AI assistant, full autonomous agent),
  purchasable with Cash. Each placed producer occupies a desk/room slot in an
  office; an office's finite slot count limits how many can be placed.
- **Office / Location**: one of the two real lise GmbH buildings, rendered as
  a top-down floor plan of rooms with a finite set of desk slots. Office #1 is
  available from the start; Office #2 is unlockable and raises the total slot
  capacity. The dev is "present" in exactly one office at a time.
- **Training (lise Academy)**: purchasable entries granting permanent
  production boosts.
- **Credential Milestones**: long-term goals (quality certification, partner
  status, etc.) that unlock and reward the player.
- **Save State**: the snapshot restored on load — timestamp, resources, owned
  upgrades/trainings (and their desk placements), which offices are unlocked,
  the dev's active office and any in-progress commute timer, earned
  milestones, and settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new player can reach their first meaningful upgrade within
  2 minutes of starting.
- **SC-002**: Offline progress is accurate — closing and reopening after N
  minutes credits, within a small tolerance, the LOC that N minutes of
  production would yield.
- **SC-003**: The game stays responsive (interactions register immediately)
  even after long sessions with very large numbers.
- **SC-004**: A returning player never loses accumulated progress across
  game updates (zero save-wiping regressions).
- **SC-005**: The full core loop (produce LOC → cash out → buy token-burner
  → faster LOC) can be demonstrated end-to-end within a single short play
  session.
- **SC-006**: The game loads and runs in mainstream mobile and desktop
  browsers without additional software, with a responsive layout that adapts
  across the supported viewport range.
- **SC-007**: The full core loop is completable one-handed on a phone in
  portrait orientation: all interactive targets meet a minimum touch-target
  size guideline (≥44×44 px) and no interaction requires a pointer-only
  gesture such as hover or right-click.
- **SC-008**: Unlocking Office #2 measurably increases the producer/desk
  capacity available to the player compared with Office #1 alone.

## Assumptions

- **Single-player MVP**: no multiplayer or social features in this feature
  (per the project constitution's offline-capable, single-player core).
- **Player manages the economy**: the dev works autonomously with idle
  animations. Free roaming / direct character control remains out of MVP
  scope; the only location mechanic is a timed commute that moves the dev's
  "presence" between the two offices (see FR-016).
- **Visual concept**: top-down pixel-art world based on the two real lise
  GmbH office floor plans (rooms such as open office, lounge, kitchen,
  conference, elevator, stairs, garage, restrooms, with desk workstations).
  Pixel-art fidelity and exact asset scope are a plan-level decision; the
  layout need only be recognizable, not a 1:1 architectural reproduction.
- **Theme / lore**: the developer works at "lise GmbH"; milestones reuse
  real lise.de themes (lise Academy = training, quality certification /
  partner status = credentials, AI solutions = token-burner tier). Flavor
  only — adjustable.
- **Persistence**: progress saves per-browser and, when the backend is
  reachable, syncs there. The exact save format/location is a plan-level
  decision (already deferred in the constitution).
- **No monetization** in the MVP.
- **Hosting**: served from an already-available self-hosted web endpoint;
  the specific stack is decided in plan.
- **Target devices**: mobile and desktop browsers are co-equal first-class
  targets (touch and pointer input, phone portrait/landscape through
  desktop); no native app or install is in scope.
