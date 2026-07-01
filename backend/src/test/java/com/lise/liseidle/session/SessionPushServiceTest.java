package com.lise.liseidle.session;

import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.SampleStates;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

/**
 * T024 — RED test for {@link SessionPushService} (TDD).
 *
 * <p>Uses a Mockito-mocked {@link SimpMessagingTemplate} to deterministically
 * prove the push-only model (contracts.md §3): the two push methods route to
 * the player's {@code /user/queue/state} destination with the correct payload
 * type and {@code type} discriminator, without relying on an async broker.
 * {@link SessionPushService}, {@link StateCorrection}, and {@link ContentUpdate}
 * do NOT exist yet (implemented in T024), so this test does not compile — the
 * correct TDD RED state per Constitution Principle III.
 */
@ExtendWith(MockitoExtension.class)
class SessionPushServiceTest {

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @InjectMocks
    private SessionPushService pushService;

    /**
     * {@code sendStateCorrection} must deliver a {@link StateCorrection} with
     * {@code type="state.correction"} to {@code /user/queue/state}.
     */
    @Test
    void sendStateCorrection_routesToUserQueueWithCorrectionPayload() {
        GameState state = SampleStates.populated();

        pushService.sendStateCorrection("player-1", state, "multi_device_sync");

        ArgumentCaptor<StateCorrection> captor = ArgumentCaptor.forClass(StateCorrection.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq("player-1"), eq("/queue/state"), captor.capture());

        StateCorrection payload = captor.getValue();
        assertEquals("state.correction", payload.type(),
                "StateCorrection must stamp type=\"state.correction\"");
        assertEquals("multi_device_sync", payload.reason());
        assertSame(state, payload.state(),
                "the GameState must be carried verbatim");
    }

    /**
     * {@code sendContentUpdate} must deliver a {@link ContentUpdate} with
     * {@code type="content.update"} to {@code /user/queue/state}.
     */
    @Test
    void sendContentUpdate_routesToUserQueueWithUpdatePayload() {
        pushService.sendContentUpdate("player-2", "1.2.0");

        ArgumentCaptor<ContentUpdate> captor = ArgumentCaptor.forClass(ContentUpdate.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq("player-2"), eq("/queue/state"), captor.capture());

        ContentUpdate payload = captor.getValue();
        assertEquals("content.update", payload.type(),
                "ContentUpdate must stamp type=\"content.update\"");
        assertEquals("1.2.0", payload.contentVersion());
    }
}
