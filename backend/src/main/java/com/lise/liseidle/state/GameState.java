package com.lise.liseidle.state;

import java.util.Set;

/**
 * The complete saveable snapshot of a player — the only thing persisted and
 * the input/output of the pure {@code advance} simulation (data-model.md
 * "GameState"). On the backend this DTO is persisted (T021) and serialized
 * over the REST/WebSocket boundary (contracts.md §2/§3).
 *
 * <p>All big-number fields live inside {@link ResourceSet} as strings; the
 * ownership sets ({@code ownedProducers}, {@code ownedUpgrades},
 * {@code ownedTrainings}, {@code earnedMilestones}) are {@code Set<String>}
 * of content ids; {@code activeBurner} is nullable (no burner active).
 * {@code lastAdvancedAt} is an ISO-8601 UTC timestamp (the clock anchor);
 * {@code schemaVersion} drives the save-migration chain.
 *
 * <p>This is a Java record: immutable, with a canonical constructor matching
 * the {@code SampleStates} test fixture argument order, plus explicit
 * {@code getX()} accessors so the round-trip tests and serialization layer
 * can use the JavaBean getter convention.
 */
public record GameState(
        ResourceSet resources,
        Set<String> ownedProducers,
        Set<String> ownedUpgrades,
        Set<String> ownedTrainings,
        BurnerState activeBurner,
        Set<String> earnedMilestones,
        String lastAdvancedAt,
        int schemaVersion,
        PlayerSettings settings) {

    public ResourceSet getResources() {
        return resources;
    }

    public Set<String> getOwnedProducers() {
        return ownedProducers;
    }

    public Set<String> getOwnedUpgrades() {
        return ownedUpgrades;
    }

    public Set<String> getOwnedTrainings() {
        return ownedTrainings;
    }

    public BurnerState getActiveBurner() {
        return activeBurner;
    }

    public Set<String> getEarnedMilestones() {
        return earnedMilestones;
    }

    public String getLastAdvancedAt() {
        return lastAdvancedAt;
    }

    public int getSchemaVersion() {
        return schemaVersion;
    }

    public PlayerSettings getSettings() {
        return settings;
    }
}
