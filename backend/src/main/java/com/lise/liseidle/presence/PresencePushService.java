package com.lise.liseidle.presence;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/**
 * Server&rarr;client push service for the presence channel
 * (contracts.md &sect;3; T060; RED tests for the callers land in T053/T054/T055).
 *
 * <p><b>Mirrors {@code session/SessionPushService}</b> in shape: a thin,
 * push-only seam that takes already-decided payloads and routes them through
 * the {@link SimpMessagingTemplate}, keeping the messaging plumbing out of the
 * service/controller logic. Where the session push service delivers
 * <i>user-addressed</i> corrections to {@code /user/queue/state}, this service
 * delivers the presence family:
 * <ul>
 *   <li>{@code presence.update} / {@code presence.remove} are <b>broadcast</b>
 *       to {@code /topic/presence} via {@link SimpMessagingTemplate#convertAndSend}
 *       &mdash; visible colleagues only, exactly one record per
 *       {@code colleagueId} (contracts &sect;3). The visibility filter is the
 *       caller's responsibility ({@code PresenceService} broadcasts only
 *       consented+visible records); this seam sends exactly what it is handed.</li>
 *   <li>{@code coop.segment} is <b>user-addressed</b> to {@code /user/queue/coop}
 *       via {@link SimpMessagingTemplate#convertAndSendToUser} (Phase 5 / T072);
 *       defined here so the message family is complete, not yet issued.</li>
 * </ul>
 *
 * <p><b>Delivery is best-effort</b>: the in-memory simple broker drops a message
 * when no client is subscribed, which is fine &mdash; presence is display-only,
 * advisory, and re-converged by a snapshot re-fetch on (re)connect (contracts
 * &sect;4 &mdash; staleness is tolerated; FR-018). Broadcasting the FR-004
 * {@link PresenceRecordView} (never the live-tier {@link PresenceRecord} with
 * its {@code leaseExpiresAt}) is enforced here: {@link #broadcastPresenceUpdate}
 * projects the domain record through {@link PresenceRecordView#of} before
 * sending, so no caller can accidentally leak the lease expiry.
 *
 * <p>Constructor-injects {@link SimpMessagingTemplate} so it is Spring-managed
 * and unit-testable with a Mockito mock (like {@code SessionPushService}).
 */
@Service
public class PresencePushService {

    /** The broadcast destination for presence deltas (contracts &sect;3). */
    static final String TOPIC_PRESENCE = "/topic/presence";

    /** The per-user co-op lease destination (Spring resolves to {@code /queue/coop-user{session}}). */
    static final String QUEUE_COOP = "/queue/coop";

    private final SimpMessagingTemplate messagingTemplate;

    public PresencePushService(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Broadcast a {@code presence.update} upsert to {@code /topic/presence}. The
     * domain record is projected onto the FR-004 {@link PresenceRecordView}
     * (dropping {@code leaseExpiresAt}, mapping the status enum to its wire
     * string) before sending, so the lease expiry is never leaked.
     *
     * @param record     the colleague's record (must already be visibility-filtered by the caller)
     * @param serverTime the server instant that authored the change (ISO-8601)
     */
    public void broadcastPresenceUpdate(PresenceRecord record, String serverTime) {
        messagingTemplate.convertAndSend(
                TOPIC_PRESENCE,
                PresenceUpdate.update(PresenceRecordView.of(record), serverTime));
    }

    /**
     * Broadcast a {@code presence.remove} to {@code /topic/presence} so
     * observers drop the avatar entirely (the colleague hid / revoked consent;
     * contracts &sect;3).
     *
     * @param colleagueId the social key whose avatar observers must drop
     */
    public void broadcastPresenceRemove(String colleagueId) {
        messagingTemplate.convertAndSend(TOPIC_PRESENCE, PresenceRemove.remove(colleagueId));
    }

    /**
     * Push a per-player {@code coop.segment} lease to {@code /user/queue/coop}
     * (Phase 5 / T072; defined here so the message family is complete, not yet
     * issued by any Phase 4 path).
     *
     * @param colleagueId the recipient (Spring user name = JWT {@code sub})
     * @param segment     the server-authored lease segment (ISO-8601 bounds, capped multiplier)
     */
    public void sendCoopSegment(String colleagueId, CoopSegmentMessage.Segment segment) {
        messagingTemplate.convertAndSendToUser(
                colleagueId, QUEUE_COOP, CoopSegmentMessage.segment(segment));
    }
}
