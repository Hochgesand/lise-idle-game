// T042 — Pure camera model for the campus world (Phase 3), extended for the
// Clash-of-Clans viewport on the real campus map (campus-layout.md §2 + §7).
//
// All camera *math* lives here as plain, pure functions of their inputs — no
// Phaser, no DOM, no `Date.now()`. This keeps the FR-024 / SC-009 logic
// unit-testable in Vitest (see camera.test.ts). The Phaser glue that applies
// these values to a real `Phaser.Camera` (`setBounds`, `setScroll`, `setZoom`)
// lives in CampusScene and is integration-level (`tsc -b` + `vite build`).
//
// Design (campus-layout.md §7 — "Camera / viewport (Clash-of-Clans feel)"):
//   - Boot: fit & center the ACTIVE office's `Rooms` bounds. Recomputed on
//     viewport resize.
//   - Pan: pointer drag moves the scroll, clamped to the map bounds; on any
//     axis where the scaled map is smaller than the viewport, the map sits
//     CENTERED (letterboxed) and panning that axis is a no-op.
//   - Zoom: wheel/pinch, clamped to [minZoomFor(viewport, map), MAX_ZOOM] —
//     the lower bound is the zoom at which the WHOLE campus exactly fits the
//     viewport (CoC-style zoom-out-to-fit; replaces the old fixed 1.5 floor).
//
// Coordinate convention (matches Phaser's camera model):
//   - `zoom` scales world→screen: 1 world px occupies `zoom` screen px, so the
//     viewport shows `width / zoom` × `height / zoom` world px.
//   - `scrollX/Y` is the WORLD coordinate at the viewport's top-left edge.
//   - The visible world region is therefore
//     `[scrollX, scrollX + width/zoom] × [scrollY, scrollY + height/zoom]`.

// ---------------------------------------------------------------------------
// Zoom-range constants
// ---------------------------------------------------------------------------

/**
 * Avatar sprite frame size (px) — Phase 3 16 px base tile. At far-out zoom
 * taps are for panning; interaction happens zoomed-in (§7, same as CoC), with
 * tap targets kept ≥ 44 px via the screen-space padded hit areas in avatars.ts.
 */
export const AVATAR_FRAME_PX = 16;

/** maxZoom ≈ 4 (64 px tiles). */
export const MAX_ZOOM = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Viewport dimensions in screen (CSS) px. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Whole-map size in world px (`map.widthInPixels` × `map.heightInPixels`). */
export interface WorldBounds {
  readonly width: number;
  readonly height: number;
}

/**
 * An axis-aligned rectangle in world px — the active office's `Rooms` bounds
 * read from the Tiled object layer.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pure camera state. `scrollX/Y` is the world point at the viewport top-left;
 * `zoom` is the world→screen scale; `width/height` is the viewport in screen px.
 */
export interface CameraState {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Clamp `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * §7: the zoom at which the WHOLE map exactly fits the viewport — the smaller
 * of the two viewport/map fit ratios, capped at {@link MAX_ZOOM} so the
 * `[minZoomFor, MAX_ZOOM]` clamp range stays valid even for a tiny map. This
 * is the lower zoom clamp (replaces the old fixed `MIN_ZOOM` 1.5 floor): the
 * user can always pinch/scroll out exactly to the full-map view and no further.
 */
export function minZoomFor(viewport: Viewport, map: WorldBounds): number {
  const fit = Math.min(viewport.width / map.width, viewport.height / map.height);
  return Math.min(fit, MAX_ZOOM);
}

/**
 * Clamp a zoom factor into `[minZoom, MAX_ZOOM]`. The lower bound is explicit
 * — pass `minZoomFor(viewport, map)` (§7 zoom-out-to-fit).
 */
export function clampZoom(zoom: number, minZoom: number): number {
  return clamp(zoom, Math.min(minZoom, MAX_ZOOM), MAX_ZOOM);
}

/**
 * The world width/height visible through the viewport at a given zoom
 * (`viewport / zoom`).
 */
function visibleSize(viewportPx: number, zoom: number): number {
  return viewportPx / zoom;
}

/**
 * Clamp one scroll axis: pin to `[0, map - visible]` when the scaled map is
 * larger than the viewport; otherwise CENTER the (smaller) map in the viewport
 * — `(map - visible) / 2`, a fixed negative offset, so there is never void off
 * one edge and panning that axis is a no-op (§7 centered letterboxing).
 */
function clampScrollAxis(scroll: number, mapPx: number, visiblePx: number): number {
  if (mapPx <= visiblePx) return (mapPx - visiblePx) / 2;
  return clamp(scroll, 0, mapPx - visiblePx);
}

// ---------------------------------------------------------------------------
// bootCamera — fit & center the ACTIVE office
// ---------------------------------------------------------------------------

/**
 * Boot fit/center on the active office's `Rooms` bounds:
 *
 *   zoom = clamp(min(viewportW / officeW, viewportH / officeH),
 *                minZoomFor(viewport, map), MAX_ZOOM)
 *
 * then center the office in the viewport. Pure: a pure function of the
 * viewport, office bounds, and map bounds. (The Phaser glue calls
 * `setBounds(0,0,mapW,mapH)` and applies the returned scroll/zoom in
 * CampusScene, wrapping the result in `clampToMap`.)
 */
export function bootCamera(viewport: Viewport, office: Rect, map: WorldBounds): CameraState {
  const zoom = clampZoom(
    Math.min(viewport.width / office.width, viewport.height / office.height),
    minZoomFor(viewport, map),
  );
  const centerX = office.x + office.width / 2;
  const centerY = office.y + office.height / 2;
  const scrollX = centerX - viewport.width / (2 * zoom);
  const scrollY = centerY - viewport.height / (2 * zoom);
  return {
    scrollX,
    scrollY,
    zoom,
    width: viewport.width,
    height: viewport.height,
  };
}

// ---------------------------------------------------------------------------
// clampToMap — pan clamped to the map bounds, centered letterboxing
// ---------------------------------------------------------------------------

/**
 * Clamp an arbitrary camera's scroll so the visible region stays within the
 * map bounds. On any axis where the viewport (at this zoom) is larger than the
 * scaled map, the smaller map is CENTERED (fixed negative scroll) rather than
 * pinned to one edge — §7 centered letterboxing, so the full-map view never
 * shows void off a single side.
 */
export function clampToMap(state: CameraState, map: WorldBounds): CameraState {
  const visibleW = visibleSize(state.width, state.zoom);
  const visibleH = visibleSize(state.height, state.zoom);
  const scrollX = clampScrollAxis(state.scrollX, map.width, visibleW);
  const scrollY = clampScrollAxis(state.scrollY, map.height, visibleH);
  return { ...state, scrollX, scrollY };
}

// ---------------------------------------------------------------------------
// panBy — pointer-drag pan, then clamp
// ---------------------------------------------------------------------------

/**
 * Apply a pointer drag (screen px) to the camera scroll and clamp to the map.
 * Dragging the pointer right/down moves the content with it, so scroll moves
 * opposite the pointer by `delta / zoom` (screen→world). On a centered
 * (letterboxed) axis the clamp re-centers, making the pan a no-op there.
 */
export function panBy(
  state: CameraState,
  pointerDeltaX: number,
  pointerDeltaY: number,
  map: WorldBounds,
): CameraState {
  const moved: CameraState = {
    ...state,
    scrollX: state.scrollX - pointerDeltaX / state.zoom,
    scrollY: state.scrollY - pointerDeltaY / state.zoom,
  };
  return clampToMap(moved, map);
}

// ---------------------------------------------------------------------------
// applyZoom — wheel/pinch zoom clamped to [minZoomFor, MAX_ZOOM]
// ---------------------------------------------------------------------------

/**
 * Apply a new zoom, clamped to `[minZoomFor(viewport, map), MAX_ZOOM]` (§7:
 * the user can zoom out until the whole campus fits, and no further), keeping
 * the world point under the viewport center fixed (zoom toward center), then
 * re-clamp to the map so the camera never drifts out of bounds. The
 * focal-point math keeps a wheel/pinch zoom feeling anchored rather than
 * jumping; at the lower clamp the letterboxed axis centers via `clampToMap`.
 */
export function applyZoom(
  state: CameraState,
  nextZoom: number,
  map: WorldBounds,
): CameraState {
  const zoom = clampZoom(
    nextZoom,
    minZoomFor({ width: state.width, height: state.height }, map),
  );
  // World point currently under the viewport center.
  const centerX = state.scrollX + state.width / (2 * state.zoom);
  const centerY = state.scrollY + state.height / (2 * state.zoom);
  const recentered: CameraState = {
    ...state,
    zoom,
    scrollX: centerX - state.width / (2 * zoom),
    scrollY: centerY - state.height / (2 * zoom),
  };
  return clampToMap(recentered, map);
}

// ---------------------------------------------------------------------------
// recomputeOnResize — re-fit on viewport resize
// ---------------------------------------------------------------------------

/**
 * Recompute the camera state for new viewport dimensions by re-fitting the
 * active office (the documented boot behavior, re-run on
 * `Scale.RESIZE`). Returns a fresh, centered fit; the Phaser glue re-applies it
 * on `this.scale.on('resize', ...)`.
 */
export function recomputeOnResize(
  viewport: Viewport,
  office: Rect,
  map: WorldBounds,
): CameraState {
  return bootCamera(viewport, office, map);
}
