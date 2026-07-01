// T034 — Pure tile-layout math for the office scene.
//
// Extracted into a Phaser-free module so it can be unit-tested in Vitest
// without spinning up a WebGL context (the OfficeScene class itself is
// integration-level, verified via `tsc -b` + `vite build`).

/** The tile size (px) of the office map — matches office.json tilewidth/height. */
export const TILE_SIZE = 32;

/**
 * Convert tile coordinates to the PIXEL CENTRE of that tile (where a sprite's
 * origin should be placed so it sits centered inside the tile).
 *
 * Pure: no Phaser, no I/O. Tested in OfficeScene.test.ts.
 *
 * @param tileX    zero-based column index
 * @param tileY    zero-based row index
 * @param tileSize px per tile (default 32, matching office.json)
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
