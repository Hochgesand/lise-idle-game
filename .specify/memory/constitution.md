<!--
============================================================================
SYNC IMPACT REPORT
============================================================================
Version change: (uninitialized template) → 1.0.0
Rationale:      Initial ratification. No prior version exists; first concrete
                adoption of the constitution earns MAJOR 1, MINOR 0, PATCH 0.

Modified principles (old → new):
  - (none — all principles newly defined)
  - I.   Deterministic, Pure Game Simulation          (NEW)
  - II.  Data-Driven Content & Balance                (NEW)
  - III. Test-First — NON-NEGOTIABLE                  (NEW)
  - IV.  Player State Integrity & Persistence         (NEW)
  - V.   Simplicity & YAGNI                           (NEW)

Added sections:
  - Core Principles (I–V)
  - Additional Constraints
  - Development Workflow
  - Governance

Removed sections: (none)

Templates requiring updates:
  - .specify/templates/plan-template.md       ✅ reviewed, no change needed
      ("Constitution Check" gate derives its gates from this file at plan time)
  - .specify/templates/spec-template.md       ✅ reviewed, no change needed
      (technology-agnostic success criteria align with these principles)
  - .specify/templates/tasks-template.md      ✅ reviewed, no change needed
      (phase/test discipline matches Test-First + Workflow principles)
  - .specify/templates/checklist-template.md  ✅ reviewed, no change needed
  - .pi/prompts/speckit.*.md                  ✅ reviewed, agent-neutral (pi)

Follow-up TODOs (intentionally deferred — belong in first plan.md, NOT here):
  - Concrete language/runtime (NEEDS CLARIFICATION)
  - Concrete persistence/save format (NEEDS CLARIFICATION)
  - Target platform(s) (NEEDS CLARIFICATION)
  - "Lise" theme/lore scope (NEEDS CLARIFICATION)
  These are runtime/implementation choices; the constitution fixes
  constraints and methodology, not the stack.

Derivation note: User input was empty and no README/plan/spec/code exists.
  Principles are INFERRED DEFAULTS derived from the project name (idle game
  genre) and the installed methodology (speckit = spec-first TDD, pi agent).
  Refine via amendment once the first spec/plan exists.
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
- The game MUST be playable offline and locally for its core loop; any
  online capability is out of scope until explicitly justified by a user
  story.

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

## Additional Constraints

These are fixed, technology-agnostic constraints. The concrete stack
(language, framework, persistence format, platform) is **NOT** chosen here —
it MUST be decided in the first `plan.md` and is recorded there as a
follow-up.

- **Offline-capable, single-player core:** The core progression loop MUST
  run locally and without a network connection.
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

**Version**: 1.0.0 | **Ratified**: 2026-06-30 | **Last Amended**: 2026-06-30
