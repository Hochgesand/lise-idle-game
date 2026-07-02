// T038 — Pure camera math for the campus world (Phase 3), extended for the
// Clash-of-Clans viewport on the REAL campus map (campus-layout.md §2 + §7).
//
// The Phaser glue (applying scroll/zoom/bounds to a real `Phaser.Camera` in
// CampusScene) is integration-level, but the camera *model* — boot fit/center,
// pan/zoom clamping, and resize recompute — is pure math with no Phaser, no
// DOM, no `Date.now()`. Keeping it pure lets Vitest assert the FR-024 math
// directly (research: "Camera & legibility" decision; quickstart Scenario 8).
//
// §7 behavior change (supersedes the fixed MIN_ZOOM = 1.5 floor):
//   - Min zoom = FIT THE WHOLE CAMPUS: `minZoomFor(viewport, map)` is the zoom
//     at which the entire map exactly fits the viewport (the smaller of the
//     two fit ratios), and it replaces the fixed floor as the lower zoom
//     clamp. The user can always pinch/scroll out to the full-map view and no
//     further; max zoom 4 is unchanged.
//   - Centered letterboxing: on any axis where the scaled map is smaller than
//     the viewport, `clampToMap` CENTERS the map (no void off one edge), and
//     panning along that axis is a no-op.
//
// Conventions:
//   - `zoom` scales world→screen: 1 world px occupies `zoom` screen px, so the
//     viewport shows `width / zoom` × `height / zoom` world px.
//   - `scrollX/Y` is the WORLD coordinate at the viewport's top-left edge.
//   - Distances are in screen px unless suffixed "world".

import { describe, it, expect } from 'vitest';
import {
  AVATAR_FRAME_PX,
  MAX_ZOOM,
  clamp,
  clampZoom,
  minZoomFor,
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

// The REAL campus map (campus-layout.md §2): 200×140 tiles × 16 px.
const CAMPUS: WorldBounds = { width: 3200, height: 2240 };

// ---------------------------------------------------------------------------
// Zoom-range constants
// ---------------------------------------------------------------------------

describe('zoom constants', () => {
  it('uses a 16 px avatar frame on the Phase 3 16 px base tile', () => {
    expect(AVATAR_FRAME_PX).toBe(16);
  });

  it('caps zoom at ~4 (64 px tiles)', () => {
    expect(MAX_ZOOM).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// clamp — the shared primitive
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

// ---------------------------------------------------------------------------
// minZoomFor — §7: the whole-campus-fit zoom REPLACES the fixed 1.5 floor
// ---------------------------------------------------------------------------

describe('minZoomFor — zoom at which the whole map exactly fits', () => {
  it('is the smaller of the two viewport/map fit ratios (width-constrained)', () => {
    // 800/3200 = 0.25 vs 600/2240 ≈ 0.2679 → width binds.
    expect(minZoomFor({ width: 800, height: 600 }, CAMPUS)).toBeCloseTo(0.25, 10);
  });

  it('is the smaller ratio when the height binds instead', () => {
    // Portrait phone: 375/3200 ≈ 0.1172 vs 812/2240 ≈ 0.3625 → width binds;
    // flip the map to make the height bind: 375/2240 vs 812/3200 = 0.25375.
    const flipped: WorldBounds = { width: 2240, height: 3200 };
    expect(minZoomFor({ width: 375, height: 812 }, flipped)).toBeCloseTo(375 / 2240, 10);
  });

  it('fits the map exactly at that zoom (visible size == map size on the binding axis)', () => {
    const viewport: Viewport = { width: 800, height: 600 };
    const z = minZoomFor(viewport, CAMPUS);
    expect(viewport.width / z).toBeCloseTo(CAMPUS.width, 5);
    expect(viewport.height / z).toBeGreaterThanOrEqual(CAMPUS.height);
  });

  it('equals 1 when the map exactly matches the viewport', () => {
    expect(minZoomFor({ width: 800, height: 600 }, { width: 800, height: 600 })).toBe(1);
  });

  it('never exceeds MAX_ZOOM even for a tiny map (valid clamp range)', () => {
    // 100×50 map in an 800×600 viewport: raw fit = min(8, 12) = 8 → capped at 4.
    expect(minZoomFor({ width: 800, height: 600 }, { width: 100, height: 50 })).toBe(MAX_ZOOM);
  });
});

// ---------------------------------------------------------------------------
// clampZoom — [minZoomFor(viewport, map), MAX_ZOOM] gate (explicit lower bound)
// ---------------------------------------------------------------------------

describe('clampZoom — [minZoom, MAX_ZOOM] with an explicit lower bound', () => {
  const min = minZoomFor({ width: 800, height: 600 }, CAMPUS); // 0.25

  it('keeps a value inside the range', () => {
    expect(clampZoom(2, min)).toBe(2);
    expect(clampZoom(0.5, min)).toBe(0.5); // legal now — below the old 1.5 floor
  });

  it('clamps up to the whole-map-fit zoom below the range', () => {
    expect(clampZoom(0.1, min)).toBe(min);
    expect(clampZoom(0, min)).toBe(min);
  });

  it('clamps down to MAX_ZOOM above the range', () => {
    expect(clampZoom(8, min)).toBe(MAX_ZOOM);
    expect(clampZoom(100, min)).toBe(MAX_ZOOM);
  });

  it('returns min/max exactly at the boundaries', () => {
    expect(clampZoom(min, min)).toBe(min);
    expect(clampZoom(MAX_ZOOM, min)).toBe(MAX_ZOOM);
  });
});

// ---------------------------------------------------------------------------
// bootCamera — fit & center the ACTIVE office's Rooms bounds (unchanged
// framing), respecting the NEW clamps [minZoomFor(viewport, map), MAX_ZOOM]
// ---------------------------------------------------------------------------

describe('bootCamera — fit & center on the active office', () => {
  const viewport: Viewport = { width: 800, height: 600 };

  it('fits the office exactly when the aspect ratio matches (zoom = fit)', () => {
    // office 400x300 in an 800x600 viewport → fit zoom = min(2, 2) = 2.
    const office: Rect = { x: 100, y: 100, width: 400, height: 300 };
    const cam = bootCamera(viewport, office, CAMPUS);

    expect(cam.zoom).toBe(2);
    // Centered: the viewport spans exactly the office.
    expect(cam.width).toBe(800);
    expect(cam.height).toBe(600);
    expect(cam.scrollX).toBe(100);
    expect(cam.scrollY).toBe(100);
  });

  it('uses the smaller of the two fit ratios without hitting the old 1.5 floor', () => {
    // 800x600 viewport, office 800x150 → fit = min(1.0, 4.0) = 1.0. The old
    // fixed MIN_ZOOM floor forced this up to 1.5; §7 keeps the true fit since
    // 1.0 >= minZoomFor(viewport, CAMPUS) = 0.25.
    const office: Rect = { x: 0, y: 0, width: 800, height: 150 };
    const cam = bootCamera(viewport, office, CAMPUS);
    expect(cam.zoom).toBe(1);
  });

  it('centers on the office bounds (square office, square viewport)', () => {
    const squareView: Viewport = { width: 600, height: 600 };
    const office: Rect = { x: 200, y: 200, width: 200, height: 200 };
    const cam = bootCamera(squareView, office, CAMPUS);
    // fit zoom = min(3, 3) = 3; office center = (300, 300);
    // scrollX = 300 - 600 / (2*3) = 300 - 100 = 200.
    expect(cam.zoom).toBe(3);
    expect(cam.scrollX).toBe(200);
    expect(cam.scrollY).toBe(200);
  });

  it('lets a large office fit below the old 1.5 floor (down to the map-fit zoom)', () => {
    // office 2000x2000 → fit = min(0.4, 0.3) = 0.3. Old behavior clamped this
    // up to 1.5 (cropping the office); §7 keeps 0.3 since it is above
    // minZoomFor(viewport, CAMPUS) = 0.25 — the office is framed whole.
    const office: Rect = { x: 0, y: 0, width: 2000, height: 2000 };
    const cam = bootCamera(viewport, office, CAMPUS);
    expect(cam.zoom).toBeCloseTo(0.3, 10);
  });

  it('clamps the office fit UP to the whole-map-fit zoom (never past full-map view)', () => {
    // A degenerate office wider than the map itself: fit = 800/6400 = 0.125,
    // below minZoomFor(viewport, CAMPUS) = 0.25 → clamped up to 0.25.
    const office: Rect = { x: 0, y: 0, width: 6400, height: 100 };
    const cam = bootCamera(viewport, office, CAMPUS);
    expect(cam.zoom).toBeCloseTo(minZoomFor(viewport, CAMPUS), 10);
  });

  it('clamps zoom down to maxZoom when the office is tiny', () => {
    const office: Rect = { x: 0, y: 0, width: 32, height: 32 };
    const cam = bootCamera(viewport, office, CAMPUS);
    // fit = min(25, 18.75) = 18.75 → clamped to 4.
    expect(cam.zoom).toBe(MAX_ZOOM);
  });

  it('never returns NaN/Infinity', () => {
    const office: Rect = { x: 5, y: 7, width: 123, height: 456 };
    const cam = bootCamera(viewport, office, CAMPUS);
    expect(Number.isFinite(cam.zoom)).toBe(true);
    expect(Number.isFinite(cam.scrollX)).toBe(true);
    expect(Number.isFinite(cam.scrollY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clampToMap — pan clamped to map bounds, CENTERED letterboxing (§7)
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

  it('CENTERS the map on both axes when it is smaller than the viewport', () => {
    // map 300x200 at zoom 1.5: visible = 533.33 x 400 → larger than the map on
    // both axes. §7: centered letterboxing — scroll is pinned to
    // (map - visible) / 2, regardless of the incoming scroll.
    const smallMap: WorldBounds = { width: 300, height: 200 };
    const zoomedOut: CameraState = {
      scrollX: 100,
      scrollY: 100,
      zoom: 1.5,
      width: 800,
      height: 600,
    };
    const centeredX = (300 - 800 / 1.5) / 2; // ≈ -116.67
    const centeredY = (200 - 600 / 1.5) / 2; // = -100
    const cam = clampToMap(zoomedOut, smallMap);
    expect(cam.scrollX).toBeCloseTo(centeredX, 5);
    expect(cam.scrollY).toBeCloseTo(centeredY, 5);
    // Any wild incoming scroll pins to the same center — no void off one edge.
    const camLeft = clampToMap({ ...zoomedOut, scrollX: -9999, scrollY: 9999 }, smallMap);
    expect(camLeft.scrollX).toBeCloseTo(centeredX, 5);
    expect(camLeft.scrollY).toBeCloseTo(centeredY, 5);
  });

  it('centers ONE axis while clamping the other (full-map-width view of the campus)', () => {
    // 800x600 viewport at the whole-campus-fit zoom 0.25: visible = 3200x2400.
    // Width fits exactly (centered at 0); height still has 2400 > 2240 →
    // vertical letterboxing centered at (2240 - 2400) / 2 = -80.
    const cam = clampToMap(
      { scrollX: 500, scrollY: 500, zoom: 0.25, width: 800, height: 600 },
      CAMPUS,
    );
    expect(cam.scrollX).toBe(0);
    expect(cam.scrollY).toBeCloseTo(-80, 5);
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

  it('is a NO-OP on a centered (letterboxed) axis', () => {
    // Whole-campus view in an 800x600 viewport (zoom 0.25): height letterboxes
    // (centered at scrollY = -80); width fits exactly (scrollX = 0). Vertical
    // drags must not move the map off-center; horizontal drags have no room.
    const fullView = clampToMap(
      { scrollX: 0, scrollY: 0, zoom: 0.25, width: 800, height: 600 },
      CAMPUS,
    );
    const dragged = panBy(fullView, 300, 250, CAMPUS);
    expect(dragged.scrollX).toBe(fullView.scrollX);
    expect(dragged.scrollY).toBe(fullView.scrollY);
    const draggedBack = panBy(fullView, -300, -250, CAMPUS);
    expect(draggedBack.scrollX).toBe(fullView.scrollX);
    expect(draggedBack.scrollY).toBe(fullView.scrollY);
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
// applyZoom — wheel/pinch zoom clamped to [minZoomFor, MAX_ZOOM], anchored
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

  it('allows zooming below the old 1.5 floor down to the whole-map-fit zoom', () => {
    // minZoomFor(800x600, 4000x4000) = min(0.2, 0.15) = 0.15. The old floor
    // rejected anything under 1.5; §7 allows 0.2.
    const cam = applyZoom(start, 0.2, map);
    expect(cam.zoom).toBeCloseTo(0.2, 10);
  });

  it('clamps a too-small zoom up to the whole-map-fit zoom (and no further out)', () => {
    const cam = applyZoom(start, 0.01, map);
    expect(cam.zoom).toBeCloseTo(minZoomFor({ width: 800, height: 600 }, map), 10);
  });

  it('shows the WHOLE campus at the lower clamp (CoC full-map view)', () => {
    const cam = applyZoom({ ...start, scrollX: 1000, scrollY: 900 }, 0, CAMPUS);
    expect(cam.zoom).toBeCloseTo(0.25, 10); // minZoomFor(800x600, CAMPUS)
    // The full map is visible: the visible world region covers [0, mapW/H].
    expect(cam.scrollX).toBeLessThanOrEqual(0);
    expect(cam.scrollY).toBeLessThanOrEqual(0);
    expect(cam.scrollX + cam.width / cam.zoom).toBeGreaterThanOrEqual(CAMPUS.width);
    expect(cam.scrollY + cam.height / cam.zoom).toBeGreaterThanOrEqual(CAMPUS.height);
    // And the letterboxed axis is centered (height: (2240 - 2400) / 2 = -80).
    expect(cam.scrollY).toBeCloseTo(-80, 5);
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

  it('re-fits the office bounds for the new viewport (no 1.5 floor)', () => {
    const portrait: Viewport = { width: 375, height: 812 };
    const cam = recomputeOnResize(portrait, office, CAMPUS);
    // fit = min(375/400, 812/300) = 0.9375 — kept (old floor forced 1.5).
    expect(cam.zoom).toBeCloseTo(0.9375, 10);
    expect(cam.width).toBe(375);
    expect(cam.height).toBe(812);
  });

  it('matches bootCamera for the same viewport + office + map', () => {
    const viewport: Viewport = { width: 1280, height: 720 };
    expect(recomputeOnResize(viewport, office, CAMPUS)).toEqual(
      bootCamera(viewport, office, CAMPUS),
    );
  });

  it('re-centers on the office center', () => {
    const viewport: Viewport = { width: 1600, height: 1200 };
    const cam = recomputeOnResize(viewport, office, CAMPUS);
    // fit = min(4, 4) = 4 → zoom 4 (max). office center = (300, 250).
    expect(cam.zoom).toBe(MAX_ZOOM);
    const centerX = cam.scrollX + cam.width / (2 * cam.zoom);
    const centerY = cam.scrollY + cam.height / (2 * cam.zoom);
    expect(centerX).toBeCloseTo(300, 5);
    expect(centerY).toBeCloseTo(250, 5);
  });

  it('adapts as the viewport changes between calls', () => {
    const a = recomputeOnResize({ width: 800, height: 600 }, office, CAMPUS);
    const b = recomputeOnResize({ width: 400, height: 300 }, office, CAMPUS);
    // Smaller viewport → smaller fit zoom, distinct scroll.
    expect(a.zoom).not.toBe(b.zoom);
  });

  it('never returns NaN/Infinity', () => {
    const cam = recomputeOnResize({ width: 375, height: 812 }, office, CAMPUS);
    expect(Number.isFinite(cam.zoom)).toBe(true);
    expect(Number.isFinite(cam.scrollX)).toBe(true);
    expect(Number.isFinite(cam.scrollY)).toBe(true);
  });
});
