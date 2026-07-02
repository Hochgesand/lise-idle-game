// T049 — Unit tests for the economy DOM overlay panel (replaces EconomyScene).
//
// Exercises `economyPanel` against the REAL DOM via jsdom (vitest is configured
// `environment: 'jsdom'`). The panel is framework-free TS over
// `getEconomyView`, so jsdom is sufficient: document.createElement,
// querySelector, replaceChildren, and click events all work here.
//
// Covers the T049 acceptance: the panel renders cash + upgrades (+ burner)
// derived from getEconomyView(getState, getContent), the cash-out control
// calls onCashOut, and tapping an affordable upgrade calls onPurchaseUpgrade.
// Tapping an activatable burner calls onActivateBurner.

import { describe, it, expect, vi } from 'vitest';
import { economyPanel } from './economyPanel';
import { createOverlay } from './overlay';
import type { OverlaySection } from './overlay';
import type { BurnerState, ContentCatalog, GameState } from '../sim/types';

/** Dispatch a pointerdown — the production activation path under delegation. */
function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_ANCHOR = '2026-06-30T12:00:00.000Z';

/** Build a GameState with tunable resource balances (drive affordability). */
function makeState(overrides: {
  cash?: string;
  loc?: string;
  aiTokens?: string;
  ownedUpgrades?: string[];
  activeBurner?: BurnerState | null;
} = {}): GameState {
  const s: GameState = {
    resources: {
      loc: overrides.loc ?? '500',
      cash: overrides.cash ?? '1000',
      aiTokens: overrides.aiTokens ?? '0',
    },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(overrides.ownedUpgrades ?? []),
    ownedTrainings: new Set<string>(),
    activeBurner: overrides.activeBurner ?? null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: FIXED_ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
    activeTraining: null,
  };
  return s;
}

/** Minimal economy content: 2 upgrades (one affordable, one prereq-locked) +
 *  1 burner (activatable with ≥ 10 AI tokens). */
function makeEconomyContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.2.0',
    producers: [],
    upgrades: [
      {
        id: 'faster_typing',
        name: 'Faster Typing',
        cost: { resource: 'cash', amount: '50' },
        effect: { type: 'globalMultiplier', multiplier: 2 },
        prerequisite: null, // always available
      },
      {
        id: 'ai_assist',
        name: 'AI Assist',
        cost: { resource: 'cash', amount: '10000' },
        effect: { type: 'globalMultiplier', multiplier: 3 },
        prerequisite: { type: 'ownsUpgrade', targetId: 'faster_typing', threshold: null },
      },
    ],
    trainings: [],
    milestones: [],
    burners: [
      {
        id: 'gpu_burner',
        name: 'GPU Burner',
        fuelCostToActivate: '10',
        burnRate: '1',
        productionMultiplier: 5,
      },
    ],
  };
}

/** Render a section into a detached node and return the panel root. */
function render(section: OverlaySection): HTMLElement {
  const node = section.render(() => makeState(), () => makeEconomyContent());
  expect(node).not.toBeNull();
  return node!;
}

/** Mount a section under a real overlay (so the delegation listener is attached
 *  to the stable root) and refresh once; return the mount. */
function mountAndRefresh(section: OverlaySection): HTMLElement {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const overlay = createOverlay({
    mount,
    sections: [section],
    accessors: { getState: () => makeState(), getContent: () => makeEconomyContent() },
  });
  overlay.refresh();
  return mount;
}

// ---------------------------------------------------------------------------
// Section identity
// ---------------------------------------------------------------------------

describe('economyPanel — identity', () => {
  it('is an OverlaySection with id "economy"', () => {
    const section = economyPanel({
      onCashOut: () => {},
      onPurchaseUpgrade: () => {},
      onActivateBurner: () => {},
    });
    expect(section.id).toBe('economy');
    expect(typeof section.render).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Cash display + cash-out control
// ---------------------------------------------------------------------------

describe('economyPanel — cash display + cash-out', () => {
  it('renders the cash balance from getState (formatLoc)', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );

    // Fixture: cash '1000' → "1.00K".
    const amount = root.querySelector<HTMLElement>('.economy-cash-amount');
    expect(amount?.textContent).toBe('1.00K');
  });

  it('shows the ECONOMY + CASH / UPGRADES / BURNER headings', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );

    expect(root.querySelector('.economy-heading')?.textContent).toBe('ECONOMY');
    const subheadings = root.querySelectorAll('.economy-subheading');
    expect(subheadings).toHaveLength(3);
    expect(subheadings[0]!.textContent).toBe('CASH');
    expect(subheadings[1]!.textContent).toBe('UPGRADES');
    expect(subheadings[2]!.textContent).toBe('BURNER');
  });

  it('calls onCashOut with the fixed amount when the cash-out button is activated (pointerdown)', () => {
    const onCashOut = vi.fn();
    const mount = mountAndRefresh(
      economyPanel({
        onCashOut,
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );

    const btn = mount.querySelector<HTMLButtonElement>('.economy-cashout')!;
    expect(btn.textContent).toBe('Cash Out 100 LOC');
    press(btn);

    expect(onCashOut).toHaveBeenCalledOnce();
    expect(onCashOut).toHaveBeenCalledWith('100');
  });

  it('renders the cash-out control as an affordable button (green, data-action) when LOC ≥ amount', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );

    const control = root.querySelector<HTMLElement>('.economy-cashout')!;
    expect(control.tagName).toBe('BUTTON');
    expect((control as HTMLButtonElement).dataset.action).toBe('cash-out');
    expect(control.style.color).toBe('var(--economy-affordable)');
  });

  it('renders the cash-out control as a non-interactive span (grey, no action) when LOC < amount', () => {
    const section = economyPanel({
      onCashOut: () => {},
      onPurchaseUpgrade: () => {},
      onActivateBurner: () => {},
    });
    const root = section.render(
      () => makeState({ loc: '10' }), // < 100 LOC
      () => makeEconomyContent(),
    )!;

    const control = root.querySelector<HTMLElement>('.economy-cashout')!;
    // Unaffordable ⇒ a span (not a button), no data-action: an unaffordable
    // tap can never reach the mutator (consistent with upgrades + burner).
    expect(control.tagName).toBe('SPAN');
    expect(control.style.color).toBe('var(--economy-locked)');
    expect((control as HTMLElement).dataset.action).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Upgrade shop
// ---------------------------------------------------------------------------

describe('economyPanel — upgrade shop', () => {
  it('renders one entry per upgrade from getEconomyView', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );

    const entries = root.querySelectorAll<HTMLElement>('.economy-upgrade');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.dataset.upgradeId).toBe('faster_typing');
    expect(entries[1]!.dataset.upgradeId).toBe('ai_assist');
  });

  it('marks an affordable upgrade as data-state="affordable" with an interactive button', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );
    const ft = root.querySelector<HTMLElement>(
      '.economy-upgrade[data-upgrade-id="faster_typing"]',
    )!;

    // faster_typing costs 50 cash; fixture has 1000 → affordable + unlocked.
    expect(ft.dataset.state).toBe('affordable');
    const btn = ft.querySelector<HTMLButtonElement>('button.ui-interactive');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('Faster Typing (cash 50)');
  });

  it('marks a prereq-locked upgrade as data-state="locked" with a non-interactive span', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );
    const ai = root.querySelector<HTMLElement>(
      '.economy-upgrade[data-upgrade-id="ai_assist"]',
    )!;

    // ai_assist requires owning faster_typing (not owned) → locked.
    expect(ai.dataset.state).toBe('locked');
    expect(ai.querySelector('button')).toBeNull();
    expect(ai.querySelector('.ui-interactive')).toBeNull();
    expect(ai.textContent).toContain('🔒 AI Assist');
  });

  it('marks an owned upgrade as data-state="owned" with a checkmark and no button', () => {
    const section = economyPanel({
      onCashOut: () => {},
      onPurchaseUpgrade: () => {},
      onActivateBurner: () => {},
    });
    const root = section.render(
      () => makeState({ ownedUpgrades: ['faster_typing'] }),
      () => makeEconomyContent(),
    )!;

    const ft = root.querySelector<HTMLElement>(
      '.economy-upgrade[data-upgrade-id="faster_typing"]',
    )!;
    expect(ft.dataset.state).toBe('owned');
    expect(ft.querySelector('button')).toBeNull();
    expect(ft.textContent).toContain('✓ Faster Typing');
  });

  it('calls onPurchaseUpgrade with the id when an affordable button is activated (pointerdown)', () => {
    const onPurchaseUpgrade = vi.fn();
    const mount = mountAndRefresh(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade,
        onActivateBurner: () => {},
      }),
    );

    press(
      mount.querySelector<HTMLButtonElement>(
        '.economy-upgrade[data-upgrade-id="faster_typing"] button',
      )!,
    );

    expect(onPurchaseUpgrade).toHaveBeenCalledOnce();
    expect(onPurchaseUpgrade).toHaveBeenCalledWith('faster_typing');
  });

  it('does not call onPurchaseUpgrade from a locked upgrade (no button wired)', () => {
    const onPurchaseUpgrade = vi.fn();
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade,
        onActivateBurner: () => {},
      }),
    );

    // ai_assist is prereq-locked → no button → activating its entry does nothing.
    const ai = root.querySelector<HTMLElement>(
      '.economy-upgrade[data-upgrade-id="ai_assist"]',
    )!;
    expect(ai.querySelector('button')).toBeNull();
    ai.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onPurchaseUpgrade).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Burner activation + fuel remaining
// ---------------------------------------------------------------------------

describe('economyPanel — burner', () => {
  it('renders an activatable burner as data-state="activatable" with an activate button', () => {
    const section = economyPanel({
      onCashOut: () => {},
      onPurchaseUpgrade: () => {},
      onActivateBurner: () => {},
    });
    const root = section.render(
      () => makeState({ aiTokens: '20' }), // ≥ 10 → activatable
      () => makeEconomyContent(),
    )!;

    const burner = root.querySelector<HTMLElement>('.economy-burner-item')!;
    expect(burner.dataset.state).toBe('activatable');
    const btn = burner.querySelector<HTMLButtonElement>('button.ui-interactive');
    expect(btn).not.toBeNull();
    expect(burner.textContent).toContain('×5 boost');
  });

  it('renders a locked-cost burner (not enough tokens) as a non-interactive span', () => {
    const root = render(
      economyPanel({
        onCashOut: () => {},
        onPurchaseUpgrade: () => {},
        onActivateBurner: () => {},
      }),
    );

    // Fixture: aiTokens '0' < 10 → locked-cost, no button.
    const burner = root.querySelector<HTMLElement>('.economy-burner-item')!;
    expect(burner.dataset.state).toBe('locked-cost');
    expect(burner.querySelector('button')).toBeNull();
  });

  it('calls onActivateBurner with the burner id when the activate button is activated (pointerdown)', () => {
    const onActivateBurner = vi.fn();
    const section = economyPanel({
      onCashOut: () => {},
      onPurchaseUpgrade: () => {},
      onActivateBurner,
    });
    // Mount under a real overlay so the delegated pointerdown reaches the
    // handler (the burner needs ≥ 10 AI tokens to be activatable).
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const overlay = createOverlay({
      mount,
      sections: [section],
      accessors: { getState: () => makeState({ aiTokens: '20' }), getContent: () => makeEconomyContent() },
    });
    overlay.refresh();

    press(mount.querySelector<HTMLButtonElement>('.economy-burner-button')!);

    expect(onActivateBurner).toHaveBeenCalledOnce();
    expect(onActivateBurner).toHaveBeenCalledWith('gpu_burner');
  });

  it('shows fuel remaining (amber) and no activate button when the burner is active', () => {
    const section = economyPanel({
      onCashOut: () => {},
      onPurchaseUpgrade: () => {},
      onActivateBurner: () => {},
    });
    const active: BurnerState = {
      definitionId: 'gpu_burner',
      startedAt: FIXED_ANCHOR,
      fuelRemaining: '5',
    };
    const root = section.render(
      () => makeState({ activeBurner: active }),
      () => makeEconomyContent(),
    )!;

    const burner = root.querySelector<HTMLElement>('.economy-burner-item')!;
    expect(burner.dataset.state).toBe('active');
    expect(burner.querySelector('button')).toBeNull();
    expect(burner.textContent).toContain('ACTIVE');
    expect(burner.textContent).toContain('Fuel: 5');
  });
});

// ---------------------------------------------------------------------------
// Overlay integration
// ---------------------------------------------------------------------------

describe('economyPanel — overlay integration', () => {
  it('mounts inside createOverlay under the "economy" slot and refreshes', async () => {
    const { createOverlay } = await import('./overlay');
    const onCashOut = vi.fn();
    const onPurchaseUpgrade = vi.fn();
    const onActivateBurner = vi.fn();
    const mount = document.createElement('div');
    document.body.appendChild(mount);

    const overlay = createOverlay({
      mount,
      sections: [
        economyPanel({ onCashOut, onPurchaseUpgrade, onActivateBurner }),
      ],
      accessors: { getState: () => makeState(), getContent: () => makeEconomyContent() },
    });
    overlay.refresh();

    const slot = mount.querySelector<HTMLElement>('.ui-panel[data-panel="economy"]');
    expect(slot).not.toBeNull();
    expect(slot!.querySelectorAll('.economy-upgrade')).toHaveLength(2);
    expect(slot!.querySelector('.economy-burner-item')).not.toBeNull();

    // A cash-out activated through the mounted overlay still routes correctly.
    press(slot!.querySelector<HTMLButtonElement>('.economy-cashout')!);
    expect(onCashOut).toHaveBeenCalledWith('100');

    overlay.destroy();
  });
});
