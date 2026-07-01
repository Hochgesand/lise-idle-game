# Game Assets (002 — Shared Office Co-op)

This directory holds the **002 campus world assets**: the Tiled map of both
lise office buildings, the CC0 pixel-art tileset, and the avatar spritesheet
that renders live/last-seen presence states. It supersedes the 001
placeholder pipeline (`office_tileset.png` / `office.json` / `dev.png`).

> **Status:** This document is the pipeline **scaffold** (T007). The asset
> downloads and Tiled install are **manual/deferred** — see the checklist in
> [Deferred manual setup](#deferred-manual-setup) below. Only the three
> legacy 001 files (`dev.png`, `office_tileset.png`, `office.json`) are
> present today.

---

## Required CC0 asset packs

All base art is **CC0 (Creative Commons Zero)** — free to use commercially,
no attribution required, no redistribution limits. This removes every
licensing question for both the company-internal deployment and the public
repository. All packs are **16×16 tiles from a single author (Kenney)** so
the palette and proportions are consistent.

| Pack | Role | License |
|------|------|---------|
| **Kenney "Roguelike Modern City"** | Primary — streets, building exteriors, urban props, the commute route | CC0 |
| **Kenney "Roguelike Indoors"** | Primary — office interiors, desks, chairs, furniture, room fittings | CC0 |
| **Kenney "Tiny Town"** | Fallback — 16×16 CC0, used only if the primary pair proves insufficient | CC0 |

### Art direction note

- **LimeZu "Modern Interiors"** (the popular office interior pack) was
  **rejected** — it is **not CC0**; its license terms conflict with
  redistribution in an open repository.
- The custom pixel budget is concentrated on a few **lise-specific touches**
  drawn on top of the CC0 base, in the same 16×16 grid — that is what makes
  the offices recognizable rather than a full custom commission:
  - **lise logo signage**
  - **skier trophy shelf**
  - **room-name plates**
  - **coffee points**

---

## Tooling

### Tiled (map editor)

The campus map is authored in **Tiled** — https://www.mapeditor.org/ —

and exported as JSON (`tilemapTiledJSON`) so Phaser 4 loads it directly.
Tilesets **must be embedded** in the export (FR-020/021/022) so the map is
a single self-contained file with no external tileset references to lose.

---

## Campus map structure (`campus.json`)

One orthogonal Tiled map containing **both lise office buildings** with
preserved footprints and named rooms, joined by the streets/tram commute
route. Base tile is **16×16**.

### Named rooms

**Office #1:**
- `corkscrew`
- `spiderweb`
- `skier`
- the Office
- Stairs/Elevator core

**Office #2:**
- `deco-office-chair`
- `frog`
- `bongo`
- `bridge`
- the executive Office
- both cores (Stairs/Elevator)

The two buildings are joined by the **streets / tram commute route** — the
visible path commuting avatars travel between them (FR-022).

### Tile layers

Draw-ordered visual world (ground, streets, floors, furniture); the exact
set is fixed during authoring.

### Object layers (three — required)

| Layer | Kind | Purpose |
|-------|------|---------|
| `Rooms` | named polygons | one per named space; drives room labels and presence grouping |
| `SeatAnchors` | point objects, **building-tagged** | desk/seat positions avatars snap to |
| `CommutePaths` | polylines (entrance-to-entrance) | routes commuting avatars travel between building entrances |

**Seat capacity invariant (FR-021):** each building MUST author clearly
more `SeatAnchors` than its expected rendered population (peak live crowd
plus last-seen avatars retained within the retention window):

- **Office #1 — ≥ 20 anchors** (peak live share ~10)
- **Office #2 — ≥ 40 anchors** (peak live share ~20 — carries the greater share)
- **≥ 60 total**

Overflow beyond the anchors falls back to standing/roaming spots — never
hides or stacks colleagues.

### Export requirements

- Tilesets **embedded** in the export (no external `.tsx`/tileset image
  references at runtime — Phaser needs the map to be self-contained).
- Base tile **16×16** (changes `TILE_SIZE` in `scenes/layout.ts`; avatar
  frames shrink accordingly; Phaser config gains `pixelArt: true`).

---

## Planned production files

| File | Description |
|------|-------------|
| `campus.json` | Tiled JSON map export — both buildings, tile + object layers, **embedded** tilesets (T040) |
| `campus_tileset.png` | Kenney CC0 16×16 base + custom lise touches; combined atlas well below 4096×4096 (T041) |
| `avatars.png` | 16 px frames with **green live vs red/desaturated last-seen** styling + activity icons (T041, FR-023) |

---

## Deferred manual setup

The following are **TODO / manual** — not yet done. The downloads and Tiled
install cannot be automated; they require a human to fetch the packs and
run the installer.

- [ ] **Download the Kenney CC0 packs** — "Roguelike Modern City" +
      "Roguelike Indoors" (fallback "Tiny Town") from kenney.nl.
- [ ] **Install Tiled** — https://www.mapeditor.org/ — for authoring the
      campus map.
- [ ] **Stage raw sources** — place the raw Kenney sources in this
      directory (`frontend/public/assets/`) so they are versioned alongside
      the README.
- [ ] **Produce `campus_tileset.png`** — Kenney CC0 16×16 base combined
      with the custom lise touches (logo signage, skier trophy shelf,
      room-name plates, coffee points); combined atlas < 4096×4096.
- [ ] **Produce `avatars.png`** — 16 px frames with green live vs
      red/desaturated last-seen styling + activity icons (FR-023).
- [ ] **Author `campus.json`** in Tiled (depends on `campus_tileset.png` —
      T040 → T041) and export with embedded tilesets.

---

## Legacy 001 assets (superseded)

The three files below are the 001 placeholder pipeline, superseded by the
002 campus assets above. They are retained until the CampusScene (T046)
replaces OfficeScene and the loop is rewired (T051).

- `office_tileset.png` — 128×64 placeholder tileset (8 tiles, 32×32)
- `office.json` — 001 Tiled map (single office, 20×15 tiles)
- `dev.png` — 4-frame 32×32 dev idle spritesheet
