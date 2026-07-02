// T040 — Production invariants for the REAL campus map (campus.json).
//
// The authoritative blueprint is `specs/002-shared-office-coop/campus-layout.md`
// (transcribed 2026-07-02 from a screenshot of the real lise floor-plan tool).
// This suite pins every §8 production invariant against the COMMITTED
// `frontend/public/assets/campus.json` so a regenerated or hand-edited map can
// never silently drop below the FR-020/021/022 contract:
//
//   - global frame: 200×140 tiles of 16 px (3200×2240 px world)
//   - tile layers in draw order: Ground → Streets → Floors → Walls →
//     Furniture → Decor
//   - object layers Rooms / SeatAnchors / CommutePaths present
//   - seat capacity: ≥ 20 anchors office_1, ≥ 40 office_2, ≥ 60 total, every
//     anchor inside its building's footprint (blueprint §3/§4)
//   - the 9 spec'd room names exactly, plus the additive named rooms from the
//     blueprint, each with the correct `building` property
//   - exactly one CommutePaths polyline with from/to properties, endpoints at
//     the two doors (blueprint §5)
//   - embedded tileset named `campus_tileset` (16 px tiles, image inline ref)
//
// The map JSON is read with node:fs (not a TS `import`) so `tsc --noEmit`
// never type-checks the multi-hundred-KB tile-data literal and no
// `resolveJsonModule` tsconfig change is needed. The path is resolved from
// the vitest root (`frontend/` — vitest.config lives there), not
// `import.meta.url`, because jsdom rewrites module URLs to http://.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Minimal Tiled JSON shapes (only what the assertions touch) ────────────

interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

interface TiledObject {
  id: number;
  name: string;
  x: number;
  y: number;
  point?: boolean;
  polygon?: Array<{ x: number; y: number }>;
  polyline?: Array<{ x: number; y: number }>;
  properties?: TiledProperty[];
}

interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup';
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
}

interface TiledTileset {
  name: string;
  firstgid: number;
  image?: string;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
}

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: string;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

const campus = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/assets/campus.json'), 'utf8'),
) as TiledMap;

// ── Blueprint constants (campus-layout.md §2–§5) ──────────────────────────

const TILE = 16;
const MAP_W = 200;
const MAP_H = 140;

/** Tile layers in required draw order (§2). */
const TILE_LAYER_ORDER = ['Ground', 'Streets', 'Floors', 'Walls', 'Furniture', 'Decor'];

/** Building footprints in TILE coords, inclusive-exclusive rects (§3/§4). */
const FOOTPRINTS: Record<string, Array<{ x0: number; y0: number; x1: number; y1: number }>> = {
  office_2: [
    { x0: 24, y0: 16, x1: 100, y1: 40 }, // top wing
    { x0: 24, y0: 40, x1: 56, y1: 92 }, // west wing
  ],
  office_1: [{ x0: 116, y0: 100, x1: 188, y1: 128 }],
};

/** The 9 spec'd room names (tasks.md / §8) with their buildings. */
const SPEC_ROOMS: Record<string, string> = {
  corkscrew: 'office_1',
  spiderweb: 'office_1',
  skier: 'office_1',
  Office: 'office_1',
  'deco-office-chair': 'office_2',
  frog: 'office_2',
  bongo: 'office_2',
  bridge: 'office_2',
  'the executive Office': 'office_2',
};

/** Additive named rooms from the blueprint (§3/§4) with their buildings. */
const BLUEPRINT_ROOMS: Record<string, string> = {
  'Phone Booth': 'office_2',
  'swinging boat': 'office_2',
  'space fighter': 'office_2',
  'Break Room': 'office_1',
  'Break-room': 'office_1',
  'Restroom Men': 'office_1',
  Restroom: 'office_1',
};

/** Commute endpoints (§5): tile centers of the two doors, world px. */
const DOOR_OFFICE_2 = { x: 47 * TILE + 8, y: 92 * TILE + 8 };
const DOOR_OFFICE_1 = { x: 149 * TILE + 8, y: 100 * TILE + 8 };
/** "Near" tolerance for door endpoints (±1.5 tiles). */
const DOOR_TOLERANCE_PX = 24;

// ── Helpers ───────────────────────────────────────────────────────────────

function objectLayer(name: string): TiledLayer {
  const layer = campus.layers.find((l) => l.type === 'objectgroup' && l.name === name);
  expect(layer, `object layer "${name}" must exist`).toBeDefined();
  return layer as TiledLayer;
}

function propValue(obj: TiledObject, prop: string): unknown {
  return obj.properties?.find((p) => p.name === prop)?.value;
}

/** Is the world-px point inside any of the building's footprint rects? */
function insideFootprint(building: string, x: number, y: number): boolean {
  const rects = FOOTPRINTS[building];
  if (rects === undefined) return false;
  return rects.some(
    (r) => x >= r.x0 * TILE && x < r.x1 * TILE && y >= r.y0 * TILE && y < r.y1 * TILE,
  );
}

// ── §2 Global frame ───────────────────────────────────────────────────────

describe('campus.json — global frame (§2)', () => {
  it('is an orthogonal 200×140 map of 16 px tiles (3200×2240 px world)', () => {
    expect(campus.orientation).toBe('orthogonal');
    expect(campus.width).toBe(MAP_W);
    expect(campus.height).toBe(MAP_H);
    expect(campus.tilewidth).toBe(TILE);
    expect(campus.tileheight).toBe(TILE);
  });

  it('has the six tile layers in exact draw order starting with Ground', () => {
    const tileLayerNames = campus.layers.filter((l) => l.type === 'tilelayer').map((l) => l.name);
    expect(tileLayerNames).toEqual(TILE_LAYER_ORDER);
  });

  it('sizes every tile layer to the full map with a complete data array', () => {
    for (const layer of campus.layers.filter((l) => l.type === 'tilelayer')) {
      expect(layer.width, `${layer.name}.width`).toBe(MAP_W);
      expect(layer.height, `${layer.name}.height`).toBe(MAP_H);
      expect(layer.data?.length, `${layer.name}.data length`).toBe(MAP_W * MAP_H);
    }
  });

  it('has the three required object layers', () => {
    objectLayer('Rooms');
    objectLayer('SeatAnchors');
    objectLayer('CommutePaths');
  });
});

// ── §8 Seat capacity + placement ──────────────────────────────────────────

describe('campus.json — seat anchors (§3/§4/§8)', () => {
  const anchors = objectLayer('SeatAnchors').objects ?? [];

  it('meets the FR-021 capacity invariant (≥20 / ≥40 / ≥60)', () => {
    const byBuilding = new Map<string, number>();
    for (const a of anchors) {
      const b = propValue(a, 'building');
      expect(typeof b, `anchor ${a.name} building property`).toBe('string');
      byBuilding.set(b as string, (byBuilding.get(b as string) ?? 0) + 1);
    }
    expect(byBuilding.get('office_1') ?? 0).toBeGreaterThanOrEqual(20);
    expect(byBuilding.get('office_2') ?? 0).toBeGreaterThanOrEqual(40);
    expect(anchors.length).toBeGreaterThanOrEqual(60);
  });

  it('places every anchor inside its building footprint (§3/§4 rects)', () => {
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const building = propValue(a, 'building') as string;
      expect(
        insideFootprint(building, a.x, a.y),
        `anchor ${a.name} at (${a.x},${a.y}) must lie inside ${building}`,
      ).toBe(true);
    }
  });

  it('exports anchors as Tiled point objects', () => {
    for (const a of anchors) {
      expect(a.point, `anchor ${a.name} must be a point object`).toBe(true);
    }
  });
});

// ── §8 Named rooms ────────────────────────────────────────────────────────

describe('campus.json — named rooms (§3/§4/§8)', () => {
  const rooms = objectLayer('Rooms').objects ?? [];
  const roomsByName = new Map<string, TiledObject[]>();
  for (const r of rooms) {
    const list = roomsByName.get(r.name) ?? [];
    list.push(r);
    roomsByName.set(r.name, list);
  }

  it.each(Object.entries(SPEC_ROOMS))(
    'has the spec room "%s" with building=%s',
    (name, building) => {
      const matches = roomsByName.get(name) ?? [];
      expect(matches.length, `room "${name}" must exist exactly once`).toBe(1);
      expect(propValue(matches[0], 'building')).toBe(building);
    },
  );

  it.each(Object.entries(BLUEPRINT_ROOMS))(
    'has the blueprint room "%s" with building=%s',
    (name, building) => {
      const matches = roomsByName.get(name) ?? [];
      expect(matches.length, `room "${name}" must exist exactly once`).toBe(1);
      expect(propValue(matches[0], 'building')).toBe(building);
    },
  );

  it('tags every room polygon with a known building', () => {
    expect(rooms.length).toBeGreaterThan(0);
    for (const r of rooms) {
      const b = propValue(r, 'building');
      expect(['office_1', 'office_2'], `room "${r.name}" building tag`).toContain(b);
      expect(r.polygon, `room "${r.name}" must be a polygon`).toBeDefined();
      expect(r.polygon?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── §5 Commute path ───────────────────────────────────────────────────────

describe('campus.json — commute path (§5/§8)', () => {
  const paths = objectLayer('CommutePaths').objects ?? [];

  it('has exactly one polyline with from/to properties', () => {
    expect(paths.length).toBe(1);
    const p = paths[0];
    expect(p.polyline, 'commute object must be a polyline').toBeDefined();
    expect(p.polyline?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(propValue(p, 'from')).toBe('office_2');
    expect(propValue(p, 'to')).toBe('office_1');
  });

  it('starts at the Office #2 door and ends at the Office #1 door (§5)', () => {
    const p = paths[0];
    const pts = (p.polyline ?? []).map((v) => ({ x: p.x + v.x, y: p.y + v.y }));
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(Math.abs(first.x - DOOR_OFFICE_2.x)).toBeLessThanOrEqual(DOOR_TOLERANCE_PX);
    expect(Math.abs(first.y - DOOR_OFFICE_2.y)).toBeLessThanOrEqual(DOOR_TOLERANCE_PX);
    expect(Math.abs(last.x - DOOR_OFFICE_1.x)).toBeLessThanOrEqual(DOOR_TOLERANCE_PX);
    expect(Math.abs(last.y - DOOR_OFFICE_1.y)).toBeLessThanOrEqual(DOOR_TOLERANCE_PX);
  });
});

// ── §8 Embedded tileset ───────────────────────────────────────────────────

describe('campus.json — embedded tileset (§2/§8)', () => {
  it('embeds exactly one tileset named campus_tileset (16 px tiles)', () => {
    expect(campus.tilesets.length).toBe(1);
    const ts = campus.tilesets[0];
    expect(ts.name).toBe('campus_tileset');
    expect(ts.firstgid).toBe(1);
    // Embedded = the tileset definition (image reference + geometry) lives
    // inline in the map JSON, not in an external .tsx file.
    expect(ts.image).toBe('campus_tileset.png');
    expect(ts.tilewidth).toBe(TILE);
    expect(ts.tileheight).toBe(TILE);
    expect(ts.columns ?? 0).toBeGreaterThan(0);
    expect(ts.tilecount ?? 0).toBeGreaterThan(0);
  });

  it('references only gids the tileset actually contains', () => {
    const ts = campus.tilesets[0];
    const maxGid = ts.firstgid + (ts.tilecount ?? 0) - 1;
    // One assertion over collected violations — a per-cell expect() across
    // 6 × 28 000 cells blows the 5 s test timeout.
    const violations: string[] = [];
    for (const layer of campus.layers.filter((l) => l.type === 'tilelayer')) {
      (layer.data ?? []).forEach((gid, i) => {
        if (gid !== 0 && !(Number.isInteger(gid) && gid >= ts.firstgid && gid <= maxGid)) {
          violations.push(`${layer.name}[${i}] = ${JSON.stringify(gid)}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
