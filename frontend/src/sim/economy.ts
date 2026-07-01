// T041 — Pure economy view derivation for the EconomyScene overlay.
//
// The EconomyScene (Phaser UI panel) needs to know which upgrades are
// affordable/locked/owned and whether the burner is activatable or active.
// These derivations are PURE (no Phaser, no I/O) so they are fully unit-
// testable (economy.test.ts), keeping the testability split of HudScene:
// pure logic tested, scene wiring integration-level (`tsc -b` + `vite build`).
//
// Reference: contracts.md §1 (canAfford, isUnlocked helpers); data-model.md
// (Cost, Requirement, Upgrade, Burner); quickstart.md Scenario 2.

import type { ContentCatalog, Cost, GameState, Requirement, ResourceType } from './types';
import { bn, compare } from './bigNumber';

// ── canAfford ────────────────────────────────────────────────────────────

/**
 * Whether the player can pay the given Cost.
 *
 * Pure: reads state.resources, compares big-number strings.
 *
 * @param state the current saveable snapshot
 * @param cost  the cost to check (resource + amount)
 * @returns true if the player's balance of `cost.resource` ≥ `cost.amount`.
 */
export function canAfford(state: GameState, cost: Cost): boolean {
  return compare(bn(state.resources[cost.resource]), bn(cost.amount)) >= 0;
}

// ── isUnlocked ───────────────────────────────────────────────────────────

/**
 * Whether a requirement is satisfied by the current state.
 *
 * Reimplements the `requirementMet` predicate from advance.ts (which is
 * module-private) as a pure public helper for UI derivation. Semantics are
 * identical: resourceGte checks the named resource ≥ threshold; owns-* checks
 * membership in the corresponding ownership set.
 *
 * @param state       the current saveable snapshot
 * @param requirement the gating predicate (or null = always unlocked)
 * @returns true if the requirement is satisfied (or null).
 */
export function isUnlocked(state: GameState, requirement: Requirement | null): boolean {
  if (requirement === null) {
    return true;
  }

  switch (requirement.type) {
    case 'resourceGte': {
      if (requirement.threshold === null || requirement.targetId === null) {
        return false;
      }
      const have = bn(state.resources[requirement.targetId as ResourceType]);
      return compare(have, bn(requirement.threshold)) >= 0;
    }
    case 'ownsProducer':
      return requirement.targetId !== null && state.ownedProducers.has(requirement.targetId);
    case 'ownsUpgrade':
      return requirement.targetId !== null && state.ownedUpgrades.has(requirement.targetId);
    case 'ownsTraining':
      return requirement.targetId !== null && state.ownedTrainings.has(requirement.targetId);
    case 'ownsMilestone':
      return requirement.targetId !== null && state.earnedMilestones.has(requirement.targetId);
    default:
      return false;
  }
}

// ── getEconomyView ───────────────────────────────────────────────────────

/** A single upgrade's UI-facing state (derived, not stored). */
export interface UpgradeView {
  id: string;
  name: string;
  cost: Cost;
  affordable: boolean; // can pay AND unlocked AND not already owned
  owned: boolean;
  unlocked: boolean; // prerequisite satisfied
}

/** The burner's UI-facing state (derived from content + activeBurner). */
export interface BurnerView {
  def: ContentCatalog['burners'][number];
  activatable: boolean; // can activate (enough aiTokens, not already active)
  active: boolean; // a burner is currently running
  fuelRemaining: string | null; // big-number string when active, null otherwise
}

/** The full economy UI state derived from (state, content). */
export interface EconomyView {
  upgrades: UpgradeView[];
  burner?: BurnerView;
}

/**
 * Derive the full economy UI state from the current state + content.
 *
 * Pure: no Phaser, no I/O. The EconomyScene calls this each frame to refresh
 * its display (affordability colors, locked state, burner fuel).
 *
 * @param state   the current saveable snapshot
 * @param content the versioned game content
 * @returns the derived economy view (upgrades + burner).
 */
export function getEconomyView(state: GameState, content: ContentCatalog): EconomyView {
  const upgrades: UpgradeView[] = content.upgrades.map((upgrade) => {
    const owned = state.ownedUpgrades.has(upgrade.id);
    const unlocked = isUnlocked(state, upgrade.prerequisite);
    // Affordable = unlocked, not owned, and can pay the cost.
    const affordable = unlocked && !owned && canAfford(state, upgrade.cost);
    return {
      id: upgrade.id,
      name: upgrade.name,
      cost: upgrade.cost,
      affordable,
      owned,
      unlocked,
    };
  });

  // Derive burner view: use the first burner definition (MVP single-burner).
  const burnerDef = content.burners[0];
  let burner: BurnerView | undefined;
  if (burnerDef !== undefined) {
    const active = state.activeBurner !== null;
    const activatable =
      !active && canAfford(state, { resource: 'aiTokens', amount: burnerDef.fuelCostToActivate });
    burner = {
      def: burnerDef,
      activatable,
      active,
      fuelRemaining: active ? state.activeBurner!.fuelRemaining : null,
    };
  }

  return { upgrades, burner };
}
