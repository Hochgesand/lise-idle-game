// T048 — Academy overlay scene: lise Academy trainings + credentials/milestones.
//
// Runs as a Phaser scene overlaid alongside OfficeScene + HudScene + EconomyScene
// (launched by the game loop wiring in T049). It does NOT own game state — it
// reads live state via injected accessors and delegates the purchase mutation
// (purchaseTraining) to an injected callback that the wiring layer binds to
// the pure mutator in actions.ts.
//
// quickstart.md Scenario 3: "Buy a lise Academy training → production permanently
// increases → reach a credential milestone → it registers as earned and grants
// a reward → both persist across reload."
//
// ## Testability split (Constitution Principle III)
// The PURE academy-view derivation (which trainings are affordable/locked/owned,
// which milestones are earned/preview/locked) lives in `../sim/academy` and is
// unit-tested in `academy.test.ts`. This Phaser scene is integration-level
// (needs a canvas context) and is verified via `tsc -b` + `vite build`. No game
// logic lives here — it only reads state, derives the view, and delegates the
// purchase action to pure/injected code.

import Phaser from 'phaser';
import type { ContentCatalog, GameState } from '../sim/types';
import { formatLoc } from '../sim/format';
import { getAcademyView } from '../sim/academy';
import type { AcademyView } from '../sim/academy';

// ── Init-data contract (T049 wires this) ─────────────────────────────────

/**
 * The data T049 passes to this scene via `scene.launch('AcademyScene', data)`.
 * The scene never imports the game loop, network layer, or mutators — it reads
 * live state through these accessors and delegates the purchase action to a
 * callback.
 */
export interface AcademySceneInit {
  /** Returns the current live GameState (advanced each tick by the game loop). */
  getState: () => GameState;
  /** Returns the versioned game content (trainings, milestones, etc.). */
  getContent: () => ContentCatalog;
  /** Called when the player clicks an affordable, unowned training. T049 wires
   *  to purchaseTraining + state update + save. */
  onPurchaseTraining: (trainingId: string) => void;
}

// ── Layout constants ─────────────────────────────────────────────────────

/** Panel position (right side, below the economy panel). */
const PANEL_X = 520;
const PANEL_Y = 360;
const PANEL_WIDTH = 260;

/** Color palette (consistent with EconomyScene/HudScene). */
const COLOR_TEXT = '#e2e8f0';
const COLOR_LABEL = '#94a3b8';
const COLOR_AFFORDABLE = '#22c55e';
const COLOR_LOCKED = '#64748b';
const COLOR_OWNED = '#3b82f6';
const COLOR_EARNED = '#f59e0b';
const COLOR_HEADING = '#cbd5e1';
const STROKE = '#0f172a';
const STROKE_THICKNESS = 3;

/** Vertical spacing between training entries. */
const ENTRY_SPACING = 20;
/** Vertical spacing between milestone entries. */
const MILESTONE_SPACING = 18;

// ── Scene ────────────────────────────────────────────────────────────────

/**
 * The Academy overlay: a panel listing lise Academy trainings (purchasable
 * permanent boosts) and earned/pending credentials (milestones).
 *
 * Scene key: `'AcademyScene'`. Launched as an overlay in T049.
 */
export class AcademyScene extends Phaser.Scene {
  private getState!: () => GameState;
  private getContent!: () => ContentCatalog;
  private onPurchaseTraining!: (trainingId: string) => void;

  /** Text objects for training entries (created once, updated each frame). */
  private trainingTexts: Phaser.GameObjects.Text[] = [];
  /** Text objects for milestone entries (created once, updated each frame). */
  private milestoneTexts: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('AcademyScene');
  }

  init(data: AcademySceneInit): void {
    this.getState = data.getState;
    this.getContent = data.getContent;
    this.onPurchaseTraining = data.onPurchaseTraining;
  }

  create(): void {
    // ── Academy heading ──────────────────────────────────────────────────
    this.add.text(PANEL_X, PANEL_Y, 'LISE ACADEMY', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLOR_HEADING,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    }).setDepth(100);

    this.add.text(PANEL_X, PANEL_Y + 16, 'TRAININGS', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: COLOR_LABEL,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    }).setDepth(100);

    // ── Training entries (created once, updated each frame) ───────────────
    let yPos = PANEL_Y + 32;
    const content = this.getContent();
    this.trainingTexts = [];
    for (const training of content.trainings) {
      const txt = this.add.text(PANEL_X, yPos, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: COLOR_TEXT,
        stroke: STROKE,
        strokeThickness: STROKE_THICKNESS,
        wordWrap: { width: PANEL_WIDTH },
      });
      txt.setDepth(100);
      txt.setInteractive({ useHandCursor: true });
      // Capture the training id for the click handler (closure over the loop var).
      const trainingId = training.id;
      txt.on('pointerdown', () => {
        this.onPurchaseTraining(trainingId);
      });
      this.trainingTexts.push(txt);
      yPos += ENTRY_SPACING;
    }

    // ── Credentials / Milestones heading ─────────────────────────────────
    yPos += 8;
    this.add.text(PANEL_X, yPos, 'CREDENTIALS', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: COLOR_LABEL,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    }).setDepth(100);
    yPos += 16;

    // ── Milestone entries (created once, updated each frame) ──────────────
    this.milestoneTexts = [];
    for (const _milestone of content.milestones) {
      const txt = this.add.text(PANEL_X, yPos, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: COLOR_TEXT,
        stroke: STROKE,
        strokeThickness: STROKE_THICKNESS,
        wordWrap: { width: PANEL_WIDTH },
      });
      txt.setDepth(100);
      this.milestoneTexts.push(txt);
      yPos += MILESTONE_SPACING;
    }

    // Render the initial state immediately.
    this.updateDisplay();
  }

  update(): void {
    this.updateDisplay();
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private updateDisplay(): void {
    const state = this.getState();
    const content = this.getContent();
    const view: AcademyView = getAcademyView(state, content);

    // ── Trainings ───────────────────────────────────────────────────────
    for (let i = 0; i < this.trainingTexts.length && i < view.trainings.length; i++) {
      const t = view.trainings[i]!;
      const txt = this.trainingTexts[i]!;
      const costStr = formatLoc(t.cost.amount);
      const resLabel = t.cost.resource;

      if (t.owned) {
        txt.setText(`✓ ${t.name} (×${t.permanentMultiplier})`);
        txt.setColor(COLOR_OWNED);
      } else if (!t.unlocked) {
        txt.setText(`🔒 ${t.name} (×${t.permanentMultiplier})`);
        txt.setColor(COLOR_LOCKED);
      } else if (t.affordable) {
        txt.setText(`${t.name} (×${t.permanentMultiplier}, ${resLabel} ${costStr})`);
        txt.setColor(COLOR_AFFORDABLE);
      } else {
        txt.setText(`${t.name} (×${t.permanentMultiplier}, ${resLabel} ${costStr})`);
        txt.setColor(COLOR_LOCKED);
      }
    }

    // ── Milestones / Credentials ────────────────────────────────────────
    for (let i = 0; i < this.milestoneTexts.length && i < view.milestones.length; i++) {
      const m = view.milestones[i]!;
      const txt = this.milestoneTexts[i]!;

      if (m.earned) {
        // Earned credential: lise-themed badge with ✓ (gold).
        txt.setText(`🏅 ✓ ${m.name}`);
        txt.setColor(COLOR_EARNED);
      } else if (m.requirementMet) {
        // Requirement met but not yet earned (e.g. waiting for advance tick):
        // show as "pending" — a faded hint that it's about to register.
        txt.setText(`○ ${m.name} (ready)`);
        txt.setColor(COLOR_LABEL);
      } else {
        // Locked: greyed out.
        txt.setText(`🔒 ${m.name}`);
        txt.setColor(COLOR_LOCKED);
      }
    }
  }
}
