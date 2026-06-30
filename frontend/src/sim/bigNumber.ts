// T012 — big-number wrapper around break_eternity.js.
//
// All resources (loc/cash/aiTokens) are big numbers serialized as STRINGS
// end-to-end — never JS `double` (Constitution integrity + numeric stability,
// data-model.md, contracts §1). break_eternity.js represents numbers far
// beyond Number.MAX_VALUE; this wrapper hides it behind a small, pure,
// functional API so the simulation never touches the underlying library
// directly and the implementation could be swapped later.
//
// ## Precision contract (matches research.md's choice of break_eternity)
// break_eternity targets idle-game astronomical magnitudes at ~15 significant
// figures. Exact integer identity is guaranteed for the layer-0 range
// (integers up to ~5e15); beyond that, values are stored in scientific /
// tetration form at ~15 sig figs. This satisfies the Constitution's
// numeric-integrity intent (no NaN/Infinity, no double-precision gameplay
// walls at 1e308) and is far beyond any gameplay-affecting need.
//
// Purity (Constitution Principle I): all operations are deterministic and
// never mutate their inputs — they allocate fresh values. No I/O, no globals.

import Decimal from 'break_eternity.js';

/**
 * Opaque big-number type.
 *
 * A nominal brand over break_eternity's `Decimal` so callers cannot construct
 * or inspect the underlying representation directly — they must go through the
 * helpers below. This keeps the lib swappable and the sim decoupled.
 */
declare const __bigNumberBrand: unique symbol;
export type BigNumber = Decimal & { readonly [__bigNumberBrand]: true };

/** Mark a fresh Decimal as a BigNumber (internal). */
function wrap(d: Decimal): BigNumber {
  return d as BigNumber;
}

/**
 * Construct a BigNumber from a string | number | BigNumber.
 * Strings parse without precision loss up to break_eternity's resolution
 * (integers, decimals, and scientific notation like "1e308" all supported).
 */
export function bn(value: string | number | BigNumber): BigNumber {
  if (typeof value === 'string') {
    return wrap(Decimal.fromString(value));
  }
  if (typeof value === 'number') {
    return wrap(Decimal.fromNumber(value));
  }
  // Already a BigNumber: deep-copy so callers can never mutate shared state.
  return wrap(Decimal.fromDecimal(value as Decimal));
}

/** Construct a BigNumber from a JS number (alias of bn(number)). */
export function fromNumber(n: number): BigNumber {
  return wrap(Decimal.fromNumber(n));
}

/** Stringify. Integer-valued layer-0 numbers yield a plain integer form. */
export function toString(b: BigNumber): string {
  return (b as Decimal).toString();
}

/** BigNumber addition (returns a new BigNumber; operands are not mutated). */
export function add(a: BigNumber, b: BigNumber): BigNumber {
  // Static ops allocate a new Decimal and never mutate their inputs.
  return wrap(Decimal.add(a as Decimal, b as Decimal));
}

/** BigNumber multiplication (returns a new BigNumber; operands not mutated). */
export function multiply(a: BigNumber, b: BigNumber): BigNumber {
  return wrap(Decimal.mul(a as Decimal, b as Decimal));
}

/** Ordering: -1 if a < b, 0 if equal, 1 if a > b. */
export function compare(a: BigNumber, b: BigNumber): -1 | 0 | 1 {
  return Decimal.cmp(a as Decimal, b as Decimal);
}

/** True if the value is zero. */
export function isZero(b: BigNumber): boolean {
  return (b as Decimal).eq(0);
}

/** The larger of two BigNumbers. */
export function max(a: BigNumber, b: BigNumber): BigNumber {
  return wrap(Decimal.max(a as Decimal, b as Decimal));
}
