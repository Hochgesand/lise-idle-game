// T034 — Pure tile-layout math for the office scene.
//
// Extracted into a Phaser-free module so it can be unit-tested in Vitest
// without spinning up a WebGL context (the scene classes themselves are
// integration-level, verified via `tsc -b` + `vite build`).

/**
 * The base tile size (px). Phase 3 (spec 002) switched the campus world to a
 * 16 px base tile (campus.json tilewidth/height = 16, Kenney CC0 16×16 packs —
 * research: Art direction). The retired 001 office map used 32 px; `tileToPixel`
 * stays pure and still accepts a custom `tileSize` for the legacy value.
 */
export const TILE_SIZE = 16;

/**
 * Convert tile coordinates to the PIXEL CENTRE of that tile (where a sprite's
 * origin should be placed so it sits centered inside the tile).
 *
 * Pure: no Phaser, no I/O. Tested in layout.test.ts.
 *
 * @param tileX    zero-based column index
 * @param tileY    zero-based row index
 * @param tileSize px per tile (default 16, matching campus.json)
 * @returns `{ x, y }` pixel coordinates of the tile centre
 */
export function tileToPixel(
  tileX: number,
  tileY: number,
  tileSize: number = TILE_SIZE,
): { x: number; y: number } {
  return {
    x: tileX * tileSize + tileSize / 2,
    y: tileY * tileSize + tileSize / 2,
  };
}
