package com.lise.liseidle.session;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * WebSocket / STOMP configuration for the push-only live channel
 * (contracts.md §3).
 *
 * <p><b>Push-only model:</b> the client advances the simulation locally and
 * saves via REST {@code PUT .../state} (the {@code SessionController}); the
 * WebSocket channel exists only so the server can push <b>authoritative state
 * corrections</b> (after a sync merge) and <b>content-update notifications</b>
 * to a connected client. No client&rarr;server gameplay messages travel over the
 * socket — keeping the model simple (Constitution Principle V).
 *
 * <h2>Endpoint &amp; routing</h2>
 * <ul>
 *   <li><b>STOMP endpoint</b> {@code /ws} ({@code ws(s)://&lt;host&gt;/ws}).</li>
 *   <li><b>User destination prefix</b> {@code /user} &mdash; the server delivers
 *       to {@code /user/queue/state}, which a connected client subscribes to as
 *       {@code /user/queue/state} (Spring resolves the user-specific queue
 *       via the session principal / user name).</li>
 *   <li><b>Application destination prefix</b> {@code /app} &mdash; standard,
 *       registered for completeness even though the channel is push-only.</li>
 * </ul>
 *
 * <h2>CORS / transport decision</h2>
 * The frontend and backend are served from different Traefik hosts
 * ({@code lise-game.schmitz.gg} vs {@code lise-game-api.schmitz.gg}), so the
 * WebSocket handshake must allow cross-origin requests. We use
 * {@link StompEndpointRegistry#addEndpoint(String...)} with
 * {@code setAllowedOriginPatterns("*")} over a <b>plain raw WebSocket STOMP</b>
 * transport (no SockJS fallback). This is the simplest self-consistent option
 * for a single-player MVP whose clients are modern desktop browsers (the
 * {@code @stomp/stompjs} client in the frontend speaks raw STOMP/WebSocket
 * natively). The T031 frontend STOMP client task is directed to use a plain
 * WebSocket (no SockJS) connection to match.
 *
 * <h2>Durability caveat</h2>
 * The in-memory simple broker ({@link MessageBrokerRegistry#enableSimpleBroker})
 * is <b>non-durable</b>: messages are not persisted and are dropped if no client
 * is connected. This is acceptable for the MVP because the client's local
 * localStorage save is authoritative for play (Constitution Principle IV —
 * offline-capable core); the push channel is a best-effort advisory, not the
 * source of truth.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    /**
     * Register the STOMP handshake endpoint at {@code /ws}.
     *
     * <p>Cross-origin is allowed because the frontend is served from a
     * different Traefik host than the backend (see class javadoc). No SockJS —
     * plain raw WebSocket STOMP, to be matched by the frontend client (T031).
     *
     * @param registry the STOMP endpoint registry
     */
    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*");
    }

    /**
     * Configure the in-memory message broker.
     *
     * <p>Enables the {@code /user} prefix (user-specific destinations like
     * {@code /user/queue/state}) and registers {@code /app} as the (unused by
     * the push-only model) application destination prefix.
     *
     * @param registry the message-broker registry
     */
    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/user");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }
}
