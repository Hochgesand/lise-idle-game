// T036 — Fresh-player starter-producer grant (pure, testable helper).
//
// A brand-new GameState (createInitialState) has EMPTY ownedProducers, so the
// LOC production rate is 0 — the player would see nothing happen. T037 seeds
// `manual_typing` as a free producer (cost: {loc, "0"}), but ownership must be
// granted on first boot (T036's responsibility — the initial state is
// ownership-agnostic by design; the game loop decides what to grant).
//
// This helper is PURE (no I/O, no Date.now()) so it is unit-testable in
// isolation, per Constitution Principle I/III.

import type { GameState } from './types';

/** The id of the free starter producer every new player begins with. */
export const STARTER_PRODUCER_ID = 'manual_typing';

/**
 * Grant the starter producer (`manual_typing`) to a fresh player if they own
 * NO producers yet. A returning player (non-empty ownedProducers) is returned
 * unchanged — their existing ownership is respected.
 *
 * @param state the loaded (or fresh) state
 * @returns a NEW GameState: if the player owns nothing, `manual_typing` is
 *          added to ownedProducers; otherwise a value-equal new state.
 *
 * Pure: returns a new state (Sets rebuilt), never mutates the input.
 */
export function grantStarterProducer(state: GameState): GameState {
  if (state.ownedProducers.size > 0) {
    // Returning player — respect their existing ownership.
    return { ...state, ownedProducers: new Set(state.ownedProducers) };
  }
  // Fresh player — grant the free starter producer so LOC grows from t=0.
  return {
    ...state,
    ownedProducers: new Set([STARTER_PRODUCER_ID]),
  };
}
