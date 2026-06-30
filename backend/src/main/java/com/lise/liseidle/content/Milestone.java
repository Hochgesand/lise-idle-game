package com.lise.liseidle.content;

/**
 * A long-term goal themed on lise GmbH credentials (data-model.md "Milestone").
 *
 * <p>{@code requirement} is what earns it; {@code reward} (an {@link Effect},
 * typically {@code grantResource}) is granted when earned. Field names match
 * the frontend's {@code Milestone} in {@code types.ts}.
 *
 * @param id          unique id
 * @param name        display name, e.g. "ISO 9001 Certified"
 * @param requirement what earns it
 * @param reward      the effect applied when earned
 */
public record Milestone(
        String id,
        String name,
        Requirement requirement,
        Effect reward) {
}
