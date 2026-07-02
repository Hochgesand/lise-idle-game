package com.lise.liseidle.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * T019b &mdash; RED tests for STOMP CONNECT bearer authentication and the
 * user-destination deliverability decision (TDD; T032 makes them GREEN).
 * Backs contracts &sect;3 ("Backend contract: WebSocket / STOMP").
 *
 * <p>These are full STOMP-over-raw-WebSocket integration tests: a real
 * {@link WebSocketStompClient} connects to the live {@code /ws} endpoint on a
 * random port and speaks the actual STOMP protocol (CONNECT/SUBSCRIBE/SEND),
 * so the assertions exercise the interceptor + broker wiring end to end.
 *
 * <p><b>No network to Keycloak</b>: the {@link JwtDecoder} bean is overridden
 * (see {@link TestJwtDecoderConfig}) so the interceptor validates a fixed set
 * of mock tokens &mdash; {@code VALID_TOKEN} decodes to a JWT whose {@code sub}
 * is {@code alice-sub}; {@code INVALID_TOKEN}/{@code EXPIRED_TOKEN} throw from
 * the decoder exactly as a malformed/expired token would. The overridden bean
 * also keeps the resource-server auto-config from touching the network.
 *
 * <h2>What the four contract bullets assert</h2>
 * <ul>
 *   <li><b>CONNECT with a bearer installs a {@code Principal} named by the
 *       {@code sub}</b> &mdash; proven by the deliverability test: the server
 *       delivers a {@code convertAndSendToUser} push on {@code /user/queue/state}
 *       to the connected, authenticated subscriber (contracts &sect;3
 *       deliverability decision &mdash; {@code convertAndSendToUser} resolves
 *       to the session only when a {@code Principal} is installed).</li>
 *   <li><b>CONNECT without a token &mdash; or with an invalid/expired one
 *       &mdash; is accepted with NO {@code Principal} (never an ERROR
 *       frame)</b> &mdash; the connect future completes (CONNECTED received,
 *       not ERROR) and the session is NOT deliverable to (no
 *       {@code Principal}). This is the 001 anonymous-reconnect guarantee
 *       (FR-002).</li>
 *   <li><b>{@code /app/presence.heartbeat} frames from a tokenless session are
 *       ignored</b> &mdash; the SEND does not produce an ERROR frame or close
 *       the socket (regression guard for the "presence heartbeats require the
 *       Principal" clause; the handler itself lands in T059).</li>
 *   <li><b>With broker prefixes {@code enableSimpleBroker("/queue", "/topic")},
 *       a {@code convertAndSendToUser} push on {@code /user/queue/state} reaches
 *       an AUTHENTICATED subscriber</b> &mdash; the corrected prefixes fix the
 *       latent 001 misconfiguration under which user-destination pushes were
 *       undeliverable (contracts &sect;3 Broker).</li>
 * </ul>
 *
 * <p><b>RED state</b>: with no {@code StompBearerAuthInterceptor} registered,
 * a bearer CONNECT installs NO {@code Principal}, and the 001
 * {@code enableSimpleBroker("/user")} value routes neither
 * {@code /user/queue/state} nor any other user destination &mdash; so the
 * deliverability assertions fail (the positive test times out). The tokenless/
 * invalid/expired "accepted, no Principal" and the heartbeat "ignored"
 * assertions are regression guards (already GREEN and must stay GREEN once the
 * interceptor lands: the interceptor MUST accept tokenless/invalid CONNECTs
 * and never emit an ERROR frame).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(StompAuthTest.TestJwtDecoderConfig.class)
class StompAuthTest {

    /** Mock access token the overridden decoder accepts; its {@code sub} is {@link #ALICE_SUB}. */
    static final String VALID_TOKEN = "alice-mock-access-token";

    /** Mock token the overridden decoder rejects as malformed (any non-recognized value). */
    static final String INVALID_TOKEN = "not-a-jwt";

    /** Mock token the overridden decoder rejects (the decoder throws for it). */
    static final String EXPIRED_TOKEN = "alice-expired-access-token";

    /** The {@code sub} claim {@link #VALID_TOKEN} carries &mdash; the Principal name. */
    static final String ALICE_SUB = "alice-sub";

    /** The {@code LiseIdler} issuer URI (baked into the mock JWT; never fetched). */
    static final String ISSUER = "https://keycloak.novitasoft.de/realms/LiseIdler";

    private static final long TIMEOUT_SECONDS = 5;
    private static final long NEGATIVE_TIMEOUT_SECONDS = 1;
    /** Settle for the (async) SUBSCRIBE frame to register on the broker. */
    private static final long SUBSCRIBE_SETTLE_MILLIS = 500;
    /** Settle for a potential async server ERROR frame / socket closure. */
    private static final long ERROR_FRAME_SETTLE_MILLIS = 500;

    @LocalServerPort
    private int port;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    private WebSocketStompClient stompClient;

    /** Tracks every opened session so {@link #tearDown()} can disconnect them. */
    private final List<StompSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new StringMessageConverter());
    }

    @AfterEach
    void tearDown() {
        sessions.forEach(session -> {
            try {
                session.disconnect();
            } catch (RuntimeException ignored) {
                // best-effort teardown between tests
            }
        });
        sessions.clear();
        // Shut down the per-test client's task scheduler so its executor
        // threads do not accumulate across the suite (a fresh WebSocketStompClient
        // is built in setUp()).
        try {
            stompClient.stop();
        } catch (RuntimeException ignored) {
            // best-effort teardown between tests
        }
    }

    /**
     * Opens a STOMP session to {@code /ws} carrying the given CONNECT headers
     * and blocks for {@link #TIMEOUT_SECONDS}. If the server replies with an
     * ERROR frame the future fails &mdash; so a clean return proves CONNECTED
     * was received (no ERROR frame).
     *
     * @param connectHeaders the STOMP CONNECT-frame native headers
     * @return the established {@link StompSession}
     * @throws Exception if the connect fails or times out
     */
    private StompSession connect(StompHeaders connectHeaders) throws Exception {
        return connect(connectHeaders, new StompSessionHandlerAdapter() {});
    }

    /**
     * Opens a STOMP session to {@code /ws} carrying the given CONNECT headers
     * and using the given handler, then blocks for {@link #TIMEOUT_SECONDS}. If
     * the server replies with an ERROR frame the future fails &mdash; so a clean
     * return proves CONNECTED was received (no ERROR frame).
     *
     * @param connectHeaders the STOMP CONNECT-frame native headers
     * @param handler        the session handler to receive callbacks
     * @return the established {@link StompSession}
     * @throws Exception if the connect fails or times out
     */
    private StompSession connect(StompHeaders connectHeaders, StompSessionHandlerAdapter handler)
            throws Exception {
        StompSession session = stompClient.connectAsync(
                        "ws://localhost:" + port + "/ws",
                        new WebSocketHttpHeaders(),
                        connectHeaders,
                        handler)
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        sessions.add(session);
        return session;
    }

    /** CONNECT headers carrying {@code Authorization: Bearer <token>}. */
    private static StompHeaders bearerConnectHeaders(String token) {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", "Bearer " + token);
        return headers;
    }

    /** CONNECT headers carrying no credentials (the anonymous case). */
    private static StompHeaders anonymousConnectHeaders() {
        return new StompHeaders();
    }

    /**
     * Subscribes the session to {@code /user/queue/state} (the client-facing
     * user destination Spring resolves to {@code /queue/state-user{sessionId}})
     * and returns a future completed with the first received payload.
     *
     * @param session the connected session
     * @return a future completed with the first message body received on the subscription
     */
    private static CompletableFuture<String> subscribeForUserQueueState(StompSession session) {
        CompletableFuture<String> received = new CompletableFuture<>();
        StompHeaders subscribe = new StompHeaders();
        subscribe.setDestination("/user/queue/state");
        session.subscribe(subscribe, new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.complete((String) payload);
            }
        });
        return received;
    }

    /**
     * Settles the (async) SUBSCRIBE frame so the broker has registered the
     * destination before the test pushes. Without this, the push races the
     * registration and is dropped on fast machines &mdash; which would let the
     * negative tests pass for the WRONG reason (a wrongly-installed Principal
     * would still see no delivery while the SUBSCRIBE is unregistered).
     */
    private static void awaitSubscribeSettled() throws InterruptedException {
        Thread.sleep(SUBSCRIBE_SETTLE_MILLIS);
    }

    /**
     * Session handler that captures transport errors and message-handling
     * exceptions so a guard can assert NONE occurred (e.g. that a tokenless
     * heartbeat did not trigger an ERROR frame / socket closure).
     */
    static final class RecordingHandler extends StompSessionHandlerAdapter {

        private volatile Throwable transportError;
        private volatile Throwable messageException;

        @Override
        public void handleTransportError(StompSession session, Throwable exception) {
            this.transportError = exception;
        }

        @Override
        public void handleException(StompSession session, StompCommand command, StompHeaders headers,
                                    byte[] payload, Throwable exception) {
            this.messageException = exception;
        }

        Throwable transportError() {
            return transportError;
        }

        Throwable messageException() {
            return messageException;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Bullet 1 + 4: CONNECT bearer installs Principal(sub); push delivered
    // ─────────────────────────────────────────────────────────────────────

    /**
     * A CONNECT carrying the mock-JWT bearer installs a session {@code Principal}
     * named by the {@code sub} claim, and a {@code convertAndSendToUser} push on
     * {@code /user/queue/state} reaches the authenticated subscriber (bullets 1
     * and 4 together: the Principal is proven by deliverability, and the
     * corrected {@code /queue} broker prefix is proven by the message arriving).
     */
    @Test
    void connectWithBearer_installsPrincipalNamedBySub_andPushDelivered() throws Exception {
        StompSession session = connect(bearerConnectHeaders(VALID_TOKEN));
        CompletableFuture<String> received = subscribeForUserQueueState(session);

        // Let the server register the SUBSCRIBE destination before the push
        // (the SUBSCRIBE frame is async; without settling, the push races the
        // registration and is dropped on fast machines).
        awaitSubscribeSettled();

        messagingTemplate.convertAndSendToUser(ALICE_SUB, "/queue/state", "HELLO-STATE");

        assertThat(received.get(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .as("convertAndSendToUser on /user/queue/state must reach the "
                        + "authenticated subscriber whose Principal name = the JWT sub")
                .isEqualTo("HELLO-STATE");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Bullet 2: tokenless / invalid / expired CONNECT accepted, no Principal
    // ─────────────────────────────────────────────────────────────────────

    /**
     * A CONNECT without a token is accepted (CONNECTED received, never an ERROR
     * frame) and installs NO {@code Principal}: a {@code convertAndSendToUser}
     * push does not reach it (001 anonymous status quo; FR-002).
     */
    @Test
    void connectWithoutToken_isAcceptedWithNoPrincipal_pushNotDelivered() throws Exception {
        StompSession session = connect(anonymousConnectHeaders());
        assertThat(session.isConnected())
                .as("tokenless CONNECT must be accepted (CONNECTED, never an ERROR frame)")
                .isTrue();

        CompletableFuture<String> received = subscribeForUserQueueState(session);
        awaitSubscribeSettled();
        messagingTemplate.convertAndSendToUser(ALICE_SUB, "/queue/state", "SHOULD-NOT-ARRIVE");

        assertThatThrownBy(() -> received.get(NEGATIVE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .isInstanceOf(TimeoutException.class);
    }

    /**
     * A CONNECT with an invalid (malformed) bearer is accepted with no
     * {@code Principal} (never an ERROR frame) and is not deliverable to.
     */
    @Test
    void connectWithInvalidToken_isAcceptedWithNoPrincipal_pushNotDelivered() throws Exception {
        StompSession session = connect(bearerConnectHeaders(INVALID_TOKEN));
        assertThat(session.isConnected())
                .as("invalid-token CONNECT must be accepted (never an ERROR frame)")
                .isTrue();

        CompletableFuture<String> received = subscribeForUserQueueState(session);
        awaitSubscribeSettled();
        messagingTemplate.convertAndSendToUser(ALICE_SUB, "/queue/state", "SHOULD-NOT-ARRIVE");

        assertThatThrownBy(() -> received.get(NEGATIVE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .isInstanceOf(TimeoutException.class);
    }

    /**
     * A CONNECT with an expired bearer is accepted with no {@code Principal}
     * (never an ERROR frame) and is not deliverable to.
     */
    @Test
    void connectWithExpiredToken_isAcceptedWithNoPrincipal_pushNotDelivered() throws Exception {
        StompSession session = connect(bearerConnectHeaders(EXPIRED_TOKEN));
        assertThat(session.isConnected())
                .as("expired-token CONNECT must be accepted (never an ERROR frame)")
                .isTrue();

        CompletableFuture<String> received = subscribeForUserQueueState(session);
        awaitSubscribeSettled();
        messagingTemplate.convertAndSendToUser(ALICE_SUB, "/queue/state", "SHOULD-NOT-ARRIVE");

        assertThatThrownBy(() -> received.get(NEGATIVE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .isInstanceOf(TimeoutException.class);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Bullet 3: heartbeat from a tokenless session is ignored
    // ─────────────────────────────────────────────────────────────────────

    /**
     * A {@code /app/presence.heartbeat} SEND from a tokenless (no-Principal)
     * session is ignored: it produces no ERROR frame and does not close the
     * socket (the presence heartbeat handler requires a {@code Principal};
     * contracts &sect;3). Regression guard &mdash; the handler itself lands in
     * T059, so at this phase "ignored" means "no error, session stays open".
     */
    @Test
    void heartbeatFromTokenlessSession_isIgnored_sessionStaysConnected() throws Exception {
        RecordingHandler handler = new RecordingHandler();
        StompSession session = connect(anonymousConnectHeaders(), handler);

        StompHeaders send = new StompHeaders();
        send.setDestination("/app/presence.heartbeat");
        session.send(send, "{\"office\":\"office_1\",\"activity\":\"coding\",\"commute\":null}");

        // The SEND is async; an ERROR frame (which would close the socket and
        // fire handleTransportError) arrives milliseconds later, so settle
        // before asserting &mdash; otherwise isConnected() would read true
        // regardless and the guard could false-green.
        Thread.sleep(ERROR_FRAME_SETTLE_MILLIS);

        assertThat(session.isConnected())
                .as("tokenless heartbeat must be ignored (no ERROR frame, session stays open)")
                .isTrue();
        assertThat(handler.transportError())
                .as("tokenless heartbeat must not trigger a transport error / ERROR frame")
                .isNull();
        assertThat(handler.messageException())
                .as("tokenless heartbeat must not trigger a server-side exception")
                .isNull();
    }

    /**
     * Replaces the resource-server {@link JwtDecoder} with one that recognizes
     * only {@link #VALID_TOKEN} and throws {@link BadJwtException} for every
     * other value &mdash; so the interceptor (T032) validates mock tokens with
     * no network to Keycloak, and both the invalid and expired paths map to the
     * same {@code decode&minus;throws} arm the real decoder uses for a malformed
     * or bad token. {@code @Primary} wins over the issuer-uri auto-config bean.
     */
    @TestConfiguration
    static class TestJwtDecoderConfig {

        @Bean
        @Primary
        JwtDecoder testJwtDecoder() {
            return token -> {
                if (VALID_TOKEN.equals(token)) {
                    Instant now = Instant.now();
                    return Jwt.withTokenValue(token)
                            .header("alg", "none")
                            .issuer(ISSUER)
                            .subject(ALICE_SUB)
                            .issuedAt(now)
                            .expiresAt(now.plusSeconds(300))
                            .claim("name", "Alice Example")
                            .claim("preferred_username", "alice")
                            .build();
                }
                // INVALID_TOKEN, EXPIRED_TOKEN, and anything else: the real
                // decoder throws BadJwtException for a malformed token and a
                // JwtValidationException for an expired one — both are
                // JwtException subclasses the interceptor treats as "no
                // Principal, accepted".
                throw new BadJwtException("unrecognized / invalid mock token: " + token);
            };
        }
    }
}
