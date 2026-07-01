package com.lise.liseidle.session;

import com.lise.liseidle.state.GameState;

/**
 * A push-only server&rarr;client message carrying an authoritative merged
 * {@link GameState} correction (contracts.md §3).
 *
 * <p>Serialized by Jackson as
 * {@code {"type":"state.correction", "state":{...GameState...}, "reason":"..."}}
 * where {@code reason} is one of {@code multi_device_sync | admin | migration}.
 * On receipt the client replaces its local state and re-anchors
 * {@code lastAdvancedAt} to now.
 *
 * <p>Use the {@link #correction(GameState, String)} factory to stamp the
 * {@code type} discriminator automatically.
 *
 * @param type   the discriminator; always {@code "state.correction"}
 * @param state  the authoritative merged GameState (big numbers as strings)
 * @param reason why the correction was sent
 */
public record StateCorrection(String type, GameState state, String reason) {

    /** The wire discriminator for this message type. */
    public static final String TYPE = "state.correction";

    /**
     * Build a {@link StateCorrection} with the type discriminator stamped.
     *
     * @param state  the authoritative GameState
     * @param reason the correction reason
     * @return a correction message ready to push
     */
    public static StateCorrection correction(GameState state, String reason) {
        return new StateCorrection(TYPE, state, reason);
    }
}
