// T051 — Pure unit test for the `tileToPixel` layout helper (frontend/src/scenes/layout.ts).
//
// This coverage previously lived in OfficeScene.test.ts, which is deleted in
// T051 along with the retired OfficeScene. The pure tile→pixel math stays
// valuable (it is shared, framework-free, and still used), so the assertions
// move here. The Phaser scene wiring is integration-level (verified via
// `tsc --noEmit -p .` + `vite build`).

import { describe, it, expect } from 'vitest';
import { tileToPixel, TILE_SIZE } from './layout';

describe('tileToPixel', () => {
  it('returns the pixel centre of tile (0,0) at the 16px default', () => {
    expect(tileToPixel(0, 0)).toEqual({ x: 8, y: 8 });
  });

  it('returns the pixel centre of an arbitrary tile at the 16px default', () => {
    expect(tileToPixel(2, 5)).toEqual({ x: 40, y: 88 });
    expect(tileToPixel(10, 10)).toEqual({ x: 168, y: 168 });
  });

  it('uses the default TILE_SIZE of 16 (Phase 3 campus base tile)', () => {
    expect(TILE_SIZE).toBe(16);
  });

  it('accepts a custom tile size (legacy 32px office.json)', () => {
    // The retired 001 OfficeScene passed an explicit 32 to place its dev sprite
    // on the legacy office.json grid; pin that the override still works.
    expect(tileToPixel(2, 5, 32)).toEqual({ x: 80, y: 176 });
    expect(tileToPixel(1, 1, 16)).toEqual({ x: 24, y: 24 });
  });
});
