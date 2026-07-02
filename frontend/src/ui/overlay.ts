// T047 — DOM overlay foundation (FR-019).
//
// A framework-free TypeScript + CSS overlay that replaces the three in-canvas
// Phaser UI scenes (HudScene / EconomyScene / AcademyScene, retired in T051).
// This module provides the mounting + per-frame refresh machinery + the
// **action-delegation bus**; the individual panels (HUD / economy / academy /
// social) register as `OverlaySection`s (T048–T050) and the game loop drives
// the refresh from `main.ts` in T051.
//
// ## Why a DOM overlay (research: "UI architecture — DOM overlay")
// Canvas text cannot do responsive layout, scrolling, focus/accessibility, or
// the phone bottom-sheet ↔ desktop side-panel reflow FR-019 demands. Moving
// the panels to the DOM fixes both that and the audited off-screen `PANEL_X =
// 520` mobile defect (research: current visual baseline). No framework: a
// handful of panels re-rendered from the existing pure view models needs none,
// and the overlay itself adds zero dependencies (Principle V).
//
// ## The accessor-injection seam (Constitution Principle III)
// The game loop (main.ts, wired in T051) owns the wall clock, the network, and
// the authoritative `state`. It hands this overlay two pure READ accessors —
// `getState()` / `getContent()` — mirroring the exact seam the Phaser scenes
// already receive. Each panel section captures its STABLE action callbacks
// (onBoost / onCashOut / …) in a closure at construction time; per-frame data
// arrives fresh through `render`'s accessors, so a section never holds stale
// state and the action wiring never needs re-binding per frame.
//
// ## Action delegation — the per-frame-rebuild click-loss fix (T048 P1)
// refresh() re-renders sections every frame via `replaceChildren`. A DOM
// `click` is synthesized only when `pointerdown` + `pointerup` land on the
// SAME element; a per-frame rebuild detaches the node that got `pointerdown`
// before the matching `pointerup` arrives, so the `click` never fires and
// onBoost/onCashOut/onPurchase* are silently never called during live
// gameplay (the panel tests passed only because they refresh() once then
// click, never mid-stream).
//
// FIX: a SINGLE `pointerdown` listener on the STABLE `.ui-root` (never
// rebuilt) dispatches by `data-action`. `pointerdown` fires on press — BEFORE
// any rebuild — so the action lands regardless of what the loop does between
// press and release. A `click` listener is kept as an accessibility fallback
// (keyboard / screen-reader activation raises a `click` with no preceding
// `pointerdown` on the same action) and the press's own click tail is
// suppressed via a press-relative flag consumed by the next matching `click`
// (one per press), so a press never double-fires — including a long press held
// past any fixed time window. Panels expose their actions via `data-action`
// attributes + a per-section `actions` map; no per-frame listener is ever
// attached to a rebuilt node.
//
// ## Throttled refresh (T048 P1 — DOM churn at 60 fps)
// Optionally (`refreshMinIntervalMs`) refresh is throttled to a sane cadence
// (leading + trailing): the leading call in a quiet window renders
// immediately, rapid subsequent calls coalesce into a single trailing render
// that applies the LATEST accessor output. The DOM is never churned faster
// than the cadence, yet the final state always lands (no stale frame). When
// unset, `refresh()` renders every call (the original contract, used by
// synchronous tests).
//
// ## Pointer-events passthrough (research: "UI architecture" + Camera decision)
// The overlay sits above the Phaser canvas, but camera pan/zoom gestures must
// still reach the canvas. The overlay root is `pointer-events: none` (set
// INLINE on the element createOverlay creates, so the guarantee holds even
// before styles.css loads or if a CSS rule errors); only interactive children
// opt back in via the `.ui-interactive` class (styled in styles.css). This is
// the direct resolution of the retired HudScene's scene-wide `pointerdown`
// boost fighting camera input ("Input conflict resolved", Camera decision).
//
// ## Hidden-panel collapse (T047 P2)
// A section whose `render` returns `null` empties its slot via
// `replaceChildren()` (no args ⇒ ZERO child nodes, not an empty text node),
// so the CSS rule `.ui-panel:empty { display: none }` (styles.css) fully
// collapses the slot: no visible empty card on desktop, and no phone-portrait
// gesture capture (a `display: none` element receives no pointer events).

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
 * A delegated action handler. Registered by a panel via
 * {@link OverlaySection.actions} keyed by the `data-action` attribute the
 * panel stamps on its button(s); fired by the overlay's single `pointerdown`
 * delegation listener on the stable root.
 *
 * @param el        the element carrying `data-action` (resolved via
 *                  `closest('[data-action]']` from the event target, so a press
 *                  on a child icon still resolves to the button)
 * @param accessors the live-data READ accessors (for handlers that need the
 *                  current state/content, e.g. the HUD boost float's "+N")
 */
export type OverlayActionHandler = (el: HTMLElement, accessors: OverlayAccessors) => void;

/**
 * A renderable overlay section — one panel (HUD / economy / academy / social).
 *
 * A section is created by a panel factory (e.g. `hudPanel` in T048) which
 * captures that panel's STABLE action callbacks (onBoost, onCashOut, …) in a
 * closure. `render` receives only the per-frame data accessors, so the panel
 * never reads stale state and its action wiring stays static across the
 * lifetime of the overlay.
 */
export interface OverlaySection {
  /** Stable unique id. Keys the section's container slot (`data-panel`). */
  id: string;
  /**
   * (T087) Accessible name for the section's slot. When set, the slot becomes
   * a labelled landmark (`role="region"` + `aria-label`) so screen-reader
   * users can jump between the panels. Every production panel provides one;
   * optional so bare test sections stay minimal.
   */
  ariaLabel?: string;
  /**
   * (Re)build the section's DOM from the current state/content. Called on each
   * refresh (throttled or per-frame). Return `null` to hide the section this
   * frame — its slot is emptied but retained, so a later non-null render
   * re-shows it without re-mounting (stable DOM order ⇒ stable responsive
   * layout).
   */
  render: (
    getState: () => GameState,
    getContent: () => ContentCatalog,
  ) => HTMLElement | null;
  /**
   * Delegated action handlers keyed by `data-action`. The overlay attaches ONE
   * `pointerdown` listener on the stable root and dispatches to these by
   * `data-action`; panels stamp `data-action="…"` (plus any per-entry
   * `data-*-id`) on their buttons instead of attaching per-node listeners, so
   * the action survives the per-frame rebuild (T048 P1 click-loss fix).
   * Optional; a section with no interactive surface omits it.
   */
  actions?: Record<string, OverlayActionHandler>;
}

/** Options for {@link createOverlay}. */
export interface CreateOverlayOptions {
  /** The DOM node to mount into (the `<div id="ui">` from index.html). */
  mount: HTMLElement;
  /** The panels to register, in display order. */
  sections: OverlaySection[];
  /** Live-data read accessors, forwarded to every section's `render` per refresh. */
  accessors: OverlayAccessors;
  /**
   * Minimum interval between DOM renders (ms). When set (> 0), `refresh()`
   * throttles to a leading + trailing cadence so the overlay is not churned at
   * 60 fps (the loop drives refresh every frame; the DOM only repaints at most
   * every `refreshMinIntervalMs`, always applying the latest state). When
   * unset/0, `refresh()` renders every call (the original contract). The
   * pointerdown delegation makes activation correct at any refresh rate; this
   * is a DOM-churn optimization only.
   */
  refreshMinIntervalMs?: number;
}

/** A mounted overlay handle. */
export interface Overlay {
  /**
   * Re-render every section from the current accessors. Call once per frame
   * from the game loop (T051). Safe to call before sections produce content; a
   * render that throws is caught and logged so it can never crash the loop
   * (FR-017/018 spirit: the overlay degrades silently). Throttled when
   * `refreshMinIntervalMs` is set.
   */
  refresh: () => void;
  /** Tear the overlay down: remove its DOM, clear timers, detach all slots. Idempotent. */
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
 * registered section (keyed by `data-panel="{id}"`), wires the single
 * `pointerdown`/`click` action-delegation listener on the root, and returns a
 * `{ refresh, destroy, root }` handle. `refresh()` re-renders each section by
 * calling its `render(getState, getContent)` and swapping the slot's content
 * via `replaceChildren` — no diffing (panels are small; this is O(panels) per
 * render, honoring the idle-game perf budget and Constitution Principle I's
 * O(active features) time-skip constraint).
 *
 * The `.ui-root` gets `pointer-events: none` INLINE (robust against stylesheet
 * load races) so camera gestures always reach the canvas; interactive panels
 * opt back in via the `.ui-interactive` class (styles.css).
 */
export function createOverlay(opts: CreateOverlayOptions): Overlay {
  const { mount, sections, accessors, refreshMinIntervalMs } = opts;

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
    // (T087) A labelled slot is a navigable landmark. Set ONCE at creation —
    // the label is stable for the section's lifetime (the per-frame rebuild
    // only touches the slot's children, never the slot itself).
    if (section.ariaLabel !== undefined) {
      slot.setAttribute('role', 'region');
      slot.setAttribute('aria-label', section.ariaLabel);
    }
    root.appendChild(slot);
    slots.set(section.id, slot);
  }

  mount.appendChild(root);

  // ── Action-delegation bus (T048 P1 click-loss fix) ───────────────────
  // Flatten every section's `actions` into one map keyed by `data-action`.
  // Action names are global across panels (boost / cash-out / …); a collision
  // is a programming error.
  const actionMap = new Map<string, OverlayActionHandler>();
  for (const section of sections) {
    if (!section.actions) continue;
    for (const [name, handler] of Object.entries(section.actions)) {
      if (actionMap.has(name)) {
        throw new Error(`[overlay] duplicate action "${name}" across sections`);
      }
      actionMap.set(name, handler);
    }
  }

  // The press's own synthesized `click` (the browser fires click at pointerup)
  // must be suppressed so a mouse/touch press doesn't double-fire — the action
  // already ran on pointerdown. We use a press-relative FLAG (set on
  // pointerdown, consumed by the next matching `click`) rather than a fixed
  // time window: a time window would fail on a long press held longer than the
  // window before release, re-firing the action (a double spend). The flag is
  // duration-independent. A genuine keyboard/screen-reader `click` with no
  // preceding pointerdown on the same action still fires (accessibility).
  let suppressClickAction: string | null = null;

  function closestAction(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest<HTMLElement>('[data-action]');
  }

  function fire(btn: HTMLElement): void {
    const action = btn.dataset.action;
    if (!action) return;
    const handler = actionMap.get(action);
    if (handler) handler(btn, accessors);
  }

  // SINGLE pointerdown listener on the STABLE root — survives every per-frame
  // rebuild. Fires the action on PRESS (before any rebuild can swap the node).
  root.addEventListener('pointerdown', (e: Event) => {
    const btn = closestAction(e.target);
    if (!btn) {
      // A press off any action ends the previous press's click-suppression
      // window (bounds the rare stale-flag case where a press's click was
      // swallowed by a rebuild).
      suppressClickAction = null;
      return;
    }
    const action = btn.dataset.action;
    if (!action) return;
    // Mark this action's press so the browser-synthesized click (at pointerup,
    // possibly after a long hold) is swallowed — no double activation. A new
    // press supersedes any prior window.
    suppressClickAction = action;
    fire(btn);
  });

  // Accessibility fallback: keyboard / screen-reader activation raises a
  // `click` with no preceding pointerdown on the same action. The press's own
  // click tail is consumed (one suppression per press) so a mouse/touch press
  // never double-fires, regardless of how long it is held.
  root.addEventListener('click', (e: Event) => {
    const btn = closestAction(e.target);
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;
    if (action === suppressClickAction) {
      // This click is the tail of the press we already handled on pointerdown.
      suppressClickAction = null; // consume — one suppression per press
      return;
    }
    fire(btn);
  });

  // ── Refresh machinery (optionally throttled) ─────────────────────────
  const minInterval = refreshMinIntervalMs ?? 0;
  let lastRenderAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTrailing = false;

  function renderAll(): void {
    lastRenderAt = Date.now();
    pendingTrailing = false;

    // (T087) Reduced motion from the SAVE SETTING: styles.css's
    // `.ui-root.ui-reduced-motion` rule kills every overlay CSS animation/
    // transition, mirroring `prefers-reduced-motion` for players who set the
    // in-game toggle instead of the OS one. Toggled per render (the same
    // cadence every panel reads the state), so a mid-session change applies
    // on the next repaint. Guarded like a section render — a throwing state
    // accessor must never crash the loop.
    try {
      root.classList.toggle(
        'ui-reduced-motion',
        accessors.getState().settings.reducedMotion === true,
      );
    } catch (err) {
      console.error('[overlay] reduced-motion state read failed', err);
    }

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

      // (T087) `hidden` is the a11y-tree counterpart of the CSS `:empty`
      // collapse: an empty labelled region must not be announced (and, like
      // the inline pointer-events, it holds even if styles.css never loads).
      // Kept in sync BEFORE the unchanged-content skip below so the very
      // first null render (empty slot → empty slot) still hides the region.
      slot.hidden = node === null;

      // (T087, cubic P2) Unchanged-content skip: swapping identical DOM in
      // every refresh destroys + re-creates the focused element ~10×/second,
      // and each programmatic re-focus is a focus-change event screen readers
      // announce — the exact announcement spam this pass avoids elsewhere by
      // omitting aria-live. Both serializations come from the same DOM
      // serializer (after replaceChildren(node), slot.innerHTML ===
      // node.outerHTML), so string equality is exact. Safe to keep the old
      // subtree: sections render listener-free DOM by contract (activation is
      // data-action delegation on the root, never per-node listeners).
      const nextHtml = node === null ? '' : node.outerHTML;
      if (nextHtml === slot.innerHTML) continue;

      // (T087) Focus preservation: replaceChildren detaches the focused
      // element, silently dropping focus to <body> — at the production 10 Hz
      // refresh a keyboard user could never keep a button focused long enough
      // to activate it. Remember the focused element's data-action before the
      // swap and re-focus its replacement after. (data-action is the stable
      // identity across rebuilds — the same key the delegation bus uses.)
      const active = document.activeElement;
      let refocusAction: string | null = null;
      if (active instanceof HTMLElement && slot.contains(active)) {
        refocusAction =
          active.closest<HTMLElement>('[data-action]')?.dataset.action ?? null;
      }

      // replaceChildren swaps the slot's content wholesale — cheap and
      // exception-safe. null ⇒ replaceChildren() with NO args removes every
      // child node (not an empty text node), so CSS `.ui-panel:empty` matches
      // and the slot fully collapses (T047 P2).
      if (node) slot.replaceChildren(node);
      else slot.replaceChildren();

      if (refocusAction !== null) {
        // Match via dataset (not a selector interpolation) — no escaping
        // pitfalls, and `CSS.escape` is unavailable in some DOM environments.
        // preventScroll: the panels are already positioned on screen — the
        // default scroll-into-view would jank a scrollable panel every
        // rebuild while a control is focused (cubic P3).
        for (const el of slot.querySelectorAll<HTMLElement>('[data-action]')) {
          if (el.dataset.action === refocusAction) {
            el.focus({ preventScroll: true });
            break;
          }
        }
      }
    }
  }

  function refresh(): void {
    if (destroyed) return;
    if (minInterval > 0) {
      const elapsed = Date.now() - lastRenderAt;
      if (elapsed >= minInterval) {
        renderAll();
      } else {
        // Coalesce rapid calls into ONE trailing render that applies the latest
        // accessor output — the DOM never repaints faster than the cadence, yet
        // the final state always lands (no stale frame).
        pendingTrailing = true;
        if (trailingTimer === null) {
          trailingTimer = setTimeout(() => {
            trailingTimer = null;
            if (destroyed) return;
            if (pendingTrailing) renderAll();
          }, minInterval - elapsed);
        }
      }
    } else {
      renderAll();
    }
  }

  let destroyed = false;

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
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
