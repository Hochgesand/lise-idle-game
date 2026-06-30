// T008 — RED unit test for the big-number wrapper around break_eternity.js.
//
// ## Background (data-model.md, contracts §1, research.md)
// All resources (loc/cash/aiTokens) are big numbers serialized as **strings**
// end-to-end — never `double` (Constitution integrity + numeric-stability).
// break_eternity.js represents numbers beyond Number.MAX_VALUE; this wrapper
// hides it behind a small, pure functional API so the sim never touches the
// underlying lib directly and could swap implementations later.
//
// ## API designed here (implemented by T012)
//  - `bn(value)`              construct from string | number | BigNumber
//  - `toString(b)`            stringify (round-trip identity)
//  - `add(a, b)`              BigNumber addition
//  - `multiply(a, b)`         BigNumber multiplication
//  - `compare(a, b)`          -1 | 0 | 1 ordering
//  - `isZero(b)`              boolean
//  - `fromNumber(n)`          construct from a JS number (alias of bn(number))
//  - `max(a, b)`              the larger of two BigNumbers
//
// This file imports from `./bigNumber`, which DOES NOT EXIST yet
// (implemented in T012). Therefore the suite fails to resolve and is RED —
// the correct TDD starting state per Constitution Principle III.

import { describe, it, expect } from 'vitest';
import { bn, toString, add, multiply, compare, isZero, fromNumber, max } from './bigNumber';

// ---------------------------------------------------------------------------
// string round-trip (no precision loss) — the central integrity property
// ---------------------------------------------------------------------------

describe('string round-trip (no precision loss)', () => {
  it('toString(bn(s)) === s for integer strings', () => {
    expect(toString(bn('123'))).toEqual('123');
    expect(toString(bn('0'))).toEqual('0');
    expect(toString(bn('1'))).toEqual('1');
  });

  it('preserves large integer strings beyond Number.MAX_SAFE_INTEGER', () => {
    // Number.MAX_SAFE_INTEGER = 9007199254740991; +2 would lose precision as a number.
    expect(toString(bn('9007199254740993'))).toEqual('9007199254740993');
    // Far larger still.
    expect(toString(bn('999999999999999999999999999999'))).toEqual(
      '999999999999999999999999999999',
    );
  });

  it('preserves very large / scientific-scale strings beyond JS number range', () => {
    // 1e308 is within double range but at its edge; 1e1000 is beyond it.
    // exponent string-format can vary, so assert value-equality via compare.
    const huge1 = bn('1e308');
    const huge2 = bn('1e1000');

    // toString must produce a representation EQUAL IN VALUE to the input.
    expect(compare(bn(toString(huge1)), bn('1e308'))).toBe(0);
    expect(compare(bn(toString(huge2)), bn('1e1000'))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// arithmetic
// ---------------------------------------------------------------------------

describe('arithmetic', () => {
  it('add: "1" + "2" === "3"', () => {
    expect(toString(add(bn('1'), bn('2')))).toEqual('3');
  });

  it('add preserves precision on large ints', () => {
    expect(toString(add(bn('9007199254740993'), bn('2')))).toEqual('9007199254740995');
  });

  it('multiply: "6" * "7" === "42"', () => {
    expect(toString(multiply(bn('6'), bn('7')))).toEqual('42');
  });

  it('multiply by a fractional rate (LOC/sec * time style)', () => {
    // rate 1.5 LOC/sec over 10 seconds => 15 LOC. Clean values.
    expect(toString(multiply(bn('1.5'), bn('10')))).toEqual('15');
  });

  it('add/multiply are pure and return new BigNumber values (operands unchanged)', () => {
    const a = bn('100');
    const b = bn('200');
    const aBefore = toString(a);
    const bBefore = toString(b);

    const sum = add(a, b);
    const product = multiply(a, b);

    // operands untouched ...
    expect(toString(a)).toEqual(aBefore);
    expect(toString(b)).toEqual(bBefore);
    // ... and results are correct.
    expect(toString(sum)).toEqual('300');
    expect(toString(product)).toEqual('20000');
  });
});

// ---------------------------------------------------------------------------
// compare / ordering
// ---------------------------------------------------------------------------

describe('compare / ordering', () => {
  it('compare handles equality and both directions', () => {
    expect(compare(bn('5'), bn('5'))).toBe(0);
    expect(compare(bn('5'), bn('10'))).toBe(-1);
    expect(compare(bn('10'), bn('5'))).toBe(1);
  });

  it('compare handles huge numbers beyond JS range', () => {
    expect(compare(bn('1e1000'), bn('1e999'))).toBe(1);
  });

  it('isZero', () => {
    expect(isZero(bn('0'))).toBe(true);
    expect(isZero(bn('5'))).toBe(false);
  });

  it('max returns the larger', () => {
    expect(toString(max(bn('3'), bn('7')))).toEqual('7');
    expect(toString(max(bn('9'), bn('2')))).toEqual('9');
  });
});

// ---------------------------------------------------------------------------
// fromNumber
// ---------------------------------------------------------------------------

describe('fromNumber', () => {
  it('fromNumber(42) stringifies to "42"', () => {
    expect(toString(fromNumber(42))).toEqual('42');
  });
});
