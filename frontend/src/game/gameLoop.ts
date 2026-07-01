// T032 — Game loop wiring: tick `advance` each frame, re-anchor on load,
// and catch up offline progress (quickstart.md Scenario 1; contracts §1).
//
// ## Design (Constitution Principle I — pure, dt-driven sim)
// The pure `advance(state, dt, content)` is the ONLY time-based mutator. The
// game loop's only job is to:
//   1. compute `dt` from a wall-clock source,
//   2. delegate to `advance`,
//   3. (on load) re-anchor `lastAdvancedAt` to "now" so the next tick starts
//      from the present instead of double-crediting the offline interval.
//
// To keep this unit-testable without Phaser, the math is extracted into pure
// functions (`catchUpOnLoad`, `tick`) that take `nowMs` as a parameter — no
// `Date.now()` inside them. A thin orchestrator class (`GameLoop`) sits on top
// and uses `Date.now()` at the orchestration boundary (allowed: it is the
// wall-clock source, never fed to the sim directly — only the computed `dt` is).
//
// ## Pause/visibility decision
// The simplest Constitution-I-consistent choice is used: each tick advances by
// the REAL elapsed dt (`nowMs - lastTickMs`), so time spent with the tab hidden
// is credited LIVE. When the tab is closed, the NEXT load's `catchUpOnLoad`
// credits the remaining offline interval. There is no separate "offline" path
// and no capping — offline and online use the exact same `advance` rule.

import type { ContentCatalog, GameState } from '../sim/types';
import { advance } from '../sim/advance';
import { createInitialState } from '../save/localStorage';

// ── Pure helpers (no Date.now() — nowMs passed in) ────────────────────────

/**
 * Catch up offline progress on load. Pure.
 *
 * Computes `dt = max(0, nowMs - Date.parse(state.lastAdvancedAt))`, advances
 * the state by that delta, then re-anchors `lastAdvancedAt` to `now` (so the
 * offline interval is not double-credited on the next tick).
 *
 * Per the Constitution, offline progress is NEVER silently capped. `advance`
 * runs in O(active features), not O(dt), so a multi-day catch-up is as cheap
 * as a 1-second tick (proven by T025). Negative dt (clock skew: "now" before
 * the recorded anchor) is clamped to 0 — never negative time, never LOC loss.
 *
 * @param state    the loaded (or fresh) state
 * @param nowMs    wall-clock now, in epoch milliseconds (the clock source; not
 *                 fed to the sim directly — only the derived dt is)
 * @param content  the validated content catalog
 * @returns a new GameState: advanced + re-anchored to now
 */
export function catchUpOnLoad(
  state: GameState,
  nowMs: number,
  content: ContentCatalog,
): GameState {
  const dt = Math.max(0, nowMs - Date.parse(state.lastAdvancedAt));
  const advanced = advance(state, dt, content);
  // Re-anchor to now (advance already moved lastAdvancedAt forward by dt; we
  // overwrite with the canonical "now" so the next tick begins from here).
  return { ...advanced, lastAdvancedAt: new Date(nowMs).toISOString() };
}

/**
 * Advance one tick. Pure.
 *
 * `dt = max(0, nowMs - prevTickMs)`; returns `advance(state, dt, content)`.
 * `advance` updates `lastAdvancedAt` internally (by dt). Negative dt (clock
 * skew) is clamped to 0.
 *
 * @param state       the current state
 * @param prevTickMs  wall-clock of the previous tick (epoch ms)
 * @param nowMs       wall-clock now (epoch ms)
 * @param content     the validated content catalog
 * @returns a new GameState advanced by (nowMs - prevTickMs)
 */
export function tick(
  state: GameState,
  prevTickMs: number,
  nowMs: number,
  content: ContentCatalog,
): GameState {
  const dt = Math.max(0, nowMs - prevTickMs);
  return advance(state, dt, content);
}

// ── Thin orchestrator (Phaser-aware via injected nowMs; no Phaser import) ──

/**
 * The game-loop orchestrator. Holds the running state reference via injected
 * getters/setters and a content provider, and delegates all math to the pure
 * helpers above. It does NOT import Phaser — the scene calls `update(timeMs)`
 * each frame with the Phaser time, so the class stays unit-testable in Vitest.
 *
 * A `load(savedState)` call:
 *   - for `null` → starts from `createInitialState()`,
 *   - runs `catchUpOnLoad` (offline catch-up + re-anchor),
 *   - publishes the new state via `setState` and tracks `lastTickMs` for the
 *     next `update`.
 */
export class GameLoop {
  private readonly getContent: () => ContentCatalog;
  private readonly getState: () => GameState;
  private readonly setState: (s: GameState) => void;
  private readonly saveCallback: () => void;
  private lastTickMs = 0;

  constructor(opts: {
    getContent: () => ContentCatalog;
    getState: () => GameState;
    setState: (s: GameState) => void;
    save?: () => void;
  }) {
    this.getContent = opts.getContent;
    this.getState = opts.getState;
    this.setState = opts.setState;
    this.saveCallback = opts.save ?? (() => undefined);
  }

  /**
   * Initialize the loop from a loaded (or fresh) state, catching up offline
   * progress and re-anchoring to now. Returns the resulting running state.
   *
   * @param savedState  the persisted state, or `null` for a fresh player
   * @param nowMs       wall-clock now (epoch ms); defaults to Date.now()
   */
  load(savedState: GameState | null, nowMs: number = Date.now()): GameState {
    const base = savedState ?? createInitialState();
    const content = this.getContent();
    const next = catchUpOnLoad(base, nowMs, content);
    this.lastTickMs = nowMs;
    this.setState(next);
    return next;
  }

  /**
   * Advance the simulation by the real elapsed dt since the previous tick and
   * publish the new state. Intended to be called each Phaser frame with
   * `time.time` (or `time`).
   *
   * @param timeMs  wall-clock now (epoch ms); the Phaser time from `update(time)`
   */
  update(timeMs: number): void {
    const state = this.getState();
    const content = this.getContent();
    const next = tick(state, this.lastTickMs, timeMs, content);
    this.lastTickMs = timeMs;
    this.setState(next);
  }

  /**
   * Persist the running state via the injected `save` callback. Call this on a
   * periodic interval and on tab close / pagehide so progress is durable. This
   * is a thin pass-through so save cadence is controlled by the caller.
   */
  save(): void {
    this.saveCallback();
  }
}

