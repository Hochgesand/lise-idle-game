package com.lise.liseidle.presence;

import com.jayway.jsonpath.JsonPath;
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
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/**
 * T055 &mdash; two-session presence integration test (backs quickstart Scenario
 * 1). Two STOMP sessions authenticate as {@code alice} and {@code bob} with
 * mock-JWT bearers, heartbeat, and each observes the other via the
 * {@code /topic/presence} deltas <b>and</b> the {@code GET /api/v1/presence}
 * snapshot; when one stops heartbeating past the lease, the other observes the
 * live &rarr; last-seen transition (contracts &sect;3 "Lease &amp; expiry").
 *
 * <p><b>No network to Keycloak</b>: a {@link TestConfiguration} overrides the
 * {@link JwtDecoder} bean (mirroring {@code StompAuthTest}) so both the STOMP
 * {@code StompBearerAuthInterceptor} and the REST resource server validate the
 * two mock tokens against fixed identities &mdash; {@code ALICE_TOKEN} &rarr;
 * {@code alice-sub}, {@code BOB_TOKEN} &rarr; {@code bob-sub}; any other value
 * throws {@link BadJwtException}.
 *
 * <p><b>Real STOMP</b>: a {@link WebSocketStompClient} connects to the live
 * {@code /ws} endpoint on a random port and speaks the actual STOMP protocol
 * (CONNECT with bearer, SUBSCRIBE {@code /topic/presence}, SEND
 * {@code /app/presence.heartbeat}). The client uses a
 * {@link JacksonJsonMessageConverter} so heartbeats serialize from a
 * {@link Map} and the server's {@code application/json} presence broadcasts
 * deserialize back into a {@link Map} &mdash; matching the prod
 * {@code @stompjs} JSON exchange without content-type friction. The REST
 * snapshot is exercised with the JDK {@code HttpClient} under the same mock
 * identity. The lease expiry is driven deterministically by backdating a
 * registry lease and invoking {@link PresenceService#sweepExpiredPresence()}
 * directly (the 10&nbsp;s scheduler would otherwise need &gt;60&nbsp;s).
 *
 * <p><b>RED&rarr;GREEN</b>: this IT is written after T059, so the wiring is
 * complete and it lands GREEN (per the task's note).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TwoSessionPresenceIT.TestJwtDecoderConfig.class)
class TwoSessionPresenceIT {

    static final String ALICE_TOKEN = "alice-mock-access-token";
    static final String BOB_TOKEN = "bob-mock-access-token";
    static final String ALICE_SUB = "alice-sub";
    static final String BOB_SUB = "bob-sub";
    private static final String ISSUER = "https://keycloak.novitasoft.de/realms/LiseIdler";

    private static final long TIMEOUT_MS = 5_000;
    private static final long SUBSCRIBE_SETTLE_MS = 500;

    @LocalServerPort
    private int port;

    @Autowired
    private PresenceRepository presenceRepository;

    @Autowired
    private PresenceRegistry registry;

    @Autowired
    private PresenceService presenceService;

    private WebSocketStompClient stompClient;
    private final List<StompSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        // Fresh live tier + durable rows for both identities (consented +
        // visible, so each sees the other once heartbeating).
        registry.clear();
        presenceRepository.deleteAll();
        presenceRepository.save(row(ALICE_SUB, "Alice"));
        presenceRepository.save(row(BOB_SUB, "Bob"));

        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new JacksonJsonMessageConverter());
    }

    @AfterEach
    void tearDown() {
        sessions.forEach(session -> {
            try {
                session.disconnect();
            } catch (RuntimeException ignored) {
                // best-effort
            }
        });
        sessions.clear();
        try {
            stompClient.stop();
        } catch (RuntimeException ignored) {
            // best-effort
        }
    }

    /**
     * End-to-end Scenario 1: both connect with a bearer, heartbeat, and each
     * sees the other live via the snapshot and the {@code /topic/presence}
     * delta; when bob stops heartbeating past the lease, alice observes the
     * live &rarr; last-seen transition.
     */
    @Test
    void twoSessions_eachSeeTheOtherLive_thenObserveLastSeenOnExpiry() throws Exception {
        StompSession alice = connect(ALICE_TOKEN);
        StompSession bob = connect(BOB_TOKEN);
        Collector aliceView = subscribe(alice);
        Collector bobView = subscribe(bob);
        Thread.sleep(SUBSCRIBE_SETTLE_MS); // let SUBSCRIBE frames register

        // Bob heartbeats → alice observes bob's live presence.update.
        sendHeartbeat(bob, "office_1", "coding");
        awaitPresenceUpdate(aliceView, BOB_SUB, "live");

        // Alice heartbeats → bob observes alice's live presence.update.
        sendHeartbeat(alice, "office_1", "coding");
        awaitPresenceUpdate(bobView, ALICE_SUB, "live");

        // The REST snapshot (alice's view) also shows bob.
        String snapshot = snapshotAs(ALICE_TOKEN);
        List<String> colleagueIds = JsonPath.read(snapshot, "$..colleagueId");
        assertThat(colleagueIds).contains(BOB_SUB);

        // Bob stops heartbeating past the lease → backdate + sweep → alice
        // observes the live → last-seen transition.
        backdateLease(BOB_SUB);
        presenceService.sweepExpiredPresence();
        awaitPresenceUpdate(aliceView, BOB_SUB, "last_seen");
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private StompSession connect(String token) throws Exception {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", "Bearer " + token);
        StompSession session = stompClient.connectAsync(
                        "ws://localhost:" + port + "/ws",
                        new WebSocketHttpHeaders(),
                        headers,
                        new StompSessionHandlerAdapter() {})
                .get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        sessions.add(session);
        return session;
    }

    private static Collector subscribe(StompSession session) {
        Collector collector = new Collector();
        StompHeaders sub = new StompHeaders();
        sub.setDestination("/topic/presence");
        session.subscribe(sub, collector);
        return collector;
    }

    /** Send a heartbeat body as a Map (Jackson serializes it to application/json). */
    private static void sendHeartbeat(StompSession session, String office, String activity) {
        StompHeaders h = new StompHeaders();
        h.setDestination("/app/presence.heartbeat");
        Map<String, Object> body = new HashMap<>();
        body.put("office", office);
        body.put("activity", activity);
        body.put("commute", null);
        session.send(h, body);
    }

    private String snapshotAs(String token) throws Exception {
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create("http://localhost:" + port + "/api/v1/presence"))
                .header("Authorization", "Bearer " + token)
                .timeout(java.time.Duration.ofSeconds(5))
                .GET().build();
        java.net.http.HttpResponse<String> resp = java.net.http.HttpClient.newHttpClient()
                .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
        assertThat(resp.statusCode())
                .as("GET /api/v1/presence with a mock bearer must succeed")
                .isEqualTo(200);
        return resp.body();
    }

    /** Overwrite a colleague's registry record with a backdated expired lease. */
    private void backdateLease(String colleagueId) {
        registry.upsert(new PresenceRecord(
                colleagueId, colleagueId.equals(ALICE_SUB) ? "Alice" : "Bob", "0",
                "office_1", "coding", null,
                PresenceRecord.Status.LIVE,
                Instant.now().toString(),
                Instant.now().minusSeconds(10).toString()));
    }

    /** Poll until a matching presence.update arrives in the collector, else fail. */
    private static void awaitPresenceUpdate(Collector collector, String colleagueId, String status) {
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            for (Map<String, Object> msg : collector.messages) {
                if (matches(msg, colleagueId, status)) {
                    return;
                }
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
        fail("no presence.update for " + colleagueId + "/" + status
                + " within " + TIMEOUT_MS + "ms; received=" + collector.messages);
    }

    @SuppressWarnings("unchecked")
    private static boolean matches(Map<String, Object> msg, String colleagueId, String status) {
        if (!"presence.update".equals(msg.get("type"))) {
            return false;
        }
        Object record = msg.get("record");
        if (!(record instanceof Map)) {
            return false;
        }
        Map<String, Object> r = (Map<String, Object>) record;
        return colleagueId.equals(r.get("colleagueId")) && status.equals(r.get("status"));
    }

    private static PlayerPresenceEntity row(String colleagueId, String displayName) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(displayName);
        e.setAvatar("0");
        e.setConsentGiven(true);
        e.setVisible(true);
        return e;
    }

    /** Collects every {@code /topic/presence} payload (deserialized to a Map). */
    static final class Collector implements StompFrameHandler {
        final List<Map<String, Object>> messages = Collections.synchronizedList(new ArrayList<>());

        @Override
        public Type getPayloadType(StompHeaders headers) {
            return Map.class;
        }

        @Override
        @SuppressWarnings("unchecked")
        public void handleFrame(StompHeaders headers, Object payload) {
            messages.add((Map<String, Object>) payload);
        }
    }

    /**
     * Mock {@link JwtDecoder} recognizing only {@link #ALICE_TOKEN} and
     * {@link #BOB_TOKEN}; {@code @Primary} wins over the issuer-uri auto-config
     * bean so neither the STOMP interceptor nor the REST resource server
     * touches the network.
     */
    @TestConfiguration
    static class TestJwtDecoderConfig {

        @Bean
        @Primary
        JwtDecoder testJwtDecoder() {
            return token -> {
                String sub;
                if (ALICE_TOKEN.equals(token)) {
                    sub = ALICE_SUB;
                } else if (BOB_TOKEN.equals(token)) {
                    sub = BOB_SUB;
                } else {
                    throw new BadJwtException("unrecognized mock token: " + token);
                }
                Instant now = Instant.now();
                return org.springframework.security.oauth2.jwt.Jwt.withTokenValue(token)
                        .header("alg", "none")
                        .issuer(ISSUER)
                        .subject(sub)
                        .issuedAt(now)
                        .expiresAt(now.plusSeconds(300))
                        .claim("name", sub.equals(ALICE_SUB) ? "Alice" : "Bob")
                        .claim("preferred_username", sub.equals(ALICE_SUB) ? "alice" : "bob")
                        .build();
            };
        }
    }
}
