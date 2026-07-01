// T034 — Phaser top-down office scene: tilemap + dev sprite idle animation.
//
// Consumes the T033 assets (see frontend/public/assets/README.md):
//  - `office-tileset` (image, 128×64, 8 tiles 32×32)
//  - `office-map`     (Tiled JSON, 20×15 tiles, 32px; layers Ground + Furniture)
//  - `dev`            (spritesheet, 128×32, 4 frames 32×32 idle bob)
//
// The HUD overlay (LOC counter, manual-boost) arrives in T035; the end-to-end
// game-loop wiring (fetch content, start tick, save/restore) in T036. This file
// owns ONLY the scene rendering — loading the map, drawing layers, placing the
// dev sprite, and playing its idle animation.
//
// ## Testable helper
// The tile→pixel layout math lives in a Phaser-free module (`./layout`) so it
// can be unit-tested in Vitest without a WebGL context. See OfficeScene.test.ts.

import Phaser from 'phaser';
import { tileToPixel } from './layout';

// ── Scene ────────────────────────────────────────────────────────────────

/**
 * The top-down pixel-art office scene.
 *
 * Loads the Tiled tilemap, renders the Ground + Furniture layers, and places
 * the dev character sprite at a desk workstation with a looping idle animation.
 *
 * Scene key: `'OfficeScene'`. Wired into the Phaser game config in T036.
 */
export class OfficeScene extends Phaser.Scene {
  constructor() {
    super('OfficeScene');
  }

  /**
   * Load the three T033 assets using the keys documented in the asset README.
   * Phaser serves `public/` at root, so the URL paths are `assets/...`.
   */
  preload(): void {
    this.load.image('office-tileset', 'assets/office_tileset.png');
    this.load.tilemapTiledJSON('office-map', 'assets/office.json');
    this.load.spritesheet('dev', 'assets/dev.png', {
      frameWidth: 32,
      frameHeight: 32,
    });
  }

  /**
   * Build the office: tilemap layers + dev sprite at a desk, idle-animating.
   *
   * The tileset name (`'office-tileset'`) and layer names (`'Ground'`,
   * `'Furniture'`) are read from office.json — they MUST match exactly or
   * `addTilesetImage`/`createLayer` return null.
   */
  create(): void {
    // ── Tilemap ──────────────────────────────────────────────────────────
    const map = this.make.tilemap({ key: 'office-map' });

    // The tileset name in the Tiled JSON is 'office-tileset' (tilesets[0].name);
    // the second arg is the Phaser image key (same string). A name mismatch
    // here returns null and layers fail to render, so this is exact.
    const tileset = map.addTilesetImage('office-tileset', 'office-tileset');
    if (tileset === null) {
      throw new Error(
        "OfficeScene: addTilesetImage returned null — tileset name 'office-tileset' does not match office.json. Check tilesets[0].name.",
      );
    }

    // Ground = floor + wall border; Furniture = desks, chairs, whiteboard.
    map.createLayer('Ground', tileset, 0, 0);
    map.createLayer('Furniture', tileset, 0, 0);

    // ── Dev sprite at a desk workstation ─────────────────────────────────
    // Desks (wood-brown tile) cluster at tile cols 2–3, rows 4–5 in the
    // Furniture layer. Place the dev seated at the first desk: tile (2, 5).
    const { x, y } = tileToPixel(2, 5);
    const dev = this.physics.add.sprite(x, y, 'dev');
    dev.setDepth(1); // render above the floor/furniture tiles

    // ── Idle animation (4-frame vertical bob) ────────────────────────────
    // Guard against duplicate creation if the scene is re-created (HMR, scene
    // restart) — Phaser throws if a key already exists.
    if (!this.anims.exists('dev-idle')) {
      this.anims.create({
        key: 'dev-idle',
        frames: this.anims.generateFrameNumbers('dev', { start: 0, end: 3 }),
        frameRate: 4,
        repeat: -1,
      });
    }
    dev.play('dev-idle');

    // Flat dark background behind the map edges (map is 640×480; canvas may be
    // larger via Scale.RESIZE). Keeps letterboxing looking intentional.
    this.cameras.main.setBackgroundColor('#0f172a');
  }
}
