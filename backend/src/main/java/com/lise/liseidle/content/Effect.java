package com.lise.liseidle.content;

/**
 * A polymorphic modifier applied by upgrades and milestone rewards
 * (data-model.md "Effect / Reward").
 *
 * <p>The wire format is a single JSON object discriminated by {@code type},
 * matching the frontend's {@code Effect} discriminated union in {@code types.ts}:
 * <ul>
 *   <li><b>globalMultiplier</b> — multiply total LOC/sec by {@code multiplier}
 *       ({@code { "type": "globalMultiplier", "multiplier": 1.05 }}).</li>
 *   <li><b>producerRateMultiplier</b> — multiply a specific producer's rate by
 *       {@code multiplier} ({@code producerId} set).</li>
 *   <li><b>grantResource</b> — grant {@code amount} of {@code resource}
 *       (used by milestone rewards; {@code resource} + {@code amount} set).</li>
 * </ul>
 *
 * <p>Optional fields are nullable: only the fields relevant to a given
 * {@code type} are populated. Jackson 3 deserializes the record natively,
 * defaulting absent object fields to {@code null} and {@code multiplier}
 * (primitive {@code double}) to {@code 0.0} when absent (harmless for
 * {@code grantResource}, which does not read it).
 *
 * <p>A {@code Reward} is just an {@code Effect} applied when a milestone is
 * earned (data-model.md); {@code Milestone.reward} uses this type directly.
 *
 * @param type        the effect type (discriminator)
 * @param multiplier  the rate multiplier (global/producer variants)
 * @param producerId  target producer id (producerRateMultiplier)
 * @param resource    target resource (grantResource)
 * @param amount      grant amount as a big-number string (grantResource)
 */
public record Effect(
        String type,
        double multiplier,
        String producerId,
        String resource,
        String amount) {
}
