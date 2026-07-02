// T048 — Unit tests for the HUD overlay panel (FR-019), jsdom.
//
// These exercise hudPanel through the REAL overlay mount path (createOverlay +
// refresh) against the live DOM in jsdom. The HUD is framework-free TS reading
// state/content through the injected accessors, so jsdom suffices: it covers
// element creation, textContent, classList, getBoundingClientRect (zeros in
// jsdom — fine), and click dispatch. The PURE formatting/rate math
// (formatLoc/formatRate/computeRate) is unit-tested in sim/; these tests pin
// the DOM wiring that reads getState/getContent and wires the boost button.
//
// Acceptance covered: renders LOC + rate from getState/getContent; the boost
// button calls onBoost. Plus the boost float-text reducedMotion behavior.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOverlay } from './overlay';
import { hudPanel } from './hudPanel';
import { createInitialState } from '../save/localStorage';
import { FALLBACK_CONTENT } from '../sim/fallbackContent';
import type { GameState } from '../sim/types';

/** Dispatch a pointerdown — the production activation path under delegation. */
function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a GameState with the given overrides on top of createInitialState. */
function makeState(overrides: {
  loc?: string;
  ownedProducers?: string[];
  reducedMotion?: boolean;
} = {}): GameState {
  const s = createInitialState();
  if (overrides.loc !== undefined) s.resources.loc = overrides.loc;
  if (overrides.ownedProducers) s.ownedProducers = new Set(overrides.ownedProducers);
  if (overrides.reducedMotion !== undefined) s.settings.reducedMotion = overrides.reducedMotion;
  return s;
}

/** Mount a single hudPanel section and refresh once; return the mount. */
function mountHud(state: GameState, onBoost: () => void = () => {}): HTMLElement {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const overlay = createOverlay({
    mount,
    sections: [hudPanel({ onBoost })],
    accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
  });
  overlay.refresh();
  return mount;
}

/** Selector for the HUD slot's boost button. */
const BOOST_BTN = '.ui-panel[data-panel="hud"] .hud-boost';

// ---------------------------------------------------------------------------
// Rendering: LOC + rate from getState/getContent
// ---------------------------------------------------------------------------

describe('hudPanel — rendering', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    // Clear any transient boost floats (safety; mount removal handles its own).
    document.querySelectorAll('.hud-boost-float').forEach((el) => el.remove());
    mount.remove();
  });

  it('renders the LOC counter from getState (formatLoc)', () => {
    mount = mountHud(makeState({ loc: '1500' }));
    expect(
      mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"] .hud-loc')?.textContent,
    ).toBe('LOC: 1.50K');
  });

  it('renders the rate preview from computeRate + getContent (formatRate)', () => {
    // manual_typing has baseRate '1' in FALLBACK_CONTENT → +1.0/s with no other
    // owned features and no active co-op segment.
    mount = mountHud(makeState({ ownedProducers: ['manual_typing'] }));
    expect(
      mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"] .hud-rate')?.textContent,
    ).toBe('+1.0/s');
  });

  it('shows +0.0/s with no owned producers (baseline rate)', () => {
    mount = mountHud(makeState());
    expect(
      mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"] .hud-rate')?.textContent,
    ).toBe('+0.0/s');
  });

  it('re-renders from the CURRENT state on each refresh (no stale LOC)', () => {
    let state = makeState({ loc: '0' });
    const overlay = createOverlay({
      mount,
      sections: [hudPanel({ onBoost: () => {} })],
      accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
    });

    overlay.refresh();
    expect(
      mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"] .hud-loc')?.textContent,
    ).toBe('LOC: 0');

    // Simulate the game loop advancing state between frames.
    state = makeState({ loc: '2500' });
    overlay.refresh();
    expect(
      mount.querySelector<HTMLElement>('.ui-panel[data-panel="hud"] .hud-loc')?.textContent,
    ).toBe('LOC: 2.50K');
  });
});

// ---------------------------------------------------------------------------
// Boost button: calls onBoost (moves the boost off the canvas)
// ---------------------------------------------------------------------------

describe('hudPanel — boost button', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.querySelectorAll('.hud-boost-float').forEach((el) => el.remove());
    mount.remove();
  });

  it('calls onBoost exactly once when the boost button is activated (pointerdown delegation)', () => {
    const onBoost = vi.fn();
    const overlay = createOverlay({
      mount,
      sections: [hudPanel({ onBoost })],
      accessors: { getState: () => makeState({ loc: '10' }), getContent: () => FALLBACK_CONTENT },
    });
    overlay.refresh();

    press(mount.querySelector<HTMLButtonElement>(BOOST_BTN)!);

    expect(onBoost).toHaveBeenCalledTimes(1);
  });

  it('opts the boost button into pointer events via .ui-interactive (camera gestures pass through elsewhere)', () => {
    const overlay = createOverlay({
      mount,
      sections: [hudPanel({ onBoost: () => {} })],
      accessors: { getState: () => makeState(), getContent: () => FALLBACK_CONTENT },
    });
    overlay.refresh();

    const btn = mount.querySelector<HTMLButtonElement>(BOOST_BTN)!;
    expect(btn.classList.contains('ui-interactive')).toBe(true);
    // The button carries the delegated data-action (overlay.ts dispatches it).
    expect(btn.dataset.action).toBe('boost');
  });
});

// ---------------------------------------------------------------------------
// Boost float-text: honors state.settings.reducedMotion
// ---------------------------------------------------------------------------

describe('hudPanel — boost float-text honors reducedMotion', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.querySelectorAll('.hud-boost-float').forEach((el) => el.remove());
    mount.remove();
  });

  it('spawns a boost float-text on click when reducedMotion is off', () => {
    const overlay = createOverlay({
      mount,
      sections: [hudPanel({ onBoost: () => {} })],
      accessors: {
        getState: () => makeState({ ownedProducers: ['manual_typing'], reducedMotion: false }),
        getContent: () => FALLBACK_CONTENT,
      },
    });
    overlay.refresh();

    mount.querySelector<HTMLButtonElement>(BOOST_BTN)!.dispatchEvent(
      new Event('pointerdown', { bubbles: true }),
    );

    // The float carries the current rate (1 LOC/sec) formatted as the "+N".
    const float = mount.querySelector<HTMLElement>('.hud-boost-float');
    expect(float).not.toBeNull();
    expect(float?.textContent).toBe('+1');
  });

  it('does NOT spawn a boost float-text when reducedMotion is on', () => {
    const overlay = createOverlay({
      mount,
      sections: [hudPanel({ onBoost: () => {} })],
      accessors: {
        getState: () => makeState({ ownedProducers: ['manual_typing'], reducedMotion: true }),
        getContent: () => FALLBACK_CONTENT,
      },
    });
    overlay.refresh();

    mount.querySelector<HTMLButtonElement>(BOOST_BTN)!.dispatchEvent(
      new Event('pointerdown', { bubbles: true }),
    );

    expect(mount.querySelector('.hud-boost-float')).toBeNull();
  });
});
