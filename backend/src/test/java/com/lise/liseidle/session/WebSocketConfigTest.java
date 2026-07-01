package com.lise.liseidle.session;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * T024 — RED test for the WebSocket/STOMP configuration (TDD).
 *
 * <p>Asserts the {@code @EnableWebSocketMessageBroker} wiring is present: when
 * that annotation + {@code WebSocketMessageBrokerConfigurer} are registered,
 * Spring creates a {@link SimpMessagingTemplate} bean. Before T024's
 * {@code WebSocketConfig} exists, that bean is absent and autowiring fails —
 * the correct TDD RED state (Constitution Principle III). This also proves the
 * application context boots cleanly with the broker enabled.
 */
@SpringBootTest
class WebSocketConfigTest {

    @Autowired
    private SimpMessagingTemplate simpMessagingTemplate;

    /**
     * The {@link SimpMessagingTemplate} bean must exist, which proves the
     * message broker (and thus the WebSocket/STOMP config) is wired.
     */
    @Test
    void simpMessagingTemplateBean_isPresent_whenBrokerConfigured() {
        assertNotNull(simpMessagingTemplate,
                "SimpMessagingTemplate must be available — proves @EnableWebSocketMessageBroker is wired");
    }
}
