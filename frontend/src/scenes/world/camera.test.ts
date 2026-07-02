// T038 — Pure camera math for the campus world (Phase 3).
//
// The Phaser glue (applying scroll/zoom/bounds to a real `Phaser.Camera` in
// CampusScene) is integration-level, but the camera *model* — boot fit/center,
// pan/zoom clamping, and resize recompute — is pure math with no Phaser, no
// DOM, no `Date.now()`. Keeping it pure lets Vitest assert the FR-024 math
// directly (research: "Camera & legibility" decision; quickstart Scenario 8).
//
// Conventions:
//   - `zoom` scales world→screen: 1 world px occupies `zoom` screen px, so the
//     viewport shows `width / zoom` × `height / zoom` world px.
//   - `scrollX/Y` is the WORLD coordinate at the viewport's top-left edge.
//   - Distances are in screen px unless suffixed "world".

import { describe, it, expect } from 'vitest';
import {
  AVATAR_FRAME_PX,
  MIN_TAP_TARGET_PX,
  MIN_ZOOM,
  MAX_ZOOM,
  clamp,
  clampZoom,
  clampToMap,
  bootCamera,
  panBy,
  applyZoom,
  recomputeOnResize,
  type CameraState,
  type Viewport,
  type Rect,
  type WorldBounds,
} from './camera';

// ---------------------------------------------------------------------------
// FR-024 zoom-range constants — derived from the avatar tap-size requirement
// ---------------------------------------------------------------------------

describe('FR-024 zoom constants', () => {
  it('uses a 16 px avatar frame on the Phase 3 16 px base tile', () => {
    expect(AVATAR_FRAME_PX).toBe(16);
  });

  it('requires avatars to read at >= 24 CSS px at minimum zoom', () => {
    expect(MIN_TAP_TARGET_PX).toBe(24);
  });

  it('derives minZoom = 24 / 16 = 1.5', () => {
    expect(MIN_ZOOM).toBeCloseTo(1.5, 10);
  });

  it('caps zoom at ~4 (64 px tiles stay crisp under pixelArt)', () => {
    expect(MAX_ZOOM).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// clamp / clampZoom — the [minZoom, maxZoom] gate
// ---------------------------------------------------------------------------

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(2, 1, 4)).toBe(2);
  });

  it('clamps below the minimum', () => {
    expect(clamp(0, 1, 4)).toBe(1);
  });

  it('clamps above the maximum', () => {
    expect(clamp(9, 1, 4)).toBe(4);
  });

  it('handles the boundary values exactly', () => {
    expect(clamp(1, 1, 4)).toBe(1);
    expect(clamp(4, 1, 4)).toBe(4);
  });
});

describe('clampZoom', () => {
  it('keeps a value inside [minZoom, maxZoom]', () => {
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(3)).toBe(3);
  });

  it('clamps to minZoom (1.5) below the range', () => {
    expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(MIN_ZOOM);
  });

  it('clamps to maxZoom (4) above the range', () => {
    expect(clampZoom(8)).toBe(MAX_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
  });

  it('returns min/max exactly at the boundaries', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });
});

// ---------------------------------------------------------------------------
// bootCamera — fit & center the ACTIVE office's Rooms bounds
// ---------------------------------------------------------------------------

describe('bootCamera — fit & center on the active office', () => {
  const viewport: Viewport = { width: 800, height: 600 };

  it('fits the office exactly when the aspect ratio matches (zoom = fit)', () => {
    // office 400x300 in an 800x600 viewport → fit zoom = min(2, 2) = 2.
    const office: Rect = { x: 100, y: 100, width: 400, height: 300 };
    const cam = bootCamera(viewport, office);

    expect(cam.zoom).toBe(2);
    // Centered: the viewport spans exactly the office.
    expect(cam.width).toBe(800);
    expect(cam.height).toBe(600);
    expect(cam.scrollX).toBe(100);
    expect(cam.scrollY).toBe(100);
  });

  it('uses the smaller of the two fit ratios (height-constrained)', () => {
    // 800x600 viewport, office 800x150 → fit = min(1.0, 4.0) = 1.0 → clamped to 1.5.
    const office: Rect = { x: 0, y: 0, width: 800, height: 150 };
    const cam = bootCamera(viewport, office);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('centers on the office bounds (square office, square viewport)', () => {
    const squareView: Viewport = { width: 600, height: 600 };
    const office: Rect = { x: 200, y: 200, width: 200, height: 200 };
    const cam = bootCamera(squareView, office);
    // fit zoom = min(3, 3) = 3; office center = (300, 300);
    // scrollX = 300 - 600 / (2*3) = 300 - 100 = 200.
    expect(cam.zoom).toBe(3);
    expect(cam.scrollX).toBe(200);
    expect(cam.scrollY).toBe(200);
  });

  it('clamps zoom up to minZoom when the office is larger than the viewport', () => {
    const office: Rect = { x: 0, y: 0, width: 2000, height: 2000 };
    const cam = bootCamera(viewport, office);
    // fit = min(0.4, 0.3) = 0.3 → clamped to 1.5.
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('clamps zoom down to maxZoom when the office is tiny', () => {
    const office: Rect = { x: 0, y: 0, width: 32, height: 32 };
    const cam = bootCamera(viewport, office);
    // fit = min(25, 18.75) = 18.75 → clamped to 4.
    expect(cam.zoom).toBe(MAX_ZOOM);
  });

  it('never returns NaN/Infinity', () => {
    const office: Rect = { x: 5, y: 7, width: 123, height: 456 };
    const cam = bootCamera(viewport, office);
    expect(Number.isFinite(cam.zoom)).toBe(true);
    expect(Number.isFinite(cam.scrollX)).toBe(true);
    expect(Number.isFinite(cam.scrollY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clampToMap — pan clamped to the map bounds
// ---------------------------------------------------------------------------

describe('clampToMap — pan clamped to map bounds', () => {
  // A zoomed-in camera: viewport shows 400x300 world px of a 1000x800 map.
  const map: WorldBounds = { width: 1000, height: 800 };
  const base: CameraState = {
    scrollX: 100,
    scrollY: 100,
    zoom: 2,
    width: 800,
    height: 600,
  };

  it('leaves an in-bounds camera untouched', () => {
    const cam = clampToMap(base, map);
    // visible 400x300 fits well inside 1000x800; scroll 100 is within [0, 600].
    expect(cam.scrollX).toBe(100);
    expect(cam.scrollY).toBe(100);
    expect(cam.zoom).toBe(2);
  });

  it('clamps scrollX past the right edge to (mapW - visibleW)', () => {
    const cam = clampToMap({ ...base, scrollX: 900 }, map);
    // visibleW = 800 / 2 = 400 → max scrollX = 1000 - 400 = 600.
    expect(cam.scrollX).toBe(600);
  });

  it('clamps scrollX past the left edge to 0', () => {
    const cam = clampToMap({ ...base, scrollX: -50 }, map);
    expect(cam.scrollX).toBe(0);
  });

  it('clamps scrollY past the bottom edge to (mapH - visibleH)', () => {
    const cam = clampToMap({ ...base, scrollY: 700 }, map);
    // visibleH = 600 / 2 = 300 → max scrollY = 800 - 300 = 500.
    expect(cam.scrollY).toBe(500);
  });

  it('clamps scrollY past the top edge to 0', () => {
    const cam = clampToMap({ ...base, scrollY: -10 }, map);
    expect(cam.scrollY).toBe(0);
  });

  it('allows negative scroll when the map is smaller than the viewport', () => {
    // map 300x200 at zoom 1.5: visible = 533.3 x 400 → larger than the map.
    const smallMap: WorldBounds = { width: 300, height: 200 };
    const zoomedOut: CameraState = {
      scrollX: 100,
      scrollY: 100,
      zoom: 1.5,
      width: 800,
      height: 600,
    };
    const cam = clampToMap(zoomedOut, smallMap);
    // scrollX range = [min(0, 300 - 533.33), max(0, ...)] = [-233.33, 0].
    expect(cam.scrollX).toBe(0); // 100 clamps down to the max (0)
    const camLeft = clampToMap({ ...zoomedOut, scrollX: -9999 }, smallMap);
    expect(camLeft.scrollX).toBeCloseTo(300 - 800 / 1.5, 5); // the negative min
  });

  it('never mutates the input state', () => {
    const snapshot = { ...base };
    clampToMap(base, map);
    expect(base).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// panBy — pointer-drag pan, then clamp to map bounds
// ---------------------------------------------------------------------------

describe('panBy — drag pan clamped to map bounds', () => {
  const map: WorldBounds = { width: 1000, height: 800 };
  const start: CameraState = {
    scrollX: 100,
    scrollY: 100,
    zoom: 2,
    width: 800,
    height: 600,
  };

  it('moves scroll opposite to the pointer drag, scaled by 1/zoom', () => {
    // Dragging the pointer right by 100 px moves content right → scrollX drops
    // by 100 / 2 = 50.
    const cam = panBy(start, 100, 0, map);
    expect(cam.scrollX).toBe(50);
    expect(cam.scrollY).toBe(100);
  });

  it('moves scrollY for a vertical drag', () => {
    const cam = panBy(start, 0, 60, map);
    expect(cam.scrollY).toBe(100 - 60 / 2);
  });

  it('clamps the result so the camera never leaves the map', () => {
    // A huge drag would push scrollX far below 0 → clamped to 0.
    const cam = panBy(start, 5000, 0, map);
    expect(cam.scrollX).toBe(0);
    // And a huge negative drag clamps to the right edge (600).
    const camRight = panBy(start, -5000, 0, map);
    expect(camRight.scrollX).toBe(600);
  });

  it('keeps zoom and viewport size unchanged', () => {
    const cam = panBy(start, 100, 100, map);
    expect(cam.zoom).toBe(2);
    expect(cam.width).toBe(800);
    expect(cam.height).toBe(600);
  });

  it('does not mutate the input state', () => {
    const snapshot = { ...start };
    panBy(start, 100, 0, map);
    expect(start).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// applyZoom — wheel/pinch zoom clamped to [minZoom, maxZoom], center-anchored
// ---------------------------------------------------------------------------

describe('applyZoom — clamped zoom toward the viewport center', () => {
  const map: WorldBounds = { width: 4000, height: 4000 };
  const start: CameraState = {
    scrollX: 100,
    scrollY: 100,
    zoom: 2,
    width: 800,
    height: 600,
  };

  it('clamps a too-large zoom down to maxZoom', () => {
    const cam = applyZoom(start, 50, map);
    expect(cam.zoom).toBe(MAX_ZOOM);
  });

  it('clamps a too-small zoom up to minZoom', () => {
    const cam = applyZoom(start, 0.2, map);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('keeps the world point under the viewport center fixed', () => {
    const cam = applyZoom(start, 3, map);
    // Center world point before: (100 + 800/4, 100 + 600/4) = (300, 250).
    const centerXAfter = cam.scrollX + cam.width / (2 * cam.zoom);
    const centerYAfter = cam.scrollY + cam.height / (2 * cam.zoom);
    expect(centerXAfter).toBeCloseTo(300, 5);
    expect(centerYAfter).toBeCloseTo(250, 5);
  });

  it('clamps the resulting scroll back within the map bounds', () => {
    const smallMap: WorldBounds = { width: 500, height: 500 };
    const cam = applyZoom(start, 4, smallMap);
    // After zooming to 4 the view is 200x150 world; scroll must stay in-bounds.
    expect(cam.scrollX).toBeGreaterThanOrEqual(0);
    expect(cam.scrollY).toBeGreaterThanOrEqual(0);
    expect(cam.scrollX + cam.width / cam.zoom).toBeLessThanOrEqual(500);
    expect(cam.scrollY + cam.height / cam.zoom).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// recomputeOnResize — re-fit the active office for new viewport dimensions
// ---------------------------------------------------------------------------

describe('recomputeOnResize — recompute camera state for a new viewport', () => {
  const office: Rect = { x: 100, y: 100, width: 400, height: 300 };

  it('re-fits the office bounds for the new viewport', () => {
    const portrait: Viewport = { width: 375, height: 812 };
    const cam = recomputeOnResize(portrait, office);
    // fit = min(375/400, 812/300) = min(0.9375, 2.706) = 0.9375 → clamped 1.5.
    expect(cam.zoom).toBe(MIN_ZOOM);
    expect(cam.width).toBe(375);
    expect(cam.height).toBe(812);
  });

  it('matches bootCamera for the same viewport + office', () => {
    const viewport: Viewport = { width: 1280, height: 720 };
    expect(recomputeOnResize(viewport, office)).toEqual(
      bootCamera(viewport, office),
    );
  });

  it('re-centers on the office center', () => {
    const viewport: Viewport = { width: 1600, height: 1200 };
    const cam = recomputeOnResize(viewport, office);
    // fit = min(4, 4) = 4 → zoom 4 (max). office center = (300, 250).
    expect(cam.zoom).toBe(MAX_ZOOM);
    const centerX = cam.scrollX + cam.width / (2 * cam.zoom);
    const centerY = cam.scrollY + cam.height / (2 * cam.zoom);
    expect(centerX).toBeCloseTo(300, 5);
    expect(centerY).toBeCloseTo(250, 5);
  });

  it('adapts as the viewport changes between calls', () => {
    const a = recomputeOnResize({ width: 800, height: 600 }, office);
    const b = recomputeOnResize({ width: 400, height: 300 }, office);
    // Smaller viewport → larger fit zoom, distinct scroll.
    expect(a.zoom).not.toBe(b.zoom);
  });

  it('never returns NaN/Infinity', () => {
    const cam = recomputeOnResize({ width: 375, height: 812 }, office);
    expect(Number.isFinite(cam.zoom)).toBe(true);
    expect(Number.isFinite(cam.scrollX)).toBe(true);
    expect(Number.isFinite(cam.scrollY)).toBe(true);
  });
});
