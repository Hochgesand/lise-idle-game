# Content JSON (placeholder)

These are placeholder content files for the Lise Dev Idle Game — empty
arrays (`[]`) that are valid JSON and structurally correct, but contain no
game content yet.

## What lives here

| File          | Entity (see `specs/001-dev-idle-game/data-model.md`) |
|---------------|------------------------------------------------------|
| `producers.json`  | `Producer` — sources of LOC/sec (dev activity tiers)        |
| `upgrades.json`   | `Upgrade` — purchasable multipliers / modifiers             |
| `trainings.json`  | `Training` (lise Academy) — permanent production boosts      |
| `milestones.json` | `Milestone` — long-term credential goals + rewards           |
| `burners.json`    | `Burner` — AI-token accelerator definitions                  |

## Serving

These raw files are **arrays** of content entities. They are NOT the wire
envelope served to the client. The `ContentController` (T020) reads each
file and wraps them into the response envelope defined in
`specs/001-dev-idle-game/contracts/contracts.md` §2:

```json
{ "schemaVersion": 1, "contentVersion": "...",
  "producers": [...], "upgrades": [...], "trainings": [...],
  "milestones": [...], "burners": [...] }
```

## When real content is added

These are intentionally empty placeholders. Real content is seeded in:

- **T037** — US1 producers (manual_typing + early producers).
- **T043** — US2 economy content (cash conversion, AI-token burner, upgrades).
- **T050** — US3 academy content (trainings, credential milestones).

All big-number fields (`baseRate`, `cost.amount`, `fuelCostToActivate`,
`burnRate`, `threshold`) MUST be **strings** (never `double`) per the
project constitution's numeric-integrity constraint.

## Notes

- The `grantResource` reward in `milestones.json` carries a redundant
  `"multiplier": 0` field. Jackson 3 (used by the backend) maps the shared
  `Effect` record for all effect types; its `double multiplier` field is a
  primitive and cannot be absent. `grantResource` never reads it, so the 0 is
  a no-op convenience for the deserializer, not a gameplay value.
