<!--
============================================================================
SYNC IMPACT REPORT
============================================================================
Version change: 1.0.0 → 1.1.0
Rationale:      Amendment to sanction online/multiplayer capability as a
                first-class, bounded concept (driven by spec 002 shared-office
                co-op presence). One new principle added and two existing
                constraints materially expanded; the deterministic offline core
                is preserved unchanged → additive, backward compatible → MINOR.

Modified principles/sections (old → new):
  - IV. Player State Integrity & Persistence
        last bullet reworded: online capability now PERMITTED as an additive
        overlay governed by Principle VI (still user-story-justified), rather
        than "out of scope until justified".
  - Additional Constraints: "Offline-capable, single-player core"
        → "Offline-capable core": multiplayer/social allowed as an additive
        overlay per Principle VI, but MUST NOT become a requirement for the
        core loop to run.

Added sections:
  - VI. Online & Multiplayer as an Additive Overlay          (NEW)

Removed sections: (none)

Templates requiring updates:
  - .specify/templates/plan-template.md       ✅ reviewed, no change needed
      ("Constitution Check" gate is derived from this file at plan time)
  - .specify/templates/spec-template.md       ✅ reviewed, no change needed
  - .specify/templates/tasks-template.md      ✅ reviewed, no change needed
  - .specify/templates/checklist-template.md  ✅ reviewed, no change needed
  - README.md / AGENTS.md                     ✅ reviewed, no hardcoded
      "single-player" claim; offline-core statements remain accurate
  - .pi/prompts/speckit.*.md                  ✅ reviewed, agent-neutral (pi)

Follow-up TODOs:
  - specs/002-shared-office-coop/plan.md MUST record the presence-driven co-op
    bonus (an online gameplay effect) in its Complexity Tracking table per
    Principles I, V, and VI.
  - Deferred stack decisions from v1.0.0 (language/runtime, persistence format,
    platform, "Lise" theme scope) remain resolved in the per-feature plan.md
    files, not here.
============================================================================
-->

# Lise Idle Game Constitution

## Core Principles

### I. Deterministic, Pure Game Simulation

The game MUST be an idle game: progression is a function of **state + elapsed
time**, not of wall-clock polling or hidden side-effects during a session.

- The core advance step MUST be a pure, deterministic function of the shape
  `advance(state, delta_time) -> state` — no I/O, no randomness sourced from
  outside the state, no mutation of shared globals.
- Offline progress MUST be computed by calling `advance` with the elapsed
  real time, exactly as if the player had been online. There MUST NOT be a
  separate, divergent "offline" code path.
- "Replaying" a save at any `delta_time` MUST yield identical results.

**Rationale:** Idle games live or die on correct time-based progression.
Determinism is what makes offline rewards, save/load round-trips, and balance
testing trivially correct and fully automatable.

### II. Data-Driven Content & Balance

All game content — resources, producers, upgrades, costs, and formula
parameters — MUST be defined as **data**, not hardcoded in logic.

- Changing a balance number MUST NOT require editing control-flow code.
- Content/balance data MUST be versioned and reviewed with the same rigor as
  source code.
- Logic MUST read content from the data layer; data MUST NOT reach into
  logic to define behavior (no logic-as-data, no `eval`).

**Rationale:** An idle game is fundamentally about tuning numbers against
time. Separating content from logic lets balance iterate without logic
regressions and keeps the simulation (Principle I) fully testable in
isolation.

### III. Test-First (NON-NEGOTIABLE)

Development is Test-Driven. This principle cannot be waived by a plan.

- Tests MUST be written, reviewed/approved, and confirmed **RED** before any
  implementation of the behavior they specify.
- The pure simulation from Principle I MUST be covered by deterministic
  tests, including offline-progress cases and large-`delta_time` cases
  (minutes, hours, days).
- The Red-Green-Refactor cycle MUST be followed; no "implement then test".

**Rationale:** speckit is a spec-first, TDD-driven methodology, and
Principle I guarantees the core logic is deterministic — so near-complete
automated coverage is both achievable and expected.

### IV. Player State Integrity & Persistence

A player's accumulated progress is the most valuable thing the game holds.

- Player state MUST be serializable and reloadable at any point; a save MUST
  round-trip losslessly (save → load → save produces an identical save).
- Offline progress MUST be honored on load via Principle I; it MUST NEVER be
  silently dropped, faked, or capped without explicit, documented design.
- Saves MUST survive format/version drift through explicit migration or a
  safe fallback. The game MUST NEVER silently destroy or wipe progress.
- The game MUST be playable offline and locally for its core loop. Online
  capability is permitted ONLY as an additive overlay governed by Principle VI,
  and MUST be justified by a prioritized user story.

**Rationale:** Losing idle progress is the single most damaging bug in the
genre. Integrity is non-negotiable.

### V. Simplicity & YAGNI

Build the minimal viable loop first; defer anything not justified by a
prioritized user story.

- Each user story MUST deliver value independently (MVP slices).
- Added complexity — new systems, new interacting subsystems, or any
  deviation from these principles — MUST be justified in the plan's
  **Complexity Tracking** table before implementation.
- Prefer one well-understood mechanism over several clever ones.

**Rationale:** Idle games accrete systems over time; without discipline the
simulation becomes untestable and the save model untrustworthy.

### VI. Online & Multiplayer as an Additive Overlay

Any online or multiplayer capability MUST be an additive layer on top of the
deterministic, offline-capable core (Principles I and IV) — never a
redefinition of it.

- The core loop MUST remain fully playable offline with no feature loss; the
  overlay MUST degrade gracefully to the offline core whenever the network or
  backend is unavailable, with no loss of progress and no blocking.
- Other players and the server MUST NOT be authoritative over a player's core
  simulation or save. Presence and social data are a read-only overlay; a
  network or social failure MUST NEVER block, corrupt, or wipe local progress.
- Any online input that feeds gameplay (e.g., a presence-driven co-op bonus)
  MUST enter the simulation only as a deterministic, timestamped, bounded input
  to `advance` — never as live wall-clock polling — so determinism, save
  replay, and offline computation stay intact. Offline spans MUST be computed
  at the neutral/baseline value of such inputs.
- Online-driven gameplay effects MUST be bounded and defined as tunable content
  data (Principle II), and MUST NOT let one player mutate another player's
  state.
- Introducing or materially expanding an online capability MUST be justified by
  a prioritized user story and recorded in the plan's Complexity Tracking table.

**Rationale:** Multiplayer and social features add reach and retention, but the
genre's integrity rules — a deterministic offline core and safe saves — are what
make the game trustworthy. Confining online behavior to a bounded,
non-authoritative, deterministically-integrated overlay lets the game be social
without ever putting the core at risk.

## Additional Constraints

These are fixed, technology-agnostic constraints. The concrete stack
(language, framework, persistence format, platform) is **NOT** chosen here —
it MUST be decided in the first `plan.md` and is recorded there as a
follow-up.

- **Offline-capable core:** The core progression loop MUST run locally and
  without a network connection. Multiplayer/social behavior is permitted only
  as an additive overlay per Principle VI; it MUST NOT become a requirement for
  the core loop to run.
- **Numeric stability:** Accumulation math MUST avoid floating-point drift
  over long play (large totals and long offline spans). Use integer /
  fixed-point / arbitrary-precision types where exactness is required.
- **Performance of time skips:** `advance(state, delta_time)` MUST run in
  time proportional to the number of active features, NOT to the magnitude
  of `delta_time` — a multi-day offline catch-up MUST be as cheap as a
  one-second tick. Concrete targets are set in `plan.md`.
- **Minimal dependencies:** Prefer the standard library and small,
  well-maintained dependencies. Avoid paid/proprietary and heavy frameworks
  unless justified.
- **Determinism over real-time:** Wall-clock APIs MUST NOT feed the
  simulation directly; only the computed `delta_time` does (Principle I).

## Development Workflow

Spec-first delivery, gated by the principles above.

- **Spec → Plan → Tasks:** Every feature begins with `spec.md` (user
  stories, requirements), then `plan.md` (design + research), then
  `tasks.md` — in that order.
- **Constitution Check is a gate:** The plan's "Constitution Check" section
  MUST pass before Phase 0 research, and be re-checked after Phase 1 design.
  Any violation MUST be recorded in the plan's Complexity Tracking table
  with a justification.
- **TDD gate:** Per Principle III — tests written, approved, and RED before
  implementation; GREEN before a task is considered done.
- **Incremental delivery:** Implement one prioritized user story at a time;
  validate each independently before proceeding.
- **Versioning discipline:** Commit after each task or logical group; one
  branch per feature (`[###-feature-name]`).
- **Deferred decisions:** The first `plan.md` MUST resolve the open
  follow-ups — language/runtime, persistence/save format, target platform,
  and "Lise" theme/lore scope.

## Governance

This constitution is the highest-authority practice document for the project.
Where any README, doc, or prompt conflicts with it, the constitution prevails
until it is amended.

- **Amendment procedure:** Any change requires (a) a recorded rationale,
  (b) a semantic-version bump (below), and for MAJOR changes (c) a migration
  note covering any in-flight work affected.
- **Versioning policy:**
  - **MAJOR** — removal or incompatible redefinition of an existing
    principle/section.
  - **MINOR** — addition of a new principle or materially expanded guidance.
  - **PATCH** — clarifications, wording, typo fixes, non-semantic refinements.
- **Compliance review:** Every plan's Constitution Check MUST pass or record
  a justified violation. Code/spec reviews MUST verify compliance with the
  principles, not just surface correctness.
- **Runtime development guidance:** See `AGENTS.md` (and the speckit prompts
  under `.pi/prompts/`) for day-to-day workflow guidance; this document sets
  the non-negotiable rules those guides operate within.

**Version**: 1.1.0 | **Ratified**: 2026-06-30 | **Last Amended**: 2026-07-01
