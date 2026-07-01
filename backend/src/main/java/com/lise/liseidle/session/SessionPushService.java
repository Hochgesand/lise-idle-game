package com.lise.liseidle.session;

import com.lise.liseidle.state.GameState;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/**
 * Server&rarr;client push service for the WebSocket/STOMP live channel
 * (contracts.md §3).
 *
 * <p><b>Push-only:</b> the simulation runs client-side; the client saves via
 * REST {@code PUT .../state} (the {@code SessionController}). This service is
 * the seam that the sync/merge layer and admin tooling call to push
 * <b>authoritative state corrections</b> (after a merge) and
 * <b>content-update notifications</b> to a connected client. It is not invoked
 * within T024 itself — it exists so the merge/REST layer (T022/T023) and any
 * admin operation can deliver corrections without touching STOMP plumbing.
 *
 * <p>Both methods deliver to the player's user-specific queue
 * {@code /user/queue/state} via
 * {@link SimpMessagingTemplate#convertAndSendToUser(String, String, Object)}.
 * Delivery is best-effort: the in-memory simple broker drops the message when
 * no client is connected, which is fine because the client's local
 * localStorage save is authoritative for play (Constitution Principle IV).
 *
 * <p>Constructor-injects {@link SimpMessagingTemplate} so it is Spring-managed
 * and unit-testable with a Mockito mock.
 */
@Service
public class SessionPushService {

    /** The per-user queue a connected client subscribes to (contracts §3). */
    static final String QUEUE_STATE = "/queue/state";

    private final SimpMessagingTemplate messagingTemplate;

    public SessionPushService(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Push an authoritative {@link GameState} correction to a connected player.
     *
     * @param playerId the recipient player id (Spring user name)
     * @param state    the authoritative merged GameState
     * @param reason   why the correction was sent
     *                 ({@code multi_device_sync | admin | migration})
     */
    public void sendStateCorrection(String playerId, GameState state, String reason) {
        messagingTemplate.convertAndSendToUser(
                playerId, QUEUE_STATE, StateCorrection.correction(state, reason));
    }

    /**
     * Push a content-update notification to a connected player, signalling they
     * should re-fetch {@code /api/v1/content}.
     *
     * @param playerId       the recipient player id (Spring user name)
     * @param contentVersion the new content version
     */
    public void sendContentUpdate(String playerId, String contentVersion) {
        messagingTemplate.convertAndSendToUser(
                playerId, QUEUE_STATE, ContentUpdate.update(contentVersion));
    }
}
