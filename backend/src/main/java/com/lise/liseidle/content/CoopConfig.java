package com.lise.liseidle.content;

/**
 * Co-op bonus tuning (data-model.md "CoopConfig"; contracts §1/§2; FR-015).
 *
 * <p>Magnitude, cap, and lease timing as <strong>tunable content data</strong>
 * (Constitution Principle II) — a single object ({@code coop.json}), mirrored
 * into the bundled client fallback so an offline-booting client integrates
 * with identical values. Loaded fail-fast by {@link ContentLoader} alongside
 * the five 001 arrays.
 *
 * <p>Field names match the frontend's {@code CoopConfig} in {@code types.ts}
 * exactly, so the served JSON is the shared contract.
 *
 * @param perColleagueMultiplier bonus per distinct present colleague, additive before capping ({@code >= 0})
 * @param maxMultiplier          hard cap on the total multiplier ({@code >= 1}, FR-011)
 * @param leaseSeconds           how far each heartbeat extends a lease / presence TTL ({@code > 0})
 * @param heartbeatSeconds       client heartbeat interval ({@code 0 < x < leaseSeconds})
 * @param commuteSeconds         office-switch commute duration ({@code > 0}); consumed by {@code advance}'s
 *                               commute resolution and by observers rendering route progress (001 FR-016)
 * @param lastSeenRetentionDays  rendering/retention window for durable last-seen rows ({@code > 0})
 */
public record CoopConfig(
        double perColleagueMultiplier,
        double maxMultiplier,
        int leaseSeconds,
        int heartbeatSeconds,
        int commuteSeconds,
        int lastSeenRetentionDays) {
}
