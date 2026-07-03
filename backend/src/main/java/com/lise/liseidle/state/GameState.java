package com.lise.liseidle.state;

import java.util.List;
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
 * <p><b>002 co-op overlay (additive):</b> {@code coopSegments} carries
 * server-issued co-op lease segments, {@code activeOffice} the dev's active
 * office, and {@code commute} an in-progress office switch. The three fields
 * are appended after {@code settings} to preserve the 001 component order
 * (so Jackson's JSON property order matches the frontend wire shape). Absent
 * or {@code null} values are normalized to {@code []} / {@code "office_1"} /
 * {@code null} on read by {@code PlayerStateService} so pre-existing v1 rows
 * never NPE or leak {@code null} to a v2 client (data-model.md "Save
 * migration"). An empty {@code coopSegments} + {@code "office_1"} + {@code null}
 * commute is byte-identical to Spec 001 behavior.
 *
 * <p><b>003 living-campus (additive, save schema v3):</b>
 * {@code activeTraining} carries the one in-progress Academy training
 * ({@code null} when idle — which is itself the normalized default, exactly
 * like {@code commute}). Backend involvement is passthrough-only: persisted,
 * merged as part of the later-{@code lastAdvancedAt} snapshot pair rule
 * (with {@code activeOffice}/{@code commute}), and served verbatim; the pure
 * frontend {@code advance} owns resolution (003 data-model §8).
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
        PlayerSettings settings,
        List<CoopSegment> coopSegments,
        String activeOffice,
        CommuteState commute,
        ActiveTrainingState activeTraining) {

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

    /**
     * (002) Server-issued co-op lease segments; default {@code []}. May be
     * {@code null} on a freshly deserialized v1 row until normalized by
     * {@code PlayerStateService}.
     */
    public List<CoopSegment> getCoopSegments() {
        return coopSegments;
    }

    /**
     * (002) The dev's active office id; default {@code "office_1"}. May be
     * {@code null} on a freshly deserialized v1 row until normalized by
     * {@code PlayerStateService}.
     */
    public String getActiveOffice() {
        return activeOffice;
    }

    /**
     * (002) An in-progress office switch, or {@code null} when none is running
     * (the baseline). {@code null} is itself the normalized default.
     */
    public CommuteState getCommute() {
        return commute;
    }

    /**
     * (003) The one in-progress Academy training, or {@code null} when none is
     * running (the baseline). {@code null} is itself the normalized default —
     * a freshly deserialized v1/v2 row carries {@code null} here, which is
     * already the correct v3 value (003 data-model §8).
     */
    public ActiveTrainingState getActiveTraining() {
        return activeTraining;
    }
}
