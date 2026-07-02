// T064 — Social overlay panel (US1): sign-in offer, first-run consent dialog,
// hide/show toggle, and the "social offline" badge.
//
// An `OverlaySection` (see overlay.ts) in the hudPanel/academyPanel factory
// style: the game loop drives a per-frame `render(getState, getContent)` and
// the panel rebuilds its DOM from the CURRENT injected accessors; the STABLE
// callbacks are captured once in the factory closure. This module is thin DOM
// wiring only — no fetches, no auth logic, no game logic:
//
//  - **Sign-in offer** (FR-002): "Kolleg:innen sehen? Anmelden" while signed
//    out. NEVER forced — a small dismissible card, and dismissing it is
//    remembered for the session (closure state). `onSignIn` is wired by
//    main.ts to `login()` (net/auth.ts).
//  - **First-run consent dialog** (FR-003): once signed in with
//    `consentGiven: false`, BEFORE any visibility. It explains exactly what
//    colleagues would see (the FR-004 allowlist: display name, avatar, office,
//    activity, live/last-seen) and offers accept/decline. Both outcomes go
//    through `onSettingsChange` — main.ts sends the result via
//    `PUT /api/v1/presence/settings` (restClient.putPresenceSettings) and the
//    heartbeat gate (T063) only opens after stored consent, so nothing is ever
//    shared before acceptance. A decline is remembered for the session and a
//    re-open affordance keeps visibility changeable at any time.
//  - **Hide/show toggle** (FR-003/FR-009): with consent given, a single button
//    flips `visible` via `onSettingsChange`.
//  - **"Social offline" badge** (FR-016): a clear but NON-BLOCKING indication
//    while the social backend/socket is unreachable. Driven by the injected
//    `isSocialOnline` accessor read per render — the panel never probes the
//    network itself, never intercepts input, never pauses the loop.
//
// ## Consent-flow states (per render, derived from accessors + closure flags)
//   signed-out            → sign-in offer (unless dismissed this session)
//   signed-out, dismissed → nothing (slot collapses)
//   signed-in, settings unknown (null) → nothing yet (/me pending — no flash)
//   signed-in, no consent, unanswered  → consent dialog (accept / decline)
//   signed-in, no consent, answered    → re-open affordance ("sichtbar werden")
//   signed-in, consent given           → hide/show visibility toggle
// The offline badge overlays ANY of these states whenever social is offline.
//
// ## Action model (unified interaction model, see overlay.ts)
// Buttons carry STABLE `data-action` attributes dispatched by the overlay's
// single `pointerdown` delegation listener on the stable root, so activation
// survives the per-frame rebuild. All touch targets are >= 44px via
// `.social-button` (styles.css).
//
// ## Testability (Constitution Principle III)
// Framework-free TS exercised in jsdom (socialPanel.test.ts) through the real
// overlay mount path. All decisions (auth state, settings, reachability) come
// from injected accessors; all effects go out through injected callbacks.

import type { OverlaySection } from './overlay';
import type { PresenceSettings } from '../net/restClient';

// ── Factory ──────────────────────────────────────────────────────────────

/** Options for {@link socialPanel}. */
export interface SocialPanelOptions {
  /** Current auth state — main.ts wires `isSignedIn` from net/auth.ts. */
  isSignedIn: () => boolean;
  /**
   * The presence settings known to the client (from `GET /api/v1/me`, echoed
   * by `PUT /api/v1/presence/settings`). `null` = not yet known (lookup
   * pending/failed) — the consent dialog is NOT shown on unknown settings, so
   * it can never flash before `/me` resolves.
   */
  getSettings: () => PresenceSettings | null;
  /**
   * Social reachability for the FR-016 badge — a status the OWNER derives
   * (main.ts: the STOMP connection state). Read per render; the panel never
   * performs its own probes.
   */
  isSocialOnline: () => boolean;
  /** Called when the player taps "Anmelden" — wired to `login()` (net/auth.ts). */
  onSignIn: () => void;
  /**
   * Called with the desired settings on consent accept/decline and on the
   * hide/show toggle. The OWNER (main.ts) performs the
   * `PUT /api/v1/presence/settings` and refreshes `getSettings` from the
   * stored server echo — the panel itself never fetches (FR-016 posture:
   * failures degrade outside the render path).
   */
  onSettingsChange: (settings: PresenceSettings) => void;
}

/**
 * Build the social overlay section (stable id `'social'`, keying its
 * `.ui-panel` slot — bottom-left on desktop, part of the sheet on phone).
 * Returns `null` from `render` when there is nothing to show, collapsing the
 * slot entirely (overlay.ts hidden-panel rule) so the idle default costs no
 * screen space and captures no gestures.
 */
export function socialPanel(opts: SocialPanelOptions): OverlaySection {
  const { isSignedIn, getSettings, isSocialOnline, onSignIn, onSettingsChange } = opts;

  // Session-scoped UI memory (closure state — intentionally NOT persisted):
  // a dismissed offer stays away for this session only; the offer may return
  // next boot (still non-blocking, FR-002). Consent itself is server-side
  // state; these flags only stop the dialog from re-rendering every frame
  // after an answer (the PUT round-trip refreshes getSettings).
  let signInDismissed = false;
  let consentAnswered = false;

  return {
    id: 'social',
    render: () => {
      const parts: HTMLElement[] = [];

      // ── FR-016: non-blocking "social offline" badge ─────────────────────
      // Rendered FIRST in every state — a passive indicator (no data-action,
      // no .ui-interactive: pointer events pass through to the camera).
      if (!isSocialOnline()) {
        const badge = document.createElement('div');
        badge.className = 'social-offline';
        badge.textContent = '⚠ Social offline';
        parts.push(badge);
      }

      if (!isSignedIn()) {
        // ── FR-002: sign-in offer — never forced, dismissible ─────────────
        if (!signInDismissed) {
          parts.push(renderSignInOffer());
        }
      } else {
        const settings = getSettings();
        if (settings !== null) {
          if (settings.consentGiven) {
            // ── FR-003: hide/show toggle (changeable at any time) ─────────
            parts.push(renderVisibilityToggle(settings));
          } else if (!consentAnswered) {
            // ── FR-003: first-run consent dialog BEFORE any visibility ────
            parts.push(renderConsentDialog());
          } else {
            // Declined (or accept still in flight): a quiet re-open
            // affordance — visibility stays changeable at any time.
            parts.push(renderConsentReopen());
          }
        }
        // settings === null: /me pending or failed — render nothing rather
        // than flash a consent dialog on unknown state (fail quiet, FR-016).
      }

      if (parts.length === 0) {
        return null; // collapse the slot entirely (no card, no gesture capture)
      }

      const root = document.createElement('div');
      root.className = 'social-panel';
      for (const part of parts) root.appendChild(part);
      return root;
    },

    // Delegated actions (overlay.ts dispatches by `data-action` from a SINGLE
    // pointerdown listener on the stable root — survives per-frame rebuilds).
    actions: {
      'social-sign-in': () => {
        onSignIn();
      },
      'social-dismiss-signin': () => {
        signInDismissed = true;
      },
      'social-consent-accept': () => {
        consentAnswered = true;
        onSettingsChange({ consentGiven: true, visible: true });
      },
      'social-consent-decline': () => {
        consentAnswered = true;
        onSettingsChange({ consentGiven: false, visible: false });
      },
      'social-consent-open': () => {
        consentAnswered = false; // re-show the dialog on the next refresh
      },
      'social-toggle-visibility': () => {
        const settings = getSettings();
        if (settings === null || !settings.consentGiven) return; // stale press
        onSettingsChange({ consentGiven: true, visible: !settings.visible });
      },
    },
  };
}

// ── Element builders (module-private, stateless) ──────────────────────────

/** The FR-002 sign-in offer: prompt + "Anmelden" + a dismiss control. */
function renderSignInOffer(): HTMLElement {
  const offer = document.createElement('div');
  offer.className = 'social-signin';

  const prompt = document.createElement('span');
  prompt.className = 'social-signin-prompt';
  prompt.textContent = 'Kolleg:innen sehen?';
  offer.appendChild(prompt);

  offer.appendChild(
    button('social-sign-in', 'Anmelden', 'social-signin-button'),
  );

  const dismiss = button('social-dismiss-signin', '✕', 'social-dismiss-button');
  dismiss.setAttribute('aria-label', 'Anmelde-Hinweis ausblenden');
  offer.appendChild(dismiss);

  return offer;
}

/**
 * The FR-003 first-run consent dialog (non-modal — it lives in the panel slot
 * and never blocks the game). Explains the exact FR-004 allowlist of shared
 * fields; nothing is shared before acceptance (the T063 heartbeat gate stays
 * closed while `consentGiven` is false).
 */
function renderConsentDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.className = 'social-consent';

  const heading = document.createElement('h2');
  heading.className = 'social-heading';
  heading.textContent = 'Für Kolleg:innen sichtbar sein?';
  dialog.appendChild(heading);

  const text = document.createElement('p');
  text.className = 'social-consent-text';
  text.textContent =
    'Geteilt werden nur: Anzeigename, Avatar, Büro, Aktivität und ' +
    'Live-/„zuletzt gesehen“-Status. Keine E-Mail, kein Spielstand. ' +
    'Du kannst dich jederzeit wieder verstecken.';
  dialog.appendChild(text);

  const row = document.createElement('div');
  row.className = 'social-consent-actions';
  row.appendChild(button('social-consent-accept', 'Einverstanden', 'social-accept-button'));
  row.appendChild(button('social-consent-decline', 'Nicht jetzt', 'social-decline-button'));
  dialog.appendChild(row);

  return dialog;
}

/** After a decline: a quiet affordance to re-open the consent dialog. */
function renderConsentReopen(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'social-consent-closed';
  wrap.appendChild(
    button('social-consent-open', 'Für Kolleg:innen sichtbar werden …', 'social-reopen-button'),
  );
  return wrap;
}

/** With consent given: current visibility + the hide/show toggle (FR-003). */
function renderVisibilityToggle(settings: PresenceSettings): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'social-visibility';

  const status = document.createElement('span');
  status.className = 'social-visibility-state';
  status.dataset.visible = String(settings.visible);
  status.textContent = settings.visible
    ? 'Sichtbar für Kolleg:innen'
    : 'Versteckt';
  wrap.appendChild(status);

  wrap.appendChild(
    button(
      'social-toggle-visibility',
      settings.visible ? 'Verstecken' : 'Sichtbar werden',
      'social-toggle-button',
    ),
  );

  return wrap;
}

/**
 * A panel button: `.ui-interactive` opts back into pointer events (the overlay
 * root is gesture-transparent); `.social-button` provides the >= 44px touch
 * target (styles.css); activation is via `data-action` delegation — no
 * per-frame listener.
 */
function button(action: string, label: string, className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `social-button ${className} ui-interactive`;
  btn.dataset.action = action;
  btn.textContent = label;
  return btn;
}
