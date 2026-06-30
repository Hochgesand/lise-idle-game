import Phaser from 'phaser';

/**
 * Placeholder entry point (T003).
 *
 * Boots a minimal Phaser 4 game into the #game div just to prove the toolchain
 * works end-to-end. The real office scene arrives in T034; the HUD in T035;
 * full wiring in T036. Scale.RESIZE keeps the canvas responsive across mobile
 * (portrait/landscape) and desktop (FR-001/FR-018).
 */
class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    // Simple flat background so the dev server shows something recognizable.
    this.cameras.main.setBackgroundColor('#1e293b');
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Lise Dev Idle Game — booting…', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#e2e8f0',
      })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1e293b',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [BootScene],
});
