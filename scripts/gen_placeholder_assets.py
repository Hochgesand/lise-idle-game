#!/usr/bin/env python3
"""Generate PLACEHOLDER assets for the Phase 3 campus world.

These are deliberate placeholders that unblock CampusScene. The REAL art
(Kenney CC0 packs + custom lise touches) and the real Tiled-authored
campus.json are MANUAL tasks T040/T041 deferred to the repo owner.

Outputs:
  frontend/public/assets/campus_tileset.png  (128x128, 8x8 tiles of 16px)
  frontend/public/assets/avatars.png         (128x16, 8 frames of 16x16)
  frontend/public/assets/campus.json         (valid Tiled orthogonal map)
"""
import json
import colorsys
import os
from PIL import Image, ImageDraw

ASSETS = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "public", "assets"
)
os.makedirs(ASSETS, exist_ok=True)

TILE = 16
COLS = 8
ROWS = 8
TCOUNT = COLS * ROWS  # 64


# ---------------------------------------------------------------------------
# 1. campus_tileset.png  — distinct solid color per tile
# ---------------------------------------------------------------------------
def make_tileset():
    img = Image.new("RGB", (COLS * TILE, ROWS * TILE), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    for idx in range(TCOUNT):
        cx = idx % COLS
        cy = idx // COLS
        # rotate hue around the 64 tiles for visibly distinct colors
        h = (idx / TCOUNT) % 1.0
        s = 0.55
        v = 0.85
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        fill = (int(r * 255), int(g * 255), int(b * 255))
        # slightly darker border so adjacent tiles separate visually
        br = max(0, int(r * 255) - 60)
        bg = max(0, int(g * 255) - 60)
        bb = max(0, int(b * 255) - 60)
        border = (br, bg, bb)
        x0, y0 = cx * TILE, cy * TILE
        x1, y1 = x0 + TILE - 1, y0 + TILE - 1
        draw.rectangle([x0, y0, x1, y1], fill=fill, outline=border)
    out = os.path.join(ASSETS, "campus_tileset.png")
    img.save(out)
    print("wrote", out, img.size)


# ---------------------------------------------------------------------------
# 2. avatars.png — 8 frames, green live vs red/desaturated last-seen
# ---------------------------------------------------------------------------
def make_avatars():
    FRAMES = 8
    img = Image.new("RGBA", (FRAMES * TILE, TILE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # frame style: 0,1,2 = green live ; 3,4 = red last-seen ;
    # 5,6 = desaturated last-seen ; 7 = green live
    def tint(f):
        if f in (0, 1, 2, 7):
            return "green"
        if f in (3, 4):
            return "red"
        return "desat"

    palette = {
        "green":  ((90, 200, 90), (40, 120, 40)),    # body, outline
        "red":    ((200, 70, 70), (120, 30, 30)),
        "desat":  ((150, 150, 160), (80, 80, 90)),
    }

    for f in range(FRAMES):
        body, outline = palette[tint(f)]
        x0 = f * TILE
        # head
        draw.ellipse([x0 + 5, 2, x0 + 10, 7], fill=body, outline=outline)
        # body
        draw.rectangle([x0 + 4, 8, x0 + 11, 14], fill=body, outline=outline)
    out = os.path.join(ASSETS, "avatars.png")
    img.save(out)
    print("wrote", out, img.size)


# ---------------------------------------------------------------------------
# 3. campus.json — valid Tiled orthogonal map
# ---------------------------------------------------------------------------
MAP_W = 50
MAP_H = 40


def _room(name, building, points, oid):
    """points: list of (x,y) absolute pixel coords for polygon."""
    return {
        "id": oid,
        "name": name,
        "type": "",
        "visible": True,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "polygon": [{"x": float(px), "y": float(py)} for px, py in points],
        "properties": [
            {"name": "building", "type": "string", "value": building}
        ],
    }


def _seat(name, building, x, y, oid):
    return {
        "id": oid,
        "name": name,
        "type": "",
        "visible": True,
        "x": float(x),
        "y": float(y),
        "rotation": 0,
        "point": True,
        "properties": [
            {"name": "building", "type": "string", "value": building}
        ],
    }


def _polyline(name, points, oid, props=None):
    obj = {
        "id": oid,
        "name": name,
        "type": "",
        "visible": True,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "polyline": [{"x": float(px), "y": float(py)} for px, py in points],
    }
    if props:
        obj["properties"] = props
    return obj


def make_map():
    # --- Ground tile data: vary gid so tiles render visibly different ---
    data = []
    for y in range(MAP_H):
        for x in range(MAP_W):
            gid = ((x * 3 + y * 5) % TCOUNT) + 1
            data.append(gid)
    assert len(data) == MAP_W * MAP_H

    oid = 1  # global object id counter

    # --- Rooms -------------------------------------------------------------
    # Office #1 footprint: x[32..352] y[64..288]
    rooms = []
    rooms.append(_room("corkscrew", "office_1",
                        [(32, 64), (192, 64), (192, 176), (32, 176)], oid)); oid += 1
    rooms.append(_room("spiderweb", "office_1",
                        [(192, 64), (352, 64), (352, 176), (192, 176)], oid)); oid += 1
    rooms.append(_room("skier", "office_1",
                        [(32, 176), (192, 176), (192, 288), (32, 288)], oid)); oid += 1
    rooms.append(_room("the Office", "office_1",
                        [(192, 176), (352, 176), (352, 288), (192, 288)], oid)); oid += 1
    # Office #2 footprint: x[448..768] y[64..288]
    rooms.append(_room("deco-office-chair", "office_2",
                        [(448, 64), (608, 64), (608, 128), (448, 128)], oid)); oid += 1
    rooms.append(_room("frog", "office_2",
                        [(608, 64), (768, 64), (768, 128), (608, 128)], oid)); oid += 1
    rooms.append(_room("bongo", "office_2",
                        [(448, 128), (608, 128), (608, 192), (448, 192)], oid)); oid += 1
    rooms.append(_room("bridge", "office_2",
                        [(608, 128), (768, 128), (768, 192), (608, 192)], oid)); oid += 1
    rooms.append(_room("the executive Office", "office_2",
                        [(448, 192), (768, 192), (768, 288), (448, 288)], oid)); oid += 1

    # --- SeatAnchors (>=8 office_1, >=8 office_2) -------------------------
    seats = []
    o1_pts = [
        (80, 96), (144, 96), (80, 144), (144, 144),
        (240, 96), (304, 96), (240, 144), (304, 144),
        (80, 208), (240, 208),
    ]
    for i, (x, y) in enumerate(o1_pts):
        seats.append(_seat(f"seat_o1_{i+1}", "office_1", x, y, oid)); oid += 1
    o2_pts = [
        (480, 96), (560, 96), (640, 96), (720, 96),
        (480, 160), (560, 160), (640, 160), (720, 160),
        (512, 224), (704, 224),
    ]
    for i, (x, y) in enumerate(o2_pts):
        seats.append(_seat(f"seat_o2_{i+1}", "office_2", x, y, oid)); oid += 1

    # --- CommutePaths: office_1 entrance (352,176) -> office_2 (448,176) --
    paths = []
    paths.append(_polyline(
        "office1_to_office2",
        [(352, 176), (384, 176), (384, 160), (416, 160), (416, 176), (448, 176)],
        oid,
        props=[
            {"name": "from", "type": "string", "value": "office_1"},
            {"name": "to", "type": "string", "value": "office_2"},
        ],
    )); oid += 1

    layers = [
        {
            "id": 1,
            "name": "Ground",
            "type": "tilelayer",
            "x": 0,
            "y": 0,
            "width": MAP_W,
            "height": MAP_H,
            "opacity": 1,
            "visible": True,
            "data": data,
        },
        {
            "id": 2,
            "name": "Rooms",
            "type": "objectgroup",
            "x": 0,
            "y": 0,
            "opacity": 1,
            "visible": True,
            "draworder": "topdown",
            "objects": rooms,
        },
        {
            "id": 3,
            "name": "SeatAnchors",
            "type": "objectgroup",
            "x": 0,
            "y": 0,
            "opacity": 1,
            "visible": True,
            "draworder": "topdown",
            "objects": seats,
        },
        {
            "id": 4,
            "name": "CommutePaths",
            "type": "objectgroup",
            "x": 0,
            "y": 0,
            "opacity": 1,
            "visible": True,
            "draworder": "topdown",
            "objects": paths,
        },
    ]

    tilemap = {
        "compressionlevel": -1,
        "editorsettings": {"export": {"format": "json"}},
        "height": MAP_H,
        "width": MAP_W,
        "infinite": False,
        "layers": layers,
        "nextlayerid": 5,
        "nextobjectid": oid,
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "tiledversion": "1.10.2",
        "tileheight": TILE,
        "tilesets": [
            {
                "columns": COLS,
                "firstgid": 1,
                "image": "campus_tileset.png",
                "imagewidth": COLS * TILE,
                "imageheight": ROWS * TILE,
                "margin": 0,
                "name": "campus_tileset",
                "spacing": 0,
                "tilecount": TCOUNT,
                "tilewidth": TILE,
                "tileheight": TILE,
                "transparentcolor": "",
            }
        ],
        "tilewidth": TILE,
        "type": "map",
        "version": "1.10",
    }

    out = os.path.join(ASSETS, "campus.json")
    with open(out, "w") as fh:
        json.dump(tilemap, fh, indent=2)
    print("wrote", out)


if __name__ == "__main__":
    make_tileset()
    make_avatars()
    make_map()
