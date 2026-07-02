// T049 — Economy DOM overlay panel (replaces EconomyScene), FR-019.
//
// One of the three panels that retire the in-canvas Phaser UI scenes
// (HudScene / EconomyScene / AcademyScene, retired in T051). It is an
// `OverlaySection` produced by `economyPanel()` and registered with
// `createOverlay` (T047); the game loop drives its per-frame re-render via
// `refresh()`.
//
// quickstart.md Scenario 2: "Accumulate LOC → cash out → buy burner →
// activate → LOC/sec multiplies while tokens deplete → returns to baseline
// when out." This panel is the direct fix for the audited off-screen
// `PANEL_X = 520` mobile defect (the retired EconomyScene fixed-position
// panel hung off the right edge at 375×812): in the DOM overlay it reflows
// into the responsive desktop side-panel / phone bottom-sheet layout
// (overlay.ts + styles.css), so it is always reachable.
//
// ## Testability split (Constitution Principle III)
// The PURE economy-view derivation (which upgrades are affordable/locked/
// owned, whether the burner is activatable/active, fuel remaining) lives in
// `../sim/economy` (`getEconomyView`) and is unit-tested in `economy.test.ts`.
// This module is ONLY the DOM wiring: it reads per-frame state via the
// accessors, derives the view through the pure function, and delegates the
// mutations (cashOut / purchaseUpgrade / activateBurner) to injected callbacks
// the wiring layer (T051) binds to the pure mutators in `actions.ts`. No game
// logic lives here.
//
// ## Action model (T048/T049/T050 unified interaction model)
// Buttons carry STABLE `data-action` attributes (cash-out / purchase-upgrade /
// activate-burner) plus per-entry `data-*-id`; the overlay's single
// `pointerdown` delegation listener (on the STABLE root) dispatches to this
// panel's `actions` map. Activation therefore survives the per-frame rebuild
// — pointerdown fires on press, before any refresh() swaps the button node
// (overlay.ts "Action delegation"). Affordability follows the same
// affordable=button / locked=span rule the sibling panels use: an
// unaffordable control renders as a non-interactive `<span>` (no
// `data-action`, nothing to dispatch), so an unaffordable tap can never reach
// the mutator.

import type { OverlaySection } from './overlay';
import { formatLoc } from '../sim/format';
import { canAfford, getEconomyView } from '../sim/economy';
import type { BurnerView, UpgradeView } from '../sim/economy';
import type { GameState, ResourceType } from '../sim/types';

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Fixed LOC amount converted per cash-out tap (mirrors the retired
 * EconomyScene's `CASH_OUT_AMOUNT`). MVP keeps it a single fixed button.
 */
const CASH_OUT_AMOUNT = '100';

/** Options for {@link economyPanel}. */
export interface EconomyPanelOptions {
  /**
   * Called when the player taps the cash-out button. T051 wires this to
   * `cashOut` + state update + save. Only enabled when the player has ≥
   * `CASH_OUT_AMOUNT` LOC (the button renders but is greyed otherwise).
   */
  onCashOut: (locAmount: string) => void;
  /**
   * Called when the player taps an affordable, unowned upgrade. T051 wires
   * this to `purchaseUpgrade`. Only affordable upgrades render as clickable
   * buttons (locked/owned entries never call it).
   */
  onPurchaseUpgrade: (upgradeId: string) => void;
  /**
   * Called when the player taps the activate-burner button. T051 wires this
   * to `activateBurner`. Only rendered when the burner is activatable (enough
   * AI tokens, not already active).
   */
  onActivateBurner: (burnerId: string) => void;
}

/**
 * Build the economy overlay panel.
 *
 * The returned `OverlaySection` captures the STABLE action callbacks
 * (`onCashOut` / `onPurchaseUpgrade` / `onActivateBurner`) in a closure at
 * construction time and reads fresh per-frame data through `render`'s
 * accessors, so it never holds stale state (the accessor-injection seam
 * documented in `overlay.ts`).
 */
export function economyPanel(opts: EconomyPanelOptions): OverlaySection {
  const { onCashOut, onPurchaseUpgrade, onActivateBurner } = opts;

  return {
    id: 'economy',
    render: (getState, getContent) => {
      const state = getState();
      const content = getContent();
      const view = getEconomyView(state, content);

      const root = document.createElement('div');
      root.className = 'economy-panel';

      root.appendChild(heading('ECONOMY', 'economy-heading'));

      // ── Cash display + cash-out control ───────────────────────────────
      root.appendChild(cashSection(state));

      // ── Upgrade shop ──────────────────────────────────────────────────
      root.appendChild(
        section('UPGRADES', 'economy-upgrades', view.upgrades.map(upgradeEntry)),
      );

      // ── Burner activation + fuel remaining ────────────────────────────
      root.appendChild(
        section('BURNER', 'economy-burner', [burnerEntry(view.burner)]),
      );

      return root;

      // ── Element builders (close over the action callbacks) ────────────

      function cashSection(s: GameState): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'economy-section economy-cash';
        wrap.appendChild(heading('CASH', 'economy-subheading'));

        // Cash balance (the spendable currency produced by cashing out LOC).
        const amount = document.createElement('div');
        amount.className = 'economy-cash-amount';
        amount.textContent = formatLoc(s.resources.cash);
        wrap.appendChild(amount);

        // Cash-out: an interactive button only when affordable (≥
        // CASH_OUT_AMOUNT LOC); otherwise a greyed non-interactive span (the
        // affordable=button / locked=span rule, consistent with upgrades +
        // burner — an unaffordable tap must never reach the mutator). Big-
        // number-safe via the pure `canAfford` helper (no parseFloat).
        const canCashOut = canAfford(s, {
          resource: 'loc',
          amount: CASH_OUT_AMOUNT,
        });
        if (canCashOut) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'economy-cashout ui-interactive';
          btn.dataset.action = 'cash-out';
          btn.textContent = `Cash Out ${CASH_OUT_AMOUNT} LOC`;
          btn.style.color = 'var(--economy-affordable)';
          wrap.appendChild(btn);
        } else {
          const span = document.createElement('span');
          span.className = 'economy-cashout economy-cashout-locked';
          span.textContent = `Cash Out ${CASH_OUT_AMOUNT} LOC`;
          span.style.color = 'var(--economy-locked)';
          wrap.appendChild(span);
        }

        return wrap;
      }

      function upgradeEntry(u: UpgradeView): HTMLElement {
        const li = document.createElement('li');
        li.className = 'economy-upgrade';
        li.dataset.upgradeId = u.id;
        li.dataset.state = upgradeState(u);

        const costStr = formatLoc(u.cost.amount);
        const resLabel = u.cost.resource as ResourceType;

        if (u.affordable) {
          // The only interactive upgrade surface: an affordable, unowned
          // upgrade. `.ui-interactive` opts back into pointer events;
          // activation is via `data-action` delegation (overlay.ts) — no
          // per-frame click listener.
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'economy-upgrade-button ui-interactive';
          btn.dataset.action = 'purchase-upgrade';
          btn.dataset.upgradeId = u.id;
          btn.textContent = `${u.name} (${resLabel} ${costStr})`;
          btn.style.color = 'var(--economy-affordable)';
          li.appendChild(btn);
        } else {
          const span = document.createElement('span');
          span.className = 'economy-upgrade-label';
          span.textContent = upgradeLabel(u, costStr, resLabel);
          span.style.color = u.owned
            ? 'var(--economy-owned)'
            : 'var(--economy-locked)';
          li.appendChild(span);
        }

        return li;
      }

      function burnerEntry(b: BurnerView | undefined): HTMLElement {
        const li = document.createElement('li');
        li.className = 'economy-burner-item';

        if (b === undefined) {
          li.dataset.state = 'none';
          li.textContent = 'No burner available';
          li.style.color = 'var(--economy-locked)';
          return li;
        }

        const def = b.def;
        const costStr = formatLoc(def.fuelCostToActivate);

        if (b.active) {
          // Active burner: show fuel remaining (amber), no activate button.
          li.dataset.state = 'active';
          const fuelStr = formatLoc(b.fuelRemaining ?? '0');
          const info = document.createElement('div');
          info.className = 'economy-burner-info';
          info.textContent = `${def.name} ACTIVE — Fuel: ${fuelStr} (×${def.productionMultiplier} boost)`;
          info.style.color = 'var(--economy-active)';
          li.appendChild(info);
          return li;
        }

        // Inactive burner: show cost info + an activate control that is a
        // button only when activatable (mirrors the affordable=button rule).
        li.dataset.state = b.activatable ? 'activatable' : 'locked-cost';
        const info = document.createElement('div');
        info.className = 'economy-burner-info';
        info.textContent = `${def.name} — Cost: ${costStr} AI tokens (×${def.productionMultiplier} boost)`;
        info.style.color = 'var(--economy-color)';
        li.appendChild(info);

        if (b.activatable) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'economy-burner-button ui-interactive';
          btn.dataset.action = 'activate-burner';
          btn.dataset.burnerId = def.id;
          btn.textContent = 'Activate Burner';
          btn.style.color = 'var(--economy-affordable)';
          li.appendChild(btn);
        } else {
          const span = document.createElement('span');
          span.className = 'economy-burner-label';
          span.textContent = 'Activate Burner';
          span.style.color = 'var(--economy-locked)';
          li.appendChild(span);
        }

        return li;
      }
    },
    // Delegated actions (overlay.ts dispatches by `data-action` from a SINGLE
    // pointerdown listener on the stable root, so these fire even when the
    // loop rebuilds the buttons mid-interaction). Per-entry ids travel on the
    // button's `data-*-id` attributes.
    actions: {
      'cash-out': () => onCashOut(CASH_OUT_AMOUNT),
      'purchase-upgrade': (el) => {
        const upgradeId = el.dataset.upgradeId;
        if (upgradeId) onPurchaseUpgrade(upgradeId);
      },
      'activate-burner': (el) => {
        const burnerId = el.dataset.burnerId;
        if (burnerId) onActivateBurner(burnerId);
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
  wrap.className = 'economy-section';
  wrap.appendChild(heading(subheading, 'economy-subheading'));

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

// ── Label / state derivation (mirrors the retired EconomyScene) ──────────

/**
 * The human-readable line for an upgrade (mirrors the sibling academyPanel's
 * marker-prefix convention so the DOM panels read consistently):
 *  - owned:        `✓ Name ({resource} {cost})`
 *  - locked (prereq unmet): `🔒 Name ({resource} {cost})`
 *  - else:         `Name ({resource} {cost})`
 *
 * Pure (no DOM); kept module-private.
 */
function upgradeLabel(u: UpgradeView, costStr: string, resLabel: ResourceType): string {
  if (u.owned) return `✓ ${u.name} (${resLabel} ${costStr})`;
  if (!u.unlocked) return `🔒 ${u.name} (${resLabel} ${costStr})`;
  return `${u.name} (${resLabel} ${costStr})`;
}

/** `data-state` for an upgrade entry: `owned | locked | affordable | locked-cost`. */
function upgradeState(u: UpgradeView): string {
  if (u.owned) return 'owned';
  if (!u.unlocked) return 'locked';
  return u.affordable ? 'affordable' : 'locked-cost';
}
