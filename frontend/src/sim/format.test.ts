// T035 — Unit tests for the pure `formatLoc` big-number formatter.
//
// The HUD renders LOC values that can grow astronomically (idle genre,
// break_eternity.js). The formatting logic is pure and fully unit-testable;
// the Phaser scene wiring (HudScene) is integration-level (`tsc -b` +
// `vite build`). These tests pin the formatter spec (see format.ts header).

import { describe, it, expect } from 'vitest';
import { formatLoc, formatRate } from './format';

describe('formatLoc', () => {
  it('formats zero as "0"', () => {
    expect(formatLoc('0')).toBe('0');
  });

  it('formats small integers as-is', () => {
    expect(formatLoc('42')).toBe('42');
    expect(formatLoc('999')).toBe('999');
  });

  it('formats thousands with K suffix (2 decimals)', () => {
    expect(formatLoc('1500')).toBe('1.50K');
    expect(formatLoc('1000')).toBe('1.00K');
    expect(formatLoc('999000')).toBe('999.00K');
  });

  it('formats millions with M suffix', () => {
    expect(formatLoc('1000000')).toBe('1.00M');
    expect(formatLoc('2500000')).toBe('2.50M');
  });

  it('formats billions with B suffix', () => {
    expect(formatLoc('1000000000')).toBe('1.00B');
  });

  it('formats trillions with T suffix', () => {
    expect(formatLoc('1000000000000')).toBe('1.00T');
  });

  it('formats astronomical values (beyond T) as exponential, never NaN/Infinity', () => {
    const result = formatLoc('1e30');
    // Should be a finite exponential like "1.00e+30" — NOT "NaN" or "Infinity".
    expect(result).not.toBe('NaN');
    expect(result).not.toBe('Infinity');
    expect(result).toMatch(/e/i);
    // Must contain a finite-looking mantissa.
    expect(result).toMatch(/^[0-9]/);
  });

  it('handles values near Number.MAX_VALUE without NaN', () => {
    const result = formatLoc('1.8e308');
    expect(result).not.toBe('NaN');
    expect(result).not.toBe('Infinity');
    expect(result).toMatch(/e/i);
  });

  it('handles values beyond Number.MAX_VALUE (break_eternity range)', () => {
    const result = formatLoc('1e400');
    expect(result).not.toBe('NaN');
    expect(result).not.toBe('Infinity');
    expect(result).toMatch(/e/i);
  });
});

describe('formatRate', () => {
  it('formats zero rate as "+0.0/s"', () => {
    expect(formatRate('0')).toBe('+0.0/s');
  });

  it('formats a rate of 1 LOC/sec as "+1.0/s"', () => {
    expect(formatRate('1')).toBe('+1.0/s');
  });

  it('formats a rate of 8.5 as "+8.5/s"', () => {
    expect(formatRate('8.5')).toBe('+8.5/s');
  });

  it('uses K/M suffixes for large rates', () => {
    expect(formatRate('1500')).toBe('+1.50K/s');
  });
});
