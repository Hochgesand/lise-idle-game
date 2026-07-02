// T048 — HUD overlay panel (FR-019), replacing the retired HudScene.
//
// This is an OverlaySection (see overlay.ts): the game loop drives a per-frame
// refresh that calls `render(getState, getContent)`, and the panel rebuilds its
// DOM from the CURRENT state/content. The manual-boost action is a STABLE
// callback captured in the factory closure (`onBoost`) — it never needs
// rebinding per frame. This moves the retired HudScene's scene-wide
// `pointerdown` boost OFF the canvas onto a real DOM button, resolving the
// camera input conflict (a camera pan no longer double-fires a boost): the
// button opts back into pointer events via `.ui-interactive` while the rest of
// the overlay stays gesture-transparent for pan/zoom (overlay.ts / styles.css,
// research "UI architecture" + Camera decision).
//
// ## Action model (T048/T049/T050 unified interaction model)
// The boost button carries a STABLE `data-action="boost"` attribute; the
// overlay's single `pointerdown` delegation listener (on the STABLE root)
// dispatches it to this panel's `actions.boost` handler. Activation therefore
// survives the per-frame rebuild — pointerdown fires on press, before any
// refresh() swaps the button node, so the boost never gets lost to a
// click-between-rebuilds (overlay.ts "Action delegation"). The handler also
// spawns the boost float-text from the pressed button element.
//
// ## Testability (Constitution Principle III)
// The PURE formatting (`formatLoc`/`formatRate`) and rate math (`computeRate`)
// live in sim/ and are unit-tested there. This module is the thin DOM wiring —
// framework-free TS exercised in jsdom (hudPanel.test.ts). No game logic, no
// Phaser, no direct state mutation: reads state, delegates formatting + the
// boost action to pure/injected code.

import type { OverlaySection } from './overlay';
import type { ContentCatalog, GameState } from '../sim/types';
import { formatLoc, formatRate } from '../sim/format';
import { computeRate } from '../sim/advance';
import { effectiveMultiplier } from '../sim/coop';
import { toString } from '../sim/bigNumber';

/** Boost float-text rise duration (ms); mirrors the retired HudScene tween. */
const BOOST_FLOAT_MS = 600;
/** Safety margin before the float's setTimeout fallback cleanup fires (ms). */
const BOOST_FLOAT_CLEANUP_MS = BOOST_FLOAT_MS + 200;

// ── Factory ──────────────────────────────────────────────────────────────

/** Options for {@link hudPanel}. */
export interface HudPanelOptions {
  /**
   * Called when the player clicks the manual-boost button. T051 wires this to
   * `manualBoost(state, content)` + state update + save — the same closure the
   * retired HudScene received via `HudSceneInit.onBoost`. The panel never
   * mutates state directly (it has no write access).
   */
  onBoost: () => void;
}

/**
 * Build the HUD overlay section: a live LOC counter (`formatLoc`), a rate
 * preview from `computeRate` (`formatRate`), an active co-op bonus badge
 * (T074 — only when a segment covers "now"; nothing at baseline), and a
 * manual-boost DOM button wired to `onBoost`. A boost float-text ("+N") rises from the button as a CSS
 * animation (`.hud-boost-float`, styles.css), suppressed when
 * `state.settings.reducedMotion` is set (accessibility).
 *
 * The returned section has the stable id `'hud'` (keying its `.ui-panel` slot);
 * its `render` is called once per frame by `createOverlay`'s `refresh()`.
 */
export function hudPanel(opts: HudPanelOptions): OverlaySection {
  // The STABLE action callback is captured once at construction; per-frame data
  // (state/content) flows fresh through render's accessors (overlay.ts seam).
  const { onBoost } = opts;

  return {
    id: 'hud',
    render: (getState, getContent) => {
      const state = getState();
      const content = getContent();

      const locStr = formatLoc(state.resources.loc);
      const rateStr = formatRate(toString(computeRate(state, content)));

      const root = document.createElement('div');
      root.className = 'hud-panel';

      // LOC counter (live, big-number formatted) — quickstart Scenario 1.
      const loc = document.createElement('div');
      loc.className = 'hud-loc';
      loc.textContent = `LOC: ${locStr}`;
      root.appendChild(loc);

      // Rate preview (LOC/sec) from computeRate.
      const rate = document.createElement('div');
      rate.className = 'hud-rate';
      rate.textContent = rateStr;
      root.appendChild(rate);

      // T074 — Co-op bonus badge (US2): when a co-op segment covers the sim's
      // "now" (the same Date.parse(lastAdvancedAt) anchor advance uses), show
      // the capped multiplier; at baseline (no covering segment, or an
      // effective ×1) append NOTHING — no empty badge element. The
      // covering-segment rule is `effectiveMultiplier` (sim/coop.ts), the
      // exact helper computeRate applies — never reimplemented here.
      // Rounded to the DISPLAYED one-decimal precision before the >1 gate so
      // a multiplier in (1, 1.05) never renders a misleading "×1.0 co-op".
      const coopMult = Math.round(coopMultiplierNow(state, content) * 10) / 10;
      if (coopMult > 1) {
        const coop = document.createElement('div');
        coop.className = 'hud-coop';
        coop.textContent = `×${formatMultiplier(coopMult)} co-op`;
        root.appendChild(coop);
      }

      // Manual-boost button — the DOM replacement for the retired scene-wide
      // `pointerdown` boost. `.ui-interactive` opts it back into pointer events
      // so the camera's pan/zoom gestures still reach the canvas everywhere
      // else (the direct fix for the camera input conflict). Activation is via
      // `data-action` delegation (overlay.ts) — no per-frame click listener.
      const boost = document.createElement('button');
      boost.type = 'button';
      boost.className = 'hud-boost ui-interactive';
      boost.dataset.action = 'boost';
      boost.textContent = 'Boost';
      root.appendChild(boost);

      return root;
    },
    // Delegated actions (overlay.ts dispatches by `data-action` from a SINGLE
    // pointerdown listener on the stable root, so this fires even when the
    // loop rebuilds the button mid-interaction).
    actions: {
      boost: (el, accessors) => {
        // Delegate the mutation to the injected callback; then the visual.
        onBoost();
        spawnBoostFloat(el, accessors.getState, accessors.getContent);
      },
    },
  };
}

// ── Co-op bonus badge helpers (T074) ─────────────────────────────────────

/**
 * The effective co-op multiplier at the sim's "now" — the
 * `Date.parse(state.lastAdvancedAt)` anchor, consistent with how `advance`
 * anchors time — via `effectiveMultiplier`'s covering-segment rule
 * (sim/coop.ts; the same rule `computeRate` applies). Returns exactly 1 at
 * baseline: no covering segment, a partial content catalog without `coop`
 * (fail safe, mirrors `applyCoopPresence`), or a corrupt `lastAdvancedAt`
 * (NaN covers nothing).
 */
function coopMultiplierNow(state: GameState, content: ContentCatalog): number {
  const coop = content.coop;
  if (coop === undefined) {
    return 1;
  }
  const nowMs = Date.parse(state.lastAdvancedAt);
  return effectiveMultiplier(state.coopSegments, nowMs, coop.maxMultiplier);
}

/**
 * Format a co-op multiplier for the badge: one decimal unless clean
 * (`1.2 → "1.2"`, `2 → "2"`, never `"2.0"`).
 */
function formatMultiplier(multiplier: number): string {
  return Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1);
}

// ── Boost float-text ─────────────────────────────────────────────────────

/**
 * Spawn a transient "+N" float that rises and fades from the boost button via
 * the `.hud-boost-float` CSS animation (styles.css). Suppressed entirely when
 * `state.settings.reducedMotion` is set (accessibility — matches the retired
 * HudScene, and reinforced by the `.ui-reduced-motion *` CSS T051 applies).
 *
 * Appended to the overlay's `.ui-root` (falling back to `document.body` before
 * first mount) rather than the per-frame-rebuilt panel slot, so the animation
 * survives `refresh()` re-renders. Auto-removed on `animationend`, with a
 * `setTimeout` fallback for environments where the event never fires (jsdom,
 * background tabs) so no float ever leaks.
 */
function spawnBoostFloat(
  anchor: HTMLElement,
  getState: () => GameState,
  getContent: () => ContentCatalog,
): void {
  const state = getState();
  // Accessibility: skip the motion entirely when reducedMotion is set.
  if (state.settings.reducedMotion) return;

  const content = getContent();
  // The "+N" label = 1 second of current production (rate × 1s), formatted.
  const amount = formatLoc(toString(computeRate(state, content)));

  const rect = anchor.getBoundingClientRect();
  const float = document.createElement('div');
  float.className = 'hud-boost-float';
  float.textContent = `+${amount}`;
  // Position the float at the button's horizontal center / top edge; the CSS
  // animation handles the rise + fade (translateX(-50%) centers it on that x).
  float.style.left = `${rect.left + rect.width / 2}px`;
  float.style.top = `${rect.top}px`;

  // Anchor under .ui-root (persists across per-frame slot rebuilds) so the
  // animation isn't wiped by the next refresh(); fall back to body pre-mount.
  const layer = anchor.closest('.ui-root') ?? document.body;
  layer.appendChild(float);

  const cleanup = (): void => {
    float.remove();
  };
  float.addEventListener('animationend', cleanup, { once: true });
  // Fallback: never let a float outlive its animation (jsdom fires no
  // animationend; a backgrounded tab may throttle it).
  window.setTimeout(cleanup, BOOST_FLOAT_CLEANUP_MS);
}
