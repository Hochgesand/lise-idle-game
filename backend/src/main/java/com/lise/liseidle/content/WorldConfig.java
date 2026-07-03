package com.lise.liseidle.content;

/**
 * (003) World/presentation tuning (003 data-model §3; FR-021).
 *
 * <p>The station-walk duration as <strong>tunable content data</strong>
 * (Constitution Principle II) — a single object ({@code world.json}), the
 * additive seventh entry in the served envelope (the exact {@code coop.json}
 * pattern), mirrored into the bundled client fallback so an offline-booting
 * client walks with identical tuning. Loaded fail-fast by
 * {@link ContentLoader} alongside the six 001/002 entries.
 *
 * <p>Consumed ONLY by the frontend presentation layer (station-walk
 * interpolation, US2); nothing in the pure simulation reads it. Field names
 * match the frontend's {@code WorldConfig} in {@code types.ts} exactly, so
 * the served JSON is the shared contract.
 *
 * @param walkSeconds station-walk duration in seconds ({@code > 0}, finite)
 */
public record WorldConfig(double walkSeconds) {
}
