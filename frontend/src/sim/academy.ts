// T048 — Pure academy view derivation for the AcademyScene overlay.
//
// The AcademyScene (Phaser UI panel) needs to know which trainings are
// affordable / locked-by-prerequisite / owned, and which milestones are earned
// vs unearned (but requirement met = "almost there" preview). These derivations
// are PURE (no Phaser, no I/O) so they are fully unit-testable (academy.test.ts),
// keeping the testability split used by HudScene/EconomyScene: pure logic
// tested, scene wiring integration-level (`tsc -b` + `vite build`).
//
// Reference: contracts.md §1 (canAfford, isUnlocked); data-model.md (Training,
// Milestone, Cost, Requirement); quickstart.md Scenario 3.
//
// REUSES `canAfford`/`isUnlocked` from economy.ts — NOT duplicated.

import type { ContentCatalog, Cost, GameState } from './types';
import { canAfford, isUnlocked } from './economy';

// ── View types ───────────────────────────────────────────────────────────

/** A single training's UI-facing state (derived, not stored). */
export interface TrainingView {
  id: string;
  name: string;
  description: string;
  cost: Cost;
  permanentMultiplier: number;
  affordable: boolean; // can pay AND unlocked AND not already owned
  owned: boolean;
  unlocked: boolean; // prerequisite satisfied
}

/** A single milestone/credential's UI-facing state (derived, not stored). */
export interface MilestoneView {
  id: string;
  name: string;
  earned: boolean; // is it in state.earnedMilestones
  requirementMet: boolean; // does the CURRENT state satisfy the requirement (preview)
}

/** The full academy UI state derived from (state, content). */
export interface AcademyView {
  trainings: TrainingView[];
  milestones: MilestoneView[];
}

// ── getAcademyView ───────────────────────────────────────────────────────

/**
 * Derive the full academy UI state from the current state + content.
 *
 * Pure: no Phaser, no I/O. The AcademyScene calls this each frame to refresh
 * its display (affordability colors, earned badges, requirement previews).
 *
 * @param state   the current saveable snapshot
 * @param content the versioned game content
 * @returns the derived academy view (trainings + milestones).
 */
export function getAcademyView(state: GameState, content: ContentCatalog): AcademyView {
  const trainings: TrainingView[] = content.trainings.map((training) => {
    const owned = state.ownedTrainings.has(training.id);
    const unlocked = isUnlocked(state, training.prerequisite);
    const affordable = unlocked && !owned && canAfford(state, training.cost);
    return {
      id: training.id,
      name: training.name,
      description: training.description,
      cost: training.cost,
      permanentMultiplier: training.permanentMultiplier,
      affordable,
      owned,
      unlocked,
    };
  });

  const milestones: MilestoneView[] = content.milestones.map((milestone) => {
    const earned = state.earnedMilestones.has(milestone.id);
    const requirementMet = isUnlocked(state, milestone.requirement);
    return {
      id: milestone.id,
      name: milestone.name,
      earned,
      requirementMet,
    };
  });

  return { trainings, milestones };
}
