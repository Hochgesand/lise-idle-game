// T035 — Pure big-number → human-readable string formatter for the HUD.
//
// The HUD (HudScene) displays LOC and rate values that grow astronomically
// (idle genre, break_eternity.js represents values far beyond Number.MAX_VALUE).
// This module is PURE (no Phaser, no I/O) so the formatting logic is fully
// unit-testable in Vitest (see format.test.ts) — the Phaser scene wiring
// itself is integration-level (`tsc -b` + `vite build`).
//
// ## Format spec
//  - 0 → "0"
//  - < 1_000 → plain integer (e.g. "42", "999")
//  - 1_000 – 999_999 → "1.50K" (2 decimal places, K suffix)
//  - 1e6 – 999.99e9 → "1.00M", "1.00B", "1.00T"
//  - ≥ 1e15 → exponential "1.00e+15" (covers break_eternity's full range,
//    including values beyond Number.MAX_VALUE — never NaN/Infinity)
//
// ## Numeric integrity (Constitution)
// Big numbers are strings end-to-end (never double). For the suffix tiers
// (K/M/B/T) the value fits in JS number range so toNumber() is safe. For
// ≥ 1e15 we use break_eternity's toExponential() which produces a finite
// mantissa+exponent string even beyond Number.MAX_VALUE — no NaN, no Infinity.

import type { BigNumber } from './bigNumber';
import { bn, toString } from './bigNumber';

/** Suffix tiers for the thousands/millions/billions/trillions bands. */
const SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;

/** Threshold above which we switch from T suffix to exponential notation. */
const EXPONENTIAL_THRESHOLD = 1e15;

/**
 * Format a big number as a human-readable LOC display string.
 *
 * Pure: no Phaser, no I/O. Handles the full break_eternity range (including
 * values beyond Number.MAX_VALUE) without producing NaN or Infinity.
 *
 * @param value a BigNumber, or a big-number string (e.g. "1500", "1e30")
 * @returns a display string: "42", "1.50K", "2.50M", "1.00e+30", etc.
 */
export function formatLoc(value: BigNumber | string): string {
  // Normalize to a BigNumber for consistent magnitude inspection.
  const bnVal = typeof value === 'string' ? bn(value) : value;

  // Zero is special (break_eternity's log10 of 0 is NaN).
  if (toString(bnVal) === '0') {
    return '0';
  }

  // For the suffix tiers, the value is within JS-safe number range, so
  // toNumber() is exact enough for formatting (we keep 2 sig decimals).
  const num = bnVal.toNumber();

  if (num < 1000) {
    // Small integer: no decimals, no suffix.
    return toString(bnVal).includes('.')
      ? Math.floor(num).toString()
      : toString(bnVal);
  }

  if (num < EXPONENTIAL_THRESHOLD) {
    // Suffix band: find the right tier (K/M/B/T).
    const tier = Math.floor(Math.log10(num) / 3); // 1=K, 2=M, 3=B, 4=T
    const suffix = SUFFIXES[tier] ?? '';
    const scaled = num / Math.pow(10, tier * 3);
    return `${scaled.toFixed(2)}${suffix}`;
  }

  // Astronomical range (≥ 1e15, including beyond Number.MAX_VALUE):
  // use break_eternity's toExponential for a finite mantissa+exponent string.
  // Format as "1.00e+30" (2 decimal mantissa).
  const exp = bnVal.toExponential(2); // e.g. "1.00e+30"
  // Normalize the separator to always show a 2-digit mantissa; break_eternity
  // already returns the "e+NN" form, so this is a passthrough with cleanup.
  return normalizeExponential(exp);
}

/**
 * Format a rate value (LOC/sec) for the HUD rate line.
 *
 * @param value a BigNumber, or a big-number string
 * @returns a string like "+1.0/s", "+8.5/s", "+1.50K/s"
 */
export function formatRate(value: BigNumber | string): string {
  const bnVal = typeof value === 'string' ? bn(value) : value;
  const num = bnVal.toNumber();

  // For small rates (0 – 999.9), show 1 decimal place.
  if (num < 1000) {
    return `+${num.toFixed(1)}/s`;
  }

  // Larger rates reuse the LOC formatter (K/M/B/T/exp) with a "/s" suffix.
  return `+${formatLoc(bnVal)}/s`;
}

/**
 * Normalize a break_eternity toExponential string to a consistent form.
 *
 * break_eternity returns e.g. "1.00e+30" already; this just guards against
 * any platform-specific separator quirks ("e" vs "E", missing "+").
 */
function normalizeExponential(exp: string): string {
  // Ensure lowercase "e" with explicit sign.
  return exp.replace(/e\+?/i, 'e+');
}
