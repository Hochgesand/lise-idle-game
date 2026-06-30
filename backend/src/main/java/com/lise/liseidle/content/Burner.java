package com.lise.liseidle.content;

/**
 * A burner content definition, referenced by {@code BurnerState.definitionId}
 * (data-model.md "Burner"). {@code fuelCostToActivate} and {@code burnRate}
 * are big-number <strong>strings</strong> (never {@code double});
 * {@code productionMultiplier} is the LOC/sec multiplier applied while active.
 *
 * <p>Field names match the frontend's {@code Burner} in {@code types.ts}.
 *
 * @param id                   unique id
 * @param name                 display name
 * @param fuelCostToActivate   AI tokens to start, as a big-number string
 * @param burnRate             tokens consumed / sec, as a big-number string
 * @param productionMultiplier LOC/sec multiplier while active
 */
public record Burner(
        String id,
        String name,
        String fuelCostToActivate,
        String burnRate,
        double productionMultiplier) {
}
