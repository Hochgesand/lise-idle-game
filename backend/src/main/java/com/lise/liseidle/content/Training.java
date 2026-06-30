package com.lise.liseidle.content;

/**
 * A lise Academy training — a permanent production boost (data-model.md
 * "Training"). Once bought, {@code permanentMultiplier} always applies.
 *
 * <p>{@code prerequisite} gates the purchase (nullable when always available).
 * Field names match the frontend's {@code Training} in {@code types.ts}.
 *
 * @param id                   unique id
 * @param name                 display name
 * @param description          flavor text (lise Academy course)
 * @param cost                 purchase cost
 * @param permanentMultiplier  multiplies base production (persists)
 * @param prerequisite         gating requirement, or null
 */
public record Training(
        String id,
        String name,
        String description,
        Cost cost,
        double permanentMultiplier,
        Requirement prerequisite) {
}
