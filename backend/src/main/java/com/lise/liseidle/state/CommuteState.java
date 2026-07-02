package com.lise.liseidle.state;

/**
 * An in-progress office switch (data-model.md "CommuteState"; closes the
 * 001 FR-016 saved-commute gap).
 *
 * <p><b>Wire shape (002 — mirrors the frontend):</b> {@code startedAt} is a
 * <strong>sim-timeline timestamp in milliseconds</strong>, written by the
 * {@code switchOffice} mutator from {@code lastAdvancedAt} (never wall clock) so
 * {@code advance} can resolve the commute from elapsed time on load at
 * {@code startedAt + CoopConfig.commuteSeconds}. {@code fromOffice}/
 * {@code toOffice} are office ids. While {@code commute != null} the dev is
 * present in no office. This numeric-ms shape matches the frontend
 * {@code CommuteState} type ({@code frontend/src/sim/types.ts}).
 *
 * <p>This is a Java record (immutable, canonical constructor) with explicit
 * {@code getX()} accessors so the DTO follows the JavaBean getter convention
 * used by the serialization layer (Jackson 3) and the round-trip tests.
 */
public record CommuteState(String fromOffice, String toOffice, long startedAt) {

    public String getFromOffice() {
        return fromOffice;
    }

    public String getToOffice() {
        return toOffice;
    }

    public long getStartedAt() {
        return startedAt;
    }
}
