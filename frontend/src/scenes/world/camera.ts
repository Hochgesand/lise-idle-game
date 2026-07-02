// T042 — Pure camera model for the campus world (Phase 3).
//
// All camera *math* lives here as plain, pure functions of their inputs — no
// Phaser, no DOM, no `Date.now()`. This keeps the FR-024 / SC-009 logic
// unit-testable in Vitest (see camera.test.ts). The Phaser glue that applies
// these values to a real `Phaser.Camera` (`setBounds`, `setScroll`, `setZoom`)
// lives in CampusScene later and is integration-level (`tsc -b` + `vite build`).
//
// Design (research: "Camera & legibility (FR-024)" decision):
//   - Boot: fit & center the ACTIVE office's `Rooms` bounds — a whole-campus fit
//     would always be overridden by the minZoom clamp, so we frame the building
//     the player is actually in. Recomputed on viewport resize.
//   - Pan: pointer drag moves the scroll, clamped to the map bounds.
//   - Zoom: wheel/pinch, clamped to [minZoom, maxZoom].
//
// Coordinate convention (matches Phaser's camera model):
//   - `zoom` scales world→screen: 1 world px occupies `zoom` screen px, so the
//     viewport shows `width / zoom` × `height / zoom` world px.
//   - `scrollX/Y` is the WORLD coordinate at the viewport's top-left edge.
//   - The visible world region is therefore
//     `[scrollX, scrollX + width/zoom] × [scrollY, scrollY + height/zoom]`.

// ---------------------------------------------------------------------------
// FR-024 zoom-range constants
// ---------------------------------------------------------------------------
//
// Avatars must stay individually tappable at >= ~24 CSS px at minimum zoom
// (FR-024 / SC-009). With the Phase 3 16 px base tile (16 px avatar frames),
// minZoom = 24 / 16 = 1.5. The name label + a padded pointer hit-area push the
// effective touch target toward the 44 px platform guideline. maxZoom ≈ 4
// (64 px tiles) stays crisp under `pixelArt: true`.

/** Avatar sprite frame size (px) — Phase 3 16 px base tile. */
export const AVATAR_FRAME_PX = 16;

/** FR-024: minimum individually-tappable avatar size, in CSS px. */
export const MIN_TAP_TARGET_PX = 24;

/** minZoom derived from the FR-024 tap-size requirement: 24 / 16 = 1.5. */
export const MIN_ZOOM: number = MIN_TAP_TARGET_PX / AVATAR_FRAME_PX;

/** maxZoom ≈ 4 (64 px tiles), crisp under `pixelArt: true`. */
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

/** Clamp a zoom factor into the FR-024 range `[MIN_ZOOM, MAX_ZOOM]`. */
export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/**
 * The world width/height visible through the viewport at a given zoom
 * (`viewport / zoom`).
 */
function visibleSize(viewportPx: number, zoom: number): number {
  return viewportPx / zoom;
}

// ---------------------------------------------------------------------------
// bootCamera — fit & center the ACTIVE office
// ---------------------------------------------------------------------------

/**
 * Boot fit/center on the active office's `Rooms` bounds:
 *
 *   zoom = clamp(min(viewportW / officeW, viewportH / officeH), minZoom, maxZoom)
 *
 * then center the office in the viewport. Pure: a pure function of the viewport
 * and office bounds. (The Phaser glue calls `setBounds(0,0,mapW,mapH)` and
 * applies the returned scroll/zoom in CampusScene.)
 */
export function bootCamera(viewport: Viewport, office: Rect): CameraState {
  const zoom = clampZoom(
    Math.min(viewport.width / office.width, viewport.height / office.height),
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
// clampToMap — pan clamped to the map bounds
// ---------------------------------------------------------------------------

/**
 * Clamp an arbitrary camera's scroll so the visible region stays within the map
 * bounds. When the viewport (at this zoom) is larger than the map, the range is
 * allowed to go negative so the smaller map can sit centered rather than pinned
 * to the top-left.
 */
export function clampToMap(state: CameraState, map: WorldBounds): CameraState {
  const visibleW = visibleSize(state.width, state.zoom);
  const visibleH = visibleSize(state.height, state.zoom);
  const scrollX = clamp(state.scrollX, Math.min(0, map.width - visibleW), Math.max(0, map.width - visibleW));
  const scrollY = clamp(state.scrollY, Math.min(0, map.height - visibleH), Math.max(0, map.height - visibleH));
  return { ...state, scrollX, scrollY };
}

// ---------------------------------------------------------------------------
// panBy — pointer-drag pan, then clamp
// ---------------------------------------------------------------------------

/**
 * Apply a pointer drag (screen px) to the camera scroll and clamp to the map.
 * Dragging the pointer right/down moves the content with it, so scroll moves
 * opposite the pointer by `delta / zoom` (screen→world).
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
// applyZoom — wheel/pinch zoom clamped to [minZoom, maxZoom]
// ---------------------------------------------------------------------------

/**
 * Apply a new zoom, clamped to `[MIN_ZOOM, MAX_ZOOM]`, keeping the world point
 * under the viewport center fixed (zoom toward center), then re-clamp to the map
 * so the camera never drifts out of bounds. The focal-point math keeps a
 * wheel/pinch zoom feeling anchored rather than jumping.
 */
export function applyZoom(
  state: CameraState,
  nextZoom: number,
  map: WorldBounds,
): CameraState {
  const zoom = clampZoom(nextZoom);
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
): CameraState {
  return bootCamera(viewport, office);
}
