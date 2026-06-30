# Feature Specification: Lise Dev Idle Game

**Feature Branch**: `001-dev-idle-game`

**Created**: 2026-06-30

**Status**: Draft

**Input**: User description: "Ein Browsergame in Vogelperspektive, in dem wir einen Software-Developer im Pixel-Stil spielen, mit Idle-Game-Mechaniken. Der Dev arbeitet bei der lise GmbH; Fortschritt läuft auch offline weiter. Theme orientiert sich an lise.de (Software-/KI-Haus, lise Academy, Zertifizierungen). Ein 'Token-Burner'-Mechanic (LOC ↔ Cash ↔ AI-Tokens) bildet den wirtschaftlichen Kern."

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
2. **Given** the dev is working, **When** the player interacts (e.g., clicks
   the scene), **Then** production receives an immediate manual boost.
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

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game MUST run in a standard web browser with no
  installation required.
- **FR-002**: The game MUST present a top-down, pixel-art scene depicting a
  software developer working at the lise GmbH office.
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

### Key Entities

- **Developer (Dev)**: the player's character in the office; the visual
  subject whose activity represents production.
- **Resources**: LOC (primary production), Cash (spendable value), AI Tokens
  (accelerator fuel consumed by the burner).
- **Producers / Upgrades**: themed sources of LOC or multipliers (e.g.,
  manual typing, community Q&A, AI assistant, full autonomous agent),
  purchasable with Cash.
- **Training (lise Academy)**: purchasable entries granting permanent
  production boosts.
- **Credential Milestones**: long-term goals (quality certification, partner
  status, etc.) that unlock and reward the player.
- **Save State**: the snapshot restored on load — timestamp, resources, owned
  upgrades/trainings, earned milestones, and settings.

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
- **SC-006**: The game loads and runs in mainstream desktop browsers without
  additional software.

## Assumptions

- **Single-player MVP**: no multiplayer or social features in this feature
  (per the project constitution's offline-capable, single-player core).
- **Player manages the economy**: the dev works autonomously with idle
  animations; direct character movement/control is out of MVP scope (flavor
  only). Worth confirming in `/speckit.clarify`.
- **Visual concept**: top-down pixel-art office with the developer at a
  workstation. The reference image is not machine-readable in this
  environment, so exact layout/asset scope is confirmed in clarify/plan.
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
