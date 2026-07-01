// T035 — HUD overlay scene: live LOC counter + manual-boost interaction.
//
// Runs as a SECOND Phaser scene overlaid on OfficeScene (both registered in
// main.ts in T036). It does NOT own game state or the game loop — it receives
// live state via an injected accessor (see HudSceneInit below) so T036 can
// wire the real game loop + content + boost mutator without the HUD importing
// any sim/network code directly.
//
// quickstart.md Scenario 1: "Watch the LOC counter...; Click/interact with the
// scene; confirm an immediate LOC boost." This scene renders the counter,
// updates it each frame from live state, and binds the click → onBoost callback.
//
// ## Testability split (Constitution Principle III)
// The PURE formatting logic (formatLoc / formatRate) lives in `../sim/format`
// and is unit-tested in `format.test.ts`. The Phaser scene wiring here is
// integration-level (needs a canvas context) and is verified via `tsc -b` +
// `vite build`. No game logic lives in this file — it only reads state and
// delegates formatting + the boost action to pure/injected code.

import Phaser from 'phaser';
import type { ContentCatalog, GameState } from '../sim/types';
import { formatLoc, formatRate } from '../sim/format';
import { computeRate } from '../sim/advance';
import { toString } from '../sim/bigNumber';

// ── Init-data contract (T036 wires this) ─────────────────────────────────

/**
 * The data T036 passes to this scene via `scene.start('HudScene', data)` or
 * `scene.launch('HudScene', data)`. The HUD never imports the game loop or
 * network layer — it reads live state through these injected accessors and
 * delegates the boost mutation to `onBoost`.
 */
export interface HudSceneInit {
  /** Returns the current live GameState (advanced each tick by the game loop). */
  getState: () => GameState;
  /** Returns the versioned game content (producers/upgrades/etc.). */
  getContent: () => ContentCatalog;
  /**
   * Called when the player clicks/taps for a manual boost. T036 wires this to
   * `manualBoost(state, content)` + state update + save. The HUD does NOT call
   * `manualBoost` directly (it has no write access to state).
   */
  onBoost: () => void;
}

// ── Scene ────────────────────────────────────────────────────────────────

/**
 * The HUD overlay: a top-left LOC counter (live, big-number formatted) + a
 * rate line, with a manual-boost click handler and minimal visual feedback.
 *
 * Scene key: `'HudScene'`. Launched as an overlay on top of OfficeScene in
 * T036 (e.g. `this.scene.launch('HudScene', data)`).
 */
export class HudScene extends Phaser.Scene {
  /** The injected accessors (set in init, read in create/update). */
  private getState!: () => GameState;
  private getContent!: () => ContentCatalog;
  private onBoost!: () => void;

  /** The LOC counter text object (updated each frame). */
  private locText!: Phaser.GameObjects.Text;
  /** The rate line text object (updated each frame). */
  private rateText!: Phaser.GameObjects.Text;

  constructor() {
    super('HudScene');
  }

  /**
   * Receive the init data from T036. Phaser calls this before create().
   */
  init(data: HudSceneInit): void {
    this.getState = data.getState;
    this.getContent = data.getContent;
    this.onBoost = data.onBoost;
  }

  /**
   * Build the HUD: LOC counter + rate line at top-left, click handler for boost.
   */
  create(): void {
    // ── LOC counter (top-left, monospace, prominent) ─────────────────────
    this.locText = this.add.text(16, 16, 'LOC: 0', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#e2e8f0',
      stroke: '#0f172a',
      strokeThickness: 4,
    });
    this.locText.setDepth(100); // above the office scene

    // ── Rate line (below the LOC counter) ────────────────────────────────
    this.rateText = this.add.text(16, 48, '+0.0/s', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#94a3b8',
      stroke: '#0f172a',
      strokeThickness: 3,
    });
    this.rateText.setDepth(100);

    // ── Manual-boost click handler (quickstart Scenario 1) ───────────────
    // A click anywhere on the scene triggers the boost. The injected onBoost
    // (wired by T036 to manualBoost) does the actual state mutation.
    this.input.on('pointerdown', (_pointer: Phaser.Input.Pointer) => {
      this.onBoost();
      this.showBoostFeedback();
    });

    // Render the initial state immediately (so it's correct before first update).
    this.updateDisplay();
  }

  /**
   * Each frame: read live state, format LOC + rate, update the text objects.
   * Cheap for an idle game (two string formats + two setText calls).
   */
  update(): void {
    this.updateDisplay();
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /** Read live state + content and refresh the LOC/rate text objects. */
  private updateDisplay(): void {
    const state = this.getState();
    const content = this.getContent();

    const locStr = formatLoc(state.resources.loc);
    this.locText.setText(`LOC: ${locStr}`);

    const rate = computeRate(state, content);
    this.rateText.setText(formatRate(toString(rate)));
  }

  /**
   * Brief visual feedback on boost: a floating "+N" text that rises and fades.
   * Suppressed if the player has reducedMotion enabled (accessibility).
   */
  private showBoostFeedback(): void {
    const state = this.getState();

    // Accessibility: skip motion if reducedMotion is set.
    if (state.settings.reducedMotion) {
      return;
    }

    // Compute the boost amount for the "+N" label (rate × 1 sec).
    const content = this.getContent();
    const rate = computeRate(state, content);
    const boostAmount = formatLoc(toString(rate));

    // Spawn a floating text near the center-top of the counter.
    const x = this.locText.x + this.locText.width / 2;
    const y = this.locText.y - 8;
    const floatText = this.add.text(x, y, `+${boostAmount}`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#22c55e',
      stroke: '#0f172a',
      strokeThickness: 3,
    });
    floatText.setOrigin(0.5);
    floatText.setDepth(101);

    // Rise 40px and fade out over 600ms, then destroy.
    this.tweens.add({
      targets: floatText,
      y: y - 40,
      alpha: 0,
      duration: 600,
      ease: 'Quad.out',
      onComplete: () => floatText.destroy(),
    });
  }
}
