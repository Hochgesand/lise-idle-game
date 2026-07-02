// T063 — Pure heartbeat payload derivation (contracts §3
// `/app/presence.heartbeat`).
//
// The heartbeat body `{ office, activity, commute }` is derived from save
// state on every publish — nothing here is ever stored in the save:
//  - While a commute is in progress the dev is present in NO office:
//    `office: null`, `activity: "commuting"`, and `commute` mirrors the save's
//    `{ fromOffice, toOffice }` WITHOUT `startedAt` — the server stamps
//    `PresenceRecord.commute.startedAt = serverTime` on the first heartbeat
//    reporting the transition, so presence timestamps never mix clock domains
//    (contracts §3: no client timestamps, no colleagueId on the wire).
//  - Otherwise `office` mirrors `activeOffice`, `commute` is null, and
//    `activity` is `"burning tokens"` while a burner is active, else
//    `"coding"`. `activity` is a display label only (FR-004 allowlist).
//
// This module is pure and Phaser-free (testable without a canvas): the clock
// and the interval live in main.ts (the clock-owning module); the transport
// guard (`isConnected`) lives in stompClient.publishHeartbeat.

import type { ContentCatalog, GameState } from '../sim/types';
import type { HeartbeatPayload } from './stompClient';

/**
 * The bundled default cadence (seconds), mirroring `fallbackContent.ts` /
 * `coop.json` — used only when a catalog carries no `coop` block (the type
 * marks it optional; every real catalog, including the fallback, has one).
 */
const DEFAULT_HEARTBEAT_SECONDS = 20;

/**
 * Derive the heartbeat body from the current save state. Pure — no clock, no
 * mutation; the loop keeps `state` current (ticked every frame), so the save
 * is the single source of truth for where the dev is and what they are doing.
 */
export function deriveHeartbeat(state: GameState): HeartbeatPayload {
  if (state.commute !== null) {
    return {
      office: null, // present in no office while in transit (data-model)
      activity: 'commuting',
      // Deliberately NOT spreading the save's CommuteState: `startedAt` is a
      // sim-timeline timestamp and must never reach the wire (server stamps it).
      commute: {
        fromOffice: state.commute.fromOffice,
        toOffice: state.commute.toOffice,
      },
    };
  }
  return {
    office: state.activeOffice,
    activity: state.activeBurner !== null ? 'burning tokens' : 'coding',
    commute: null,
  };
}

/**
 * The heartbeat interval in milliseconds for the main.ts `setInterval`:
 * `content.coop.heartbeatSeconds` (contracts §3 cadence), defaulting to the
 * bundled 20 s when the catalog carries no coop block.
 */
export function heartbeatIntervalMs(content: ContentCatalog): number {
  return (content.coop?.heartbeatSeconds ?? DEFAULT_HEARTBEAT_SECONDS) * 1000;
}
