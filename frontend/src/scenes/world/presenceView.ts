// T065/T078 — presenceView: the pure presence→world derivation (US1 + US3).
//
// PURE and Phaser-free (Constitution Principle I). This module is the bridge
// between the client presence model (net/presenceClient.ts, `PresenceRecord`)
// and the campus renderer (avatars.ts, `AvatarRender`):
//
//   PresenceRecord[]  ──filter present──▶  SeatedColleague[]
//                     ──assignSeats─────▶  SeatAssignment[]   (seats.ts)
//                     ──commute math────▶  route positions    (commute.ts)
//                     ──project─────────▶  AvatarRender[]     (avatars.ts)
//
// main.ts calls `buildAvatarRenders` with the anchors parsed by CampusScene
// (`getSeatAnchors()`) and the visible colleagues from the presence model
// (`PresenceModel.colleagues()`), and pushes the result into
// `CampusScene.updateAvatars` — after the boot snapshot fetch and on every
// `/topic/presence` delta (and, while commuters are on the route, per frame:
// their progress is a function of the clock).
//
// ## What it maps (FR-005/006/022/023)
//  - a colleague PRESENT in an office (`office !== null`) is seated at a
//    distinct `SeatAnchor` tagged with that building (`assignSeats` guarantees
//    determinism, per-building tags, and standing overflow — never hidden);
//  - a COMMUTING colleague (`office === null` + `commute` set) renders ON the
//    `CommutePaths` polyline when a {@link CommuteRenderContext} is supplied:
//    progress is derived from the server-stamped `commute.startedAt` against
//    `coop.commuteSeconds` (commute.ts `commuteProgress`), the route is
//    oriented by `commute.fromOffice` (`orientPath`), and the deterministic
//    per-colleague lane offset spreads a rush side-by-side (SC-010). Once
//    progress reaches 1 the colleague resolves BACK TO A SEAT in the
//    destination building — no gap while the arrival heartbeat is in flight;
//  - `status` maps the wire tier to the renderer tier: `'live'` → `'live'`
//    (green frame) and `'last_seen'` → `'lastSeen'` (red frame), FR-023;
//  - `displayName` + `activity` pass through verbatim — they are the label
//    texts the zoom rule shows/hides (FR-005/006).
//
// ## What it skips
//  - COMMUTING colleagues when NO commute context is supplied (the caller has
//    no route/tuning yet — e.g. a catalog without a coop block);
//  - placeless records (`office === null`, no commute — a malformed or
//    transitional presence): there is nowhere sensible to place them, and the
//    presence channel is advisory (contracts §4) — skip, never throw.
//
// ## Transition + label derivations (US3, consumed by avatars.ts)
// `statusTransition` decides how the Phaser layer moves between liveness
// tiers (fade to the red/desaturated at-desk state on live → lastSeen — the
// "no pop" rule, US3 acceptance 3 — with `LAST_SEEN_ALPHA`/`LAST_SEEN_FADE_MS`
// as the tuning constants; `reducedMotion` callers apply the end state
// instantly). `labelVisible` is the single label-visibility rule: the
// FR-005 × FR-024 zoom threshold for seated avatars, tap/hover-only while in
// transit (FR-022 decluttering).

import type { PresenceRecord } from '../../net/presenceClient';
import { assignSeats, type SeatAnchor, type SeatedColleague } from './seats';
import {
  commuteProgress,
  commuterPosition,
  orientPath,
  type CommutePath,
} from './commute';
import type { AvatarPresence, AvatarRender } from './avatars';

// ── Projection helpers ────────────────────────────────────────────────────

/**
 * Map the wire liveness tier (`PresenceRecord.status`, snake_case per
 * contracts §2) to the renderer tier (`AvatarPresence.status`, camelCase —
 * selects the green/red avatar frame, FR-023).
 */
export function toAvatarStatus(status: PresenceRecord['status']): AvatarPresence['status'] {
  return status === 'live' ? 'live' : 'lastSeen';
}

/**
 * Project a full `PresenceRecord` onto the renderer's narrow
 * `AvatarPresence` slice (FR-004 allowlist stays intact — only display
 * fields cross into the world layer).
 */
export function toAvatarPresence(record: PresenceRecord): AvatarPresence {
  return {
    colleagueId: record.colleagueId,
    displayName: record.displayName,
    activity: record.activity,
    status: toAvatarStatus(record.status),
  };
}

// ── Status transitions (US3 acceptance 3 — the "no pop" rule) ─────────────

/**
 * Alpha of the red/desaturated at-desk resting state a last-seen avatar
 * settles at (FR-023 × US3 acceptance 3). Live avatars render at alpha 1.
 */
export const LAST_SEEN_ALPHA = 0.55;

/**
 * Duration (ms) of the live → last-seen soft fade. With
 * `state.settings.reducedMotion` set, the renderer applies the end state
 * instantly instead of animating (accessibility — same rule as the HUD boost
 * float).
 */
export const LAST_SEEN_FADE_MS = 600;

/**
 * How the renderer should move between liveness tiers for one colleague:
 *  - `'appear'`          first sighting — render directly in the target state
 *                        (a colleague first seen as last-seen never fades);
 *  - `'none'`            tier unchanged — nothing to animate;
 *  - `'fadeToLastSeen'`  live → lastSeen — soften to the red/desaturated
 *                        at-desk state over {@link LAST_SEEN_FADE_MS} (no pop,
 *                        no removal; instant under reducedMotion);
 *  - `'revive'`          lastSeen → live — the colleague is back; snap to the
 *                        live (green, alpha 1) state immediately.
 *
 * Pure decision logic (Phaser-free, T078-tested); avatars.ts applies it.
 */
export type StatusTransition = 'appear' | 'none' | 'fadeToLastSeen' | 'revive';

/**
 * Derive the {@link StatusTransition} from the previously rendered tier
 * (`undefined` = colleague not rendered before) to the incoming one.
 */
export function statusTransition(
  prev: AvatarPresence['status'] | undefined,
  next: AvatarPresence['status'],
): StatusTransition {
  if (prev === undefined) return 'appear';
  if (prev === next) return 'none';
  return next === 'lastSeen' ? 'fadeToLastSeen' : 'revive';
}

// ── Label visibility (FR-005 × FR-024 zoom rule + FR-022 transit rule) ────

/** Inputs to {@link labelVisible} (one avatar's label state this frame). */
export interface LabelVisibilityInput {
  /** Camera zoom is at/above the label-persistence threshold (avatars.ts). */
  persistent: boolean;
  /** Pointer currently hovers this avatar. */
  hovered: boolean;
  /** The user tap-pinned this avatar's label on. */
  pinned: boolean;
  /** The avatar is rendered on the commute route (AvatarRender.inTransit). */
  inTransit: boolean;
}

/**
 * The single label-visibility rule: hover/pin always shows the label; the
 * persistent-zoom rule (FR-005 × FR-024) applies only to SEATED avatars —
 * while in transit labels are tap/hover-only so a commute rush never drags a
 * cloud of text across the map (FR-022 decluttering, SC-010 legibility).
 */
export function labelVisible(input: LabelVisibilityInput): boolean {
  if (input.hovered || input.pinned) return true;
  return input.persistent && !input.inTransit;
}

// ── Commute render context ────────────────────────────────────────────────

/**
 * Everything the mapping needs to place commuters on the route. The CALLER
 * owns the clock and the content: main.ts passes `Date.now()` and
 * `content.coop.commuteSeconds` with the `CommutePaths` polyline parsed by
 * CampusScene — this module stays pure (same inputs, same output).
 */
export interface CommuteRenderContext {
  /** The parsed campus commute route (commute.ts `extractCommutePath`). */
  path: CommutePath;
  /** "Now" on the wall clock (ms since epoch) — progress anchor. */
  nowMs: number;
  /** Travel duration from `content.coop.commuteSeconds` (seconds). */
  commuteSeconds: number;
}

// ── The mapping ───────────────────────────────────────────────────────────

/** A commuting record (office null, commute set) — narrowing helper shape. */
type CommutingRecord = PresenceRecord & {
  commute: NonNullable<PresenceRecord['commute']>;
};

/**
 * Build the avatar renders for the campus world from the parsed seat
 * `anchors`, the visible presence `records`, and (optionally) the commute
 * render context.
 *
 * Colleagues present in an office are deterministically seated at distinct
 * anchors in the CORRECT building via `assignSeats` (overflow stands, never
 * hidden). With a {@link CommuteRenderContext}, commuting colleagues render
 * ON the route at their `startedAt`-derived progress (lane-offset,
 * `inTransit: true`) — and resolve back to a DESTINATION seat once progress
 * reaches 1. Without a context, commuters are skipped (the pre-T080
 * behavior); placeless records are always skipped (defensive).
 *
 * (T019/US1) With a `reservedAnchor` (the player's seat — `reservedAnchorFor`
 * in seats.ts), no colleague — resident or arrived commuter — is ever seated
 * on it: the reservation rides straight through to `assignSeats` (FR-003).
 * `null`/`undefined` = no reservation (unchanged pre-003 behavior).
 *
 * Pure: no I/O, no clock (the context carries `nowMs`), no mutation of the
 * inputs; the same inputs always yield the same output (seated renders in
 * `colleagueId` order from `assignSeats`, then in-transit commuters in
 * `colleagueId` order).
 */
export function buildAvatarRenders(
  anchors: ReadonlyArray<SeatAnchor>,
  records: ReadonlyArray<PresenceRecord>,
  commuteCtx?: CommuteRenderContext,
  reservedAnchor?: SeatAnchor | null,
): AvatarRender[] {
  // Partition: seated (office set) / commuting (office null + commute set) /
  // placeless (defensive skip).
  const present = records.filter(
    (r): r is PresenceRecord & { office: string } => r.office !== null,
  );
  const commuting = records.filter(
    (r): r is CommutingRecord => r.office === null && r.commute !== null,
  );

  // Split commuters by progress: in transit vs already arrived. Arrived
  // commuters seat in their DESTINATION building alongside the residents —
  // the observer sees them at a desk while the arrival heartbeat is in
  // flight, never a gap or a stack.
  const inTransit: Array<{ record: CommutingRecord; progress: number }> = [];
  const arrived: CommutingRecord[] = [];
  if (commuteCtx !== undefined) {
    for (const r of commuting) {
      const elapsed = commuteCtx.nowMs - Date.parse(r.commute.startedAt);
      // commuteProgress defends: NaN elapsed (unparseable startedAt) → 0.
      const progress = commuteProgress(elapsed, commuteCtx.commuteSeconds);
      if (progress >= 1) {
        arrived.push(r);
      } else {
        inTransit.push({ record: r, progress });
      }
    }
  }

  // Seat the present colleagues + the arrived commuters (destination office).
  const seatable: SeatedColleague[] = [
    ...present.map((r) => ({ colleagueId: r.colleagueId, office: r.office })),
    ...arrived.map((r) => ({ colleagueId: r.colleagueId, office: r.commute.toOffice })),
  ];
  const assignments = assignSeats(anchors, seatable, reservedAnchor);

  // Join the placements back onto their presence records by colleagueId.
  const recordById = new Map<string, PresenceRecord>(
    [...present, ...arrived].map((r) => [r.colleagueId, r]),
  );

  const renders: AvatarRender[] = [];
  for (const a of assignments) {
    const record = recordById.get(a.colleagueId);
    if (record === undefined) continue; // unreachable: assignSeats never invents ids
    renders.push({
      colleagueId: a.colleagueId,
      x: a.x,
      y: a.y,
      presence: toAvatarPresence(record),
      inTransit: false,
    });
  }

  // Place the in-transit commuters on the oriented route (stable id order —
  // determinism independent of the input record order).
  inTransit.sort((a, b) => (a.record.colleagueId < b.record.colleagueId ? -1 : 1));
  for (const { record, progress } of inTransit) {
    // commuteCtx is defined whenever inTransit is non-empty.
    const ctx = commuteCtx as CommuteRenderContext;
    const oriented = orientPath(ctx.path, record.commute.fromOffice);
    const pos = commuterPosition(oriented, progress, record.colleagueId);
    renders.push({
      colleagueId: record.colleagueId,
      x: pos.x,
      y: pos.y,
      presence: toAvatarPresence(record),
      inTransit: true,
    });
  }

  return renders;
}
