// T050 — Academy DOM overlay panel (replaces AcademyScene).
//
// One of the three panels that retire the in-canvas Phaser UI scenes (HudScene /
// EconomyScene / AcademyScene, retired in T051). It is an `OverlaySection`
// produced by `academyPanel()` and registered with `createOverlay` (T047); the
// game loop drives its per-frame re-render via `refresh()`.
//
// quickstart.md Scenario 3: "Buy a lise Academy training → production
// permanently increases → reach a credential milestone → it registers as
// earned and grants a reward → both persist across reload."
//
// ## Testability split (Constitution Principle III)
// The PURE academy-view derivation (which trainings are affordable/locked/
// owned, which milestones are earned/preview/locked) lives in `../sim/academy`
// (`getAcademyView`) and is unit-tested in `academy.test.ts`. This module is
// ONLY the DOM wiring: it reads per-frame state via the accessors, derives the
// view through the pure function, and delegates the purchase mutation to the
// injected `onPurchaseTraining` callback that the wiring layer (T051) binds to
// the pure mutator in `actions.ts`. No game logic lives here.
//
// ## Action model (T048/T049/T050 unified interaction model)
// Purchasable (affordable) trainings render as `<button data-action=
// "purchase-training" data-training-id="…">` and the overlay's single
// `pointerdown` delegation listener (on the STABLE root) dispatches to this
// panel's `actions['purchase-training']` handler. Activation therefore
// survives the per-frame rebuild — pointerdown fires on press, before any
// refresh() swaps the button node (overlay.ts "Action delegation"). Locked
// and owned trainings render as non-interactive `<span>`s (no `data-action`,
// nothing to dispatch). This keeps the canvas's camera pan/zoom gestures
// working everywhere a tap isn't meaningful.

import type { OverlaySection } from './overlay';
import { formatLoc } from '../sim/format';
import { getAcademyView } from '../sim/academy';
import type { TrainingView, MilestoneView } from '../sim/academy';
import type { ResourceType } from '../sim/types';

// ── Public API ───────────────────────────────────────────────────────────

/** Options for {@link academyPanel}. */
export interface AcademyPanelOptions {
  /**
   * Called when the player taps an affordable, unowned training. T051 wires
   * this to `purchaseTraining` + state update + save. Only affordable trainings
   * are wired as clickable buttons, so this fires with a genuinely purchasable
   * id (locked/owned entries never call it).
   */
  onPurchaseTraining: (trainingId: string) => void;
}

/**
 * Build the academy overlay panel.
 *
 * The returned `OverlaySection` captures `onPurchaseTraining` in a closure
 * (STABLE action wiring — never re-bound per frame) and reads fresh per-frame
 * data through `render`'s accessors, so it never holds stale state (the
 * accessor-injection seam documented in `overlay.ts`).
 */
export function academyPanel(opts: AcademyPanelOptions): OverlaySection {
  const { onPurchaseTraining } = opts;

  return {
    id: 'academy',
    render: (getState, getContent) => {
      const view = getAcademyView(getState(), getContent());

      const root = document.createElement('div');
      root.className = 'academy-panel';

      root.appendChild(heading('LISE ACADEMY', 'academy-heading'));

      // ── Trainings ─────────────────────────────────────────────────────
      root.appendChild(
        section('TRAININGS', 'academy-trainings', view.trainings.map(trainingEntry)),
      );

      // ── Credentials / Milestones ──────────────────────────────────────
      root.appendChild(
        section('CREDENTIALS', 'academy-milestones', view.milestones.map(milestoneEntry)),
      );

      return root;

      // ── Element builders (close over onPurchaseTraining) ───────────────

      function trainingEntry(t: TrainingView): HTMLElement {
        const li = document.createElement('li');
        li.className = 'academy-training';
        li.dataset.trainingId = t.id;
        li.dataset.state = trainingState(t);

        if (t.affordable) {
          // The only interactive surface in this panel: a purchasable training.
          // `.ui-interactive` opts back into pointer events; activation is via
          // `data-action` delegation (overlay.ts) — no per-frame click listener.
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'academy-training-button ui-interactive';
          btn.dataset.action = 'purchase-training';
          btn.dataset.trainingId = t.id;
          btn.textContent = trainingLabel(t);
          btn.style.color = 'var(--economy-affordable)';
          li.appendChild(btn);
        } else {
          const span = document.createElement('span');
          span.className = 'academy-training-label';
          span.textContent = trainingLabel(t);
          span.style.color = t.owned
            ? 'var(--economy-owned)'
            : 'var(--academy-locked)';
          li.appendChild(span);
        }

        return li;
      }

      function milestoneEntry(m: MilestoneView): HTMLElement {
        const li = document.createElement('li');
        li.className = 'academy-milestone';
        li.dataset.milestoneId = m.id;
        li.dataset.state = milestoneState(m);
        li.textContent = milestoneLabel(m);
        li.style.color = milestoneColor(m);
        return li;
      }
    },
    // Delegated actions (overlay.ts dispatches by `data-action` from a SINGLE
    // pointerdown listener on the stable root, so this fires even when the
    // loop rebuilds the button mid-interaction).
    actions: {
      'purchase-training': (el) => {
        const trainingId = el.dataset.trainingId;
        if (trainingId) onPurchaseTraining(trainingId);
      },
    },
  };
}

// ── Element helpers ──────────────────────────────────────────────────────

/** A section card: a sub-heading + a `<ul>` of entries. */
function section(
  subheading: string,
  listClass: string,
  entries: HTMLElement[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'academy-section';
  wrap.appendChild(heading(subheading, 'academy-subheading'));

  const ul = document.createElement('ul');
  ul.className = listClass;
  for (const entry of entries) ul.appendChild(entry);
  wrap.appendChild(ul);
  return wrap;
}

/** A heading element at the given class level. */
function heading(text: string, className: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = className;
  h.textContent = text;
  return h;
}

// ── Label / state derivation (mirrors the retired AcademyScene) ──────────

/**
 * The human-readable line for a training, matching the retired AcademyScene:
 *  - owned:        `✓ Name (×N)`
 *  - locked (prereq unmet): `🔒 Name (×N)`
 *  - else:         `Name (×N, {resource} {cost})`
 *
 * Pure (no DOM); kept module-private.
 */
function trainingLabel(t: TrainingView): string {
  const mult = `×${t.permanentMultiplier}`;
  if (t.owned) return `✓ ${t.name} (${mult})`;
  if (!t.unlocked) return `🔒 ${t.name} (${mult})`;
  const costStr = formatLoc(t.cost.amount);
  const resLabel = t.cost.resource as ResourceType;
  return `${t.name} (${mult}, ${resLabel} ${costStr})`;
}

/** `data-state` for a training entry: `owned | locked | affordable | locked-cost`. */
function trainingState(t: TrainingView): string {
  if (t.owned) return 'owned';
  if (!t.unlocked) return 'locked';
  return t.affordable ? 'affordable' : 'locked-cost';
}

/**
 * The human-readable line for a milestone, matching the retired AcademyScene:
 *  - earned:         `🏅 ✓ Name`
 *  - requirement met (preview): `○ Name (ready)`
 *  - locked:         `🔒 Name`
 */
function milestoneLabel(m: MilestoneView): string {
  if (m.earned) return `🏅 ✓ ${m.name}`;
  if (m.requirementMet) return `○ ${m.name} (ready)`;
  return `🔒 ${m.name}`;
}

/** `data-state` for a milestone entry: `earned | preview | locked`. */
function milestoneState(m: MilestoneView): string {
  if (m.earned) return 'earned';
  if (m.requirementMet) return 'preview';
  return 'locked';
}

/** Inline color for a milestone, themed via the academy CSS tokens. */
function milestoneColor(m: MilestoneView): string {
  if (m.earned) return 'var(--academy-earned)'; // gold
  if (m.requirementMet) return 'var(--academy-color)'; // neutral "pending"
  return 'var(--academy-locked)'; // greyed
}
