// T065 — presenceView: the pure presence→seat→render mapping (US1).
//
// PURE and Phaser-free (Constitution Principle I). This module is the bridge
// between the client presence model (net/presenceClient.ts, `PresenceRecord`)
// and the campus renderer (avatars.ts, `AvatarRender`):
//
//   PresenceRecord[]  ──filter present──▶  SeatedColleague[]
//                     ──assignSeats─────▶  SeatAssignment[]   (seats.ts)
//                     ──project─────────▶  AvatarRender[]     (avatars.ts)
//
// main.ts calls `buildAvatarRenders` with the anchors parsed by CampusScene
// (`getSeatAnchors()`) and the visible colleagues from the presence model
// (`PresenceModel.colleagues()`), and pushes the result into
// `CampusScene.updateAvatars` — after the boot snapshot fetch and on every
// `/topic/presence` delta.
//
// ## What it maps (FR-005/006/023)
//  - a colleague PRESENT in an office (`office !== null`) is seated at a
//    distinct `SeatAnchor` tagged with that building (`assignSeats` guarantees
//    determinism, per-building tags, and standing overflow — never hidden);
//  - `status` maps the wire tier to the renderer tier: `'live'` → `'live'`
//    (green frame) and `'last_seen'` → `'lastSeen'` (red frame), FR-023;
//  - `displayName` + `activity` pass through verbatim — they are the label
//    texts the zoom rule shows/hides (FR-005/006).
//
// ## What it skips
//  - COMMUTING colleagues (`office === null` + `commute` set) — they render on
//    the commute path (commute.ts), wired in T080, not at a seat;
//  - placeless records (`office === null`, no commute — a malformed or
//    transitional presence): there is nowhere sensible to place them, and the
//    presence channel is advisory (contracts §4) — skip, never throw.

import type { PresenceRecord } from '../../net/presenceClient';
import { assignSeats, type SeatAnchor, type SeatedColleague } from './seats';
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

// ── The mapping ───────────────────────────────────────────────────────────

/**
 * Build the seated avatar renders for the campus world from the parsed seat
 * `anchors` and the visible presence `records`.
 *
 * Colleagues present in an office are deterministically seated at distinct
 * anchors in the CORRECT building via `assignSeats` (overflow stands, never
 * hidden); commuting and placeless records (`office === null`) are skipped —
 * T080 renders commuters on the commute path.
 *
 * Pure: no I/O, no clock, no mutation of the inputs; the same inputs always
 * yield the same output (in `colleagueId` order, inherited from
 * `assignSeats`).
 */
export function buildAvatarRenders(
  anchors: ReadonlyArray<SeatAnchor>,
  records: ReadonlyArray<PresenceRecord>,
): AvatarRender[] {
  // Only colleagues PRESENT in an office are seatable. `office === null`
  // covers both commuters (commute set — T080's job) and placeless records
  // (defensive skip).
  const present = records.filter(
    (r): r is PresenceRecord & { office: string } => r.office !== null,
  );

  const seatable: SeatedColleague[] = present.map((r) => ({
    colleagueId: r.colleagueId,
    office: r.office,
  }));
  const assignments = assignSeats(anchors, seatable);

  // Join the placements back onto their presence records by colleagueId.
  const recordById = new Map<string, PresenceRecord>(present.map((r) => [r.colleagueId, r]));

  const renders: AvatarRender[] = [];
  for (const a of assignments) {
    const record = recordById.get(a.colleagueId);
    if (record === undefined) continue; // unreachable: assignSeats never invents ids
    renders.push({
      colleagueId: a.colleagueId,
      x: a.x,
      y: a.y,
      presence: toAvatarPresence(record),
    });
  }
  return renders;
}
