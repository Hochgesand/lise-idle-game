package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentCatalog;
import com.lise.liseidle.content.CoopConfig;
import com.lise.liseidle.content.WorldConfig;
import com.lise.liseidle.content.ContentLoader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * T076 &mdash; RED tests for the commute presence lifecycle (US3; contracts
 * &sect;3 "Client &rarr; Server"; data-model "CommuteState" / "Presence
 * lifecycle"). Pins three behaviours and one defensive guarantee:
 * <ol>
 *   <li>the <b>first</b> heartbeat reporting a commute gets
 *       {@code commute.startedAt} <b>server-stamped</b> (the server authors the
 *       transition time; a client never supplies it), with {@code office = null}
 *       and a {@code presence.update} broadcast;</li>
 *   <li>the arrival heartbeat clears {@code commute} and sets
 *       {@code office = toOffice};</li>
 *   <li><b>no</b> coop lease segment is issued to a commuting colleague (the
 *       bonus is suspended in transit, contracts &sect;3);</li>
 *   <li><b>defensive</b>: a heartbeat carrying a commute forces the record's
 *       {@code office} to {@code null} regardless of the client's {@code office}
 *       field &mdash; upholding the record invariant "office is {@code null}
 *       while commuting" (data-model PresenceRecord) so a buggy/tampered client
 *       cannot claim to be both commuting and seated (which would inflate a
 *       co-op bonus, contracts &sect;4).</li>
 * </ol>
 *
 * <p><b>Mockito unit test</b> (mirrors {@link PresenceServiceTest}): a real
 * {@link PresenceRegistry} + real {@link CoopConfig}, with
 * {@link PresenceRepository} and {@link PresencePushService} mocked so the
 * broadcast/segment side effects are asserted precisely via {@code verify}. No
 * network, no Keycloak, no STOMP plumbing &mdash; the commute stamping and the
 * bonus suspension are pure {@link PresenceService} logic.
 *
 * <p><b>RED state</b>: cases 1&ndash;3 land GREEN (Phase 5 / T072 already
 * server-stamps {@code startedAt} via {@code resolveCommute} and suspends the
 * segment when {@code office = null}); case 4 is RED against the current code,
 * which trusts the client's {@code office} field verbatim &mdash; the GREEN
 * step (T076) makes the server force {@code office = null} while a commute is
 * reported.
 */
@ExtendWith(MockitoExtension.class)
class PresenceCommuteTest {

    private static final CoopConfig COOP = new CoopConfig(0.10, 1.5, 60, 20, 30, 14);

    @Mock
    private PresenceRepository repository;

    @Mock
    private PresencePushService pushService;

    @Mock
    private ContentLoader contentLoader;

    /** Real registry so the commute stamping runs against actual state. */
    private final PresenceRegistry registry = new PresenceRegistry();

    private PresenceService service;

    @BeforeEach
    void setUp() {
        // PresenceService + CoopService both read the co-op tuning once at
        // construction (content is immutable per version).
        when(contentLoader.getCatalog()).thenReturn(
                new ContentCatalog(1, "test", List.of(), List.of(), List.of(), List.of(), List.of(), COOP,
                        new WorldConfig(2)));
        CoopService coopService = new CoopService(registry, repository, contentLoader);
        service = new PresenceService(registry, repository, pushService, contentLoader, coopService);
    }

    // ── 1. first commuting heartbeat → server-stamped startedAt + broadcast ──

    /**
     * The first heartbeat reporting a commute ({@code office = null},
     * {@code commute = {office_1, office_2}}) gets
     * {@code commute.startedAt} <b>server-stamped</b>: it is parseable, falls at
     * the heartbeat's server instant, and equals the record's
     * {@code lastSeenAt} (both authored by the same server {@code now}). The
     * record's {@code office} is {@code null} and the commute projection carries
     * the requested {@code fromOffice}/{@code toOffice}. A
     * {@code presence.update} is broadcast (the commute start is a material
     * change). A client never supplies {@code startedAt} &mdash; the
     * {@link HeartbeatPayload.CommuteRequest} carries only {@code fromOffice}/
     * {@code toOffice}, so this equality is the structural proof the server
     * authored the timestamp (contracts &sect;3).
     */
    @Test
    void firstCommuteHeartbeat_serverStampsStartedAt_nullOffice_andBroadcastsUpdate() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        // alice is already live in office_1 before the commute starts.
        registry.upsert(live("alice", "Alice", "office_1", "coding", Instant.now().plusSeconds(COOP.leaseSeconds()).toString()));

        Instant before = Instant.now();
        service.applyHeartbeat("alice", new HeartbeatPayload(
                null, "commuting", new HeartbeatPayload.CommuteRequest("office_1", "office_2")));

        PresenceRecord record = registry.get("alice").orElseThrow();
        assertThat(record.office())
                .as("office is null while commuting (data-model PresenceRecord)")
                .isNull();
        assertThat(record.commute()).as("commute projection is set").isNotNull();
        assertThat(record.commute().fromOffice()).isEqualTo("office_1");
        assertThat(record.commute().toOffice()).isEqualTo("office_2");

        // startedAt is server-stamped at the heartbeat instant: parseable, ~now,
        // and equal to lastSeenAt (the same server `now` authored both).
        Instant startedAt = Instant.parse(record.commute().startedAt());
        assertThat(startedAt).isBetween(before, Instant.now().plusSeconds(1));
        assertThat(record.commute().startedAt())
                .as("startedAt is authored by the server at the heartbeat instant (== lastSeenAt)")
                .isEqualTo(record.lastSeenAt());

        // The commute start is a material change → presence.update broadcast.
        ArgumentCaptor<PresenceRecord> broadcast = ArgumentCaptor.forClass(PresenceRecord.class);
        verify(pushService).broadcastPresenceUpdate(broadcast.capture(), anyString());
        assertThat(broadcast.getValue().colleagueId()).isEqualTo("alice");
        assertThat(broadcast.getValue().commute()).isNotNull();
        assertThat(broadcast.getValue().office()).isNull();
    }

    /**
     * A repeated commuting heartbeat (same {@code fromOffice}/{@code toOffice})
     * reuses the already-stamped {@code startedAt} rather than re-stamping it,
     * so observers render route progress against one stable transition time
     * (contracts &sect;3; the steady 20&nbsp;s commute cadence does not jitter
     * the route anchor).
     */
    @Test
    void repeatedCommuteHeartbeat_reusesStableServerStampedStartedAt() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        registry.upsert(live("alice", "Alice", "office_1", "coding", Instant.now().plusSeconds(COOP.leaseSeconds()).toString()));

        service.applyHeartbeat("alice", new HeartbeatPayload(
                null, "commuting", new HeartbeatPayload.CommuteRequest("office_1", "office_2")));
        String firstStartedAt = registry.get("alice").orElseThrow().commute().startedAt();

        // a second commuting heartbeat with the same route reuses the stamp
        service.applyHeartbeat("alice", new HeartbeatPayload(
                null, "commuting", new HeartbeatPayload.CommuteRequest("office_1", "office_2")));
        String secondStartedAt = registry.get("alice").orElseThrow().commute().startedAt();

        assertThat(secondStartedAt)
                .as("the server-stamped startedAt is stable across repeated commute heartbeats")
                .isEqualTo(firstStartedAt);
    }

    // ── 2. arrival heartbeat clears commute + sets office = toOffice ─────────

    /**
     * The arrival heartbeat ({@code office = toOffice}, {@code commute = null})
     * clears the in-progress commute projection and sets the record's
     * {@code office} to the destination, broadcasting the material change
     * (data-model "Presence lifecycle": "arrival clears {@code commute} and sets
     * {@code office = toOffice}").
     */
    @Test
    void arrivalHeartbeat_clearsCommute_andSetsOfficeToDestination() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        // alice is mid-commute (server-stamped startedAt), office null.
        registry.upsert(commuting("alice", "Alice", "office_1", "office_2"));

        service.applyHeartbeat("alice", new HeartbeatPayload("office_2", "coding", null));

        PresenceRecord record = registry.get("alice").orElseThrow();
        assertThat(record.office())
                .as("arrival sets office to the destination")
                .isEqualTo("office_2");
        assertThat(record.commute())
                .as("arrival clears the commute projection")
                .isNull();

        ArgumentCaptor<PresenceRecord> broadcast = ArgumentCaptor.forClass(PresenceRecord.class);
        verify(pushService).broadcastPresenceUpdate(broadcast.capture(), anyString());
        assertThat(broadcast.getValue().office()).isEqualTo("office_2");
        assertThat(broadcast.getValue().commute()).isNull();
    }

    // ── 3. no coop segment issued to a commuting colleague ──────────────────

    /**
     * No coop lease segment is issued to a <b>commuting</b> sender, even when
     * visible colleagues are present elsewhere: the bonus is suspended in
     * transit (contracts &sect;3 "Server effects of one heartbeat" (3); data-model
     * "co-op bonus during a commute"). Here bob is live in {@code office_1} but
     * alice is commuting ({@code office = null}), so alice receives no
     * {@code coop.segment}.
     */
    @Test
    void noCoopSegmentIssuedToCommuter_evenWithColleaguesAround() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        // alice and bob are both live in office_1; alice then starts a commute.
        registry.upsert(live("alice", "Alice", "office_1", "coding",
                Instant.now().plusSeconds(COOP.leaseSeconds()).toString()));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(COOP.leaseSeconds()).toString()));

        // alice's next heartbeat reports the commute (office = null).
        service.applyHeartbeat("alice", new HeartbeatPayload(
                null, "commuting", new HeartbeatPayload.CommuteRequest("office_1", "office_2")));

        verify(pushService, never()).sendCoopSegment(eq("alice"), any());
    }

    // ── 4. (RED) a commute forces office = null regardless of the client field ─

    /**
     * <b>RED against the current code.</b> A heartbeat carrying a commute MUST
     * result in a record whose {@code office} is {@code null} <b>regardless of
     * the client's {@code office} field</b> &mdash; upholding the record
     * invariant "office is {@code null} while commuting" (data-model
     * PresenceRecord). The current code trusts {@code payload.office()} verbatim,
     * so a buggy/tampered client reporting {@code office = "office_1"} together
     * with a commute would (a) leave the colleague "seated" while commuting and
     * (b) wrongly issue them a coop segment (the colleague is counted toward
     * office_1's crowd). The GREEN step makes the server force
     * {@code office = null} whenever a commute is reported, so the bonus stays
     * suspended in transit (contracts &sect;4: failures fail toward baseline).
     */
    @Test
    void commuteHeartbeat_forcesOfficeNull_regardlessOfClientOfficeField() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        // alice is live in office_1, bob is there too → alice WOULD get a segment
        // if the server believed she were still in office_1.
        registry.upsert(live("alice", "Alice", "office_1", "coding",
                Instant.now().plusSeconds(COOP.leaseSeconds()).toString()));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(COOP.leaseSeconds()).toString()));

        // a buggy/tampered client reports office = "office_1" WHILE commuting.
        service.applyHeartbeat("alice", new HeartbeatPayload(
                "office_1", "commuting", new HeartbeatPayload.CommuteRequest("office_1", "office_2")));

        PresenceRecord record = registry.get("alice").orElseThrow();
        assertThat(record.office())
                .as("the server forces office = null while a commute is reported, "
                        + "ignoring the client's office field (record invariant)")
                .isNull();
        assertThat(record.commute()).as("the commute projection is set").isNotNull();
        // and the bonus stays suspended in transit: no coop segment to alice.
        verify(pushService, never()).sendCoopSegment(eq("alice"), any());
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /** A durable row with a name/avatar and the given consent/visibility. */
    private static PlayerPresenceEntity row(String colleagueId, boolean consent, boolean visible) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(colleagueId.equals("alice") ? "Alice" : "Bob");
        e.setAvatar("0");
        e.setConsentGiven(consent);
        e.setVisible(visible);
        return e;
    }

    /** A LIVE, seated registry record (no commute) with the given lease expiry. */
    private static PresenceRecord live(String colleagueId, String displayName,
                                       String office, String activity, String leaseExpiresAt) {
        return new PresenceRecord(
                colleagueId, displayName, "0", office, activity, null,
                PresenceRecord.Status.LIVE, Instant.now().toString(), leaseExpiresAt);
    }

    /** A LIVE, mid-commute registry record (office null) with a fresh lease. */
    private static PresenceRecord commuting(String colleagueId, String displayName,
                                            String fromOffice, String toOffice) {
        return new PresenceRecord(
                colleagueId, displayName, "0", null, "commuting",
                new PresenceRecord.Commute(fromOffice, toOffice, Instant.now().toString()),
                PresenceRecord.Status.LIVE, Instant.now().toString(),
                Instant.now().plusSeconds(60).toString());
    }
}
