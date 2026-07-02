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
import org.springframework.http.MediaType;
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
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

/**
 * T069 &mdash; the coop segment-flow integration test (backs quickstart
 * Scenarios 3&ndash;4). Two STOMP sessions authenticate as {@code alice} and
 * {@code bob} with mock-JWT bearers; a heartbeat with another visible colleague
 * present issues/extends a {@code coop.segment} on {@code /user/queue/coop}
 * (server-authored ISO-8601 {@code from}/{@code until},
 * {@code until = serverNow + leaseSeconds}, capped multiplier; extension upserts
 * the same {@code from}); and a colleague hiding (via
 * {@code PUT /api/v1/presence/settings}) or leaving (a heartbeat reporting a new
 * office) triggers <b>proactively pushed</b> recomputed downgrade segments with
 * {@code from = serverTime} to the affected colleague (SC-006 &mdash; no wait
 * for heartbeat or lease expiry).
 *
 * <p><b>No network to Keycloak</b>: a {@link TestConfiguration} overrides the
 * {@link JwtDecoder} bean (mirroring {@code TwoSessionPresenceIT}) so both the
 * STOMP {@code StompBearerAuthInterceptor} and the REST resource server
 * validate the two mock tokens against fixed identities &mdash;
 * {@code ALICE_TOKEN} &rarr; {@code alice-sub}, {@code BOB_TOKEN} &rarr;
 * {@code bob-sub}; any other value throws {@link BadJwtException}.
 *
 * <p><b>Real STOMP</b>: a {@link WebSocketStompClient} connects to the live
 * {@code /ws} endpoint, speaks STOMP (CONNECT with bearer, SUBSCRIBE
 * {@code /user/queue/coop}, SEND {@code /app/presence.heartbeat}), and the
 * server's {@code coop.segment} messages deserialize back into a {@link Map}.
 * The hide trigger is exercised over REST (the JDK {@code HttpClient} under the
 * same mock identity); the leave trigger is a heartbeat reporting a new office.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CoopSegmentFlowIT.TestJwtDecoderConfig.class)
class CoopSegmentFlowIT {

    static final String ALICE_TOKEN = "alice-mock-access-token";
    static final String BOB_TOKEN = "bob-mock-access-token";
    static final String ALICE_SUB = "alice-sub";
    static final String BOB_SUB = "bob-sub";
    private static final String ISSUER = "https://keycloak.novitasoft.de/realms/LiseIdler";
    private static final int LEASE_SECONDS = 60;

    private static final long TIMEOUT_MS = 5_000;

    @LocalServerPort
    private int port;

    @Autowired
    private PresenceRepository presenceRepository;

    @Autowired
    private PresenceRegistry registry;

    private WebSocketStompClient stompClient;
    private final List<StompSession> sessions = new ArrayList<>();

    @BeforeEach
    void setUp() {
        // Fresh live tier + durable rows for both identities (consented +
        // visible, so each counts toward the other's bonus once heartbeating).
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
     * Scenario 4 (bonus on): a heartbeat with another visible colleague present
     * issues a {@code coop.segment} on {@code /user/queue/coop} &mdash;
     * server-authored ISO-8601 {@code from}/{@code until},
     * {@code until = from + leaseSeconds}, capped multiplier (&times;1.1 for one
     * colleague); and a second heartbeat EXTENDS the lease, upserting the SAME
     * {@code from} (contracts &sect;3; data-model.md "CoopSegment").
     */
    @Test
    void heartbeatWithColleaguePresent_issuesAndExtendsCoopSegment() throws Exception {
        StompSession alice = connect(ALICE_TOKEN);
        StompSession bob = connect(BOB_TOKEN);
        Collector aliceCoop = subscribeCoop(alice);
        subscribeCoop(bob); // bob subscribes too (keeps his session user-resolvable)

        // bob must be present (registered) before alice's heartbeat issues her segment.
        ensurePresent(bob, BOB_SUB, ALICE_TOKEN);

        // alice heartbeats (re-heartbeating until her segment arrives — subscription
        // + bob-present readiness); each heartbeat with bob present re-pushes her segment.
        Map<String, Object> first = awaitCoopViaHeartbeat(alice, aliceCoop, multiplierIs(1.1));

        assertThat(first.get("type")).isEqualTo("coop.segment");
        @SuppressWarnings("unchecked")
        Map<String, Object> seg1 = (Map<String, Object>) first.get("segment");
        String from1 = (String) seg1.get("from");
        String until1 = (String) seg1.get("until");
        Instant from1Instant = Instant.parse(from1);
        // server-authored ISO-8601 bounds, until = from + leaseSeconds (bounded lease)
        assertThat(from1).matches("^\\d{4}-\\d{2}-\\d{2}T.+Z$");
        assertThat(Duration.between(from1Instant, Instant.parse(until1)).getSeconds())
                .as("until = from + leaseSeconds (bounded lease)")
                .isEqualTo(LEASE_SECONDS);
        assertThat(((Number) seg1.get("multiplier")).doubleValue())
                .as("capped multiplier for one distinct visible colleague")
                .isCloseTo(1.1, org.assertj.core.data.Offset.offset(1e-9));

        // a second heartbeat EXTENDS the lease: same stable `from`, later `until`
        Map<String, Object> second = awaitCoopViaHeartbeat(
                alice, aliceCoop, extensionOf(from1, until1));
        @SuppressWarnings("unchecked")
        Map<String, Object> seg2 = (Map<String, Object>) second.get("segment");
        assertThat(seg2.get("from"))
                .as("extension upserts the same `from`")
                .isEqualTo(from1);
        assertThat(Instant.parse((String) seg2.get("until")))
                .as("until extends on the second heartbeat")
                .isAfter(Instant.parse(until1));
    }

    /**
     * Scenario 3 (hide me, co-op half): a colleague hiding via
     * {@code PUT /api/v1/presence/settings} triggers a <b>proactively pushed</b>
     * recomputed downgrade segment to every office-mate, with
     * {@code from = serverTime} and baseline multiplier (SC-006 &mdash; the
     * contribution stops at delta-propagation speed, not at lease expiry).
     */
    @Test
    void hidingColleague_proactivelyPushesDowngradeToOfficeMates() throws Exception {
        StompSession alice = connect(ALICE_TOKEN);
        StompSession bob = connect(BOB_TOKEN);
        Collector aliceCoop = subscribeCoop(alice);
        subscribeCoop(bob);

        // establish alice's bonus epoch (bob present) so the downgrade is observable
        ensurePresent(bob, BOB_SUB, ALICE_TOKEN);
        awaitCoopViaHeartbeat(alice, aliceCoop, multiplierIs(1.1));

        // bob hides → alice receives a recomputed downgrade with a fresh `from`
        Instant before = Instant.now();
        putSettings(BOB_TOKEN, true, false);

        Map<String, Object> downgrade = pollCoop(aliceCoop, multiplierIs(1.0), TIMEOUT_MS);
        @SuppressWarnings("unchecked")
        Map<String, Object> seg = (Map<String, Object>) downgrade.get("segment");
        assertThat(((Number) seg.get("multiplier")).doubleValue())
                .as("hiding downgrades alice to baseline")
                .isCloseTo(1.0, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(!Instant.parse((String) seg.get("from")).isBefore(before))
                .as("the downgrade `from` is the hide instant (proactive, not lease expiry)")
                .isTrue();
    }

    /**
     * A colleague leaving the office (a heartbeat reporting a new office)
     * triggers a <b>proactively pushed</b> recomputed downgrade segment to every
     * remaining office-mate, with {@code from = serverTime} and baseline
     * multiplier (SC-006).
     */
    @Test
    void leavingColleague_proactivelyPushesDowngradeToRemainingMates() throws Exception {
        StompSession alice = connect(ALICE_TOKEN);
        StompSession bob = connect(BOB_TOKEN);
        Collector aliceCoop = subscribeCoop(alice);
        subscribeCoop(bob);

        // establish alice's bonus epoch (bob present in office_1)
        ensurePresent(bob, BOB_SUB, ALICE_TOKEN);
        awaitCoopViaHeartbeat(alice, aliceCoop, multiplierIs(1.1));

        // bob leaves office_1 for office_2 → alice downgraded to baseline immediately
        Instant before = Instant.now();
        sendHeartbeat(bob, "office_2", "coding");

        Map<String, Object> downgrade = pollCoop(aliceCoop, multiplierIs(1.0), TIMEOUT_MS);
        @SuppressWarnings("unchecked")
        Map<String, Object> seg = (Map<String, Object>) downgrade.get("segment");
        assertThat(((Number) seg.get("multiplier")).doubleValue())
                .as("leaving downgrades alice to baseline")
                .isCloseTo(1.0, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(!Instant.parse((String) seg.get("from")).isBefore(before))
                .as("the downgrade `from` is the leave instant (proactive)")
                .isTrue();
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

    /** Subscribe to the per-user coop lease channel (/user/queue/coop). */
    private static Collector subscribeCoop(StompSession session) {
        Collector collector = new Collector();
        StompHeaders sub = new StompHeaders();
        sub.setDestination("/user/queue/coop");
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

    /** Heartbeat `colleague` until `viewerToken` sees them in the presence snapshot. */
    private void ensurePresent(StompSession colleague, String colleagueId, String viewerToken) throws Exception {
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            sendHeartbeat(colleague, "office_1", "coding");
            if (colleagueVisible(viewerToken, colleagueId)) {
                return;
            }
            sleep(100);
        }
        fail(colleagueId + " never appeared in the presence snapshot");
    }

    private boolean colleagueVisible(String token, String colleagueId) throws Exception {
        List<String> ids = JsonPath.read(snapshotAs(token), "$.colleagues..colleagueId");
        return ids.contains(colleagueId);
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

    /** PUT /api/v1/presence/settings under the given mock identity. */
    private void putSettings(String token, boolean consentGiven, boolean visible) throws Exception {
        String body = "{\"consentGiven\":" + consentGiven + ",\"visible\":" + visible + "}";
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create("http://localhost:" + port + "/api/v1/presence/settings"))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .timeout(java.time.Duration.ofSeconds(5))
                .PUT(java.net.http.HttpRequest.BodyPublishers.ofString(body))
                .build();
        java.net.http.HttpResponse<String> resp = java.net.http.HttpClient.newHttpClient()
                .send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
        assertThat(resp.statusCode())
                .as("PUT /api/v1/presence/settings with a mock bearer must succeed")
                .isEqualTo(200);
    }

    // ── coop.segment matching / polling ─────────────────────────────────

    /** Re-heartbeat `self` (each heartbeat re-pushes its segment) until a matching one arrives. */
    private static Map<String, Object> awaitCoopViaHeartbeat(StompSession self, Collector coop,
                                                              Predicate<Map<String, Object>> predicate) {
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            sendHeartbeat(self, "office_1", "coding");
            long inner = System.currentTimeMillis() + 400;
            while (System.currentTimeMillis() < inner) {
                Map<String, Object> found = scanCoop(coop, predicate);
                if (found != null) {
                    return found;
                }
                sleep(40);
            }
        }
        fail("no matching coop.segment within " + TIMEOUT_MS + "ms; received=" + coop.messages);
        return null;
    }

    /** Poll the collector (no heartbeat) for a matching segment — for externally-triggered pushes. */
    private static Map<String, Object> pollCoop(Collector coop, Predicate<Map<String, Object>> predicate, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            Map<String, Object> found = scanCoop(coop, predicate);
            if (found != null) {
                return found;
            }
            sleep(50);
        }
        fail("no matching coop.segment within " + timeoutMs + "ms; received=" + coop.messages);
        return null;
    }

    private static Map<String, Object> scanCoop(Collector coop, Predicate<Map<String, Object>> predicate) {
        List<Map<String, Object>> copy;
        synchronized (coop.messages) {
            copy = new ArrayList<>(coop.messages);
        }
        for (Map<String, Object> msg : copy) {
            if (isCoopSegment(msg) && predicate.test(msg)) {
                return msg;
            }
        }
        return null;
    }

    private static boolean isCoopSegment(Map<String, Object> msg) {
        return "coop.segment".equals(msg.get("type")) && msg.get("segment") instanceof Map;
    }

    @SuppressWarnings("unchecked")
    private static double multiplierOf(Map<String, Object> msg) {
        return ((Number) ((Map<String, Object>) msg.get("segment")).get("multiplier")).doubleValue();
    }

    @SuppressWarnings("unchecked")
    private static String fromOf(Map<String, Object> msg) {
        return (String) ((Map<String, Object>) msg.get("segment")).get("from");
    }

    @SuppressWarnings("unchecked")
    private static String untilOf(Map<String, Object> msg) {
        return (String) ((Map<String, Object>) msg.get("segment")).get("until");
    }

    /** Matches a coop.segment whose multiplier equals `m` (within 1e-9). */
    private static Predicate<Map<String, Object>> multiplierIs(double m) {
        return msg -> Math.abs(multiplierOf(msg) - m) < 1e-9;
    }

    /** Matches a coop.segment that extends `from` with a strictly later `until`. */
    private static Predicate<Map<String, Object>> extensionOf(String from, String until) {
        return msg -> from.equals(fromOf(msg))
                && Instant.parse(untilOf(msg)).isAfter(Instant.parse(until));
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    private static PlayerPresenceEntity row(String colleagueId, String displayName) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(displayName);
        e.setAvatar("0");
        e.setConsentGiven(true);
        e.setVisible(true);
        return e;
    }

    /** Collects every {@code /user/queue/coop} payload (deserialized to a Map). */
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
