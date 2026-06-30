package com.lise.liseidle.content;

/**
 * A purchasable multiplier or modifier — data-model.md "Upgrade".
 *
 * <p>{@code effect} is applied to the player's production (see {@link Effect});
 * {@code prerequisite} gates the purchase (nullable when always available).
 *
 * <p>Field names match the frontend's {@code Upgrade} in {@code types.ts}.
 *
 * @param id            unique id
 * @param name          display name
 * @param cost          purchase cost
 * @param effect        the modifier to apply when owned
 * @param prerequisite  gating requirement, or null
 */
public record Upgrade(
        String id,
        String name,
        Cost cost,
        Effect effect,
        Requirement prerequisite) {
}
