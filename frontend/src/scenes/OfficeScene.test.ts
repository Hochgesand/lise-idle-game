// T034 — Unit test for the pure `tileToPixel` layout helper.
//
// The Phaser scene wiring (OfficeScene class) needs a WebGL/canvas context and
// is therefore integration-level (verified via `tsc -b` + `vite build`). The
// tile→pixel math, however, is pure and fully unit-testable.

import { describe, it, expect } from 'vitest';
import { tileToPixel, TILE_SIZE } from './layout';

describe('tileToPixel', () => {
  it('returns the pixel centre of tile (0,0)', () => {
    expect(tileToPixel(0, 0)).toEqual({ x: 8, y: 8 });
  });

  it('returns the pixel centre of tile (2,5) at the 16px default', () => {
    // tileToPixel uses the shared TILE_SIZE default (16px, the Phase 3 campus
    // base). The retired 001 OfficeScene now passes an EXPLICIT 32 to keep its
    // dev sprite on the legacy office.json desk until it is deleted in T051;
    // this assertion just pins the function's default behaviour.
    expect(tileToPixel(2, 5)).toEqual({ x: 40, y: 88 });
  });

  it('uses the default TILE_SIZE of 16 (Phase 3 base tile)', () => {
    expect(TILE_SIZE).toBe(16);
    expect(tileToPixel(10, 10)).toEqual({ x: 168, y: 168 });
  });

  it('accepts a custom tile size', () => {
    expect(tileToPixel(1, 1, 16)).toEqual({ x: 24, y: 24 });
  });
});
