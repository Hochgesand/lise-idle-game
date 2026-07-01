// T041 — Economy overlay scene: cash display, cash-out, upgrade shop, burner.
//
// Runs as a Phaser scene overlaid alongside OfficeScene + HudScene (launched
// by the game loop wiring in T042). It does NOT own game state — it reads
// live state via injected accessors and delegates mutations (cashOut,
// purchaseUpgrade, activateBurner) to injected callbacks that the wiring layer
// binds to the pure mutators in actions.ts.
//
// quickstart.md Scenario 2: "Accumulate LOC → cash out → buy burner → activate
// → LOC/sec multiplies while tokens deplete → returns to baseline when out."
//
// ## Testability split (Constitution Principle III)
// The PURE economy-view derivation (which upgrades are affordable/locked, burner
// state) lives in `../sim/economy` and is unit-tested in `economy.test.ts`.
// This Phaser scene is integration-level (needs a canvas context) and is
// verified via `tsc -b` + `vite build`. No game logic lives here — it only
// reads state, derives the view, and delegates actions to pure/injected code.

import Phaser from 'phaser';
import type { ContentCatalog, GameState } from '../sim/types';
import { formatLoc } from '../sim/format';
import { getEconomyView } from '../sim/economy';

// ── Init-data contract (T042 wires this) ─────────────────────────────────

/**
 * The data T042 passes to this scene via `scene.launch('EconomyScene', data)`.
 * The scene never imports the game loop, network layer, or mutators — it reads
 * live state through these accessors and delegates actions to callbacks.
 */
export interface EconomySceneInit {
  /** Returns the current live GameState (advanced each tick by the game loop). */
  getState: () => GameState;
  /** Returns the versioned game content (upgrades, burners, etc.). */
  getContent: () => ContentCatalog;
  /** Called when the player clicks "Cash Out". T042 wires to cashOut + state update. */
  onCashOut: (locAmount: string) => void;
  /** Called when the player clicks an affordable upgrade. T042 wires to purchaseUpgrade. */
  onPurchaseUpgrade: (upgradeId: string) => void;
  /** Called when the player clicks "Activate Burner". T042 wires to activateBurner. */
  onActivateBurner: (burnerId: string) => void;
  /** The LOC → Cash conversion rate (from content/config). */
  cashRate: number;
}

// ── Layout constants ─────────────────────────────────────────────────────

/** Panel position (right side of the screen). */
const PANEL_X = 520;
const PANEL_Y = 16;
const PANEL_WIDTH = 260;

/** Color palette (consistent with HudScene). */
const COLOR_TEXT = '#e2e8f0';
const COLOR_LABEL = '#94a3b8';
const COLOR_AFFORDABLE = '#22c55e';
const COLOR_LOCKED = '#64748b';
const COLOR_OWNED = '#3b82f6';
const COLOR_ACTIVE = '#f59e0b';
const COLOR_HEADING = '#cbd5e1';
const STROKE = '#0f172a';
const STROKE_THICKNESS = 3;

/** Fixed cash-out amount (MVP: a simple fixed button). */
const CASH_OUT_AMOUNT = '100';

// ── Scene ────────────────────────────────────────────────────────────────

/**
 * The Economy overlay: a right-side panel with cash display, cash-out button,
 * upgrade shop, and burner activation/fuel display.
 *
 * Scene key: `'EconomyScene'`. Launched as an overlay in T042.
 */
export class EconomyScene extends Phaser.Scene {
  private getState!: () => GameState;
  private getContent!: () => ContentCatalog;
  private onCashOut!: (locAmount: string) => void;
  private onPurchaseUpgrade!: (upgradeId: string) => void;
  private onActivateBurner!: (burnerId: string) => void;
  /** Text objects refreshed each frame. */
  private cashText!: Phaser.GameObjects.Text;
  private cashOutButton!: Phaser.GameObjects.Text;
  private upgradeTexts: Phaser.GameObjects.Text[] = [];
  private burnerText!: Phaser.GameObjects.Text;
  private burnerButton!: Phaser.GameObjects.Text;

  constructor() {
    super('EconomyScene');
  }

  init(data: EconomySceneInit): void {
    this.getState = data.getState;
    this.getContent = data.getContent;
    this.onCashOut = data.onCashOut;
    this.onPurchaseUpgrade = data.onPurchaseUpgrade;
    this.onActivateBurner = data.onActivateBurner;
    // cashRate is available in init data for T042 to pass; not stored since
    // the scene doesn't display it (the HUD shows the rate with burner mult).
  }

  create(): void {
    // ── Cash display ────────────────────────────────────────────────────
    this.add.text(PANEL_X, PANEL_Y, 'CASH', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLOR_LABEL,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    }).setDepth(100);

    this.cashText = this.add.text(PANEL_X, PANEL_Y + 16, '0', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: COLOR_TEXT,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    });
    this.cashText.setDepth(100);

    // ── Cash-out button ─────────────────────────────────────────────────
    this.cashOutButton = this.add.text(PANEL_X, PANEL_Y + 44, `[Cash Out ${CASH_OUT_AMOUNT} LOC]`, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLOR_AFFORDABLE,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    });
    this.cashOutButton.setDepth(100);
    this.cashOutButton.setInteractive({ useHandCursor: true });
    this.cashOutButton.on('pointerdown', () => {
      this.onCashOut(CASH_OUT_AMOUNT);
    });

    // ── Upgrade shop heading ────────────────────────────────────────────
    let yPos = PANEL_Y + 76;
    this.add.text(PANEL_X, yPos, 'UPGRADES', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLOR_HEADING,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    }).setDepth(100);
    yPos += 18;

    // ── Upgrade entries (created once, updated each frame) ───────────────
    const content = this.getContent();
    this.upgradeTexts = [];
    for (const upgrade of content.upgrades) {
      const txt = this.add.text(PANEL_X, yPos, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: COLOR_TEXT,
        stroke: STROKE,
        strokeThickness: STROKE_THICKNESS,
      });
      txt.setDepth(100);
      txt.setInteractive({ useHandCursor: true });
      txt.on('pointerdown', () => {
        this.onPurchaseUpgrade(upgrade.id);
      });
      this.upgradeTexts.push(txt);
      yPos += 20;
    }

    // ── Burner section ──────────────────────────────────────────────────
    yPos += 8;
    this.add.text(PANEL_X, yPos, 'BURNER', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLOR_HEADING,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    }).setDepth(100);
    yPos += 18;

    this.burnerText = this.add.text(PANEL_X, yPos, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: COLOR_TEXT,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
      wordWrap: { width: PANEL_WIDTH },
    });
    this.burnerText.setDepth(100);
    yPos += 40;

    this.burnerButton = this.add.text(PANEL_X, yPos, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLOR_AFFORDABLE,
      stroke: STROKE,
      strokeThickness: STROKE_THICKNESS,
    });
    this.burnerButton.setDepth(100);
    this.burnerButton.setInteractive({ useHandCursor: true });
    this.burnerButton.on('pointerdown', () => {
      const def = this.getContent().burners[0];
      if (def !== undefined) {
        this.onActivateBurner(def.id);
      }
    });

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
    const view = getEconomyView(state, content);

    // ── Cash ────────────────────────────────────────────────────────────
    this.cashText.setText(formatLoc(state.resources.cash));

    // ── Cash-out button: green if affordable, grey if not ────────────────
    const canCashOut =
      parseFloat(state.resources.loc) >= parseFloat(CASH_OUT_AMOUNT) ||
      state.resources.loc === CASH_OUT_AMOUNT;
    this.cashOutButton.setColor(
      canCashOut ? COLOR_AFFORDABLE : COLOR_LOCKED,
    );

    // ── Upgrades ────────────────────────────────────────────────────────
    for (let i = 0; i < this.upgradeTexts.length && i < view.upgrades.length; i++) {
      const u = view.upgrades[i]!;
      const txt = this.upgradeTexts[i]!;
      const costStr = formatLoc(u.cost.amount);
      const resLabel = u.cost.resource;

      if (u.owned) {
        txt.setText(`${u.name} ✓ (${resLabel} ${costStr})`);
        txt.setColor(COLOR_OWNED);
      } else if (!u.unlocked) {
        txt.setText(`${u.name} 🔒 (${resLabel} ${costStr})`);
        txt.setColor(COLOR_LOCKED);
      } else if (u.affordable) {
        txt.setText(`${u.name} (${resLabel} ${costStr})`);
        txt.setColor(COLOR_AFFORDABLE);
      } else {
        txt.setText(`${u.name} (${resLabel} ${costStr})`);
        txt.setColor(COLOR_LOCKED);
      }
    }

    // ── Burner ──────────────────────────────────────────────────────────
    if (view.burner !== undefined) {
      const b = view.burner;
      if (b.active) {
        const fuelStr = formatLoc(b.fuelRemaining ?? '0');
        this.burnerText.setText(
          `${b.def.name} ACTIVE\nFuel: ${fuelStr}\n×${b.def.productionMultiplier} boost`,
        );
        this.burnerText.setColor(COLOR_ACTIVE);
        this.burnerButton.setText('');
        this.burnerButton.setColor(COLOR_LOCKED);
      } else {
        const costStr = formatLoc(b.def.fuelCostToActivate);
        this.burnerText.setText(
          `${b.def.name}\nCost: ${costStr} AI tokens\n×${b.def.productionMultiplier} boost`,
        );
        this.burnerText.setColor(COLOR_TEXT);
        if (b.activatable) {
          this.burnerButton.setText('[Activate Burner]');
          this.burnerButton.setColor(COLOR_AFFORDABLE);
        } else {
          this.burnerButton.setText('[Activate Burner]');
          this.burnerButton.setColor(COLOR_LOCKED);
        }
      }
    } else {
      this.burnerText.setText('No burner available');
      this.burnerButton.setText('');
    }
  }
}
