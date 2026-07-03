package com.lise.liseidle.state;

import java.util.List;

/**
 * Test fixture builder for {@link GameState} used by the Phase 2 round-trip
 * tests (T011). Lives in the test sources so it does not pollute production.
 *
 * <p>The DTO classes ({@link GameState}, {@link ResourceSet}, {@link BurnerState},
 * {@link PlayerSettings}) are implemented by T018; until then this helper does
 * not compile, which is the required TDD RED state.
 */
public final class SampleStates {

    private SampleStates() {
    }

    /**
     * A fully populated {@link GameState} exercising every field, including a
     * {@link BurnerState} and big-number values beyond {@code MAX_SAFE_INTEGER}.
     */
    public static GameState populated() {
        ResourceSet resources = new ResourceSet(
                /* loc       */ "9007199254740993", // beyond MAX_SAFE_INTEGER
                /* cash      */ "42",
                /* aiTokens  */ "0");

        BurnerState burner = new BurnerState(
                /* definitionId   */ "burner1",
                /* startedAt      */ "2026-06-30T12:00:00.000Z",
                /* fuelRemaining  */ "100");

        PlayerSettings settings = new PlayerSettings(
                /* reducedMotion */ false,
                /* muted         */ true);

        // (002) co-op overlay — exercised with concrete values so the
        // round-trip tests prove these fields persist/serialize losslessly
        // (not merely the defaulted baseline). {@code from}/{@code until}/
        // {@code startedAt} are sim-timeline ms (Date.parse of the ISO
        // lastAdvancedAt above = 1782820800000); {@code until = from +
        // 60_000} is one placeholder lease (coop.leaseSeconds = 60).
        CoopSegment segment = new CoopSegment(
                /* from       */ 1782820800000L,
                /* until      */ 1782820860000L,
                /* multiplier */ 1.2);

        CommuteState commute = new CommuteState(
                /* fromOffice */ "office_1",
                /* toOffice   */ "office_2",
                /* startedAt  */ 1782820770000L); // 30s before `from`

        // (003) an in-progress Academy training — exercised with a concrete
        // value so the round-trip tests prove the v3 field persists/serializes
        // losslessly (not merely the defaulted null baseline). `startedAt` is
        // sim-timeline ms (Date.parse of the ISO lastAdvancedAt above).
        ActiveTrainingState activeTraining = new ActiveTrainingState(
                /* trainingId */ "agile_master",
                /* startedAt  */ 1782820800000L);

        return new GameState(
                resources,
                java.util.Set.of("manual_typing", "copilot"),
                java.util.Set.of("u1"),
                java.util.Set.of("t1"),
                burner,
                java.util.Set.of("m1"),
                "2026-06-30T12:00:00.000Z",
                1,
                settings,
                /* coopSegments */ List.of(segment),
                /* activeOffice */ "office_2",
                /* commute */ commute,
                /* activeTraining */ activeTraining);
    }

    /**
     * A {@link GameState} with no active burner, exercising the
     * {@code activeBurner = null} case.
     */
    public static GameState withNoActiveBurner() {
        ResourceSet resources = new ResourceSet(
                "10", "5", "0");

        PlayerSettings settings = new PlayerSettings(false, false);

        return new GameState(
                resources,
                java.util.Set.of("manual_typing"),
                java.util.Set.of(),
                java.util.Set.of(),
                /* activeBurner */ null,
                java.util.Set.of(),
                "2026-06-30T12:00:00.000Z",
                1,
                settings,
                /* coopSegments */ List.of(),
                /* activeOffice */ "office_1",
                /* commute */ null,
                /* activeTraining */ null);
    }

    /**
     * A fresh, empty {@link GameState} — the state a brand-new player starts
     * with (all ownership sets empty, resources at zero, no burner).
     */
    public static GameState fresh() {
        ResourceSet resources = new ResourceSet("0", "0", "0");
        PlayerSettings settings = new PlayerSettings(false, false);

        return new GameState(
                resources,
                java.util.Set.of(),
                java.util.Set.of(),
                java.util.Set.of(),
                null,
                java.util.Set.of(),
                "2026-06-30T12:00:00.000Z",
                1,
                settings,
                /* coopSegments */ List.of(),
                /* activeOffice */ "office_1",
                /* commute */ null,
                /* activeTraining */ null);
    }
}
