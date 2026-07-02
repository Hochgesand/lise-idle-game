// T064 — RED unit tests for the social overlay panel (US1), jsdom.
//
// The social panel is an `OverlaySection` (see overlay.ts) exercised through
// the REAL overlay mount path (createOverlay + refresh), like hudPanel.test.ts.
// It is thin DOM wiring over injected accessors/callbacks — no fetches of its
// own, no auth logic, no game logic:
//
//  - **Sign-in offer** (FR-002): "Kolleg:innen sehen? Anmelden" — shown ONLY
//    while signed out, NEVER forced, dismissible for the session. Sign-in is
//    always optional; the panel merely offers it.
//  - **First-run consent dialog** (FR-003): shown BEFORE any visibility, once
//    signed in with `consentGiven: false`. Explains exactly what is shared
//    (display name, avatar, office, activity, live/last-seen — the FR-004
//    allowlist), with accept/decline. The DECISION is delegated to the injected
//    `onSettingsChange` (main.ts wires it to
//    `PUT /api/v1/presence/settings` via restClient — contracts §2).
//  - **Hide/show toggle** (FR-003): visibility change at any time, again via
//    `onSettingsChange`.
//  - **"Social offline" badge** (FR-016): a clear but NON-BLOCKING indication
//    driven by the injected `isSocialOnline` accessor — the panel never probes
//    the network itself.
//
// This file imports `./socialPanel`, which does NOT exist yet, so the suite
// fails to resolve its import = RED, the correct TDD starting state
// (Constitution Principle III).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOverlay } from './overlay';
import { socialPanel, type SocialPanelOptions } from './socialPanel';
import { createInitialState } from '../save/localStorage';
import { FALLBACK_CONTENT } from '../sim/fallbackContent';
import type { PresenceSettings } from '../net/restClient';

/** Dispatch a pointerdown — the production activation path under delegation. */
function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLOT = '.ui-panel[data-panel="social"]';
const SIGNIN = `${SLOT} .social-signin`;
const SIGNIN_BTN = `${SLOT} [data-action="social-sign-in"]`;
const DISMISS_BTN = `${SLOT} [data-action="social-dismiss-signin"]`;
const CONSENT = `${SLOT} .social-consent`;
const ACCEPT_BTN = `${SLOT} [data-action="social-consent-accept"]`;
const DECLINE_BTN = `${SLOT} [data-action="social-consent-decline"]`;
const TOGGLE_BTN = `${SLOT} [data-action="social-toggle-visibility"]`;
const OFFLINE_BADGE = `${SLOT} .social-offline`;

interface Harness {
  mount: HTMLElement;
  refresh: () => void;
  onSignIn: ReturnType<typeof vi.fn>;
  onSettingsChange: ReturnType<typeof vi.fn>;
}

/**
 * Mount a single socialPanel section through createOverlay and refresh once.
 * Accessor overrides are live closures so a test can flip state between
 * refreshes (mirroring the game loop's per-frame accessor reads).
 */
function mountSocial(overrides: Partial<SocialPanelOptions> = {}): Harness {
  const onSignIn = vi.fn();
  const onSettingsChange = vi.fn();
  const opts: SocialPanelOptions = {
    isSignedIn: () => false,
    getSettings: () => null,
    isSocialOnline: () => true,
    onSignIn,
    onSettingsChange,
    ...overrides,
  };
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const state = createInitialState();
  const overlay = createOverlay({
    mount,
    sections: [socialPanel(opts)],
    accessors: { getState: () => state, getContent: () => FALLBACK_CONTENT },
  });
  overlay.refresh();
  return { mount, refresh: () => overlay.refresh(), onSignIn, onSettingsChange };
}

/** PresenceSettings shorthand. */
function settings(consentGiven: boolean, visible: boolean): PresenceSettings {
  return { consentGiven, visible };
}

let harness: Harness | null = null;

beforeEach(() => {
  harness = null;
});

afterEach(() => {
  harness?.mount.remove();
});

// ---------------------------------------------------------------------------
// Sign-in offer (FR-002 — never forced, dismissible, signed-out only)
// ---------------------------------------------------------------------------

describe('socialPanel — sign-in offer (FR-002)', () => {
  it('offers sign-in while signed out ("Kolleg:innen sehen? Anmelden")', () => {
    harness = mountSocial({ isSignedIn: () => false });
    const offer = harness.mount.querySelector<HTMLElement>(SIGNIN);
    expect(offer).not.toBeNull();
    expect(offer?.textContent).toContain('Kolleg:innen sehen?');
    const btn = harness.mount.querySelector<HTMLButtonElement>(SIGNIN_BTN);
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Anmelden');
    // Interactive surfaces opt back into pointer events (overlay passthrough).
    expect(btn?.classList.contains('ui-interactive')).toBe(true);
  });

  it('calls onSignIn exactly once when the offer is activated', () => {
    harness = mountSocial({ isSignedIn: () => false });
    press(harness.mount.querySelector(SIGNIN_BTN)!);
    expect(harness.onSignIn).toHaveBeenCalledTimes(1);
  });

  it('is dismissible: the dismiss control hides the offer on the next refresh', () => {
    harness = mountSocial({ isSignedIn: () => false });
    const dismiss = harness.mount.querySelector<HTMLElement>(DISMISS_BTN);
    expect(dismiss).not.toBeNull();
    press(dismiss!);
    harness.refresh();
    expect(harness.mount.querySelector(SIGNIN)).toBeNull();
    // Dismissing never triggers a sign-in (non-forcing, FR-002).
    expect(harness.onSignIn).not.toHaveBeenCalled();
  });

  it('collapses the slot entirely when dismissed and social is online (render null)', () => {
    harness = mountSocial({ isSignedIn: () => false, isSocialOnline: () => true });
    press(harness.mount.querySelector(DISMISS_BTN)!);
    harness.refresh();
    // replaceChildren() with zero nodes → :empty matches → CSS collapses the
    // card and the slot captures no gestures (overlay.ts hidden-panel rule).
    const slot = harness.mount.querySelector<HTMLElement>(SLOT);
    expect(slot?.childNodes.length).toBe(0);
  });

  it('never shows the offer while signed in', () => {
    harness = mountSocial({ isSignedIn: () => true, getSettings: () => settings(true, true) });
    expect(harness.mount.querySelector(SIGNIN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// First-run consent dialog (FR-003 — before any visibility)
// ---------------------------------------------------------------------------

describe('socialPanel — first-run consent dialog (FR-003)', () => {
  it('shows the consent dialog when signed in without consent, explaining what is shared', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(false, false),
    });
    const dialog = harness.mount.querySelector<HTMLElement>(CONSENT);
    expect(dialog).not.toBeNull();
    // The explanation names the FR-004 allowlist (what colleagues will see).
    for (const shared of ['Anzeigename', 'Avatar', 'Büro', 'Aktivität', 'zuletzt gesehen']) {
      expect(dialog?.textContent).toContain(shared);
    }
    expect(harness.mount.querySelector(ACCEPT_BTN)).not.toBeNull();
    expect(harness.mount.querySelector(DECLINE_BTN)).not.toBeNull();
  });

  it('does NOT show the dialog before the settings are known (null = /me pending)', () => {
    harness = mountSocial({ isSignedIn: () => true, getSettings: () => null });
    expect(harness.mount.querySelector(CONSENT)).toBeNull();
  });

  it('does NOT show the dialog while signed out (consent is a signed-in concern)', () => {
    harness = mountSocial({ isSignedIn: () => false, getSettings: () => null });
    expect(harness.mount.querySelector(CONSENT)).toBeNull();
  });

  it('accept sends { consentGiven: true, visible: true } via onSettingsChange', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(false, false),
    });
    press(harness.mount.querySelector(ACCEPT_BTN)!);
    expect(harness.onSettingsChange).toHaveBeenCalledTimes(1);
    expect(harness.onSettingsChange).toHaveBeenCalledWith({ consentGiven: true, visible: true });
  });

  it('decline sends { consentGiven: false, visible: false } and stops re-showing the dialog', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(false, false),
    });
    press(harness.mount.querySelector(DECLINE_BTN)!);
    expect(harness.onSettingsChange).toHaveBeenCalledTimes(1);
    expect(harness.onSettingsChange).toHaveBeenCalledWith({ consentGiven: false, visible: false });
    harness.refresh();
    expect(harness.mount.querySelector(CONSENT)).toBeNull();
  });

  it('after a decline, a re-open affordance brings the dialog back (visibility changeable at any time)', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(false, false),
    });
    press(harness.mount.querySelector(DECLINE_BTN)!);
    harness.refresh();
    const reopen = harness.mount.querySelector<HTMLElement>(
      `${SLOT} [data-action="social-consent-open"]`,
    );
    expect(reopen).not.toBeNull();
    press(reopen!);
    harness.refresh();
    expect(harness.mount.querySelector(CONSENT)).not.toBeNull();
  });

  it('does NOT show the dialog once consent is given (first-run only)', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(true, true),
    });
    expect(harness.mount.querySelector(CONSENT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hide/show toggle (FR-003 — change visibility at any time)
// ---------------------------------------------------------------------------

describe('socialPanel — hide/show toggle (FR-003)', () => {
  it('while visible, the toggle hides: sends { consentGiven: true, visible: false }', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(true, true),
    });
    const toggle = harness.mount.querySelector<HTMLElement>(TOGGLE_BTN);
    expect(toggle).not.toBeNull();
    press(toggle!);
    expect(harness.onSettingsChange).toHaveBeenCalledTimes(1);
    expect(harness.onSettingsChange).toHaveBeenCalledWith({ consentGiven: true, visible: false });
  });

  it('while hidden, the toggle shows: sends { consentGiven: true, visible: true }', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(true, false),
    });
    press(harness.mount.querySelector(TOGGLE_BTN)!);
    expect(harness.onSettingsChange).toHaveBeenCalledWith({ consentGiven: true, visible: true });
  });

  it('reflects the CURRENT visibility on each refresh (no stale toggle state)', () => {
    let current = settings(true, true);
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => current,
    });
    const visibleLabel = harness.mount.querySelector<HTMLElement>(TOGGLE_BTN)?.textContent;

    current = settings(true, false);
    harness.refresh();
    const hiddenLabel = harness.mount.querySelector<HTMLElement>(TOGGLE_BTN)?.textContent;

    // The button label must flip with the state (hide ↔ show affordance).
    expect(visibleLabel).toBeTruthy();
    expect(hiddenLabel).toBeTruthy();
    expect(hiddenLabel).not.toBe(visibleLabel);
  });

  it('shows no toggle without consent (consent comes BEFORE any visibility)', () => {
    harness = mountSocial({
      isSignedIn: () => true,
      getSettings: () => settings(false, false),
    });
    expect(harness.mount.querySelector(TOGGLE_BTN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "Social offline" badge (FR-016 — non-blocking, accessor-driven)
// ---------------------------------------------------------------------------

describe('socialPanel — social offline badge (FR-016)', () => {
  it('shows the badge when social is offline', () => {
    harness = mountSocial({ isSocialOnline: () => false });
    const badge = harness.mount.querySelector<HTMLElement>(OFFLINE_BADGE);
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('Social offline');
  });

  it('the badge is non-blocking: no action, not interactive', () => {
    harness = mountSocial({ isSocialOnline: () => false });
    const badge = harness.mount.querySelector<HTMLElement>(OFFLINE_BADGE)!;
    expect(badge.dataset.action).toBeUndefined();
    expect(badge.classList.contains('ui-interactive')).toBe(false);
  });

  it('shows no badge while social is online', () => {
    harness = mountSocial({ isSocialOnline: () => true, isSignedIn: () => false });
    expect(harness.mount.querySelector(OFFLINE_BADGE)).toBeNull();
  });

  it('coexists with the sign-in offer (signed out + offline)', () => {
    harness = mountSocial({ isSignedIn: () => false, isSocialOnline: () => false });
    expect(harness.mount.querySelector(OFFLINE_BADGE)).not.toBeNull();
    expect(harness.mount.querySelector(SIGNIN)).not.toBeNull();
  });

  it('tracks the accessor per refresh (offline → online clears the badge)', () => {
    let online = false;
    harness = mountSocial({ isSocialOnline: () => online });
    expect(harness.mount.querySelector(OFFLINE_BADGE)).not.toBeNull();
    online = true;
    harness.refresh();
    expect(harness.mount.querySelector(OFFLINE_BADGE)).toBeNull();
  });
});
