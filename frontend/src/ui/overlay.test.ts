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

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
