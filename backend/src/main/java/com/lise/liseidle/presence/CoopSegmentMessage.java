package com.lise.liseidle.presence;

/**
 * A per-player, user-addressed co-op lease segment on {@code /user/queue/coop}
 * (contracts &sect;3 "Server &rarr; Client messages"; Phase 5 / tasks.md T072).
 *
 * <p><b>Defined in T060 but NOT yet sent</b> &mdash; {@link PresencePushService}
 * exposes {@link PresencePushService#sendCoopSegment(String, Segment)} now so
 * the presence package's push surface is complete, but no Phase 4 code path
 * issues segments: the co-op bonus is wired onto the heartbeat path in Phase 5
 * (T071 {@code CoopService} + T072 {@code PresenceService} issuance). Keeping
 * the record here lets T060 land the full message family in one commit and
 * lets Phase 5 reference a stable type.
 *
 * <p>Serialized by Jackson as
 * {@code {"type":"coop.segment",
 *          "segment":{"from":"&lt;ISO&gt;","until":"&lt;ISO&gt;","multiplier":1.2}}}.
 * The segment {@code from}/{@code until} are <b>server-authored ISO-8601
 * instants</b> (the {@code coop.segment} STOMP wire shape, contracts &sect;3),
 * and {@code multiplier} is a bounded scalar already capped server-side at
 * {@code coop.maxMultiplier} ({@code 1 <= multiplier <= maxMultiplier}). The
 * client applies it via {@code applyCoopPresence} (contracts &sect;1) and
 * persists at the established safe-mutation points. <b>Note</b>: this STOMP
 * ISO-string shape is distinct from the persisted save
 * {@code state/CoopSegment} (sim-timeline ms) &mdash; the client converts on
 * merge; Phase 5 reconciles the two.
 *
 * <p>Use the {@link #segment(Segment)} factory to stamp the {@code type}
 * discriminator automatically. Mirrors the 001 {@code TYPE}-discriminator +
 * static-factory style; pushes go through {@link PresencePushService}.
 *
 * @param type    the discriminator; always {@link #TYPE}
 * @param segment the server-authored lease segment
 */
public record CoopSegmentMessage(String type, Segment segment) {

    /** The wire discriminator for this message type (contracts &sect;3). */
    public static final String TYPE = "coop.segment";

    /**
     * A server-authored co-op lease segment (contracts &sect;3
     * {@code coop.segment}). {@code from}/{@code until} are ISO-8601 server
     * instants; {@code multiplier} is a capped scalar in
     * {@code [1, maxMultiplier]}.
     *
     * @param from       segment start, server clock (ISO-8601)
     * @param until      bounded lease end, server clock (ISO-8601)
     * @param multiplier production multiplier ({@code 1 <= m <= maxMultiplier})
     */
    public record Segment(String from, String until, double multiplier) {
    }

    /**
     * Build a {@link CoopSegmentMessage} with the type discriminator stamped.
     *
     * @param segment the server-authored lease segment
     * @return a segment message ready to push on {@code /user/queue/coop}
     */
    public static CoopSegmentMessage segment(Segment segment) {
        return new CoopSegmentMessage(TYPE, segment);
    }
}
