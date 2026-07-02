// T087 — RED unit tests for the accessibility & reduced-motion pass (FR-019),
// jsdom.
//
// Covers the DOM-testable slice of T087:
//
//  - **Reduced motion (save setting)**: styles.css has always documented that
//    the `.ui-reduced-motion` class is applied to `.ui-root` from
//    `state.settings.reducedMotion` — but nothing ever applied it. The overlay
//    (the only code that owns `.ui-root` AND reads the state accessor per frame)
//    must toggle it on every render so ALL CSS animations/transitions in the
//    overlay obey the save setting, not just prefers-reduced-motion.
//  - **Panel landmarks**: each `.ui-panel` slot is a labelled region
//    (`role="region"` + `aria-label` from the section's new `ariaLabel`) so a
//    screen reader can jump between HUD/economy/academy/social. Every panel
//    factory provides the label.
//  - **Hidden slots leave the a11y tree**: a null render must ALSO set the
//    `hidden` attribute (belt-and-braces with the CSS `:empty` collapse, which
//    jsdom cannot verify) so an empty region is never announced.
//  - **Keyboard focus survives the per-frame rebuild**: refresh() replaces
//    every slot's children wholesale (replaceChildren), which silently drops
//    focus to <body> — at the 10 Hz production cadence a keyboard user can
//    never keep a button focused long enough to activate it. The overlay must
//    re-focus the matching `[data-action]` element after a rebuild.
//  - **Dialog semantics**: the social consent dialog gets `role="dialog"`,
//    `aria-modal="false"` (it is deliberately NON-modal — it never blocks the
//    game, FR-003), and aria-labelledby/-describedby wiring.
//  - **Heading hierarchy**: panel headings are <h2>, section subheadings <h3>
//    (economy/academy currently render everything as <h2>, which reads as a
//    flat, misleading outline).
//  - **Decorative motion is hidden from AT**: the transient boost float-text
//    is aria-hidden (it duplicates the LOC counter and would spam a screen
//    reader on every boost).
//  - **Tab order sanity**: every actionable element is a real <button>
//    (natural tab order, no tabindex hacks), and non-interactive state spans
//    (locked entries, the commuting indicator) are not focusable.
//
// NO aria-live regions are asserted anywhere: the panels are rebuilt wholesale
// at 10 Hz, and a re-created live region re-announces on every rebuild —
// that would be an accessibility REGRESSION, not an improvement.
//
// Touch-target minimums (>= 44 px) live in styles.css, which jsdom does not
// apply — they land as visual-only tweaks in the GREEN commit.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOverlay, type OverlaySection } from './overlay';
import { hudPanel } from './hudPanel';
import { economyPanel } from './economyPanel';
import { academyPanel } from './academyPanel';
import { socialPanel, type SocialPanelOptions } from './socialPanel';
import { createInitialState } from '../save/localStorage';
import { FALLBACK_CONTENT } from '../sim/fallbackContent';
import type { GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Dispatch a pointerdown — the production activation path under delegation. */
function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function makeState(overrides: { reducedMotion?: boolean } = {}): GameState {
  const s = createInitialState();
  if (overrides.reducedMotion !== undefined) {
    s.settings.reducedMotion = overrides.reducedMotion;
  }
  return s;
}

/** A minimal section rendering one data-action button (focus/refresh tests). */
function buttonSection(id: string, action: string, ariaLabel?: string): OverlaySection {
  return {
    id,
    ariaLabel,
    render: () => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = action;
      btn.textContent = 'Go';
      return btn;
    },
    actions: { [action]: () => {} },
  };
}

/** All four production panels with inert callbacks, in main.ts order. */
function productionSections(opts: Partial<SocialPanelOptions> = {}): OverlaySection[] {
  return [
    hudPanel({ onBoost: vi.fn(), onSwitchOffice: vi.fn() }),
    economyPanel({
      onCashOut: vi.fn(),
      onPurchaseUpgrade: vi.fn(),
      onActivateBurner: vi.fn(),
    }),
    academyPanel({ onPurchaseTraining: vi.fn() }),
    socialPanel({
      isSignedIn: () => false,
      getSettings: () => null,
      isSocialOnline: () => true,
      onSignIn: vi.fn(),
      onSettingsChange: vi.fn(),
      ...opts,
    }),
  ];
}

let mount: HTMLElement;

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
});

afterEach(() => {
  mount.remove();
});

function mountOverlay(
  sections: OverlaySection[],
  getState: () => GameState = () => makeState(),
): ReturnType<typeof createOverlay> {
  return createOverlay({
    mount,
    sections,
    accessors: { getState, getContent: () => FALLBACK_CONTENT },
  });
}

// ---------------------------------------------------------------------------
// Reduced motion: state.settings.reducedMotion → .ui-reduced-motion on .ui-root
// ---------------------------------------------------------------------------

describe('overlay — reduced motion from the save setting (T087)', () => {
  it('applies .ui-reduced-motion to .ui-root when state.settings.reducedMotion is set', () => {
    const overlay = mountOverlay(
      [buttonSection('hud', 'boost')],
      () => makeState({ reducedMotion: true }),
    );
    overlay.refresh();

    expect(overlay.root.classList.contains('ui-reduced-motion')).toBe(true);
  });

  it('removes the class again when the setting is off (live toggle, per render)', () => {
    let state = makeState({ reducedMotion: true });
    const overlay = mountOverlay([buttonSection('hud', 'boost')], () => state);

    overlay.refresh();
    expect(overlay.root.classList.contains('ui-reduced-motion')).toBe(true);

    state = makeState({ reducedMotion: false });
    overlay.refresh();
    expect(overlay.root.classList.contains('ui-reduced-motion')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Panel landmarks: labelled regions per slot
// ---------------------------------------------------------------------------

describe('overlay — panel slots are labelled regions (T087)', () => {
  it('gives a slot role="region" and aria-label from the section ariaLabel', () => {
    const overlay = mountOverlay([buttonSection('hud', 'boost', 'Game status')]);
    overlay.refresh();

    const slot = mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"]')!;
    expect(slot.getAttribute('role')).toBe('region');
    expect(slot.getAttribute('aria-label')).toBe('Game status');
    void overlay;
  });

  it('every production panel provides a non-empty ariaLabel', () => {
    for (const section of productionSections()) {
      expect(section.ariaLabel, `section "${section.id}" ariaLabel`).toBeTruthy();
    }
  });

  it('production slots carry their region labels through the overlay mount', () => {
    const overlay = mountOverlay(productionSections());
    overlay.refresh();

    for (const slot of mount.querySelectorAll<HTMLElement>('.ui-panel')) {
      expect(slot.getAttribute('role'), `slot "${slot.dataset.panel}"`).toBe('region');
      expect(slot.getAttribute('aria-label'), `slot "${slot.dataset.panel}"`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Hidden slots leave the accessibility tree
// ---------------------------------------------------------------------------

describe('overlay — a null render hides the slot from AT (T087)', () => {
  it('sets the hidden attribute on a null render and clears it when content returns', () => {
    let show = false;
    const section: OverlaySection = {
      id: 'social',
      ariaLabel: 'Social',
      render: () => {
        if (!show) return null;
        const el = document.createElement('div');
        el.textContent = 'content';
        return el;
      },
    };
    const overlay = mountOverlay([section]);

    overlay.refresh();
    const slot = mount.querySelector<HTMLElement>('.ui-panel[data-panel="social"]')!;
    // An EMPTY labelled region must not be announced: the CSS :empty collapse
    // handles the visual side (unverifiable in jsdom); `hidden` is the
    // runtime guarantee that also removes it from the a11y tree.
    expect(slot.hidden).toBe(true);

    show = true;
    overlay.refresh();
    expect(slot.hidden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keyboard focus survives the per-frame rebuild
// ---------------------------------------------------------------------------

describe('overlay — focus preservation across refresh (T087)', () => {
  /** A section whose rendered content CHANGES each refresh (ticking label),
   *  like the HUD's live LOC counter — forces a real rebuild every render. */
  function tickingSection(id: string, action: string): OverlaySection {
    let tick = 0;
    return {
      id,
      render: () => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.action = action;
        btn.textContent = `Go ${tick++}`;
        return btn;
      },
      actions: { [action]: () => {} },
    };
  }

  it('re-focuses the matching [data-action] element after a content-changing rebuild', () => {
    const overlay = mountOverlay([tickingSection('hud', 'boost')]);
    overlay.refresh();

    const before = mount.querySelector<HTMLButtonElement>('[data-action="boost"]')!;
    before.focus();
    expect(document.activeElement).toBe(before);

    // The production loop refreshes at 10 Hz — the changed content replaces
    // the button node.
    overlay.refresh();

    const after = mount.querySelector<HTMLButtonElement>('[data-action="boost"]')!;
    expect(after).not.toBe(before); // node really was rebuilt …
    expect(document.activeElement).toBe(after); // … and focus followed it
  });

  it('keeps the SAME node (no rebuild, no re-focus event) when the content is unchanged', () => {
    // (cubic P2) Rebuilding identical DOM would destroy + re-focus the
    // focused button every refresh — each programmatic focus is a
    // focus-change event screen readers announce, i.e. announcement spam at
    // 10 Hz. Unchanged content must leave the existing subtree untouched.
    const overlay = mountOverlay([buttonSection('hud', 'boost')]);
    overlay.refresh();

    const before = mount.querySelector<HTMLButtonElement>('[data-action="boost"]')!;
    before.focus();
    const focusSpy = vi.fn();
    before.addEventListener('focus', focusSpy);

    overlay.refresh();

    expect(mount.querySelector('[data-action="boost"]')).toBe(before); // same node
    expect(document.activeElement).toBe(before); // focus never moved
    expect(focusSpy).not.toHaveBeenCalled(); // no re-focus event → no AT re-announce
  });

  it('does not steal focus from elements outside the overlay', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const overlay = mountOverlay([tickingSection('hud', 'boost')]);
    overlay.refresh();

    outside.focus();
    overlay.refresh();

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

// ---------------------------------------------------------------------------
// Social consent dialog semantics (FR-003 — non-modal by design)
// ---------------------------------------------------------------------------

describe('socialPanel — consent dialog ARIA semantics (T087)', () => {
  it('marks the consent card role="dialog" aria-modal="false" with label/description wiring', () => {
    const overlay = mountOverlay(
      productionSections({
        isSignedIn: () => true,
        getSettings: () => ({ consentGiven: false, visible: false }),
      }),
    );
    overlay.refresh();

    const dialog = mount.querySelector<HTMLElement>('.social-consent')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('role')).toBe('dialog');
    // Deliberately non-modal: the dialog lives in the panel slot and never
    // blocks the game (FR-003) — aria-modal="false" states that explicitly.
    expect(dialog.getAttribute('aria-modal')).toBe('false');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading?.textContent).toContain('Für Kolleg:innen sichtbar sein?');

    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description?.textContent).toContain('Geteilt werden nur');
  });
});

// ---------------------------------------------------------------------------
// Heading hierarchy: h2 panel headings, h3 subheadings
// ---------------------------------------------------------------------------

describe('economy/academy panels — heading hierarchy (T087)', () => {
  it('economy: panel heading is <h2>, section subheadings are <h3>', () => {
    const overlay = mountOverlay(productionSections());
    overlay.refresh();

    const heading = mount.querySelector<HTMLElement>('.economy-heading')!;
    expect(heading.tagName).toBe('H2');

    const subheadings = mount.querySelectorAll<HTMLElement>('.economy-subheading');
    expect(subheadings.length).toBeGreaterThan(0);
    for (const sub of subheadings) {
      expect(sub.tagName).toBe('H3');
    }
  });

  it('academy: panel heading is <h2>, section subheadings are <h3>', () => {
    const overlay = mountOverlay(productionSections());
    overlay.refresh();

    const heading = mount.querySelector<HTMLElement>('.academy-heading')!;
    expect(heading.tagName).toBe('H2');

    const subheadings = mount.querySelectorAll<HTMLElement>('.academy-subheading');
    expect(subheadings.length).toBeGreaterThan(0);
    for (const sub of subheadings) {
      expect(sub.tagName).toBe('H3');
    }
  });
});

// ---------------------------------------------------------------------------
// Decorative motion hidden from AT
// ---------------------------------------------------------------------------

describe('hudPanel — boost float is aria-hidden (T087)', () => {
  it('spawns the float with aria-hidden="true" (decorative; duplicates the LOC counter)', () => {
    const state = makeState({ reducedMotion: false });
    state.ownedProducers = new Set(['manual_typing']);
    const overlay = mountOverlay(productionSections(), () => state);
    overlay.refresh();

    press(mount.querySelector('[data-action="boost"]')!);

    const float = overlay.root.querySelector<HTMLElement>('.hud-boost-float');
    expect(float).not.toBeNull();
    expect(float!.getAttribute('aria-hidden')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Tab order sanity — native buttons, no tabindex hacks, spans not focusable
// ---------------------------------------------------------------------------

describe('overlay — tab order sanity (T087)', () => {
  it('every actionable element is a native <button> without a tabindex override', () => {
    const overlay = mountOverlay(
      productionSections({
        isSignedIn: () => true,
        getSettings: () => ({ consentGiven: true, visible: true }),
      }),
    );
    overlay.refresh();

    const actionable = mount.querySelectorAll<HTMLElement>('[data-action]');
    expect(actionable.length).toBeGreaterThan(0);
    for (const el of actionable) {
      expect(el.tagName, `[data-action="${el.dataset.action}"]`).toBe('BUTTON');
      expect(el.hasAttribute('tabindex')).toBe(false); // natural DOM tab order
    }
  });

  it('no element in the overlay carries a positive tabindex (no order hijacking)', () => {
    const overlay = mountOverlay(productionSections());
    overlay.refresh();

    for (const el of overlay.root.querySelectorAll<HTMLElement>('[tabindex]')) {
      expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }
  });
});
