package com.lise.liseidle.presence;

/**
 * A broadcast server&rarr;client presence upsert on {@code /topic/presence}
 * (contracts &sect;3 "Server &rarr; Client messages"). One message type covers a
 * colleague joining, an office move, an activity change, a commute start/end,
 * and the live &rarr; last-seen transition: observers replace the record keyed by
 * {@code colleagueId} (last-write-wins per colleague).
 *
 * <p>Serialized by Jackson as
 * {@code {"type":"presence.update", "serverTime":"...", "record":{ ...PresenceRecordView... }}}.
 * The {@code record} is the FR-004 allowlist {@link PresenceRecordView} (no
 * {@code leaseExpiresAt}); {@code serverTime} is the server clock instant that
 * authored the change, so a client MAY discard a delta older than its last
 * snapshot's {@code serverTime} (contracts &sect;3 "Reconnect &amp; snapshot
 * refresh").
 *
 * <p>Use the {@link #update(PresenceRecordView, String)} factory to stamp the
 * {@code type} discriminator automatically. Mirrors the 001
 * {@code TYPE}-discriminator + static-factory style of
 * {@code session/StateCorrection}/{@code session/ContentUpdate}; pushes go
 * through {@link PresencePushService}.
 *
 * @param type       the discriminator; always {@link #TYPE}
 * @param serverTime ISO-8601 server instant that authored the change
 * @param record     the FR-004 allowlist presence record
 */
public record PresenceUpdate(String type, String serverTime, PresenceRecordView record) {

    /** The wire discriminator for this message type (contracts &sect;3). */
    public static final String TYPE = "presence.update";

    /**
     * Build a {@link PresenceUpdate} with the type discriminator stamped.
     *
     * @param record     the FR-004 allowlist presence record to upsert
     * @param serverTime the server instant that authored the change (ISO-8601)
     * @return an update message ready to broadcast on {@code /topic/presence}
     */
    public static PresenceUpdate update(PresenceRecordView record, String serverTime) {
        return new PresenceUpdate(TYPE, serverTime, record);
    }
}
