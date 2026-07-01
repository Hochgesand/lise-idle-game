// Fix (review BLOCKER #1 + MAJOR #2): Pure boot-state preparation.
//
// Extracts the "fresh vs returning + grant + catch-up" decision out of
// `main.ts boot()` into a PURE, testable function. The previous boot ordering
// credited a fresh player ~1.77 billion LOC because `createInitialState()`
// anchors `lastAdvancedAt` to the epoch (1970), `grantStarterProducer` added
// `manual_typing` (1 LOC/s) BEFORE catch-up, and `catchUpOnLoad` then computed
// `dt = now − 1970 ≈ 1.77e12 ms`.
//
// Fix: for a FRESH player (`loaded === null`), re-anchor `lastAdvancedAt` to
// NOW before granting the starter producer, so catch-up dt = 0 and no phantom
// credit accrues. For a RETURNING player, the normal catch-up path runs (their
// saved timestamp is a real recent value, so offline credit is correct).
//
// This function is pure: `nowMs` is passed in (no `Date.now()` here), so it is
// fully unit-testable. `main.ts boot()` calls this helper and passes
// `Date.now()` as `nowMs` (the wall-clock boundary stays in the wiring layer).

import type { ContentCatalog, GameState } from '../sim/types';
import { createInitialState } from '../save/localStorage';
import { grantStarterProducer } from '../sim/freshPlayer';
import { catchUpOnLoad } from './gameLoop';

/**
 * Prepare the initial running state from a loaded save (or fresh state).
 *
 * @param loaded   the persisted state from `loadGame()`, or `null` for a
 *                 brand-new player
 * @param content  the validated content catalog (for catch-up rate computation)
 * @param nowMs    wall-clock now in epoch milliseconds (passed in — no
 *                 `Date.now()` here, keeping this pure)
 * @returns the GameState to start the loop with
 */
export function prepareInitialState(
  loaded: GameState | null,
  content: ContentCatalog,
  nowMs: number,
): GameState {
  if (loaded === null) {
    // FRESH player: re-anchor to NOW so catch-up dt = 0 (no phantom credit
    // from the epoch default), then grant the starter producer.
    const fresh = createInitialState();
    const anchored = { ...fresh, lastAdvancedAt: new Date(nowMs).toISOString() };
    return grantStarterProducer(anchored);
  }

  // RETURNING player: catch up offline progress at the real rate, then
  // re-anchor. The grant is a no-op for returning players (they already own
  // producers), but we call it for consistency/safety.
  const caught = catchUpOnLoad(loaded, nowMs, content);
  return grantStarterProducer(caught);
}
