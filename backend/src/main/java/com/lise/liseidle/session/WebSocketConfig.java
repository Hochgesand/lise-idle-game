package com.lise.liseidle.session;

import com.lise.liseidle.security.StompBearerAuthInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.security.oauth2.jwt.JwtDecoder;
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

    private final StompBearerAuthInterceptor stompBearerAuthInterceptor;

    /**
     * @param stompBearerAuthInterceptor the CONNECT-frame bearer authenticator
     *        (T032); needs the resource-server {@link JwtDecoder} which Spring
     *        injects into the interceptor's constructor
     */
    public WebSocketConfig(StompBearerAuthInterceptor stompBearerAuthInterceptor) {
        this.stompBearerAuthInterceptor = stompBearerAuthInterceptor;
    }

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
     * Register the CONNECT-frame bearer authenticator on the client-inbound
     * channel so the session {@code Principal} (named by the JWT {@code sub})
     * is installed before any message is dispatched (T032; contracts &sect;3).
     *
     * @param registration the channel registration
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompBearerAuthInterceptor);
    }

    /**
     * Configure the in-memory message broker.
     *
     * <p>Enables the {@code /queue} and {@code /topic} simple-broker prefixes
     * (corrected in T032 from the latent 001 value {@code "/user"}) and keeps
     * {@code /user} as the <i>client-facing</i> user-destination prefix
     * (contracts &sect;3 Broker). Spring rewrites a client subscription to
     * {@code /user/queue/state} to {@code /queue/state-user{sessionId}} for the
     * connected session; the simple broker only routes destinations matching
     * its configured prefixes, so {@code /queue} is required for
     * {@code convertAndSendToUser} pushes (incl. 001's
     * {@code /user/queue/state} corrections) to be deliverable to an
     * authenticated subscriber. {@code /topic} carries the broadcast presence
     * deltas ({@code /topic/presence}, later phases). {@code /app} is the
     * (presence-heartbeat) application destination prefix.
     *
     * @param registry the message-broker registry
     */
    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/queue", "/topic");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }
}
