package com.lise.liseidle.presence;

/**
 * A broadcast server&rarr;client presence removal on {@code /topic/presence}
 * (contracts &sect;3 "Server &rarr; Client messages"). The colleague hid
 * themselves (or revoked consent); observers drop the avatar entirely
 * (unlike last-seen, which keeps rendering).
 *
 * <p>Serialized by Jackson as
 * {@code {"type":"presence.remove", "colleagueId":"&lt;sub&gt;"}}. Carrying only
 * the {@code colleagueId} is safe under the contracts &sect;2 identity-bound
 * ownership rule (the {@code sub} is a public technical key there); no field
 * beyond it is needed and none is exposed (FR-004).
 *
 * <p>Use the {@link #remove(String)} factory to stamp the {@code type}
 * discriminator automatically. Mirrors the 001 {@code TYPE}-discriminator +
 * static-factory style; pushes go through {@link PresencePushService}.
 *
 * @param type        the discriminator; always {@link #TYPE}
 * @param colleagueId the social key whose avatar observers must drop
 */
public record PresenceRemove(String type, String colleagueId) {

    /** The wire discriminator for this message type (contracts &sect;3). */
    public static final String TYPE = "presence.remove";

    /**
     * Build a {@link PresenceRemove} with the type discriminator stamped.
     *
     * @param colleagueId the social key whose avatar observers must drop
     * @return a remove message ready to broadcast on {@code /topic/presence}
     */
    public static PresenceRemove remove(String colleagueId) {
        return new PresenceRemove(TYPE, colleagueId);
    }
}
