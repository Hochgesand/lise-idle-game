package com.lise.liseidle.content;

/**
 * A source of LOC/sec (themed dev activity tier) — data-model.md "Producer".
 *
 * <p>{@code baseRate} is the LOC/sec granted when owned, as a big-number
 * <strong>string</strong> (never {@code double}). {@code costGrowth} is the
 * cost multiplier per purchase (e.g. {@code 1.15}). {@code unlockRequirement}
 * gates availability (nullable when always available).
 *
 * <p>Field names match the frontend's {@code Producer} in {@code types.ts}
 * exactly so the served JSON is a shared contract. Jackson 3 serializes this
 * record natively from the canonical components.
 *
 * @param id                unique id, e.g. "manual_typing"
 * @param name              display name
 * @param description       flavor text
 * @param baseRate          LOC/sec granted, as a big-number string
 * @param cost              purchase cost
 * @param costGrowth        cost multiplier per purchase
 * @param unlockRequirement gating requirement, or null
 */
public record Producer(
        String id,
        String name,
        String description,
        String baseRate,
        Cost cost,
        double costGrowth,
        Requirement unlockRequirement) {
}
