// T042 — Economy configuration (the LOC → Cash conversion rate).
//
// Extracted into its own module so it can be imported by both `main.ts`
// (the wiring layer) and by tests — without pulling in Phaser (which `main.ts`
// imports and which does not parse in Vitest's jsdom env).
//
// T043 explicitly left the cash conversion rate for T042 to define (it is NOT
// a content field — `cashOut(state, locAmount, cashRate)` takes it as a param).

/**
 * The LOC → Cash conversion rate. 1 LOC converts to 0.5 cash.
 * Chosen as a sensible MVP value: LOC is the abundant idle resource, cash is
 * the scarce spendable — a sub-1 rate creates the reinvest tension of
 * quickstart.md Scenario 2.
 */
export const CASH_RATE = 0.5;
