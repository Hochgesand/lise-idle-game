# Game Assets (002 — Shared Office Co-op)

This directory holds the **002 campus world assets**: the campus map of both
lise office buildings, the flat-design tileset atlas, and the avatar
spritesheet that renders live/last-seen presence states.

> **Art direction (current):** the assets are **programmatic flat-design,
> floor-plan style** — self-drawn by `scripts/gen_campus_assets.py` from the
> blueprint `specs/002-shared-office-coop/campus-layout.md`. There are **no
> external asset packs** and therefore **no licensing concerns**. The earlier
> Kenney-CC0 + Tiled-authoring plan was **superseded 2026-07-02** by this
> flat-design decision — see `campus-layout.md` and the amendment at the
> Art-direction decision in `specs/002-shared-office-coop/research.md`.

---

## Generator

All three shipped files are produced deterministically by the generator:

```sh
uv run --with pillow scripts/gen_campus_assets.py
```

(The system `python3` lacks Pillow, hence `uv run --with pillow`.)

Optional fidelity-check flags:

```sh
uv run --with pillow scripts/gen_campus_assets.py --preview out.png    # full-map composite render
uv run --with pillow scripts/gen_campus_assets.py \
    --crop 350 950 900 1350 3 crop.png                                 # scaled crop (px coords)
# --labels overlays room names on the preview/crop
```

The output is **deterministic** (stable JSON ordering), so regeneration is
diff-clean — re-running the generator on an unchanged blueprint produces no
git diff.

---

## Shipped files

| File | Spec |
|------|------|
| `campus_tileset.png` | **94-tile** flat-design atlas, 16×16 px tiles, **256×96** image |
| `campus.json` | Tiled-JSON map, **200×140** tiles (16 px base): **6 tile layers** (`Ground`, `Streets`, `Floors`, `Walls`, `Furniture`, `Decor`) + **3 object layers** (`Rooms` — 22 named polygons, `SeatAnchors` — **128** building-tagged points, `CommutePaths` — entrance-to-entrance polyline); tileset **embedded** |
| `avatars.png` | **8-frame** horizontal strip of 16 px frames (128×16): green **live** vs red/desaturated **last-seen** styling (FR-023) |

---

## Production invariants

The generator and tests enforce the checklist in
`specs/002-shared-office-coop/campus-layout.md` **§8 Production invariants**,
verified by `frontend/src/scenes/world/campusMap.test.ts`:

- **SeatAnchors capacity (FR-021):** ≥ 20 anchors in Office #1, ≥ 40 in
  Office #2, **≥ 60 total** — all on walkable floor inside the correct
  building polygon (shipped map: 128 total).
- Every named room from campus-layout.md §3/§4 present as a `Rooms` polygon
  with the correct `building` property; the 9 spec'd names exactly:
  `corkscrew`, `spiderweb`, `skier`, `Office` (office_1);
  `deco-office-chair`, `frog`, `bongo`, `bridge`, `the executive Office`
  (office_2).
- One `CommutePaths` polyline with `from`/`to` properties, endpoints at the
  two building doors.
- Tileset **embedded** in the map export, named `campus_tileset`, image
  `campus_tileset.png` (FR-020/021/022 — self-contained, Phaser loads it
  directly via `tilemapTiledJSON`).
- Map loads in CampusScene with zero thrown errors; all tile layers render.
- JSON output deterministic so regeneration diffs stay clean.

---

## History

- **2026-07-02:** Programmatic flat-design generation (modeled on the real
  floor-plan tool) replaced the planned Kenney CC0 assembly + manual Tiled
  authoring. The former "PLACEHOLDER" status, the CC0 pack table, and the
  Tiled install/download TODO checklist are superseded — rationale and
  details in `specs/002-shared-office-coop/campus-layout.md` and the
  research.md Art-direction amendment.
- The 001 placeholder pipeline (`office_tileset.png` / `office.json` /
  `dev.png`) has been removed — unreferenced by any code.
