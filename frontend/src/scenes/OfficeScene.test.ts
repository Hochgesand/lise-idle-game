// T034 — Unit test for the pure `tileToPixel` layout helper.
//
// The Phaser scene wiring (OfficeScene class) needs a WebGL/canvas context and
// is therefore integration-level (verified via `tsc -b` + `vite build`). The
// tile→pixel math, however, is pure and fully unit-testable.

import { describe, it, expect } from 'vitest';
import { tileToPixel, TILE_SIZE } from './layout';

describe('tileToPixel', () => {
  it('returns the pixel centre of tile (0,0)', () => {
    expect(tileToPixel(0, 0)).toEqual({ x: 16, y: 16 });
  });

  it('returns the pixel centre of tile (2,5) — the dev desk workstation', () => {
    // The dev sprite is placed here in OfficeScene.create().
    expect(tileToPixel(2, 5)).toEqual({ x: 80, y: 176 });
  });

  it('uses the default TILE_SIZE of 32', () => {
    expect(TILE_SIZE).toBe(32);
    expect(tileToPixel(10, 10)).toEqual({ x: 336, y: 336 });
  });

  it('accepts a custom tile size', () => {
    expect(tileToPixel(1, 1, 16)).toEqual({ x: 24, y: 24 });
  });
});
