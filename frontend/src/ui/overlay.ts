// T047 — DOM overlay foundation (FR-019).
//
// A framework-free TypeScript + CSS overlay that will replace the three
// in-canvas Phaser UI scenes (HudScene / EconomyScene / AcademyScene, retired
// in T051). This module provides ONLY the mounting + per-frame refresh
// machinery; the individual panels (HUD / economy / academy / social) register
// as `OverlaySection`s implemented in T048–T050, and the game loop drives the
// refresh from `main.ts` in T051.
//
// ## Why a DOM overlay (research: "UI architecture — DOM overlay")
// Canvas text cannot do responsive layout, scrolling, focus/accessibility, or
// the phone bottom-sheet ↔ desktop side-panel reflow FR-019 demands. Moving the
// panels to the DOM fixes both that and the audited off-screen `PANEL_X = 520`
// mobile defect (research: current visual baseline). No framework: a handful of
// panels re-rendered from the existing pure view models needs none, and the
// overlay itself adds zero dependencies (Principle V).
//
// ## The accessor-injection seam (Constitution Principle III)
// The game loop (main.ts, wired in T051) owns the wall clock, the network, and
// the authoritative `state`. It hands this overlay two pure READ accessors —
// `getState()` / `getContent()` — mirroring the exact seam the Phaser scenes
// already receive (`HudSceneInit`/`EconomySceneInit`/`AcademySceneInit` are
// plain `{ getState, getContent, on<Action> }` objects with zero Phaser types).
// Each panel section captures its STABLE action callbacks (onBoost / onCashOut
// / …) in a closure at construction time; per-frame data arrives fresh through
// `render`'s accessors, so a section never holds stale state and the action
// wiring never needs re-binding per frame.
//
// ## Pointer-events passthrough (research: "UI architecture" + Camera decision)
// The overlay sits above the Phaser canvas, but camera pan/zoom gestures must
// still reach the canvas. The overlay root is `pointer-events: none` (set
// INLINE on the element createOverlay creates, so the guarantee holds even
// before styles.css loads or if a CSS rule errors); only interactive children
// opt back in via the `.ui-interactive` class (styled in styles.css). This is
// the direct resolution of the retired HudScene's scene-wide `pointerdown`
// boost fighting camera input ("Input conflict resolved", Camera decision).

import type { ContentCatalog, GameState } from '../sim/types';

// ── Public API ───────────────────────────────────────────────────────────

/**
 * The live-data READ accessors the game loop injects. Identical in shape to the
 * accessors passed to the retired Phaser scenes, so T051 can forward the exact
 * same closures (`() => state`, `() => content`).
 */
export interface OverlayAccessors {
  /** Returns the current live GameState (advanced each tick by the game loop). */
  getState: () => GameState;
  /** Returns the versioned game content. */
  getContent: () => ContentCatalog;
}

/**
 * A renderable overlay section — one panel (HUD / economy / academy / social).
 *
 * A section is created by a panel factory (e.g. `createHudSection` in T048)
 * which captures that panel's STABLE action callbacks (onBoost, onCashOut, …)
 * in a closure. `render` receives only the per-frame data accessors, so the
 * panel never reads stale state and its action wiring stays static across the
 * lifetime of the overlay.
 */
export interface OverlaySection {
  /** Stable unique id. Keys the section's container slot (`data-panel`). */
  id: string;
  /**
   * (Re)build the section's DOM from the current state/content. Called once per
   * frame by `refresh()`. Return `null` to hide the section this frame — its
   * slot is emptied but retained, so a later non-null render re-shows it without
   * re-mounting (stable DOM order ⇒ stable responsive layout).
   */
  render: (
    getState: () => GameState,
    getContent: () => ContentCatalog,
  ) => HTMLElement | null;
}

/** Options for {@link createOverlay}. */
export interface CreateOverlayOptions {
  /** The DOM node to mount into (the `<div id="ui">` from index.html). */
  mount: HTMLElement;
  /** The panels to register, in display order. */
  sections: OverlaySection[];
  /** Live-data read accessors, forwarded to every section's `render` per frame. */
  accessors: OverlayAccessors;
}

/** A mounted overlay handle. */
export interface Overlay {
  /**
   * Re-render every section from the current accessors. Call once per frame from
   * the game loop (T051). Safe to call before sections produce content; a render
   * that throws is caught and logged so it can never crash the loop (FR-017/018
   * spirit: the overlay degrades silently).
   */
  refresh: () => void;
  /** Tear the overlay down: remove its DOM and detach all slots. Idempotent. */
  destroy: () => void;
  /** The overlay's root element (`.ui-root`), for advanced callers/tests. */
  readonly root: HTMLElement;
}

// ── Factory ──────────────────────────────────────────────────────────────

const UI_ROOT_CLASS = 'ui-root';
const UI_PANEL_CLASS = 'ui-panel';

/**
 * Build and mount the overlay.
 *
 * Creates a `.ui-root` container inside `mount`, one `.ui-panel` slot per
 * registered section (keyed by `data-panel="{id}"`), and returns a
 * `{ refresh, destroy, root }` handle. `refresh()` re-renders each section by
 * calling its `render(getState, getContent)` and swapping the slot's content
 * via `replaceChildren` — no diffing (panels are small; this is O(panels) per
 * frame, honoring the idle-game perf budget and Constitution Principle I's
 * O(active features) time-skip constraint).
 *
 * The `.ui-root` gets `pointer-events: none` INLINE (robust against stylesheet
 * load races) so camera gestures always reach the canvas; interactive panels
 * opt back in via the `.ui-interactive` class (styles.css).
 */
export function createOverlay(opts: CreateOverlayOptions): Overlay {
  const { mount, sections, accessors } = opts;

  // ── Root container ───────────────────────────────────────────────────
  // `pointer-events: none` inline = the overlay NEVER blocks canvas gestures,
  // even before styles.css loads or if a CSS rule errors. The matching
  // `#ui / .ui-root { pointer-events: none }` rule in styles.css is the
  // human-readable source of truth; this is the runtime guarantee.
  const root = document.createElement('div');
  root.className = UI_ROOT_CLASS;
  root.style.pointerEvents = 'none';

  // ── One slot per section, keyed by id ────────────────────────────────
  // Slots are created once and kept across refreshes so a returning section
  // reuses its slot (stable DOM order ⇒ stable responsive layout).
  const slots = new Map<string, HTMLElement>();
  for (const section of sections) {
    if (slots.has(section.id)) {
      throw new Error(`[overlay] duplicate section id: "${section.id}"`);
    }
    const slot = document.createElement('section');
    slot.className = UI_PANEL_CLASS;
    slot.dataset.panel = section.id;
    root.appendChild(slot);
    slots.set(section.id, slot);
  }

  mount.appendChild(root);

  let destroyed = false;

  function refresh(): void {
    if (destroyed) return;
    for (const section of sections) {
      const slot = slots.get(section.id);
      if (!slot) continue;

      let node: HTMLElement | null = null;
      try {
        node = section.render(accessors.getState, accessors.getContent);
      } catch (err) {
        // A panel render error must NEVER crash the game loop (FR-017/018
        // spirit: the overlay degrades silently). Log and leave the slot as-is
        // so a transient render failure doesn't blank the panel mid-frame.
        console.error(`[overlay] section "${section.id}" render failed`, err);
        continue;
      }

      // replaceChildren swaps the slot's content wholesale — cheap and
      // exception-safe (no manual remove/append dance). null ⇒ clear.
      slot.replaceChildren(node ?? '');
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    root.remove();
    slots.clear();
  }

  return {
    refresh,
    destroy,
    get root(): HTMLElement {
      return root;
    },
  };
}
