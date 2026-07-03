package com.lise.liseidle.state;

/**
 * (003) The one in-progress Academy training (003 data-model §1). At most one
 * exists per save ({@code GameState.activeTraining}); {@code null} when idle.
 *
 * <p><b>Wire shape (mirrors the frontend):</b> {@code startedAt} is a
 * <strong>sim-timeline timestamp in milliseconds</strong>, written by the
 * frontend {@code startTraining} mutator from {@code lastAdvancedAt} (never
 * wall clock) so the pure {@code advance} resolves completion from elapsed
 * time at {@code startedAt + Training.durationSeconds * 1000} — including
 * inside offline spans (003 FR-017/018). {@code trainingId} references a
 * Training content definition. The backend is passthrough-only: it persists,
 * merges (later-{@code lastAdvancedAt} snapshot pair rule), and serves this
 * record verbatim, never resolves it. This numeric-ms shape matches the
 * frontend {@code ActiveTrainingState} type ({@code frontend/src/sim/types.ts}).
 *
 * <p>This is a Java record (immutable, canonical constructor) with explicit
 * {@code getX()} accessors so the DTO follows the JavaBean getter convention
 * used by the serialization layer (Jackson 3) and the round-trip tests.
 */
public record ActiveTrainingState(String trainingId, long startedAt) {

    public String getTrainingId() {
        return trainingId;
    }

    public long getStartedAt() {
        return startedAt;
    }
}
