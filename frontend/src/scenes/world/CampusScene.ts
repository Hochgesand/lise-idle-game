// T046 — Phaser campus scene: tilemap + camera/seats/avatars wiring.
//
// Supersedes the retired 001 `OfficeScene.ts` (deleted in T051). Loads the
// real campus map (`frontend/public/assets/campus.json`, 200×140 tiles × 16
// px → 3200×2240 px world, campus-layout.md §2), renders ALL its tile layers
// in array order (`Ground` → `Streets` → `Floors` → `Walls` → `Furniture` →
// `Decor`), and wires the THREE pure world modules onto a real Phaser scene:
//
//   - camera.ts — boot fit/center on the ACTIVE office's `Rooms` bounds,
//     pointer-drag pan, wheel + pinch zoom, resize recompute. Every value that
//     touches `this.cameras.main` is derived by the pure functions first, so
//     the FR-024 math stays unit-tested (camera.test.ts).
//   - seats.ts — read the Tiled `SeatAnchors` object layer and run the pure
//     `extractSeatAnchors`; the anchors are exposed via `getSeatAnchors()` and
//     the seat ASSIGNMENT happens outside the scene (US1/T065: main.ts maps
//     presence → seats → renders via scenes/world/presenceView.ts).
//   - avatars.ts — drive an `AvatarLayer` from the presence model. main.ts
//     (T065) pushes `AvatarRender[]` through the `updateAvatars(renders)` hook
//     after the presence snapshot fetch and on every `/topic/presence` delta.
//
// ## Asset keys / tileset-name contract (mirrors retired OfficeScene by design)
// `campus.json` embeds one tileset named `campus_tileset` (image
// `campus_tileset.png`). `addTilesetImage` is called with
// that exact name; a mismatch returns null and we THROW (research: World &
// tilemap decision — "a create() that throws on tileset-name mismatch, as 001
// did by design") so a map/asset desync fails loud at boot, not as a silent
// blank canvas.
//
// ## Integration-level
// The Phaser glue here is exercised by `tsc --noEmit -p .` + `vite build`
// (Constitution Principle III); the pure modules it composes carry the
// unit-testable logic. No `Date.now()`, no network, no localStorage here —
// CampusScene renders what it is handed; the loop (main.ts, T051) owns the
// clock and pushes presence via the hooks below.

import Phaser from 'phaser';
import {
  bootCamera,
  clampToMap,
  panBy,
  applyZoom,
  recomputeOnResize,
  type CameraState,
  type Viewport,
  type Rect,
  type WorldBounds,
} from './camera';
import { extractSeatAnchors, readBuildingProperty, type RawSeatAnchor, type SeatAnchor } from './seats';
import { extractCommutePath, type CommutePath, type RawCommutePathObject } from './commute';
import { AvatarLayer, AVATAR_TEXTURE, type AvatarRender, type AvatarUpdateOptions } from './avatars';

// ── Asset keys (mirrored by the README + the campus.json embedded tileset) ──

/** Phaser tilemap key for `assets/campus.json` (loaded in preload). */
export const CAMPUS_MAP_KEY = 'campus-map';
/** Phaser image key for `assets/campus_tileset.png` (loaded in preload). */
export const CAMPUS_TILESET_KEY = 'campus-tileset';

/**
 * The avatar spritesheet key. Imported from `avatars.ts` (`AVATAR_TEXTURE`) as
 * the SINGLE source of truth — the `AvatarLayer` renders sprites with the same
 * constant, so loading under a different local key would silently break avatar
 * rendering (missing-texture placeholder). Kept re-exported for callers/tests.
 */
export const AVATARS_KEY = AVATAR_TEXTURE;

/**
 * The tileset NAME embedded in campus.json (`tilesets[0].name`). MUST match
 * what `addTilesetImage` is called with or the layers fail to render — a
 * mismatch is a map/asset desync and throws loud (research: World decision).
 */
const CAMPUS_TILESET_NAME = 'campus_tileset';

/** Per-frame zoom factor for one mouse-wheel notch (≈15% per tick). */
const WHEEL_ZOOM_FACTOR = 1.15;

/**
 * The default active office CampusScene boots the camera on (the fresh-player
 * starting office). The loop re-frames via {@link setActiveOffice} whenever the
 * player's `state.activeOffice` changes (US3/T082), keeping this scene
 * decoupled from the sim state.
 */
const DEFAULT_ACTIVE_OFFICE = 'office_1';

// ── Scene ────────────────────────────────────────────────────────────────

/**
 * The top-down pixel-art campus scene for Phase 3.
 *
 * Loads the campus tilemap, renders its tile layer(s), wires the pure camera /
 * seats / avatars modules, and exposes hooks ({@link updateAvatars},
 * {@link setActiveOffice}) the game loop uses to push live presence (US1/T065)
 * and to re-frame the camera when the active office changes.
 *
 * Scene key: `'CampusScene'`. Registered in the Phaser game config in T051.
 */
export class CampusScene extends Phaser.Scene {
  /** The parsed campus tilemap (set in create). */
  private map!: Phaser.Tilemaps.Tilemap;
  /** Whole-map world bounds (`map.widthInPixels` × `map.heightInPixels`). */
  private mapBounds!: WorldBounds;
  /** Parsed seat anchors from the `SeatAnchors` object layer (per-building). */
  private seatAnchors: SeatAnchor[] = [];
  /** Parsed `CommutePaths` route (T080); null when the map carries none. */
  private commutePath: CommutePath | null = null;
  /** The avatar layer; presence is pushed via {@link updateAvatars}. */
  private avatarLayer!: AvatarLayer;

  /** The office the camera is currently framed on (`setActiveOffice` updates). */
  private activeOffice: string = DEFAULT_ACTIVE_OFFICE;
  /** Live camera state derived from the pure module; applied to cameras.main. */
  private cam!: CameraState;

  /** Screen-space origin of the current single-pointer drag (null = none). */
  private dragOrigin: { x: number; y: number } | null = null;
  /** Previous pointer-pair distance during a pinch (null = not pinching). */
  private pinchDistance: number | null = null;

  constructor() {
    super('CampusScene');
  }

  // ── preload: campus.json + embedded tileset + avatars ──────────────────

  /**
   * Load the campus tilemap JSON, the embedded tileset image, and the avatar
   * spritesheet. Phaser serves `public/` at root, so the URLs are `assets/...`.
   */
  preload(): void {
    this.load.tilemapTiledJSON(CAMPUS_MAP_KEY, 'assets/campus.json');
    this.load.image(CAMPUS_TILESET_KEY, 'assets/campus_tileset.png');
    // avatars.png is 128×16 = 8 frames of 16×16 (see avatars.ts). Loaded as a
    // spritesheet under AVATAR_TEXTURE (imported from avatars.ts) so frame
    // indices 0..7 resolve and the key matches what `AvatarLayer` renders with.
    this.load.spritesheet(AVATAR_TEXTURE, 'assets/avatars.png', {
      frameWidth: 16,
      frameHeight: 16,
    });
  }

  // ── create: tilemap + camera + seats + avatars + input ─────────────────

  /**
   * Build the campus: tilemap layers, camera fit/center on the active office
   * with pan/zoom input, parsed seat anchors, and an empty avatar layer
   * (presence arrives with US1/T065 via {@link updateAvatars}).
   */
  create(): void {
    // ── Tilemap ──────────────────────────────────────────────────────────
    this.map = this.make.tilemap({ key: CAMPUS_MAP_KEY });

    // Tileset-name contract: the embedded name MUST match, else throw (mirrors
    // the retired OfficeScene by design — a desync fails loud, not silently).
    const tileset = this.map.addTilesetImage(CAMPUS_TILESET_NAME, CAMPUS_TILESET_KEY);
    if (tileset === null) {
      throw new Error(
        `CampusScene: addTilesetImage returned null — tileset name "${CAMPUS_TILESET_NAME}" does not match campus.json. Check tilesets[0].name.`,
      );
    }

    // Render EVERY tile layer in authoring order (campus-layout.md §2:
    // `Ground` → `Streets` → `Floors` → `Walls` → `Furniture` → `Decor`).
    // Looping `map.layers` renders them all in array order and skips object
    // layers, which live in `map.objects`, not `map.layers`.
    for (const layerData of this.map.layers) {
      this.map.createLayer(layerData.name, tileset, 0, 0);
    }

    // ── Camera: bounds + boot fit/center on the active office ────────────
    this.mapBounds = {
      width: this.map.widthInPixels,
      height: this.map.heightInPixels,
    };
    this.cameras.main.setBounds(0, 0, this.mapBounds.width, this.mapBounds.height);
    this.bootCameraOnActiveOffice();

    // ── Seats: parse the SeatAnchors object layer via the pure module ─────
    // Exposed via getSeatAnchors(); the deterministic assignment runs in the
    // pure presenceView mapping (US1/T065) driven from main.ts.
    this.seatAnchors = this.parseSeatAnchors();

    // ── Commute route: parse the CommutePaths polyline (T080) ─────────────
    // The pure `extractCommutePath` is defensive (null on a missing/malformed
    // layer — commuters are simply skipped; presence is advisory, FR-016).
    this.commutePath = this.parseCommutePath();

    // ── Avatars: empty until main.ts pushes presence renders (US1/T065) ───
    this.avatarLayer = new AvatarLayer(this);
    this.avatarLayer.update([]);

    // ── Input: pointer-drag pan + wheel/pinch zoom (pure module math) ────
    // Two extra pointers enable two-finger pinch on touch devices.
    this.input.addPointer(2);
    this.wireCameraInput();

    // ── Resize: re-fit the active office (Scale.RESIZE mode fires this) ───
    // `this.scale` is the GAME-level Scale manager — unlike scene-local input
    // listeners it is NOT auto-cleaned on scene shutdown, so detach on shutdown
    // to avoid a stale-scene callback leak if the scene is ever restarted.
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });

    // Flat dark background behind the map edges (at the whole-campus-fit zoom
    // the map letterboxes CENTERED on the non-binding axis — §7). Matches the
    // retired OfficeScene.
    this.cameras.main.setBackgroundColor('#0f172a');
  }

  // ── Per-frame: refresh the avatar layer's label-zoom rule ───────────────

  /**
   * Phaser calls this every frame. We push the live camera zoom into the avatar
   * layer so its FR-005 × FR-024 label rule (persistent at/above the threshold,
   * on tap/hover below it) tracks the current zoom. Cheap: one boolean write
   * per avatar.
   */
  update(): void {
    this.avatarLayer.setZoom(this.cameras.main.zoom);
  }

  // ── Public hooks (the loop pushes presence + office changes here) ───────

  /**
   * Reconcile the rendered avatars against `renders` (the loop builds these
   * from the presence model + seat/commute assignments in US1/T065 & US3/T080).
   * Adds containers for new colleagues, removes departed ones, updates the rest
   * in place — a live → lastSeen flip fades softly (T081; instant under
   * `opts.reducedMotion`). Safe to call with `[]` (the no-presence default).
   */
  updateAvatars(renders: ReadonlyArray<AvatarRender>, opts?: AvatarUpdateOptions): void {
    this.avatarLayer.update(renders, opts);
  }

  /**
   * Re-frame the camera on a different office's `Rooms` bounds and update the
   * active-office tracker. Called by the loop when the player switches offices
   * (US3/T082) and by the overlay's per-building quick-jump buttons (T047).
   * A no-op if the office is already active.
   */
  setActiveOffice(officeId: string): void {
    if (this.activeOffice === officeId) return;
    this.activeOffice = officeId;
    // Before create() has parsed the map there is nothing to re-frame yet —
    // create()'s own boot framing picks the updated office up (the loop may
    // sync the save's office before this scene finishes booting).
    if (this.map === undefined) return;
    this.bootCameraOnActiveOffice();
  }

  /** Read-only access to the parsed seat anchors (used by US1/T065 wiring). */
  getSeatAnchors(): ReadonlyArray<SeatAnchor> {
    return this.seatAnchors;
  }

  /**
   * The parsed `CommutePaths` route (T080), or null when the map carries no
   * usable polyline. main.ts passes it into `buildAvatarRenders`'s commute
   * context so observed commuters travel the street between the buildings.
   */
  getCommutePath(): CommutePath | null {
    return this.commutePath;
  }

  // ── Camera internals ───────────────────────────────────────────────────

  /**
   * Fit & center the camera on the ACTIVE office's `Rooms` bounds via the pure
   * `bootCamera`, then clamp to the map. Applied to `cameras.main`.
   */
  private bootCameraOnActiveOffice(): void {
    const viewport: Viewport = {
      width: this.scale.width,
      height: this.scale.height,
    };
    this.cam = clampToMap(bootCamera(viewport, this.activeOfficeBounds(), this.mapBounds), this.mapBounds);
    this.applyCamera();
  }

  /** Push the pure camera state onto the real Phaser camera. */
  private applyCamera(): void {
    this.cameras.main.setScroll(this.cam.scrollX, this.cam.scrollY);
    this.cameras.main.setZoom(this.cam.zoom);
  }

  /**
   * Wire pointer-drag pan + wheel/pinch zoom. Each gesture is translated by the
   * pure camera functions (`panBy` / `applyZoom`), keeping the clamping math in
   * the tested module.
   */
  private wireCameraInput(): void {
    // A fresh press starts a new gesture; clear any stale drag/pinch state.
    this.input.on('pointerdown', () => {
      this.dragOrigin = null;
      this.pinchDistance = null;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      const pinching = p1.isDown && p2.isDown;

      if (pinching) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDistance !== null && this.pinchDistance > 0) {
          this.zoomBy(this.cam.zoom * (dist / this.pinchDistance));
        }
        this.pinchDistance = dist;
        this.dragOrigin = null; // a pinch supersedes a single-pointer drag
        return;
      }

      if (!pointer.isDown) return;

      // Single-pointer pan: move the world by the screen-space pointer delta.
      this.pinchDistance = null;
      if (this.dragOrigin === null) {
        this.dragOrigin = { x: pointer.x, y: pointer.y };
        return;
      }
      const dx = pointer.x - this.dragOrigin.x;
      const dy = pointer.y - this.dragOrigin.y;
      this.cam = panBy(this.cam, dx, dy, this.mapBounds);
      this.dragOrigin = { x: pointer.x, y: pointer.y };
      this.applyCamera();
    });

    // End of a gesture: clear state so the next press starts fresh.
    this.input.on('pointerup', () => {
      this.dragOrigin = null;
      this.pinchDistance = null;
    });

    // Mouse wheel: zoom in (deltaY < 0) / out (deltaY > 0) by one factor tick.
    this.input.on(
      'wheel',
      (
        _pointer: Phaser.Input.Pointer,
        _currentlyOver: Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
        _deltaZ: number,
      ) => {
        const factor = deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
        this.zoomBy(this.cam.zoom * factor);
      },
    );
  }

  /** Apply a new (unclamped) zoom via the pure `applyZoom`, then sync. */
  private zoomBy(nextZoom: number): void {
    this.cam = applyZoom(this.cam, nextZoom, this.mapBounds);
    this.applyCamera();
  }

  /**
   * Viewport resize → re-fit the active office (the documented boot behavior,
   * re-run). Recomputed by the pure `recomputeOnResize`, then clamped to map.
   */
  private onResize(gameSize: Phaser.Structs.Size): void {
    if (this.map === undefined) return; // guard before create() completes
    const viewport: Viewport = { width: gameSize.width, height: gameSize.height };
    this.cam = clampToMap(recomputeOnResize(viewport, this.activeOfficeBounds(), this.mapBounds), this.mapBounds);
    this.applyCamera();
  }

  // ── Rooms/SeatAnchors object-layer parsing ─────────────────────────────

  /**
   * The active office's `Rooms` bounds as a world-space `Rect`: the union
   * bounding box of every room object tagged with the active office's
   * `building` property. Falls back to the whole map if no rooms match (a
   * map/office id desync) so the camera always frames something sensible.
   */
  private activeOfficeBounds(): Rect {
    const layer = this.map.getObjectLayer('Rooms');
    const rooms = layer?.objects ?? [];
    const matching = rooms.filter((o) => readBuildingProperty(o.properties) === this.activeOffice);

    if (matching.length === 0) {
      return { x: 0, y: 0, width: this.mapBounds.width, height: this.mapBounds.height };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of matching) {
      const b = objectBounds(o);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /** Parse the `SeatAnchors` object layer into normalized anchors. */
  private parseSeatAnchors(): SeatAnchor[] {
    const layer = this.map.getObjectLayer('SeatAnchors');
    // Bridge the Phaser object shape into the pure module's `RawSeatAnchor`
    // (x/y are optional on Phaser's type; default to 0 — a point object always
    // carries them).
    const raw: RawSeatAnchor[] = (layer?.objects ?? []).map((o) => ({
      x: o.x ?? 0,
      y: o.y ?? 0,
      name: o.name,
      properties: o.properties,
    }));
    return extractSeatAnchors(raw);
  }

  /** Parse the `CommutePaths` object layer into a route via the pure module. */
  private parseCommutePath(): CommutePath | null {
    const layer = this.map.getObjectLayer('CommutePaths');
    // Bridge the Phaser object shape into the pure module's raw shape (x/y
    // are optional on Phaser's type; polyline vertices are origin-relative).
    const raw: RawCommutePathObject[] = (layer?.objects ?? []).map((o) => ({
      x: o.x ?? 0,
      y: o.y ?? 0,
      polyline: o.polyline as RawCommutePathObject['polyline'],
      properties: o.properties,
    }));
    return extractCommutePath(raw);
  }
}

// ── Module-private helpers (Phaser-free object-layer parsing) ─────────────

/** A `{ x, y }` point as authored in Tiled polygon/polyline vertices. */
interface Point2D {
  x: number;
  y: number;
}

/**
 * World-space bounding box of a Tiled object. Supports polygon/polyline objects
 * (the `Rooms` are polygons) by taking the bbox of their vertices offset by the
 * object's own origin, and rectangle objects (width/height). Returns a
 * degenerate `{0,0,0,0}` rect for empty point objects.
 */
function objectBounds(o: Phaser.Types.Tilemaps.TiledObject): Rect {
  const ox = o.x ?? 0;
  const oy = o.y ?? 0;
  const verts = (o.polygon ?? o.polyline) as ReadonlyArray<Point2D> | undefined;

  if (verts !== undefined && verts.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of verts) {
      const px = ox + (p.x ?? 0);
      const py = oy + (p.y ?? 0);
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  return { x: ox, y: oy, width: o.width ?? 0, height: o.height ?? 0 };
}
