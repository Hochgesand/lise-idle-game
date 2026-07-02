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
 * T077 &mdash; duplicate-session collapse integration test (backs quickstart
 * Scenario 9). Two STOMP sessions authenticate under <b>one</b> mock-JWT
 * identity ({@code alice}) and a third observer session ({@code bob}) watches
 * {@code /topic/presence}. The contracts &sect;3 "Duplicate-session collapse"
 * invariants are exercised end-to-end over the real STOMP protocol:
 * <ol>
 *   <li><b>One record per identity</b> &mdash; presence is keyed by
 *       {@code colleagueId} (the JWT {@code sub}), never by WebSocket session,
 *       so every snapshot and broadcast payload carries exactly one
 *       {@code alice} record (no ghost avatar).</li>
 *   <li><b>Max-of-heartbeats</b> &mdash; closing one session keeps the
 *       colleague {@code live} while the surviving session keeps heartbeating;
 *       the lease is the latest heartbeat + {@code leaseSeconds}.</li>
 *   <li><b>Last-seen only after all sessions stop</b> &mdash; the colleague
 *       flips to {@code last_seen} only once <i>all</i> their sessions stop
 *       heartbeating past the lease (quickstart Scenario 9 form).</li>
 * </ol>
 *
 * <p><b>No network to Keycloak</b>: a {@link TestConfiguration} overrides the
 * {@link JwtDecoder} bean (mirroring {@code TwoSessionPresenceIT}) so both the
 * STOMP {@code StompBearerAuthInterceptor} and the REST resource server
 * validate the mock tokens against fixed identities &mdash; {@code ALICE_TOKEN}
 * &rarr; {@code ALICE_SUB}, {@code BOB_TOKEN} &rarr; {@code BOB_SUB}; any other
 * value throws {@link BadJwtException}. Because both alice sessions carry the
 * <i>same</i> token, both install a {@link java.security.Principal} named
 * {@code ALICE_SUB} &mdash; the same registry key &mdash; which is what makes
 * the collapse structural.
 *
 * <p><b>Real STOMP</b>: a {@link WebSocketStompClient} connects to the live
 * {@code /ws} endpoint and speaks the actual STOMP protocol. The collapse needs
 * no per-session tracking in {@link PresenceRegistry}/
 * {@link PresenceService}: the keyed registry naturally collapses any number of
 * sessions per colleague to one record (last write wins), and a colleague goes
 * last-seen only when no session refreshes the lease &mdash; verified GREEN
 * here against the existing wiring.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(DuplicateSessionIT.TestJwtDecoderConfig.class)
class DuplicateSessionIT {

    static final String ALICE_TOKEN = "alice-mock-access-token";
    static final String BOB_TOKEN = "bob-mock-access-token";
    static final String ALICE_SUB = "alice-sub";
    static final String BOB_SUB = "bob-sub";
    private static final String ISSUER = "https://keycloak.novitasoft.de/realms/LiseIdler";

    private static final long TIMEOUT_MS = 5_000;
    /** Short per-retry window for the subscription-readiness loop. */
    private static final long READINESS_POLL_MS = 400;

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
        // visible, so bob sees alice once she heartbeats).
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
     * End-to-end Scenario 9: two alice sessions + a bob observer. Both alice
     * sessions heartbeat &rarr; exactly one alice record in the snapshot;
     * closing one session keeps alice live (the other refreshes the lease);
     * only when the last session stops heartbeating past the lease does bob
     * observe the live &rarr; last-seen transition.
     */
    @Test
    void twoSessionsUnderOneIdentity_oneRecord_maxOfHeartbeats_lastSeenOnlyAfterAllStop() throws Exception {
        StompSession bob = connect(BOB_TOKEN);
        Collector bobView = subscribe(bob);
        StompSession aliceA = connect(ALICE_TOKEN);
        StompSession aliceB = connect(ALICE_TOKEN);

        // Confirm bob's subscription is live by varying activity until bob
        // receives its OWN presence.update (a /topic/presence broadcast reaches
        // the sender too).
        ensureBroadcastReachesSelf(bob, bobView, BOB_SUB);

        // ── (1) one record per identity ──────────────────────────────────
        // Both alice sessions heartbeat in the same office/activity. Because
        // presence is keyed by colleagueId, the registry holds ONE alice record;
        // the second session's heartbeat (same office/activity) is not a
        // material change, so no duplicate broadcast.
        sendHeartbeat(aliceA, "office_1", "coding");
        awaitPresenceUpdate(bobView, ALICE_SUB, "live");
        sendHeartbeat(aliceB, "office_1", "coding");

        // The REST snapshot (bob's view) shows exactly ONE alice colleague.
        assertThat(snapshotColleagueIds(BOB_TOKEN).stream()
                .filter(id -> id.equals(ALICE_SUB)).toList())
                .as("one record per identity in the snapshot (structural collapse)")
                .hasSize(1);
        // And the live tier itself holds exactly one alice record.
        assertThat(registry.snapshot().stream()
                .filter(r -> r.colleagueId().equals(ALICE_SUB)).toList())
                .as("the registry holds exactly one alice record across two sessions")
                .hasSize(1);

        // ── (2) max-of-heartbeats: closing one session keeps alice live ──
        // Disconnect session A; session B keeps heartbeating, refreshing the
        // lease. A sweep must NOT expire alice (the surviving session keeps her
        // live) — exactly one alice record, still live. B's heartbeat uses a
        // fresh activity so it re-broadcasts; awaiting that broadcast
        // synchronizes the registry upsert before the sweep/backdate below,
        // closing the in-flight-heartbeat ordering window (mirrors
        // TwoSessionPresenceIT awaiting its final heartbeat before backdating).
        disconnectTracked(aliceA);
        sendHeartbeat(aliceB, "office_1", "pairing"); // material change → re-broadcast
        awaitPresenceUpdate(bobView, ALICE_SUB, "live"); // confirms B's upsert is processed
        presenceService.sweepExpiredPresence();

        assertThat(snapshotColleagues(BOB_TOKEN).stream()
                .filter(c -> ALICE_SUB.equals(c.get("colleagueId"))).findFirst()
                .map(c -> c.get("status")).orElse(null))
                .as("closing one session keeps the colleague live (max-of-heartbeats)")
                .isEqualTo("live");
        assertThat(registry.snapshot().stream()
                .filter(r -> r.colleagueId().equals(ALICE_SUB)).toList())
                .as("still exactly one alice record after one session closes")
                .hasSize(1);

        // ── (3) last-seen only after ALL sessions stop ───────────────────
        // The last surviving session stops heartbeating; backdate the lease and
        // sweep → bob observes the live → last-seen transition.
        backdateLease(ALICE_SUB);
        presenceService.sweepExpiredPresence();
        awaitPresenceUpdate(bobView, ALICE_SUB, "last_seen");
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

    /** Disconnect a session and drop it from the teardown list (idempotent). */
    private void disconnectTracked(StompSession session) {
        sessions.remove(session);
        try {
            session.disconnect();
        } catch (RuntimeException ignored) {
            // best-effort
        }
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

    /** The {@code colleagueId} of every colleague in the snapshot (bob's view). */
    @SuppressWarnings("unchecked")
    private List<String> snapshotColleagueIds(String token) throws Exception {
        return JsonPath.read(snapshotAs(token), "$.colleagues[*].colleagueId");
    }

    /** Every colleague entry (as a Map) in the snapshot (bob's view). */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> snapshotColleagues(String token) throws Exception {
        return JsonPath.read(snapshotAs(token), "$.colleagues[*]");
    }

    /** Overwrite a colleague's registry record with a backdated expired lease. */
    private void backdateLease(String colleagueId) {
        registry.upsert(new PresenceRecord(
                colleagueId, "Alice", "0",
                "office_1", "coding", null,
                PresenceRecord.Status.LIVE,
                Instant.now().toString(),
                Instant.now().minusSeconds(10).toString()));
    }

    /**
     * Send heartbeats with varying activity until the sender receives its OWN
     * {@code presence.update}, confirming the subscription is live and a
     * broadcast can reach it.
     */
    private static void ensureBroadcastReachesSelf(StompSession session, Collector selfView, String selfId) {
        String[] activities = {"coding", "reviewing", "designing", "testing", "planning"};
        for (String activity : activities) {
            sendHeartbeat(session, "office_1", activity);
            if (receivedWithin(selfView, selfId, "live", READINESS_POLL_MS)) {
                return;
            }
        }
        fail("never received own presence.update; " + selfId + " subscription may not be live");
    }

    /** True iff a matching presence.update is already in the collector within the window. */
    private static boolean receivedWithin(Collector collector, String colleagueId, String status, long windowMs) {
        long deadline = System.currentTimeMillis() + windowMs;
        while (System.currentTimeMillis() < deadline) {
            if (containsMatching(collector, colleagueId, status)) {
                return true;
            }
            try {
                Thread.sleep(40);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
        return false;
    }

    /** Poll until a matching presence.update arrives in the collector, else fail. */
    private static void awaitPresenceUpdate(Collector collector, String colleagueId, String status) {
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (containsMatching(collector, colleagueId, status)) {
                return;
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

    private static boolean containsMatching(Collector collector, String colleagueId, String status) {
        List<Map<String, Object>> copy;
        synchronized (collector.messages) {
            copy = new ArrayList<>(collector.messages);
        }
        for (Map<String, Object> msg : copy) {
            if (matches(msg, colleagueId, status)) {
                return true;
            }
        }
        return false;
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
