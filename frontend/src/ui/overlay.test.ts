// T047 — Unit tests for the DOM overlay foundation (FR-019).
//
// These exercise createOverlay against the REAL DOM via jsdom (vitest is
// configured `environment: 'jsdom'`). The overlay is framework-free TS, so
// jsdom is sufficient: document.createElement, replaceChildren,
// getComputedStyle (inline styles), and dataset all work here. (External
// stylesheet rules from styles.css are NOT applied by jsdom — so the
// pointer-events guarantee is asserted from the INLINE style createOverlay
// sets, which is the load-race-safe runtime guarantee and the thing that
// actually makes camera gestures pass through.)
//
// Covers the T047 acceptance: createOverlay mounts sections, refresh()
// re-renders a section from getState/getContent, and the pointer-events
// passthrough rules are applied.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOverlay, type OverlaySection } from './overlay';
import { createInitialState } from '../save/localStorage';
import { FALLBACK_CONTENT } from '../sim/fallbackContent';
import type { GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeState(loc: string): GameState {
  const s = createInitialState();
  s.resources.loc = loc;
  return s;
}

/** A section that renders an LOC readout from getState — mirrors how a real
 *  panel (HUD, T048) will derive its DOM from the per-frame accessors. */
function locReadoutSection(id: string): OverlaySection {
  return {
    id,
    render: (getState) => {
      const el = document.createElement('div');
      el.className = 'loc-readout';
      el.textContent = `LOC: ${getState().resources.loc}`;
      return el;
    },
  };
}

/** A section that reads getContent, proving both accessors reach render. */
function contentSection(id: string): OverlaySection {
  return {
    id,
    render: (_getState, getContent) => {
      const el = document.createElement('div');
      el.className = 'content-readout';
      el.textContent = `version: ${getContent().contentVersion}`;
      return el;
    },
  };
}

/** A section that returns null — it should hide (empty its slot) on refresh. */
function hiddenSection(id: string): OverlaySection {
  return {
    id,
    render: () => null,
  };
}

// ---------------------------------------------------------------------------
// createOverlay mounts sections
// ---------------------------------------------------------------------------

describe('createOverlay — mounting', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  it('creates one .ui-panel slot per section, in registration order', () => {
    createOverlay({
      mount,
      sections: [locReadoutSection('hud'), contentSection('economy'), locReadoutSection('academy')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    const slots = mount.querySelectorAll<HTMLElement>('.ui-panel');
    expect(slots).toHaveLength(3);
    expect(slots[0]!.dataset.panel).toBe('hud');
    expect(slots[1]!.dataset.panel).toBe('economy');
    expect(slots[2]!.dataset.panel).toBe('academy');
  });

  it('appends a single .ui-root container inside the mount', () => {
    createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    expect(mount.querySelectorAll('.ui-root')).toHaveLength(1);
    // The slots live inside the root, not directly in the mount.
    expect(mount.querySelector('.ui-root > .ui-panel')).not.toBeNull();
  });

  it('throws on a duplicate section id (defensive — stable layout invariant)', () => {
    expect(() =>
      createOverlay({
        mount,
        sections: [locReadoutSection('hud'), locReadoutSection('hud')],
        accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
      }),
    ).toThrow(/duplicate section id/);
  });
});

// ---------------------------------------------------------------------------
// refresh() re-renders a section from getState/getContent
// ---------------------------------------------------------------------------

describe('refresh — per-frame re-render from accessors', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  it('renders a section by calling render(getState, getContent)', () => {
    let state = makeState('0');
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud'), contentSection('economy')],
      accessors: {
        getState: () => state,
        getContent: () => FALLBACK_CONTENT,
      },
    });

    overlay.refresh();

    const hud = mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"] .loc-readout');
    const eco = mount.querySelector<HTMLElement>(
      '.ui-panel[data-panel="economy"] .content-readout',
    );
    expect(hud?.textContent).toBe('LOC: 0');
    expect(eco?.textContent).toBe(`version: ${FALLBACK_CONTENT.contentVersion}`);
  });

  it('re-renders on each refresh from the CURRENT accessor output (no stale state)', () => {
    let state = makeState('100');
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
    });

    overlay.refresh();
    const slot = mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"]')!;
    expect(slot.textContent).toContain('LOC: 100');

    // Simulate the game loop advancing state between frames.
    state = makeState('2500');
    overlay.refresh();

    // The slot's child is replaced wholesale (replaceChildren), not appended.
    expect(slot.querySelectorAll('.loc-readout')).toHaveLength(1);
    expect(slot.textContent).toContain('LOC: 2500');
  });

  it('clears a section whose render returns null (hide this frame)', () => {
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud'), hiddenSection('social')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    overlay.refresh();

    const social = mount.querySelector<HTMLElement>('.ui-panel[data-panel="social"]')!;
    expect(social.children).toHaveLength(0);
    // Truly empty: ZERO child nodes (not an empty text node), so the real-browser
    // CSS rule `.ui-panel:empty { display: none }` matches and the slot fully
    // collapses — no visible card, no phone-portrait gesture capture (T047 P2).
    // jsdom does not apply styles.css, so the collapse is verified structurally.
    expect(social.childNodes).toHaveLength(0);
    // The slot is retained so a later non-null render re-shows it.
    expect(social.dataset.panel).toBe('social');
  });

  it('survives a throwing render without crashing the loop (degrades silently)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = locReadoutSection('hud');
    const bad: OverlaySection = {
      id: 'broken',
      render: () => {
        throw new Error('boom');
      },
    };
    const overlay = createOverlay({
      mount,
      sections: [good, bad],
      accessors: { getState: () => makeState('7'), getContent: () => FALLBACK_CONTENT },
    });

    expect(() => overlay.refresh()).not.toThrow();
    // The healthy section still rendered.
    expect(
      mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"]')!.textContent,
    ).toContain('LOC: 7');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('destroy', () => {
  it('removes the overlay DOM from the mount', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    expect(mount.querySelector('.ui-root')).not.toBeNull();
    overlay.destroy();
    expect(mount.querySelector('.ui-root')).toBeNull();
  });

  it('makes subsequent refresh() a no-op (idempotent teardown)', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    overlay.destroy();
    expect(() => overlay.refresh()).not.toThrow();
    // Nothing re-appeared.
    expect(mount.querySelector('.ui-root')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pointer-events passthrough (FR-019: camera gestures reach the canvas)
// ---------------------------------------------------------------------------

describe('pointer-events passthrough', () => {
  it('sets pointer-events: none on the overlay root (camera gestures pass through)', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    // Inline style is the load-race-safe guarantee (styles.css reinforces it).
    // jsdom reflects inline styles via getComputedStyle.
    expect(getComputedStyle(overlay.root).pointerEvents).toBe('none');
  });

  it('lets a panel opt an interactive child back in via .ui-interactive', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const section: OverlaySection = {
      id: 'hud',
      render: (getState) => {
        const root = document.createElement('div');
        const btn = document.createElement('button');
        btn.className = 'ui-interactive';
        btn.textContent = `Boost @ ${getState().resources.loc}`;
        root.appendChild(btn);
        return root;
      },
    };
    const overlay = createOverlay({
      mount,
      sections: [section],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });

    overlay.refresh();

    // The interactive child exists and is a descendant of the transparent root.
    const btn = mount.querySelector<HTMLButtonElement>(
      '.ui-panel[data-panel="hud"] button.ui-interactive',
    );
    expect(btn).not.toBeNull();
    expect(overlay.root.contains(btn)).toBe(true);
    // The root itself stays transparent (the canvas gets the gestures that
    // miss the button).
    expect(getComputedStyle(overlay.root).pointerEvents).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Action delegation — pointerdown on the STABLE root (T048 P1 click-loss fix)
// ---------------------------------------------------------------------------
//
// refresh() re-renders sections every frame (replaceChildren). A DOM `click`
// only fires when pointerdown + pointerup land on the SAME element; a per-
// frame rebuild detaches the node that got pointerdown before pointerup lands,
// so the click never synthesizes and actions silently never fire during live
// gameplay. The fix: a SINGLE pointerdown listener on the STABLE .ui-root
// dispatches by `data-action`; pointerdown fires on press, before any rebuild.

/** Dispatch a pointerdown — the production activation path under delegation. */
function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

/** A section that renders a single data-action button (+ optional inner span). */
function actionSection(
  id: string,
  action: string,
  handler: (el: HTMLElement, acc: { getState: () => GameState; getContent: () => typeof FALLBACK_CONTENT }) => void,
  withChild = false,
): OverlaySection {
  return {
    id,
    render: () => {
      const btn = document.createElement('button');
      btn.dataset.action = action;
      btn.textContent = 'Go';
      if (withChild) {
        const icon = document.createElement('span');
        icon.textContent = '⚡';
        btn.appendChild(icon);
      }
      return btn;
    },
    actions: { [action]: handler },
  };
}

describe('action delegation — pointerdown on the stable root', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    mount.remove();
  });

  function mountOverlay(sections: OverlaySection[]): ReturnType<typeof createOverlay> {
    return createOverlay({
      mount,
      sections,
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });
  }

  it('fires the matching handler on pointerdown (delegated on the stable root)', () => {
    const handler = vi.fn();
    const overlay = mountOverlay([actionSection('hud', 'boost', handler)]);
    overlay.refresh();

    press(mount.querySelector('[data-action="boost"]')!);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes the data-action element + accessors to the handler', () => {
    const handler = vi.fn();
    const accessors = { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT };
    const overlay = createOverlay({
      mount,
      sections: [actionSection('hud', 'boost', handler)],
      accessors,
    });
    overlay.refresh();

    const btn = mount.querySelector<HTMLElement>('[data-action="boost"]')!;
    press(btn);

    expect(handler).toHaveBeenCalledWith(btn, accessors);
  });

  it('resolves the handler from a child of the button via closest()', () => {
    const handler = vi.fn();
    const overlay = mountOverlay([actionSection('hud', 'boost', handler, true)]);
    overlay.refresh();

    const icon = mount.querySelector('[data-action="boost"] span')!;
    press(icon);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBe(
      mount.querySelector('[data-action="boost"]'),
    );
  });

  it('ignores pointerdown/click on elements with no data-action', () => {
    const handler = vi.fn();
    const overlay = createOverlay({
      mount,
      sections: [
        {
          id: 'hud',
          render: () => {
            const d = document.createElement('div');
            d.textContent = 'no action';
            return d;
          },
          actions: { boost: handler },
        },
      ],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });
    overlay.refresh();

    const div = mount.querySelector('.ui-panel[data-panel="hud"] div')!;
    press(div);
    div.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('fires on a bare click with no preceding pointerdown (keyboard/screen-reader)', () => {
    const handler = vi.fn();
    const overlay = mountOverlay([actionSection('hud', 'boost', handler)]);
    overlay.refresh();

    mount
      .querySelector('[data-action="boost"]')!
      .dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire when a click immediately follows a pointerdown on the same action', () => {
    const handler = vi.fn();
    const overlay = mountOverlay([actionSection('hud', 'boost', handler)]);
    overlay.refresh();

    const btn = mount.querySelector('[data-action="boost"]')!;
    press(btn);
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  // Regression for the cubic P2: a press held longer than any fixed time
  // window before release must still NOT double-fire. The dedup is a press-
  // relative flag (set on pointerdown, consumed by the next matching click),
  // NOT a time window, so a long hold is safe (the old time-window code would
  // re-fire here once the hold exceeded the window).
  it('does not double-fire on a long press (click well after pointerdown) — dedup is duration-independent', () => {
    const handler = vi.fn();
    const overlay = mountOverlay([actionSection('hud', 'boost', handler)]);
    overlay.refresh();

    const btn = mount.querySelector('[data-action="boost"]')!;
    press(btn);
    // Simulate a long hold: the click arrives only at release. No time
    // advance is needed because the dedup ignores elapsed time entirely.
    btn.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires once per distinct press (two presses ⇒ two activations)', () => {
    const handler = vi.fn();
    const overlay = mountOverlay([actionSection('hud', 'boost', handler)]);
    overlay.refresh();

    const btn = () => mount.querySelector('[data-action="boost"]')!;
    press(btn());
    btn().dispatchEvent(new Event('click', { bubbles: true })); // tail of press 1
    press(btn()); // press 2 (re-arms suppression)
    btn().dispatchEvent(new Event('click', { bubbles: true })); // tail of press 2

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('throws on a duplicate action name across sections (defensive)', () => {
    expect(() =>
      createOverlay({
        mount,
        sections: [
          { id: 'a', render: () => document.createElement('div'), actions: { go: () => {} } },
          { id: 'b', render: () => document.createElement('div'), actions: { go: () => {} } },
        ],
        accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
      }),
    ).toThrow(/duplicate action/);
  });

  // ── THE REGRESSION TEST (T048 P1) ───────────────────────────────────────
  // Proves a data-action fires EVEN WHEN refresh() runs repeatedly between
  // pointerdown and pointerup (simulating 60fps rebuilds). Under the old
  // per-node `click` listener model this test FAILS (the rebuilt node detaches
  // before the click synthesizes); under pointerdown delegation it passes.
  it('fires a delegated action even when refresh() rebuilds the DOM between pointerdown and pointerup (60fps regression)', () => {
    const handler = vi.fn();
    const overlay = createOverlay({
      mount,
      sections: [
        {
          id: 'hud',
          render: () => {
            const btn = document.createElement('button');
            btn.dataset.action = 'boost';
            btn.textContent = 'Boost';
            return btn;
          },
          actions: { boost: handler },
        },
      ],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });
    overlay.refresh();

    // The press lands on the current button node …
    const pressed = mount.querySelector<HTMLElement>('[data-action="boost"]')!;
    pressed.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    // … the loop then rebuilds the DOM many times (60 fps) before the matching
    // pointerup/click could complete. Under the OLD per-node click-listener
    // model this rebuild detaches the node that got pointerdown, so the click
    // never synthesizes and the action never fires during live gameplay.
    for (let i = 0; i < 12; i++) overlay.refresh();

    // The originally-pressed node is now detached; a pointerup/click on it
    // cannot bubble to the live root — but it does not matter: under
    // pointerdown delegation the action already fired on press.
    pressed.dispatchEvent(new Event('pointerup', { bubbles: true }));
    pressed.dispatchEvent(new Event('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Refresh throttling (refreshMinIntervalMs) — T048 P1 DOM-churn fix
// ---------------------------------------------------------------------------

describe('refresh throttling (refreshMinIntervalMs)', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    mount.remove();
  });

  const slot = (m: HTMLElement): HTMLElement =>
    m.querySelector<HTMLElement>('.ui-panel[data-panel="hud"]')!;

  it('renders the leading call immediately and coalesces rapid calls into one trailing render (latest wins)', () => {
    let state = makeState('0');
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
      refreshMinIntervalMs: 100,
    });

    overlay.refresh(); // leading → renders immediately
    expect(slot(mount).textContent).toContain('LOC: 0');

    state = makeState('999');
    overlay.refresh(); // within window → deferred (DOM unchanged)
    expect(slot(mount).textContent).toContain('LOC: 0');

    vi.advanceTimersByTime(100); // trailing flush → latest state lands
    expect(slot(mount).textContent).toContain('LOC: 999');

    overlay.destroy();
  });

  it('renders every call when refreshMinIntervalMs is unset (no throttle — original contract)', () => {
    let state = makeState('0');
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
    });

    overlay.refresh();
    expect(slot(mount).textContent).toContain('LOC: 0');
    state = makeState('2500');
    overlay.refresh();
    expect(slot(mount).textContent).toContain('LOC: 2500');
  });

  it('clears a pending trailing render on destroy (no late render after teardown)', () => {
    let state = makeState('0');
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud')],
      accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
      refreshMinIntervalMs: 100,
    });
    overlay.refresh(); // leading
    state = makeState('999');
    overlay.refresh(); // schedules a trailing render
    overlay.destroy(); // must clear the trailing timer

    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(mount.querySelector('.ui-root')).toBeNull(); // nothing re-rendered
  });
});

// ---------------------------------------------------------------------------
// Hidden-panel collapse (T047 P2)
// ---------------------------------------------------------------------------

describe('hidden-panel collapse (T047 P2)', () => {
  it('a null render leaves the slot with ZERO child nodes so CSS .ui-panel:empty hides it', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const overlay = createOverlay({
      mount,
      sections: [locReadoutSection('hud'), hiddenSection('social')],
      accessors: { getState: () => makeState('0'), getContent: () => FALLBACK_CONTENT },
    });
    overlay.refresh();

    const social = mount.querySelector<HTMLElement>('.ui-panel[data-panel="social"]')!;
    // Truly empty: ZERO child nodes (not an empty text node), so the real-
    // browser CSS rule `.ui-panel:empty { display: none }` matches → no card,
    // no phone-portrait gesture capture. (jsdom does not apply styles.css, so
    // the collapse is verified structurally here.)
    expect(social.childNodes).toHaveLength(0);
    expect(social.children).toHaveLength(0);
    expect(social.dataset.panel).toBe('social');
  });
});
