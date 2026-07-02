# Campus Layout — authoritative map blueprint (T040/T041)

**Source:** transcribed 2026-07-02 from a screenshot of the real lise office
floor-plan tool (desk-booking map, Bonn campus) provided by Andre. The
screenshot itself is not in the repo — **this document is the durable,
authoritative transcription**; treat every coordinate below as the source of
truth for `scripts/gen_campus_assets.py`.

**Vision (Andre, 2026-07-02):** the map must be *big* and faithful to the real
building footprints; viewport/look-and-feel like Clash of Clans / Pokémon —
one large, lively, readable world you pan and pinch-zoom across, with the
game's activities physically distributed over the rooms. Art direction is the
**flat, modern floor-plan style of the real tool** (clean white buildings,
soft green rooms, navy cores, bluish-gray streets) rather than retro pixel
art — this supersedes the 002 research decision to assemble Kenney CC0 pixel
tiles (recorded as an amendment in `research.md`; generation stays fully
programmatic and CC0-clean because we draw every tile ourselves).

---

## 1. What the real floor plan shows (prose, for fidelity checks)

Two buildings on opposite sides of a street, both rotated on the screenshot
(we axis-align them in game; shapes and relative placement are preserved):

- **Office #2 — the big L-shaped building (north-west).** A long top wing
  (open dev areas at both ends; a tiny "Phone Booth" room top-center; a navy
  Elevator + Stairs core at the wing junction; a green "swinging boat" room
  right of the stairs; green meeting rooms along the south edge of the east
  end) and a west wing running south (green "bridge" meeting room center-east;
  a second Elevator + Stairs core; green "bongo" room on the west edge; open
  dev area with monitor workstations; a south edge row of green rooms
  "space fighter", "deco-office-chair", "frog"; phone icons and coffee points
  sprinkled through). A **parking lot with marked stalls** sits west of the
  west wing.
- **Office #1 — the elongated bar building (south-east).** Roughly 4:1
  aspect, a central corridor along its full length, rooms on both sides.
  North side W→E: dev rooms, "skier" (green), "Restroom Men", "Break Room",
  another dev room, a small "Restroom" near the SE end. South side W→E: dev
  room, "spiderweb" (green), navy Stairs core, "corkscrew", "Office" (green),
  navy Elevator, "Break-room" at the SE tip.
- **Between and around them:** bluish-gray streets with white dashed
  centerlines and a crossing between the buildings; a **tram line** (double
  track with cross-ties) running along the north-east; large light-green
  lawns with tree clusters (two-tone green blobs) north-east and around
  Office #1; light paper-gray plaza/pavement elsewhere. Desks appear as
  clustered pairs with green/red occupancy dots — in game those dots become
  the live/last-seen colleague avatars.

---

## 2. Game map — global frame

| Property | Value |
|---|---|
| Orientation | orthogonal Tiled map, JSON, **embedded tileset** (name `campus_tileset`) |
| Size | **200 × 140 tiles**, tile 16×16 px → **3200 × 2240 px world** |
| Tile layers (draw order) | `Ground` → `Streets` → `Floors` → `Walls` → `Furniture` → `Decor` (CampusScene renders every tile layer in array order; `Ground` must exist — it already does in the load contract) |
| Object layers | `Rooms` (named polygons, `building` property), `SeatAnchors` (points, `building` property), `CommutePaths` (polyline, `from`/`to` properties) — exact 002 contract, property array form `[{name,type,value}]` |
| Rendering | flat-design art → Phaser `pixelArt: false` / antialias ON (change from current config); `roundPixels` off |

Grid convention below: `(col, row)` in tiles, origin top-left, ranges are
inclusive-exclusive `[from, to)`.

## 3. Office #2 — big L-shape, north-west (`building: office_2`)

Footprint (white floor, 1-tile wall outline):

- **Top wing:** x `[24, 100)`, y `[16, 40)`
- **West wing:** x `[24, 56)`, y `[40, 92)` (contiguous with top wing)
- **Main door:** south wall of west wing, x `[46, 49)` at y 91 (opens to the
  street/tram stop) · **Second door:** south wall of top wing east end,
  x `[88, 91)` at y 39
- **Parking lot (outdoor):** x `[8, 22)`, y `[48, 84)` — gray asphalt, white
  stall lines, 6–8 parked flat-style cars, driveway joining the south street

Interior — named rooms (green `Rooms` polygons unless noted; label = `name`):

| Room | Rect (tiles) | Notes / props |
|---|---|---|
| `Phone Booth` | x [46,49), y [18,20) | tiny, phone glyph tile |
| `swinging boat` | x [62,71), y [18,25) | swing-bench prop |
| `bridge` | x [44,55), y [44,53) | large meeting table |
| `bongo` | x [26,33), y [60,67) | west edge |
| `space fighter` | x [26,34), y [74,81) | south row |
| `deco-office-chair` | x [35,44), y [76,85) | south row |
| `frog` | x [45,54), y [78,87) | south row, SE corner of wing |
| `the executive Office` | x [46,55), y [68,76) | east side of west wing |

Navy cores (dark `#2e3a59` blocks, white glyphs, **not** green rooms, still
`Rooms` polygons so they get labels): `Elevator` x [50,54), y [20,23) and
`Stairs` x [55,60), y [24,28) (wing junction); `Elevator` x [34,38), y [46,49)
and `Stairs` x [30,37), y [52,57) (west wing).

Open dev areas (floor + desk clusters, no room polygon needed): NW area
x [26,45), y [18,31) ≈ 12 desks; east area x [72,97), y [18,31) ≈ 16 desks;
south-of-corridor meeting strip x [80,97), y [32,39) as two green unnamed
meeting rooms; west wing area x [38,55), y [58,67) ≈ 8 desks + 4 monitor
workstations near `bongo`; x [26,45), y [40,46) corridor + coffee point.
Coffee points (coffee glyph): (60,30), (38,62). Phone glyph: (40,50).

**SeatAnchors office_2: ≥ 40** (production invariant) — place ~44 anchors on
desk-chair tiles across the dev areas above (12 + 16 + 12) plus 4 in `bridge`.

## 4. Office #1 — bar building, south-east (`building: office_1`)

Footprint: x `[116, 188)`, y `[100, 128)` (72×28 tiles). Central corridor
y `[112, 116)` across the full length. **Main door:** north wall x `[148,151)`
at y 100 (faces the tram stop). Second door: south wall x [180,183) at y 127.

| Room (north side, W→E) | Rect (tiles) |
|---|---|
| dev room A (green, unnamed) | x [118,130), y [102,112) |
| dev room B (green, unnamed) | x [131,141), y [102,112) |
| `skier` | x [142,151), y [102,112) — trophy-shelf prop |
| `Restroom Men` | x [152,157), y [102,112) — white/gray, WC glyph |
| `Break Room` | x [158,167), y [102,112) — coffee glyph, tables |
| dev room C (green, unnamed) | x [168,179), y [102,112) |
| `Restroom` | x [180,186), y [102,112) — WC glyph |

| Room (south side, W→E) | Rect (tiles) |
|---|---|
| dev room D (green, unnamed) | x [118,131), y [116,126) |
| `spiderweb` | x [132,143), y [116,126) |
| `Stairs` (navy core) | x [144,151), y [116,126) |
| `corkscrew` | x [152,161), y [116,126) |
| `Office` | x [162,171), y [116,126) |
| `Elevator` (navy core) | x [172,176), y [116,126) |
| `Break-room` | x [177,187), y [116,126) — coffee glyph |

**SeatAnchors office_1: ≥ 20** — ~26 anchors: 6 each in dev rooms A/B/D,
4 in dev room C, 2 in `skier`, 2 in `Office`.

## 5. Streets, tram, commute, greenery

- **Street C (main, between the buildings):** horizontal, y `[92, 98)`,
  x `[0, 200)` — bluish-gray `#b9c0cd`, white dashed centerline at y 94–95,
  zebra crossing at x [104,110).
- **Street B:** vertical, x `[104, 110)`, y `[8, 92)` (meets Street C; passes
  east of Office #2).
- **Street A:** horizontal, y `[44, 50)`, x `[110, 200)` (north-east quarter).
- Sidewalk (1 tile, light gray) along every street edge and building wall.
- **Tram line:** dedicated grass-bed track, y `[88, 91)`, x `[56, 200)` (just
  north of Street C): two rails + cross-ties; **tram stops** (platform tile +
  small shelter + sign) at x [66,72) (serves Office #2 door) and x [146,152)
  (serves Office #1 door). One stylized flat tram vehicle parked at
  x [90,96) as decor.
- **Lawns & trees:** NE quadrant x [112,200), y [8,88) is a park — light
  green lawn `#cfe0c3`, winding light path, 8–10 two-tone tree clusters
  (2×2 tiles); more lawn south of Office #1 (y [130,140)) and along the top
  edge (y [0,8)) with a tree row. Everything else paper-gray plaza `#f1efed`.
- **CommutePaths polyline** (`from: office_2`, `to: office_1` — one polyline,
  traversed both ways; world px = tile × 16 + 8):
  `(47,92) → (47,95) → (69,95) → (69,90) → (148,90) → (149,95) → (149,100)`
  i.e. out the Office #2 door, to the tram stop, **along the tram line**, off
  at the Office #1 stop, in the north door. This is the visible commute
  colleagues ride (FR-022).

## 6. Style guide (palette + tile inventory)

Palette (flat, no gradients per tile; 1px-soft shading allowed):
`paper #f1efed` · `plaza edge #e4e1de` · `street #b9c0cd` · `street dash
#ffffff` · `sidewalk #d6d9de` · `building floor #ffffff` · `wall #cfcfcf`
(outline `#b5b5b5`) · `room green fill #dcebbc` / border `#b6cd8a` · `room
green alt #cfe3a8` · `navy core #2e3a59` (glyphs white) · `restroom gray
#e9e9ec` · `lawn #cfe0c3` · `lawn dark #b7d0a8` · `tree light #8fbf6f` /
`tree dark #5e9e4f` · `desk wood #d9b98c` / desk white `#ececec` · `chair
#4a4a55` · `plant pot #c96f4a` + leaf `#6fae5a` · `coffee #7a5230` ·
`tram rail #8b8f99` · `shadow rgba(0,0,0,0.08)` (south+east of buildings,
1-tile skirt — gives the CoC-style "grounded" look).

Tileset `campus_tileset.png`: 16px grid atlas (≤ 256 tiles, e.g. 16×16 tiles
= 256×256 px). Required tile families: paper/plaza (2 variants), lawn (2) +
path, street center/edge/dash/crossing, sidewalk, tram rail/tie/platform,
parking asphalt/stall-line/car (2×1, 2 colors), building floor, wall
straight/corner (outer+inner) for white walls, green-room fill/border
straight/corner, navy core fill + glyph tiles (elevator ▲▼, stairs steps, WC,
phone, coffee cup), desk 2×1 (wood + white) with paper/monitor variants,
chair (4 orientations optional, 1 ok), monitor workstation, meeting table
2×2, plant, tree quarter tiles (2×2 cluster, light+dark two-tone), swing
bench, trophy shelf, kicker table, tram body 2×1 ×3 segments, lise logo
plate (white "lise" on green 2×1 — building signage at both main doors),
shadow edge tiles. Every tile drawn programmatically with Pillow — crisp
flat shapes, rounded corners where cheap (circles/rects), no noise.

`avatars.png`: keep the 8×16px-frame strip contract (frames 0,1,2,7 live —
distinct shirt colors teal/coral/amber/violet, green status dot; 3,4 red
last-seen variants with red dot; 5,6 desaturated last-seen). Flat style:
round head (skin tones vary per frame), simple body, 1px darker outline,
subtle drop-shadow ellipse. Readable at 16px AND when scaled 3–4×.

## 7. Camera / viewport (Clash-of-Clans feel)

- **Min zoom = fit the whole campus** in the viewport (computed from map
  size — replaces the fixed `MIN_ZOOM 1.5`); max zoom 4 unchanged. Boot
  still frames the active office (existing `bootCamera`), user can freely
  pinch out to the whole world; pan clamped to map bounds (existing
  `clampToMap`).
- Wheel zoom stays focal-point-centered; drag pan; label zoom rule
  (`LABEL_ZOOM_THRESHOLD 2.5`) unchanged; avatar tap targets stay ≥ 44 px
  via the existing screen-space padded hit areas (FR-024 note: at far-out
  zoom taps are for panning, interaction happens zoomed-in — same as CoC).

## 8. Production invariants (checklist for the generator + tests)

- [ ] ≥ 20 anchors office_1, ≥ 40 office_2, ≥ 60 total, all on walkable
      floor inside the right building polygon
- [ ] every named room from §3/§4 present as a `Rooms` polygon with correct
      `building` property; 9 spec'd names exactly: `corkscrew`, `spiderweb`,
      `skier`, `Office` (office_1); `deco-office-chair`, `frog`, `bongo`,
      `bridge`, `the executive Office` (office_2)
- [ ] one `CommutePaths` polyline with `from`/`to` properties, endpoints at
      the two doors
- [ ] tileset embedded, name `campus_tileset`, image `campus_tileset.png`
- [ ] map loads in CampusScene with zero thrown errors; all tile layers render
- [ ] JSON deterministic (stable ordering) so regeneration diffs are clean
