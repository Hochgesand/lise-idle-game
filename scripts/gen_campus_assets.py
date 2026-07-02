#!/usr/bin/env python3
"""Generate the REAL campus assets (T040/T041) — flat-design floor-plan style.

Authoritative blueprint: specs/002-shared-office-coop/campus-layout.md
(transcribed 2026-07-02 from a screenshot of the real lise floor-plan tool).
Every coordinate, palette hex and layer name below follows that document.

Outputs (deterministic — no timestamps, no randomness, stable ordering, so
regeneration is diff-clean):

  frontend/public/assets/campus_tileset.png  16 px flat-design tile atlas
  frontend/public/assets/campus.json         200x140 Tiled map, embedded tileset
  frontend/public/assets/avatars.png         8-frame 16 px avatar strip

Usage:
  python3 scripts/gen_campus_assets.py                       # write the assets
  python3 scripts/gen_campus_assets.py --preview out.png     # + full-map render
  python3 scripts/gen_campus_assets.py \
      --crop 350 950 900 1350 3 crop.png                     # + zoomed crop
  (--labels overlays room names on the preview/crop for fidelity checks)
"""
import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "assets")

TILE = 16
MAP_W, MAP_H = 200, 140

# ── Palette (campus-layout.md §6) ─────────────────────────────────────────
PAPER = "#f1efed"
PAPER2 = "#edeae7"
STREET = "#b9c0cd"
WHITE = "#ffffff"
SIDEWALK = "#d6d9de"
FLOOR = "#ffffff"
WALL = "#cfcfcf"
WALL_EDGE = "#b5b5b5"
ROOM_GREEN = "#dcebbc"
ROOM_GREEN_BORDER = "#b6cd8a"
ROOM_GREEN_ALT = "#cfe3a8"
ROOM_GREEN_ALT_BORDER = "#aec888"
NAVY = "#2e3a59"
RESTROOM = "#e9e9ec"
RESTROOM_BORDER = "#c9c9d1"
LAWN = "#cfe0c3"
LAWN2 = "#c8dbba"
LAWN_DARK = "#b7d0a8"
TREE_LIGHT = "#8fbf6f"
TREE_DARK = "#5e9e4f"
TREE_LIGHT_B = "#7fb562"
TREE_DARK_B = "#4f8f43"
DESK_WOOD = "#d9b98c"
DESK_WOOD_EDGE = "#c2a273"
DESK_WHITE = "#ececec"
DESK_WHITE_EDGE = "#d2d2d2"
CHAIR = "#4a4a55"
CHAIR_DARK = "#3a3a44"
PLANT_POT = "#c96f4a"
PLANT_LEAF = "#6fae5a"
PLANT_LEAF_DARK = "#5e9e4f"
COFFEE = "#7a5230"
RAIL = "#8b8f99"
TIE = "#a3a89f"
ASPHALT = "#a9aeb8"
ASPHALT_LINE = "#f5f5f5"
PATH = "#e8e4da"
MONITOR = "#3a3f4a"
MONITOR_SCREEN = "#9fc4dd"
LISE_GREEN = "#76b82a"
TRAM_BODY = "#d95c4a"
TRAM_EDGE = "#b6483a"
TRAM_WINDOW = "#cde3ee"
CAR_A = "#5a7bd0"
CAR_A_EDGE = "#4762ab"
CAR_B = "#d06a5a"
CAR_B_EDGE = "#ab5347"
CAR_GLASS = "#bcd6e8"
SHELTER = "#8e99a8"
SHADOW = (0, 0, 0, 20)  # rgba(0,0,0,0.08)

# ── Building geometry (campus-layout.md §3/§4, tile coords, [from,to)) ────
O2_TOP = (24, 16, 100, 40)   # office_2 top wing
O2_WEST = (24, 40, 56, 92)   # office_2 west wing
O1_BAR = (116, 100, 188, 128)  # office_1 bar

# Doors: (x0, x1) gap at wall row y.
O2_DOOR_MAIN = (46, 49, 91)    # south wall, west wing
O2_DOOR_EAST = (88, 91, 39)    # south wall, top wing east end
O1_DOOR_MAIN = (148, 151, 100)  # north wall
O1_DOOR_SOUTH = (180, 183, 127)  # south wall

# Named rooms: (name, rect, kind, building). kind: green | navy | restroom.
ROOMS = [
    ("Phone Booth", (46, 18, 49, 20), "green", "office_2"),
    ("swinging boat", (62, 18, 71, 25), "green", "office_2"),
    ("bridge", (44, 44, 55, 53), "green", "office_2"),
    ("bongo", (26, 60, 33, 67), "green", "office_2"),
    ("space fighter", (26, 74, 34, 81), "green", "office_2"),
    ("deco-office-chair", (35, 76, 44, 85), "green", "office_2"),
    ("frog", (45, 78, 54, 87), "green", "office_2"),
    ("the executive Office", (46, 68, 55, 76), "green", "office_2"),
    ("Elevator", (50, 20, 54, 23), "navy", "office_2"),
    ("Stairs", (55, 24, 60, 28), "navy", "office_2"),
    ("Elevator", (34, 46, 38, 49), "navy", "office_2"),
    ("Stairs", (30, 52, 37, 57), "navy", "office_2"),
    ("skier", (142, 102, 151, 112), "green", "office_1"),
    ("Restroom Men", (152, 102, 157, 112), "restroom", "office_1"),
    ("Break Room", (158, 102, 167, 112), "green", "office_1"),
    ("Restroom", (180, 102, 186, 112), "restroom", "office_1"),
    ("spiderweb", (132, 116, 143, 126), "green", "office_1"),
    ("Stairs", (144, 116, 151, 126), "navy", "office_1"),
    ("corkscrew", (152, 116, 161, 126), "green", "office_1"),
    ("Office", (162, 116, 171, 126), "green", "office_1"),
    ("Elevator", (172, 116, 176, 126), "navy", "office_1"),
    ("Break-room", (177, 116, 187, 126), "green", "office_1"),
]

# Unnamed green rooms (drawn on Floors, NO Rooms object — blueprint: the open
# dev rooms/meeting strip are green fills without labels).
UNNAMED_GREEN = [
    ((80, 32, 88, 39), "alt"),    # office_2 meeting strip west
    ((89, 32, 97, 39), "alt"),    # office_2 meeting strip east
    ((118, 102, 130, 112), "alt"),  # office_1 dev room A
    ((131, 102, 141, 112), "alt"),  # dev room B
    ((168, 102, 179, 112), "alt"),  # dev room C
    ((118, 116, 131, 126), "alt"),  # dev room D
]

# ── Tile atlas ────────────────────────────────────────────────────────────


class Atlas:
    """16 px tile atlas built from named draw functions. gids are 1-based."""

    def __init__(self):
        self.tiles = []      # list[Image] in gid order
        self.by_name = {}    # name -> gid

    def add(self, name, img):
        assert name not in self.by_name, name
        self.tiles.append(img)
        self.by_name[name] = len(self.tiles)
        return self.by_name[name]

    def tile(self, name, fill=None, draw_fn=None):
        """Register (once) a 16x16 tile: solid `fill` and/or custom draw."""
        if name in self.by_name:
            return self.by_name[name]
        img = Image.new("RGBA", (TILE, TILE), fill if fill else (0, 0, 0, 0))
        if draw_fn:
            draw_fn(ImageDraw.Draw(img), img)
        return self.add(name, img)

    def multi(self, name, w, h, draw_fn):
        """Register a w x h (in tiles) prop drawn on one canvas, split into
        tiles. Returns gids[row][col]."""
        key = f"{name}:0,0"
        if key not in self.by_name:
            canvas = Image.new("RGBA", (w * TILE, h * TILE), (0, 0, 0, 0))
            draw_fn(ImageDraw.Draw(canvas), canvas)
            for r in range(h):
                for c in range(w):
                    part = canvas.crop((c * TILE, r * TILE, (c + 1) * TILE, (r + 1) * TILE))
                    self.add(f"{name}:{r},{c}", part)
        return [[self.by_name[f"{name}:{r},{c}"] for c in range(w)] for r in range(h)]

    def image(self, cols=16):
        rows = (len(self.tiles) + cols - 1) // cols
        img = Image.new("RGBA", (cols * TILE, rows * TILE), (0, 0, 0, 0))
        for i, t in enumerate(self.tiles):
            img.paste(t, ((i % cols) * TILE, (i // cols) * TILE))
        return img


A = Atlas()


def _font(size):
    try:
        return ImageFont.load_default(size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


# ── Ground / street / outdoor tiles ───────────────────────────────────────

def t_solid(name, color):
    return A.tile(name, fill=color)


def t_dash_h(d, _):
    d.rectangle([0, 0, 15, 15], fill=STREET)
    d.rectangle([3, 7, 12, 8], fill=WHITE)


def t_dash_v(d, _):
    d.rectangle([0, 0, 15, 15], fill=STREET)
    d.rectangle([7, 3, 8, 12], fill=WHITE)


def t_crossing(d, _):
    d.rectangle([0, 0, 15, 15], fill=STREET)
    d.rectangle([1, 2, 14, 5], fill=WHITE)
    d.rectangle([1, 10, 14, 13], fill=WHITE)


def t_tram_track(with_tie):
    def fn(d, _):
        d.rectangle([0, 0, 15, 15], fill=LAWN_DARK)
        if with_tie:
            d.rectangle([6, 1, 9, 14], fill=TIE)
        d.rectangle([0, 3, 15, 4], fill=RAIL)
        d.rectangle([0, 11, 15, 12], fill=RAIL)
    return fn


def t_platform(d, _):
    d.rectangle([0, 0, 15, 15], fill=SIDEWALK)
    d.rectangle([0, 0, 15, 1], fill="#c3c8cf")
    d.rectangle([0, 14, 15, 15], fill="#eceff2")


def t_stall_line(d, _):
    d.rectangle([0, 0, 15, 15], fill=ASPHALT)
    d.rectangle([0, 0, 15, 1], fill=ASPHALT_LINE)


def t_shadow(d, _):
    d.rectangle([0, 0, 15, 15], fill=SHADOW)


def t_path(d, _):
    d.rectangle([0, 0, 15, 15], fill=PATH)


# ── Bordered room-tile factory ────────────────────────────────────────────

def room_tile(fill, border, sides):
    """A room tile: `fill` with a 2 px `border` stripe on each side in
    `sides` (subset of 'nsew'). Registered once per combination."""
    key = f"room:{fill}:{border}:{''.join(sorted(sides))}"

    def fn(d, _):
        d.rectangle([0, 0, 15, 15], fill=fill)
        if "n" in sides:
            d.rectangle([0, 0, 15, 1], fill=border)
        if "s" in sides:
            d.rectangle([0, 14, 15, 15], fill=border)
        if "w" in sides:
            d.rectangle([0, 0, 1, 15], fill=border)
        if "e" in sides:
            d.rectangle([14, 0, 15, 15], fill=border)
    return A.tile(key, draw_fn=fn)


# ── Navy-core glyph tiles ─────────────────────────────────────────────────

def t_glyph_elevator(d, _):
    d.rectangle([0, 0, 15, 15], fill=NAVY)
    d.polygon([(8, 1), (12, 6), (4, 6)], fill=WHITE)
    d.polygon([(4, 9), (12, 9), (8, 14)], fill=WHITE)


def t_glyph_stairs(d, _):
    d.rectangle([0, 0, 15, 15], fill=NAVY)
    for i in range(4):
        d.rectangle([2 + i * 3, 3 + i * 3, 13, 4 + i * 3], fill=WHITE)


def t_glyph_wc(d, _):
    d.rectangle([0, 0, 15, 15], fill=NAVY)
    d.text((8, 8), "WC", fill=WHITE, font=_font(8), anchor="mm")


def t_glyph_phone(d, _):
    d.rectangle([0, 0, 15, 15], fill=NAVY)
    d.rounded_rectangle([3, 6, 12, 8], radius=1, fill=WHITE)
    d.ellipse([2, 4, 6, 9], fill=WHITE)
    d.ellipse([9, 4, 13, 9], fill=WHITE)


def t_glyph_coffee(d, _):
    d.rectangle([0, 0, 15, 15], fill=NAVY)
    d.rectangle([4, 6, 10, 12], fill=WHITE)
    d.arc([9, 7, 13, 11], 270, 90, fill=WHITE, width=2)
    d.rectangle([5, 2, 6, 4], fill=WHITE)
    d.rectangle([8, 3, 9, 5], fill=WHITE)


# ── Furniture / prop tiles (transparent background) ───────────────────────

def t_chair(facing):
    def fn(d, _):
        if facing == "n":  # backrest at the top (colleague faces the desk above)
            d.rounded_rectangle([4, 5, 11, 12], radius=2, fill=CHAIR)
            d.rounded_rectangle([3, 3, 12, 6], radius=2, fill=CHAIR_DARK)
        else:  # backrest at the bottom
            d.rounded_rectangle([4, 3, 11, 10], radius=2, fill=CHAIR)
            d.rounded_rectangle([3, 9, 12, 12], radius=2, fill=CHAIR_DARK)
    return A.tile(f"chair_{facing}", draw_fn=fn)


def desk(kind):
    body = DESK_WOOD if kind == "wood" else DESK_WHITE
    edge = DESK_WOOD_EDGE if kind == "wood" else DESK_WHITE_EDGE

    def fn(d, _):
        d.rounded_rectangle([1, 3, 30, 13], radius=2, fill=body, outline=edge)
        for x0 in (6, 20):  # a monitor per seat half
            d.rectangle([x0, 5, x0 + 6, 9], fill=MONITOR)
            d.rectangle([x0 + 1, 6, x0 + 5, 8], fill=MONITOR_SCREEN)
            d.rectangle([x0 + 2, 10, x0 + 4, 10], fill=MONITOR)
    return A.multi(f"desk_{kind}", 2, 1, fn)[0]


def t_workstation(d, _):
    d.rounded_rectangle([1, 5, 14, 13], radius=2, fill=DESK_WHITE, outline=DESK_WHITE_EDGE)
    d.rectangle([3, 1, 12, 7], fill=MONITOR)
    d.rectangle([4, 2, 11, 6], fill=MONITOR_SCREEN)


def meeting_table():
    def fn(d, _):
        d.rounded_rectangle([3, 3, 28, 28], radius=5, fill=DESK_WOOD, outline=DESK_WOOD_EDGE)
        d.rounded_rectangle([8, 8, 23, 23], radius=3, fill="#e3c79c")
    return A.multi("meeting_table", 2, 2, fn)


def t_plant(d, _):
    d.ellipse([2, 1, 12, 10], fill=PLANT_LEAF)
    d.ellipse([6, 3, 13, 9], fill=PLANT_LEAF_DARK)
    d.polygon([(4, 10), (11, 10), (10, 14), (5, 14)], fill=PLANT_POT)


def t_coffee_machine(d, _):
    d.rounded_rectangle([3, 1, 12, 13], radius=1, fill=CHAIR)
    d.rectangle([5, 3, 10, 6], fill=MONITOR_SCREEN)
    d.rectangle([6, 9, 9, 12], fill=WHITE)
    d.rectangle([7, 7, 8, 8], fill=COFFEE)


def t_phone_point(d, _):
    d.rounded_rectangle([3, 7, 12, 9], radius=1, fill=NAVY)
    d.ellipse([2, 5, 6, 10], fill=NAVY)
    d.ellipse([9, 5, 13, 10], fill=NAVY)


def swing_bench():
    def fn(d, _):
        d.rectangle([2, 1, 29, 2], fill="#8a6f4d")           # top bar
        d.line([(4, 13), (7, 2)], fill="#8a6f4d", width=2)    # posts
        d.line([(27, 13), (24, 2)], fill="#8a6f4d", width=2)
        d.line([(11, 2), (11, 8)], fill="#6b7280", width=1)   # ropes
        d.line([(20, 2), (20, 8)], fill="#6b7280", width=1)
        d.rounded_rectangle([9, 8, 22, 12], radius=2, fill=DESK_WOOD, outline=DESK_WOOD_EDGE)
    return A.multi("swing_bench", 2, 1, fn)[0]


def t_trophy_shelf(d, _):
    d.rectangle([1, 4, 14, 5], fill=DESK_WOOD)
    d.rectangle([1, 10, 14, 11], fill=DESK_WOOD)
    for x0, y0 in ((3, 1), (9, 1), (6, 7)):
        d.rectangle([x0 + 1, y0, x0 + 3, y0 + 2], fill="#e8c150")
        d.rectangle([x0, y0 + 2, x0 + 4, y0 + 3], fill="#c8a030")


def kicker():
    def fn(d, _):
        d.rounded_rectangle([2, 3, 29, 12], radius=2, fill="#3f7d4e", outline="#2f5f3b")
        d.rectangle([15, 4, 16, 11], fill=WHITE)
        for i, x0 in enumerate((6, 10, 20, 24)):
            color = "#d04545" if i % 2 == 0 else "#4565d0"
            d.rectangle([x0, 4, x0, 11], fill="#8a8a8a")
            for y0 in (5, 8, 10):
                d.rectangle([x0 - 1, y0, x0 + 1, y0 + 1], fill=color)
    return A.multi("kicker", 2, 1, fn)[0]


def car(letter):
    body = CAR_A if letter == "a" else CAR_B
    edge = CAR_A_EDGE if letter == "a" else CAR_B_EDGE

    def fn(d, _):
        d.rounded_rectangle([2, 3, 29, 12], radius=4, fill=body, outline=edge)
        d.rounded_rectangle([9, 4, 14, 11], radius=1, fill=CAR_GLASS)
        d.rounded_rectangle([21, 5, 24, 10], radius=1, fill=CAR_GLASS)
    return A.multi(f"car_{letter}", 2, 1, fn)[0]


def tram_vehicle():
    def fn(d, _):
        d.rounded_rectangle([1, 2, 94, 13], radius=5, fill=TRAM_BODY, outline=TRAM_EDGE)
        for x0 in (32, 64):  # segment articulation
            d.rectangle([x0 - 1, 3, x0, 12], fill=TRAM_EDGE)
        for x0 in (6, 14, 38, 46, 70, 78):  # windows
            d.rounded_rectangle([x0, 4, x0 + 5, 8], radius=1, fill=TRAM_WINDOW)
        for x0 in (24, 56, 86):  # doors
            d.rectangle([x0, 4, x0 + 3, 11], fill=TRAM_EDGE)
        d.rectangle([91, 5, 93, 10], fill=TRAM_WINDOW)  # front window
    return A.multi("tram", 6, 1, fn)[0]


def shelter():
    def fn(d, _):
        d.rectangle([3, 4, 4, 13], fill="#6b7280")
        d.rectangle([27, 4, 28, 13], fill="#6b7280")
        d.rounded_rectangle([7, 8, 24, 12], radius=1, fill=DESK_WOOD, outline=DESK_WOOD_EDGE)
        d.rounded_rectangle([1, 1, 30, 5], radius=2, fill=SHELTER)
    return A.multi("shelter", 2, 1, fn)[0]


def t_stop_sign(d, _):
    d.rectangle([7, 8, 8, 14], fill="#6b7280")
    d.ellipse([3, 0, 12, 9], fill="#2e7d46")
    d.line([(6, 2), (6, 7)], fill="#f5d442", width=1)
    d.line([(9, 2), (9, 7)], fill="#f5d442", width=1)
    d.line([(6, 4), (9, 4)], fill="#f5d442", width=1)


def lise_logo():
    def fn(d, _):
        d.rounded_rectangle([0, 2, 31, 13], radius=3, fill=LISE_GREEN, outline="#5f9a1e")
        d.text((16, 8), "lise", fill=WHITE, font=_font(10), anchor="mm")
    return A.multi("lise_logo", 2, 1, fn)[0]


def tree(variant):
    light = TREE_LIGHT if variant == "a" else TREE_LIGHT_B
    dark = TREE_DARK if variant == "a" else TREE_DARK_B

    def fn(d, _):
        d.ellipse([1, 5, 21, 25], fill=light)
        d.ellipse([9, 1, 29, 21], fill=light)
        d.ellipse([6, 11, 26, 31], fill=light)
        d.ellipse([13, 13, 29, 29], fill=dark)
        d.ellipse([17, 6, 27, 16], fill=dark)
    return A.multi(f"tree_{variant}", 2, 2, fn)


# ── Register the whole inventory in a stable order ────────────────────────

def build_atlas():
    t_solid("paper", PAPER)
    t_solid("paper2", PAPER2)
    t_solid("lawn", LAWN)
    t_solid("lawn2", LAWN2)
    A.tile("path", draw_fn=t_path)
    t_solid("street", STREET)
    A.tile("dash_h", draw_fn=t_dash_h)
    A.tile("dash_v", draw_fn=t_dash_v)
    A.tile("crossing", draw_fn=t_crossing)
    t_solid("sidewalk", SIDEWALK)
    t_solid("tram_bed", LAWN_DARK)
    A.tile("tram_track_a", draw_fn=t_tram_track(True))
    A.tile("tram_track_b", draw_fn=t_tram_track(False))
    A.tile("platform", draw_fn=t_platform)
    t_solid("asphalt", ASPHALT)
    A.tile("stall_line", draw_fn=t_stall_line)
    t_solid("floor", FLOOR)
    t_solid("wall", WALL)
    t_solid("navy", NAVY)
    A.tile("glyph_elevator", draw_fn=t_glyph_elevator)
    A.tile("glyph_stairs", draw_fn=t_glyph_stairs)
    A.tile("glyph_wc", draw_fn=t_glyph_wc)
    A.tile("glyph_phone", draw_fn=t_glyph_phone)
    A.tile("glyph_coffee", draw_fn=t_glyph_coffee)
    A.tile("chair_n", draw_fn=t_chair("n").__self__ if False else None) if False else t_chair("n")
    t_chair("s")
    desk("wood")
    desk("white")
    A.tile("workstation", draw_fn=t_workstation)
    meeting_table()
    A.tile("plant", draw_fn=t_plant)
    A.tile("coffee_machine", draw_fn=t_coffee_machine)
    A.tile("phone_point", draw_fn=t_phone_point)
    swing_bench()
    A.tile("trophy_shelf", draw_fn=t_trophy_shelf)
    kicker()
    car("a")
    car("b")
    tram_vehicle()
    shelter()
    A.tile("stop_sign", draw_fn=t_stop_sign)
    lise_logo()
    tree("a")
    tree("b")
    A.tile("shadow", draw_fn=t_shadow)


# ── Map grids ─────────────────────────────────────────────────────────────

LAYER_NAMES = ["Ground", "Streets", "Floors", "Walls", "Furniture", "Decor"]


def new_grid():
    return [0] * (MAP_W * MAP_H)


def put(grid, x, y, gid):
    if 0 <= x < MAP_W and 0 <= y < MAP_H:
        grid[y * MAP_W + x] = gid


def fill(grid, rect, gid):
    x0, y0, x1, y1 = rect
    for y in range(y0, y1):
        for x in range(x0, x1):
            put(grid, x, y, gid)


def put_multi(grid, x, y, gids):
    for r, row in enumerate(gids):
        for c, gid in enumerate(row):
            put(grid, x + c, y + r, gid)


def g(name):
    return A.by_name[name]


def footprint_cells(rects):
    cells = set()
    for x0, y0, x1, y1 in rects:
        for y in range(y0, y1):
            for x in range(x0, x1):
                cells.add((x, y))
    return cells


def build_map():
    grids = {n: new_grid() for n in LAYER_NAMES}
    ground, streets = grids["Ground"], grids["Streets"]
    floors, walls = grids["Floors"], grids["Walls"]
    furniture, decor = grids["Furniture"], grids["Decor"]

    # ── Ground: paper base with sparse variant, lawns, parking asphalt ────
    for y in range(MAP_H):
        for x in range(MAP_W):
            variant = (x * 3 + y * 7) % 13 == 0
            put(ground, x, y, g("paper2") if variant else g("paper"))

    def lawn_fill(rect):
        x0, y0, x1, y1 = rect
        for y in range(y0, y1):
            for x in range(x0, x1):
                variant = (x * 5 + y * 3) % 11 == 0
                put(ground, x, y, g("lawn2") if variant else g("lawn"))

    lawn_fill((0, 0, 200, 8))       # top-edge lawn strip with tree row
    lawn_fill((112, 8, 200, 88))    # NE park
    lawn_fill((110, 130, 200, 140))  # lawn south of office_1
    fill(ground, (8, 48, 22, 84), g("asphalt"))    # parking lot
    fill(ground, (13, 84, 17, 92), g("asphalt"))   # driveway to Street C

    # Park paths (winding L: east-west walk + branch up to Street A).
    fill(ground, (112, 68, 200, 70), g("path"))
    fill(ground, (156, 50, 158, 68), g("path"))

    # ── Streets layer ─────────────────────────────────────────────────────
    fill(streets, (0, 92, 200, 98), g("street"))     # Street C (main)
    fill(streets, (104, 8, 110, 92), g("street"))    # Street B (vertical)
    fill(streets, (110, 44, 200, 50), g("street"))   # Street A (NE)

    for x in range(0, 200):  # Street C dashed centerline (y 94)
        if x % 4 < 2:
            put(streets, x, 94, g("dash_h"))
    for y in range(8, 92):   # Street B dashes
        if y % 4 < 2:
            put(streets, 106, y, g("dash_v"))
    for x in range(110, 200):  # Street A dashes
        if x % 4 < 2:
            put(streets, x, 46, g("dash_h"))

    fill(streets, (104, 92, 110, 98), g("crossing"))  # zebra crossing

    # Tram line: grass bed + rails, y[88,91), x[56,200).
    fill(streets, (56, 88, 200, 89), g("tram_bed"))
    for x in range(56, 200):
        put(streets, x, 89, g("tram_track_a") if x % 2 == 0 else g("tram_track_b"))
    fill(streets, (56, 90, 200, 91), g("tram_bed"))

    # Parking stall lines: rows every 3 tiles on both stall columns.
    for y in range(48, 84, 3):
        for x in list(range(8, 13)) + list(range(17, 22)):
            put(streets, x, y, g("stall_line"))

    # Sidewalks along streets (only where nothing else was painted).
    def sidewalk(rect):
        x0, y0, x1, y1 = rect
        for y in range(y0, y1):
            for x in range(x0, x1):
                if streets[y * MAP_W + x] == 0:
                    put(streets, x, y, g("sidewalk"))

    sidewalk((0, 91, 200, 92))    # north of Street C (below the tram)
    sidewalk((0, 98, 200, 99))    # south of Street C
    sidewalk((103, 8, 104, 92))   # west of Street B
    sidewalk((110, 8, 111, 92))   # east of Street B
    sidewalk((110, 43, 200, 44))  # north of Street A
    sidewalk((110, 50, 200, 51))  # south of Street A

    # Tram stop platforms (overwrite the sidewalk at the stops).
    fill(streets, (66, 91, 72, 92), g("platform"))
    fill(streets, (146, 91, 152, 92), g("platform"))

    # Sidewalk ring around each building (only into empty street cells).
    o2_cells = footprint_cells([O2_TOP, O2_WEST])
    o1_cells = footprint_cells([O1_BAR])
    all_cells = o2_cells | o1_cells
    for (cx, cy) in sorted(all_cells):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if (nx, ny) not in all_cells and 0 <= nx < MAP_W and 0 <= ny < MAP_H:
                if streets[ny * MAP_W + nx] == 0:
                    put(streets, nx, ny, g("sidewalk"))

    # ── Buildings: floor + wall outline with door gaps ────────────────────
    def paint_building(cells, doors):
        door_cells = set()
        for x0, x1, yd in doors:
            for x in range(x0, x1):
                door_cells.add((x, yd))
        for (cx, cy) in sorted(cells):
            edge = any(
                (cx + dx, cy + dy) not in cells
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
                if (dx, dy) != (0, 0)
            )
            if edge and (cx, cy) not in door_cells:
                put(walls, cx, cy, g("wall"))
            else:
                put(floors, cx, cy, g("floor"))

    paint_building(o2_cells, [O2_DOOR_MAIN, O2_DOOR_EAST])
    paint_building(o1_cells, [O1_DOOR_MAIN, O1_DOOR_SOUTH])

    # Shadow skirt (Decor): one tile south/east of each building.
    for (cx, cy) in sorted(all_cells):
        for dx, dy in ((1, 0), (0, 1), (1, 1)):
            nx, ny = cx + dx, cy + dy
            if (nx, ny) not in all_cells:
                put(decor, nx, ny, g("shadow"))

    # ── Rooms: green fills with borders, navy cores, restrooms ────────────
    def paint_room(rect, kind):
        x0, y0, x1, y1 = rect
        if kind == "navy":
            fill(floors, rect, g("navy"))
            return
        fill_c, border_c = {
            "green": (ROOM_GREEN, ROOM_GREEN_BORDER),
            "alt": (ROOM_GREEN_ALT, ROOM_GREEN_ALT_BORDER),
            "restroom": (RESTROOM, RESTROOM_BORDER),
        }[kind]
        for y in range(y0, y1):
            for x in range(x0, x1):
                sides = ""
                if y == y0:
                    sides += "n"
                if y == y1 - 1:
                    sides += "s"
                if x == x0:
                    sides += "w"
                if x == x1 - 1:
                    sides += "e"
                put(floors, x, y, room_tile(fill_c, border_c, sides))

    for _, rect, kind, _b in ROOMS:
        paint_room(rect, kind)
    for rect, kind in UNNAMED_GREEN:
        paint_room(rect, kind)

    # Navy-core glyphs at each core's center tile.
    for name, rect, kind, _b in ROOMS:
        if kind == "navy":
            cx = (rect[0] + rect[2]) // 2
            cy = (rect[1] + rect[3]) // 2
            glyph = "glyph_elevator" if name == "Elevator" else "glyph_stairs"
            put(floors, cx, cy, g(glyph))
        if kind == "restroom":
            cx = (rect[0] + rect[2]) // 2
            cy = (rect[1] + rect[3]) // 2
            put(floors, cx, cy, g("glyph_wc"))

    # ── Furniture: desks + chairs (seat anchors), tables, props ──────────
    anchors = []  # (name, building, world_px_x, world_px_y)

    def place_desk(x, y, building, kind="wood"):
        """2x1 desk at (x,y) with two chairs below; two seat anchors."""
        put_multi(furniture, x, y, [desk(kind)])
        for i, cx in enumerate((x, x + 1)):
            put(furniture, cx, y + 1, g("chair_n"))
            n = len([a for a in anchors if a[1] == building]) + 1
            anchors.append((f"seat_{building[-1]}_{n}", building, cx * TILE + 8, (y + 1) * TILE + 8))
        return 2

    def place_workstation(x, y, building):
        put(furniture, x, y, g("workstation"))
        put(furniture, x, y + 1, g("chair_n"))
        n = len([a for a in anchors if a[1] == building]) + 1
        anchors.append((f"seat_{building[-1]}_{n}", building, x * TILE + 8, (y + 1) * TILE + 8))

    # office_2 — NW dev area (12), east dev area (16), west wing (8 + 4 WS).
    for y in (19, 23, 27):
        for x in (27, 31, 35, 39):
            place_desk(x, y, "office_2", "wood" if (x + y) % 2 else "white")
    for y in (19, 22, 25, 28):
        for x in (73, 79, 85, 91):
            place_desk(x, y, "office_2", "white" if (x + y) % 2 else "wood")
    for y in (59, 63):
        for x in (39, 43, 47, 51):
            place_desk(x, y, "office_2")
    for y in (60, 62, 64, 66):
        place_workstation(34, y - 1, "office_2") if False else None
    for y in (60, 63, 66):
        pass
    # 4 monitor workstations near bongo (blueprint §3).
    for i, y in enumerate((58, 61, 64, 67)):
        place_workstation(35, y, "office_2")

    # bridge: 2x2 meeting table + 4 chairs (4 anchors).
    put_multi(furniture, 48, 47, meeting_table())
    for cx, cy in ((47, 47), (50, 47), (47, 48), (50, 48)):
        put(furniture, cx, cy, g("chair_n") if cy == 47 else g("chair_s"))
        n = len([a for a in anchors if a[1] == "office_2"]) + 1
        anchors.append((f"seat_2_{n}", "office_2", cx * TILE + 8, cy * TILE + 8))

    # office_1 — dev rooms A/B/D (6 each), C (4), skier (2), Office (2).
    for y in (103, 106, 109):
        for x in (119, 124):
            place_desk(x, y, "office_1", "wood" if y % 2 else "white")
    for y in (103, 106, 109):
        for x in (132, 137):
            place_desk(x, y, "office_1", "white" if y % 2 else "wood")
    for y in (117, 120, 123):
        for x in (119, 125):
            place_desk(x, y, "office_1")
    for y in (104, 108):
        for x in (169, 174):
            place_desk(x, y, "office_1", "white")
    place_desk(144, 105, "office_1")           # skier
    place_desk(164, 119, "office_1", "white")  # Office

    # Named-room props.
    put(furniture, 146, 103, g("trophy_shelf"))          # skier trophies
    put_multi(furniture, 65, 21, [swing_bench()])        # swinging boat
    put(furniture, 47, 19, g("phone_point"))             # Phone Booth
    put(furniture, 40, 50, g("phone_point"))             # corridor phone (§3)
    put(furniture, 60, 30, g("coffee_machine"))          # coffee points (§3)
    put(furniture, 38, 62, g("coffee_machine"))
    put(furniture, 160, 104, g("coffee_machine"))        # Break Room
    put_multi(furniture, 162, 108, [kicker()])           # Break Room kicker
    put(furniture, 179, 118, g("coffee_machine"))        # Break-room
    put_multi(furniture, 181, 121, meeting_table())    # Break-room table
    put_multi(furniture, 136, 120, meeting_table())    # spiderweb
    put_multi(furniture, 155, 120, meeting_table())    # corkscrew
    put_multi(furniture, 49, 71, meeting_table())      # the executive Office
    put_multi(furniture, 83, 34, meeting_table())      # meeting strip west
    put_multi(furniture, 92, 34, meeting_table())      # meeting strip east
    put(furniture, 29, 63, g("chair_s"))                 # bongo
    put(furniture, 30, 63, g("chair_s"))
    put(furniture, 29, 77, g("plant"))                   # space fighter
    put(furniture, 39, 80, g("chair_s"))                 # deco-office-chair
    put(furniture, 49, 82, g("plant"))                   # frog

    # Plants along corridors / corners (fixed, deterministic).
    for x, y in ((26, 17), (98, 17), (26, 38), (54, 90), (26, 90), (98, 38),
                 (117, 101), (186, 101), (117, 126), (169, 113), (128, 113)):
        put(furniture, x, y, g("plant"))

    # Parked cars (8, alternating colors) in the stall columns.
    for i, (x, y) in enumerate(((9, 49), (9, 55), (9, 61), (9, 73),
                                (18, 52), (18, 58), (18, 70), (18, 76))):
        put_multi(furniture, x, y, [car("a" if i % 2 == 0 else "b")])

    # Tram vehicle parked at x[90,96) on the track (§5).
    put_multi(furniture, 90, 89, [tram_vehicle()])

    # Tram stops: shelter + sign on the platforms.
    put_multi(furniture, 66, 90, [shelter()])
    put(furniture, 70, 91, g("stop_sign"))
    put_multi(furniture, 146, 90, [shelter()])
    put(furniture, 150, 91, g("stop_sign"))

    # ── Decor: trees + lise logo plates ───────────────────────────────────
    park_trees = [(118, 12), (132, 20), (150, 14), (170, 10), (186, 18),
                  (120, 56), (136, 62), (166, 58), (186, 72), (146, 76)]
    top_trees = [(12, 2), (30, 3), (48, 2), (66, 3), (84, 2), (98, 3),
                 (118, 2), (136, 3), (154, 2), (172, 3), (190, 2)]
    south_trees = [(124, 132), (150, 134), (174, 132), (190, 133)]
    for i, (x, y) in enumerate(park_trees + top_trees + south_trees):
        put_multi(decor, x, y, tree("a" if i % 2 == 0 else "b"))

    # lise signage next to each main door (§6: logo plate at both doors).
    put_multi(decor, 44, 91, [lise_logo()])
    put_multi(decor, 146, 100, [lise_logo()])

    return grids, anchors


# ── Tiled JSON assembly ───────────────────────────────────────────────────

def _props(**kv):
    return [{"name": k, "type": "string", "value": v} for k, v in kv.items()]


def rect_polygon(rect):
    x0, y0, x1, y1 = (v * TILE for v in rect)
    return [{"x": float(px), "y": float(py)}
            for px, py in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]


def build_json(grids, anchors):
    oid = 1
    room_objects = []
    for name, rect, _kind, building in ROOMS:
        room_objects.append({
            "id": oid, "name": name, "type": "", "visible": True,
            "x": 0, "y": 0, "rotation": 0,
            "polygon": rect_polygon(rect),
            "properties": _props(building=building),
        })
        oid += 1

    seat_objects = []
    for name, building, px, py in anchors:
        seat_objects.append({
            "id": oid, "name": name, "type": "", "visible": True,
            "x": float(px), "y": float(py), "rotation": 0, "point": True,
            "properties": _props(building=building),
        })
        oid += 1

    # Commute polyline (§5): door → tram stop → along the tram → door.
    commute_tiles = [(47, 92), (47, 95), (69, 95), (69, 90),
                     (148, 90), (149, 95), (149, 100)]
    commute = {
        "id": oid, "name": "office2_to_office1", "type": "", "visible": True,
        "x": 0, "y": 0, "rotation": 0,
        "polyline": [{"x": float(tx * TILE + 8), "y": float(ty * TILE + 8)}
                     for tx, ty in commute_tiles],
        "properties": _props(**{"from": "office_2", "to": "office_1"}),
    }
    oid += 1

    layers = []
    lid = 1
    for name in LAYER_NAMES:
        layers.append({
            "id": lid, "name": name, "type": "tilelayer",
            "x": 0, "y": 0, "width": MAP_W, "height": MAP_H,
            "opacity": 1, "visible": True, "data": grids[name],
        })
        lid += 1
    for name, objs in (("Rooms", room_objects),
                       ("SeatAnchors", seat_objects),
                       ("CommutePaths", [commute])):
        layers.append({
            "id": lid, "name": name, "type": "objectgroup",
            "x": 0, "y": 0, "opacity": 1, "visible": True,
            "draworder": "topdown", "objects": objs,
        })
        lid += 1

    atlas_img = A.image()
    cols = atlas_img.width // TILE
    return {
        "compressionlevel": -1,
        "editorsettings": {"export": {"format": "json"}},
        "height": MAP_H,
        "width": MAP_W,
        "infinite": False,
        "layers": layers,
        "nextlayerid": lid,
        "nextobjectid": oid,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "tiledversion": "1.10.2",
        "tileheight": TILE,
        "tilesets": [{
            "columns": cols,
            "firstgid": 1,
            "image": "campus_tileset.png",
            "imagewidth": atlas_img.width,
            "imageheight": atlas_img.height,
            "margin": 0,
            "name": "campus_tileset",
            "spacing": 0,
            "tilecount": len(A.tiles),
            "tilewidth": TILE,
            "tileheight": TILE,
            "transparentcolor": "",
        }],
        "tilewidth": TILE,
        "type": "map",
        "version": "1.10",
    }


# ── avatars.png (frame-index contract from frontend avatars.ts) ───────────

def make_avatars():
    """8 frames of 16x16. Frames 0,1,2,7 live (distinct shirts, green dot);
    3,4 red last-seen; 5,6 desaturated last-seen. LIVE_FRAME=0,
    LAST_SEEN_FRAME=3 in frontend/src/scenes/world/avatars.ts."""
    frames = [
        # (shirt, shirt_outline, skin, dot)
        ("#2aa8a0", "#1f7d77", "#f0c8a0", "#37c837"),  # 0 live teal
        ("#e8705f", "#b8564a", "#d9a066", "#37c837"),  # 1 live coral
        ("#e3a72f", "#b58324", "#8a5a3b", "#37c837"),  # 2 live amber
        ("#c05050", "#8f3a3a", "#e8bd97", "#d33f3f"),  # 3 last-seen red
        ("#a84444", "#7d3131", "#c99368", "#d33f3f"),  # 4 last-seen red
        ("#9a9aa4", "#75757f", "#cfc2b4", "#b57878"),  # 5 last-seen desat
        ("#8a8a94", "#68686f", "#bfae9d", "#b57878"),  # 6 last-seen desat
        ("#8f6fd0", "#6c52a3", "#f5d5b8", "#37c837"),  # 7 live violet
    ]
    img = Image.new("RGBA", (8 * TILE, TILE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for f, (shirt, outline, skin, dot) in enumerate(frames):
        x0 = f * TILE
        d.ellipse([x0 + 4, 13, x0 + 12, 15], fill=(0, 0, 0, 40))  # drop shadow
        d.rounded_rectangle([x0 + 4, 7, x0 + 11, 14], radius=2, fill=shirt, outline=outline)
        d.ellipse([x0 + 4, 1, x0 + 11, 8], fill=skin, outline=outline)
        d.ellipse([x0 + 11, 0, x0 + 15, 4], fill=dot)              # status dot
    out = os.path.join(ASSETS, "avatars.png")
    img.save(out)
    print("wrote", out, img.size)


# ── Preview rendering (self-check only, not shipped) ──────────────────────

def render_preview(grids, labels=False):
    img = Image.new("RGBA", (MAP_W * TILE, MAP_H * TILE), (255, 255, 255, 255))
    for name in LAYER_NAMES:
        grid = grids[name]
        layer_img = Image.new("RGBA", img.size, (0, 0, 0, 0))
        for y in range(MAP_H):
            for x in range(MAP_W):
                gid = grid[y * MAP_W + x]
                if gid:
                    layer_img.paste(A.tiles[gid - 1], (x * TILE, y * TILE))
        img = Image.alpha_composite(img, layer_img)
    if labels:
        d = ImageDraw.Draw(img)
        f = _font(11)
        for name, rect, kind, _b in ROOMS:
            cx = (rect[0] + rect[2]) / 2 * TILE
            cy = (rect[1] + rect[3]) / 2 * TILE
            color = WHITE if kind == "navy" else "#4a5a35"
            d.text((cx, cy), name, fill=color, font=f, anchor="mm")
    return img


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--preview", metavar="PATH", help="write a full-map composite PNG")
    ap.add_argument("--crop", nargs=6, metavar=("X0", "Y0", "X1", "Y1", "SCALE", "PATH"),
                    help="write a scaled crop (px coords) of the composite")
    ap.add_argument("--labels", action="store_true", help="overlay room names on previews")
    args = ap.parse_args()

    os.makedirs(ASSETS, exist_ok=True)
    build_atlas()
    grids, anchors = build_map()

    atlas_img = A.image()
    atlas_path = os.path.join(ASSETS, "campus_tileset.png")
    atlas_img.save(atlas_path)
    print("wrote", atlas_path, atlas_img.size, f"({len(A.tiles)} tiles)")

    tilemap = build_json(grids, anchors)
    json_path = os.path.join(ASSETS, "campus.json")
    with open(json_path, "w") as fh:
        json.dump(tilemap, fh, separators=(",", ":"), sort_keys=False)
        fh.write("\n")
    o1 = sum(1 for a in anchors if a[1] == "office_1")
    o2 = sum(1 for a in anchors if a[1] == "office_2")
    print("wrote", json_path, f"({o1} office_1 + {o2} office_2 = {len(anchors)} anchors)")

    make_avatars()

    if args.preview or args.crop:
        preview = render_preview(grids, labels=args.labels)
        if args.preview:
            preview.save(args.preview)
            print("wrote", args.preview, preview.size)
        if args.crop:
            x0, y0, x1, y1, scale = (int(v) for v in args.crop[:5])
            crop = preview.crop((x0, y0, x1, y1))
            crop = crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST)
            crop.save(args.crop[5])
            print("wrote", args.crop[5], crop.size)


if __name__ == "__main__":
    main()
