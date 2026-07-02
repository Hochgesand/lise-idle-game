// T050 — Unit tests for the academy DOM overlay panel.
//
// Exercises `academyPanel` against the REAL DOM via jsdom (vitest is configured
// `environment: 'jsdom'`). The panel is framework-free TS over
// `getAcademyView`, so jsdom is sufficient: document.createElement,
// querySelector, replaceChildren, and click events all work here.
//
// Covers the T050 acceptance: the panel renders trainings + milestones derived
// from getAcademyView(getState, getContent), and tapping an affordable training
// calls onPurchaseTraining with that training's id.

import { describe, it, expect, vi } from 'vitest';
import { academyPanel } from './academyPanel';
import type { OverlaySection } from './overlay';
import type { ContentCatalog, GameState } from '../sim/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_ANCHOR = '2026-06-30T12:00:00.000Z';

/** A state with a known cash balance (drives training affordability). */
function makeState(cash: string, ownedTrainings = new Set<string>()): GameState {
  return {
    resources: { loc: '1000', cash, aiTokens: '0' },
    ownedProducers: new Set<string>(['manual_typing']),
    ownedUpgrades: new Set<string>(),
    ownedTrainings,
    activeBurner: null,
    earnedMilestones: new Set<string>(),
    lastAdvancedAt: FIXED_ANCHOR,
    schemaVersion: 1,
    settings: { reducedMotion: false, muted: false },
    coopSegments: [],
    activeOffice: 'office_1',
    commute: null,
  };
}

/** Minimal academy content: 2 trainings (one always-unlocked, one gated) +
 *  3 milestones (earned / preview / locked). */
function makeAcademyContent(): ContentCatalog {
  return {
    schemaVersion: 1,
    contentVersion: '1.2.0',
    producers: [],
    upgrades: [],
    trainings: [
      {
        id: 'iso_9001_course',
        name: 'ISO 9001 Course',
        description: 'Learn quality management basics.',
        cost: { resource: 'cash', amount: '500' },
        permanentMultiplier: 2,
        prerequisite: null, // always available
      },
      {
        id: 'agile_master',
        name: 'Agile Master',
        description: 'Master Scrum and Kanban.',
        cost: { resource: 'cash', amount: '200' },
        permanentMultiplier: 3,
        prerequisite: { type: 'ownsTraining', targetId: 'iso_9001_course', threshold: null },
      },
    ],
    milestones: [
      {
        id: 'iso_9001_certified',
        name: 'ISO 9001 Certified',
        requirement: { type: 'resourceGte', targetId: 'loc', threshold: '500' },
        reward: { type: 'grantResource', resource: 'cash', amount: '50' },
      },
      {
        id: 'gold_partner',
        name: 'Microsoft Gold Partner',
        requirement: { type: 'ownsTraining', targetId: 'agile_master', threshold: null },
        reward: { type: 'globalMultiplier', multiplier: 1.5 },
      },
    ],
    burners: [],
  };
}

/** Render a section into a detached mount and return the section's slot root. */
function render(section: OverlaySection): HTMLElement {
  const node = section.render(() => makeState('1000'), () => makeAcademyContent());
  expect(node).not.toBeNull();
  return node!;
}

// ---------------------------------------------------------------------------
// Section identity
// ---------------------------------------------------------------------------

describe('academyPanel — identity', () => {
  it('is an OverlaySection with id "academy"', () => {
    const section = academyPanel({ onPurchaseTraining: () => {} });
    expect(section.id).toBe('academy');
    expect(typeof section.render).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Trainings
// ---------------------------------------------------------------------------

describe('academyPanel — trainings list', () => {
  it('renders one entry per training from getAcademyView', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));

    const entries = root.querySelectorAll<HTMLElement>('.academy-training');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.dataset.trainingId).toBe('iso_9001_course');
    expect(entries[1]!.dataset.trainingId).toBe('agile_master');
  });

  it('shows the heading + TRAININGS / CREDENTIALS subheadings', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));

    expect(root.querySelector('.academy-heading')?.textContent).toBe('LISE ACADEMY');
    const subheadings = root.querySelectorAll('.academy-subheading');
    expect(subheadings).toHaveLength(2);
    expect(subheadings[0]!.textContent).toBe('TRAININGS');
    expect(subheadings[1]!.textContent).toBe('CREDENTIALS');
  });

  it('marks an affordable training as data-state="affordable" with an interactive button', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));
    const iso = root.querySelector<HTMLElement>('.academy-training[data-training-id="iso_9001_course"]')!;

    // iso_9001_course costs 500 cash; fixture has 1000 → affordable + unlocked.
    expect(iso.dataset.state).toBe('affordable');
    const btn = iso.querySelector<HTMLButtonElement>('button.ui-interactive');
    expect(btn).not.toBeNull();
    // Label mirrors the retired scene: "Name (×N, {resource} {cost})".
    expect(btn!.textContent).toBe('ISO 9001 Course (×2, cash 500)');
  });

  it('marks a prereq-locked training as data-state="locked" with a non-interactive span', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));
    const agile = root.querySelector<HTMLElement>(
      '.academy-training[data-training-id="agile_master"]',
    )!;

    // agile_master requires owning iso_9001_course (not owned) → locked.
    expect(agile.dataset.state).toBe('locked');
    // Locked trainings are NOT clickable (no button, no .ui-interactive).
    expect(agile.querySelector('button')).toBeNull();
    expect(agile.querySelector('.ui-interactive')).toBeNull();
    expect(agile.textContent).toContain('🔒 Agile Master');
  });

  it('marks an owned training as data-state="owned" with a checkmark and no button', () => {
    const section = academyPanel({ onPurchaseTraining: () => {} });
    const root = section.render(
      () => makeState('1000', new Set(['iso_9001_course'])),
      () => makeAcademyContent(),
    )!;

    const iso = root.querySelector<HTMLElement>('.academy-training[data-training-id="iso_9001_course"]')!;
    expect(iso.dataset.state).toBe('owned');
    expect(iso.querySelector('button')).toBeNull();
    expect(iso.textContent).toContain('✓ ISO 9001 Course');
  });

  it('marks an unlocked-but-too-expensive training as data-state="locked-cost"', () => {
    const section = academyPanel({ onPurchaseTraining: () => {} });
    const root = section.render(() => makeState('100'), () => makeAcademyContent())!;

    const iso = root.querySelector<HTMLElement>('.academy-training[data-training-id="iso_9001_course"]')!;
    // Unlocked (no prereq) but cannot afford → not a button.
    expect(iso.dataset.state).toBe('locked-cost');
    expect(iso.querySelector('button')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Milestones / Credentials
// ---------------------------------------------------------------------------

describe('academyPanel — milestones / credentials', () => {
  it('renders one entry per milestone from getAcademyView', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));

    const entries = root.querySelectorAll<HTMLElement>('.academy-milestone');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.dataset.milestoneId).toBe('iso_9001_certified');
    expect(entries[1]!.dataset.milestoneId).toBe('gold_partner');
  });

  it('marks an earned milestone as data-state="earned" with a gold badge + checkmark', () => {
    const section = academyPanel({ onPurchaseTraining: () => {} });
    const state = makeState('0');
    state.earnedMilestones.add('iso_9001_certified');
    const root = section.render(() => state, () => makeAcademyContent())!;

    const iso = root.querySelector<HTMLElement>(
      '.academy-milestone[data-milestone-id="iso_9001_certified"]',
    )!;
    expect(iso.dataset.state).toBe('earned');
    expect(iso.textContent).toBe('🏅 ✓ ISO 9001 Certified');
    expect(iso.style.color).toBe('var(--academy-earned)');
  });

  it('marks a requirement-met-but-unearned milestone as data-state="preview"', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));

    // loc=1000 ≥ threshold 500 → requirement met, NOT earned.
    const iso = root.querySelector<HTMLElement>(
      '.academy-milestone[data-milestone-id="iso_9001_certified"]',
    )!;
    expect(iso.dataset.state).toBe('preview');
    expect(iso.textContent).toBe('○ ISO 9001 Certified (ready)');
  });

  it('marks a locked milestone (requirement not met) as data-state="locked"', () => {
    const root = render(academyPanel({ onPurchaseTraining: () => {} }));

    const gold = root.querySelector<HTMLElement>(
      '.academy-milestone[data-milestone-id="gold_partner"]',
    )!;
    expect(gold.dataset.state).toBe('locked');
    expect(gold.textContent).toBe('🔒 Microsoft Gold Partner');
    expect(gold.style.color).toBe('var(--academy-locked)');
  });
});

// ---------------------------------------------------------------------------
// Purchase wiring
// ---------------------------------------------------------------------------

describe('academyPanel — purchase wiring', () => {
  it('calls onPurchaseTraining with the training id when an affordable button is clicked', () => {
    const onPurchaseTraining = vi.fn();
    const root = render(academyPanel({ onPurchaseTraining }));

    const btn = root.querySelector<HTMLButtonElement>(
      '.academy-training[data-training-id="iso_9001_course"] button',
    )!;
    btn.click();

    expect(onPurchaseTraining).toHaveBeenCalledOnce();
    expect(onPurchaseTraining).toHaveBeenCalledWith('iso_9001_course');
  });

  it('does not call onPurchaseTraining from a locked training (no button wired)', () => {
    const onPurchaseTraining = vi.fn();
    const root = render(academyPanel({ onPurchaseTraining }));

    // agile_master is prereq-locked → no button → clicking its entry does nothing.
    const agile = root.querySelector<HTMLElement>(
      '.academy-training[data-training-id="agile_master"]',
    )!;
    expect(agile.querySelector('button')).toBeNull();
    agile.click(); // would-be stray tap on the non-interactive entry
    expect(onPurchaseTraining).not.toHaveBeenCalled();
  });

  it('passes the clicked training id through on re-render (stable wiring per frame)', () => {
    const onPurchaseTraining = vi.fn();
    const section = academyPanel({ onPurchaseTraining });

    // Frame 1: nothing owned; iso_9001_course is affordable.
    let root = section.render(() => makeState('1000'), () => makeAcademyContent())!;
    root.querySelector<HTMLButtonElement>(
      '.academy-training[data-training-id="iso_9001_course"] button',
    )!.click();

    // Frame 2: re-render with the same accessors (the loop calls render/frame)
    // and click again — the callback closure is captured once at construction,
    // so it still routes to the right id.
    root = section.render(() => makeState('1000'), () => makeAcademyContent())!;
    root.querySelector<HTMLButtonElement>(
      '.academy-training[data-training-id="iso_9001_course"] button',
    )!.click();

    expect(onPurchaseTraining).toHaveBeenCalledTimes(2);
    expect(onPurchaseTraining).toHaveBeenNthCalledWith(1, 'iso_9001_course');
    expect(onPurchaseTraining).toHaveBeenNthCalledWith(2, 'iso_9001_course');
  });
});

// ---------------------------------------------------------------------------
// Integration with the overlay
// ---------------------------------------------------------------------------

describe('academyPanel — overlay integration', () => {
  it('mounts inside createOverlay under the "academy" slot and refreshes', async () => {
    const { createOverlay } = await import('./overlay');
    const onPurchaseTraining = vi.fn();
    const mount = document.createElement('div');
    document.body.appendChild(mount);

    const overlay = createOverlay({
      mount,
      sections: [academyPanel({ onPurchaseTraining })],
      accessors: { getState: () => makeState('1000'), getContent: () => makeAcademyContent() },
    });
    overlay.refresh();

    // The panel rendered inside its "academy" slot.
    const slot = mount.querySelector<HTMLElement>('.ui-panel[data-panel="academy"]');
    expect(slot).not.toBeNull();
    expect(slot!.querySelectorAll('.academy-training')).toHaveLength(2);
    expect(slot!.querySelectorAll('.academy-milestone')).toHaveLength(2);

    // A purchase clicked through the mounted overlay still routes correctly.
    slot!.querySelector<HTMLButtonElement>(
      '.academy-training[data-training-id="iso_9001_course"] button.ui-interactive',
    )!.click();
    expect(onPurchaseTraining).toHaveBeenCalledWith('iso_9001_course');

    overlay.destroy();
  });
});
