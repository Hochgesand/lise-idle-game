package com.lise.liseidle.state;

/**
 * A closed, server-authored co-op lease segment — the only channel through
 * which presence affects the simulation (data-model.md "CoopSegment").
 *
 * <p><b>Wire shape (002 — mirrors the frontend):</b> {@code from}/{@code until}
 * are <strong>sim-timeline timestamps in milliseconds</strong> (the same numeric
 * timeline the client derives from {@code Date.parse(lastAdvancedAt)}), and
 * {@code multiplier} is a bounded scalar
 * ({@code 1 <= multiplier <= CoopConfig.maxMultiplier}). The client never
 * authors these values — they arrive server-stamped and are merged verbatim
 * into the save. This numeric-ms shape matches the frontend {@code CoopSegment}
 * type ({@code frontend/src/sim/types.ts}); data-model.md describes the same
 * fields conceptually (the authoritative statement for the on-the-wire shape is
 * the frontend type + this record).
 *
 * <p>This is a Java record (immutable, canonical constructor) with explicit
 * {@code getX()} accessors so the DTO follows the JavaBean getter convention
 * used by the serialization layer (Jackson 3) and the round-trip tests.
 */
public record CoopSegment(long from, long until, double multiplier) {

    public long getFrom() {
        return from;
    }

    public long getUntil() {
        return until;
    }

    public double getMultiplier() {
        return multiplier;
    }
}
