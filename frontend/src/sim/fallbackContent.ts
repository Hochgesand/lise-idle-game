// Fix (review MAJOR #3): Bundled fallback content for offline play.
//
// Constitution IV mandates the core loop be fully playable offline. If the
// backend is unreachable, `fetchContent()` previously fell back to an EMPTY
// catalog — `computeRate` returned 0 and LOC stopped growing. This module
// bundles the SAME producer data as `backend/.../content/producers.json`
// (T037) so the loop produces LOC even with no backend.
//
// This is pure, typed data (Constitution II — data-driven content). It lives
// in `sim/` (no I/O, no Phaser) so it is unit-testable in isolation. It is the
// LAST-RESORT fallback; when the backend IS reachable, the served content
// overrides it (so balance changes propagate without a frontend rebuild).
//
// Keep this in sync with the backend content files when content changes
// (T037/T043/T050). The `contentVersion` is bumped to match the backend's
// `CONTENT_VERSION` so a client can detect staleness. US2 economy content
// (burner + upgrades) was added in T043.

import type { ContentCatalog } from './types';

/**
 * The bundled fallback content catalog. Mirrors the producer data from
 * `backend/src/main/resources/content/producers.json` so the game produces LOC
 * offline. Upgrades/trainings/milestones/burners are empty until those user
 * stories are implemented (T043/T050 will add their fallback data here).
 */
export const FALLBACK_CONTENT: ContentCatalog = {
  schemaVersion: 1,
  contentVersion: '1.2.0',
  producers: [
    {
      id: 'manual_typing',
      name: 'Manual Typing',
      description:
        'The dev types by hand, one keystroke at a time. Every great codebase starts here.',
      baseRate: '1',
      cost: { resource: 'loc', amount: '0' },
      costGrowth: 1.15,
      unlockRequirement: null,
    },
    {
      id: 'stack_overflow',
      name: 'Stack Overflow Copier',
      description:
        'Copy, paste, adapt. The dev has discovered the collective knowledge of the internet.',
      baseRate: '8',
      cost: { resource: 'loc', amount: '100' },
      costGrowth: 1.15,
      unlockRequirement: { type: 'resourceGte', targetId: 'loc', threshold: '50' },
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      description:
        'An AI pair-programmer suggests entire functions. The dev reviews and ships faster than ever.',
      baseRate: '47',
      cost: { resource: 'loc', amount: '1100' },
      costGrowth: 1.15,
      unlockRequirement: { type: 'ownsProducer', targetId: 'stack_overflow', threshold: null },
    },
  ],
  upgrades: [
    {
      id: 'better_keyboards',
      name: 'Better Keyboards',
      cost: { resource: 'cash', amount: '500' },
      effect: { type: 'globalMultiplier', multiplier: 2 },
      prerequisite: null,
    },
    {
      id: 'mechanical_switches',
      name: 'Mechanical Switches',
      cost: { resource: 'cash', amount: '200' },
      effect: { type: 'producerRateMultiplier', producerId: 'manual_typing', multiplier: 3 },
      prerequisite: { type: 'ownsProducer', targetId: 'stack_overflow', threshold: null },
    },
  ],
  trainings: [
    {
      id: 'iso_9001_course',
      name: 'ISO 9001 Course',
      description: 'Quality management fundamentals — process discipline boosts throughput.',
      cost: { resource: 'cash', amount: '500' },
      permanentMultiplier: 2,
      prerequisite: null,
    },
    {
      id: 'agile_master',
      name: 'Agile Master',
      description: 'Certified Scrum mastery — your devs ship faster, sprint after sprint.',
      cost: { resource: 'cash', amount: '2000' },
      permanentMultiplier: 3,
      prerequisite: { type: 'ownsTraining', targetId: 'iso_9001_course', threshold: null },
    },
  ],
  milestones: [
    {
      id: 'iso_9001_certified',
      name: 'ISO 9001 Certified',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '10000' },
      reward: { type: 'grantResource', resource: 'cash', amount: '1000' },
    },
    {
      id: 'ms_gold_partner',
      name: 'Microsoft Gold Partner',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '100000' },
      reward: { type: 'globalMultiplier', multiplier: 2 },
    },
    {
      id: 'ai_design_sprint_facilitator',
      name: 'AI Design Sprint Facilitator',
      requirement: { type: 'resourceGte', targetId: 'loc', threshold: '1000000' },
      reward: { type: 'globalMultiplier', multiplier: 3 },
    },
  ],
  burners: [
    {
      id: 'gpu_cluster',
      name: 'GPU Cluster',
      fuelCostToActivate: '100',
      burnRate: '10',
      productionMultiplier: 3,
    },
  ],
  // (002) Co-op tuning — mirrors backend/src/main/resources/content/coop.json
  // (T021 placeholder values) so an offline-booting client integrates with the
  // same values as the served envelope (contracts §1). loadContent validates
  // this exact shape for the served path; the fallback carries it verbatim.
  coop: {
    perColleagueMultiplier: 0.1,
    maxMultiplier: 1.5,
    leaseSeconds: 60,
    heartbeatSeconds: 20,
    commuteSeconds: 30,
    lastSeenRetentionDays: 14,
  },
};
