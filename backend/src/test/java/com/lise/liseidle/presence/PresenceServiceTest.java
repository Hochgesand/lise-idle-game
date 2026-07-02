package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentCatalog;
import com.lise.liseidle.content.CoopConfig;
import com.lise.liseidle.content.ContentLoader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.security.Principal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * T054 &mdash; RED tests for {@link PresenceService} (TDD; T059 makes them
 * GREEN). Pins the lease / scheduled-sweep / visibility / tokenless-ignore
 * behaviours described in tasks.md T054 and contracts &sect;3 "Lease &amp;
 * expiry contract".
 *
 * <p><b>Mockito unit test</b> (mirrors {@code session/SessionPushServiceTest}'s
 * style): a real {@link PresenceRegistry} + a real {@link CoopConfig} record,
 * with {@link PresenceRepository} and {@link PresencePushService} mocked so the
 * broadcast/persist side effects are asserted precisely via {@code verify}.
 * {@link PresenceService} reads {@link CoopConfig} once at construction from
 * the (mocked) {@link ContentLoader}, matching how the production bean is
 * wired (content is immutable per version). No network, no Keycloak, no STOMP
 * plumbing &mdash; the lease math and the visibility filter are pure logic.
 *
 * <p><b>RED state</b>: {@link PresenceService}, {@link HeartbeatPayload}, and
 * the snapshot/settings types do not exist yet (implemented in T059), so this
 * test does not compile &mdash; the correct TDD RED state per Constitution
 * Principle III (matching {@code SessionPushServiceTest}'s RED note).
 */
@ExtendWith(MockitoExtension.class)
class PresenceServiceTest {

    private static final CoopConfig COOP = new CoopConfig(0.10, 1.5, 60, 20, 30, 14);

    @Mock
    private PresenceRepository repository;

    @Mock
    private PresencePushService pushService;

    @Mock
    private ContentLoader contentLoader;

    /** Real registry so the lease/sweep logic runs against actual state. */
    private final PresenceRegistry registry = new PresenceRegistry();

    private PresenceService service;

    @BeforeEach
    void setUp() {
        // PresenceService + CoopService both read the co-op tuning once at
        // construction (content is immutable per version), so the catalog stub
        // is consumed by both here.
        when(contentLoader.getCatalog()).thenReturn(
                new ContentCatalog(1, "test", List.of(), List.of(), List.of(), List.of(), List.of(), COOP));
        CoopService coopService = new CoopService(registry, repository, contentLoader);
        service = new PresenceService(registry, repository, pushService, contentLoader, coopService);
    }

    // ── 1. accepted heartbeat marks the sender live + sets the lease ───────

    /**
     * An accepted heartbeat marks the sender {@code LIVE} and sets
     * {@code leaseExpiresAt = serverNow + coop.leaseSeconds}, with
     * {@code lastSeenAt = serverNow} (contracts &sect;3; data-model
     * "PresenceRecord"). The lease extension is exactly one lease beyond the
     * stamped last-seen, and both are stamped at the server clock on receipt.
     */
    @Test
    void acceptedHeartbeat_marksSenderLive_andExtendsLeaseByExactlyLeaseSeconds() {
        PlayerPresenceEntity alice = row("alice", true, true);
        when(repository.findById("alice")).thenReturn(Optional.of(alice));

        Instant before = Instant.now();
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));

        PresenceRecord record = registry.get("alice").orElseThrow();
        assertThat(record.status()).isEqualTo(PresenceRecord.Status.LIVE);
        assertThat(record.office()).isEqualTo("office_1");
        assertThat(record.activity()).isEqualTo("coding");

        Instant lastSeenAt = Instant.parse(record.lastSeenAt());
        Instant leaseExpiresAt = Instant.parse(record.leaseExpiresAt());
        // The lease is exactly one lease beyond the stamped last-seen.
        assertThat(Duration.between(lastSeenAt, leaseExpiresAt).getSeconds())
                .as("leaseExpiresAt must be lastSeenAt + leaseSeconds")
                .isEqualTo(COOP.leaseSeconds());
        // Both are stamped at the server clock on receipt (within a tolerance).
        assertThat(lastSeenAt).isBetween(before, Instant.now().plusSeconds(1));
    }

    // ── 2. scheduled sweep expires live → last-seen, persists, broadcasts ──

    /**
     * The {@code @Scheduled} sweep expires a {@code LIVE} record whose lease
     * is in the past to {@code LAST_SEEN}: it stamps {@code lastSeenAt} to
     * {@code serverNow}, persists office/activity/lastSeenAt to the
     * {@code player_presence} row, and broadcasts the delta
     * (contracts &sect;3 "Lease &amp; expiry contract"; data-model
     * "Presence lifecycle").
     */
    @Test
    void scheduledSweep_expiresLiveToLastSeen_persistsLastSeenAt_andBroadcastsDelta() {
        // A LIVE alice whose lease is already in the past.
        Instant expiredLease = Instant.now().minusSeconds(10);
        registry.upsert(live("alice", "Alice", "office_1", "coding", expiredLease.toString()));
        PlayerPresenceEntity alice = row("alice", true, true);
        when(repository.findById("alice")).thenReturn(Optional.of(alice));

        Instant before = Instant.now();
        service.sweepExpiredPresence();

        PresenceRecord record = registry.get("alice").orElseThrow();
        assertThat(record.status())
                .as("expired live record flips to LAST_SEEN")
                .isEqualTo(PresenceRecord.Status.LAST_SEEN);
        assertThat(Instant.parse(record.lastSeenAt()))
                .as("lastSeenAt is stamped to the sweep's serverNow")
                .isBetween(before, Instant.now().plusSeconds(1));

        // Persisted to the durable row: office/activity carried, lastSeenAt stamped.
        ArgumentCaptor<PlayerPresenceEntity> saved = ArgumentCaptor.forClass(PlayerPresenceEntity.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getLastSeenAt())
                .as("durable row lastSeenAt is stamped on expiry")
                .isEqualTo(record.lastSeenAt());
        assertThat(saved.getValue().getOffice()).isEqualTo("office_1");
        assertThat(saved.getValue().getActivity()).isEqualTo("coding");

        // The live → last-seen delta is broadcast to visible colleagues.
        ArgumentCaptor<PresenceRecord> broadcast = ArgumentCaptor.forClass(PresenceRecord.class);
        verify(pushService).broadcastPresenceUpdate(broadcast.capture(), anyString());
        assertThat(broadcast.getValue().status()).isEqualTo(PresenceRecord.Status.LAST_SEEN);
        assertThat(broadcast.getValue().colleagueId()).isEqualTo("alice");
    }

    /**
     * A record already {@code LAST_SEEN} (or a not-yet-expired {@code LIVE}
     * record) is left untouched by the sweep &mdash; only expired live records
     * flip; the last-seen retention delete is a separate Phase 7 concern.
     */
    @Test
    void scheduledSweep_leavesUnexpiredLiveRecordAlone() {
        Instant freshLease = Instant.now().plusSeconds(COOP.leaseSeconds());
        registry.upsert(live("alice", "Alice", "office_1", "coding", freshLease.toString()));

        service.sweepExpiredPresence();

        PresenceRecord record = registry.get("alice").orElseThrow();
        assertThat(record.status()).isEqualTo(PresenceRecord.Status.LIVE);
        verify(repository, never()).save(any());
        verify(pushService, never()).broadcastPresenceUpdate(any(), anyString());
    }

    // ── 3. hidden players contribute to no snapshot or broadcast ──────────

    /**
     * A hidden ({@code visible=false}) live colleague is filtered out of the
     * snapshot's {@code colleagues} (FR-009) even though they have a live
     * registry record, while a visible+consented colleague appears.
     * {@code self} is always echoed regardless.
     */
    @Test
    void hiddenPlayers_areFilteredFromSnapshot_butVisibleColleaguesAppear() {
        // viewer: visible, no live record → self echoed from the durable row.
        when(repository.findById("viewer")).thenReturn(Optional.of(row("viewer", true, true)));
        // visible colleague: live + viewable → appears.
        registry.upsert(live("visible-c", "Visible", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));
        when(repository.findById("visible-c")).thenReturn(Optional.of(row("visible-c", true, true)));
        // hidden colleague: live but hidden → filtered.
        registry.upsert(live("hidden-c", "Hidden", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));
        when(repository.findById("hidden-c")).thenReturn(Optional.of(row("hidden-c", true, false)));

        PresenceSnapshot snapshot = service.buildSnapshot("viewer");

        assertThat(snapshot.colleagues()).hasSize(1);
        assertThat(snapshot.colleagues().get(0).colleagueId()).isEqualTo("visible-c");
        assertThat(snapshot.self()).as("self is always echoed").isNotNull();
    }

    /**
     * A heartbeat from a hidden colleague updates their own record (so their
     * own {@code self} reflects live status) but is NOT broadcast to others
     * (FR-009 &mdash; hidden players contribute to no broadcast). A visible
     * colleague's first heartbeat IS broadcast.
     */
    @Test
    void hiddenPlayers_heartbeatNotBroadcast_butVisibleColleagueHeartbeatIs() {
        when(repository.findById("hidden-c")).thenReturn(Optional.of(row("hidden-c", true, false)));
        when(repository.findById("visible-c")).thenReturn(Optional.of(row("visible-c", true, true)));

        service.applyHeartbeat("hidden-c", new HeartbeatPayload("office_1", "coding", null));
        service.applyHeartbeat("visible-c", new HeartbeatPayload("office_1", "coding", null));

        // The hidden colleague's record exists (for their own self) ...
        assertThat(registry.get("hidden-c")).isPresent();
        // ... but no broadcast for them; exactly one broadcast for the visible colleague.
        ArgumentCaptor<PresenceRecord> broadcast = ArgumentCaptor.forClass(PresenceRecord.class);
        verify(pushService).broadcastPresenceUpdate(broadcast.capture(), anyString());
        assertThat(broadcast.getValue().colleagueId()).isEqualTo("visible-c");
    }

    /**
     * A heartbeat whose office/activity/commute are unchanged from the prior
     * record does NOT broadcast again &mdash; only material changes broadcast
     * (contracts &sect;3 "Server effects of one heartbeat" (2)), so a steady
     * 20 s heartbeat cadence does not spam {@code /topic/presence}.
     */
    @Test
    void unchangedHeartbeat_doesNotRebroadcast() {
        when(repository.findById("visible-c")).thenReturn(Optional.of(row("visible-c", true, true)));

        service.applyHeartbeat("visible-c", new HeartbeatPayload("office_1", "coding", null));
        service.applyHeartbeat("visible-c", new HeartbeatPayload("office_1", "coding", null));

        verify(pushService).broadcastPresenceUpdate(any(PresenceRecord.class), anyString());
    }

    // ── 4. heartbeats from tokenless sessions are ignored ─────────────────

    /**
     * A {@code /app/presence.heartbeat} from a tokenless (no-{@link Principal})
     * session is ignored: the registry is not mutated and nothing is broadcast
     * (contracts &sect;3 &mdash; presence heartbeats require the Principal).
     */
    @Test
    void heartbeatsFromTokenlessSessions_areIgnored() {
        service.onHeartbeat(new HeartbeatPayload("office_1", "coding", null), null);

        assertThat(registry.snapshot()).isEmpty();
        verify(pushService, never()).broadcastPresenceUpdate(any(), anyString());
    }

    // ── 5. co-op segment issuance (T072) ────────────────────────────────

    /**
     * A heartbeat with another distinct visible colleague present issues a
     * server-authored {@code coop.segment} to the sender on
     * {@code /user/queue/coop}: capped multiplier (1.1 for one colleague),
     * {@code from = serverNow}, {@code until = serverNow + leaseSeconds}
     * (contracts &sect;3 {@code coop.segment}; FR-010).
     */
    @Test
    void heartbeatWithColleaguePresent_issuesCappedCoopSegmentToSender() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));

        Instant before = Instant.now();
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));

        ArgumentCaptor<CoopSegmentMessage.Segment> segment =
                ArgumentCaptor.forClass(CoopSegmentMessage.Segment.class);
        verify(pushService).sendCoopSegment(eq("alice"), segment.capture());
        CoopSegmentMessage.Segment seg = segment.getValue();
        assertThat(seg.multiplier()).isEqualTo(1.1, within(1e-9));
        assertThat(Instant.parse(seg.from())).isBetween(before, Instant.now());
        assertThat(Duration.between(before, Instant.parse(seg.until())).getSeconds())
                .as("until = serverNow + leaseSeconds")
                .isBetween((long) COOP.leaseSeconds(), (long) COOP.leaseSeconds() + 2);
    }

    /**
     * No coop segment is issued to a sender who is alone or commuting: the
     * bonus is suspended in transit and absent when no colleague shares the
     * office (contracts &sect;3 "Server effects of one heartbeat" (3)).
     */
    @Test
    void heartbeatAloneOrCommuting_issuesNoCoopSegmentToSender() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        // alone in office_1 (no other colleague)
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));
        // then commuting (office = null)
        service.applyHeartbeat("alice", new HeartbeatPayload(null, "commuting",
                new HeartbeatPayload.CommuteRequest("office_1", "office_2")));

        verify(pushService, never()).sendCoopSegment(eq("alice"), any());
    }

    /**
     * The segment {@code from} is stable across heartbeat extensions: a second
     * heartbeat with the same crowd reuses the first {@code from} and only
     * extends {@code until} (contracts &sect;3; data-model.md "CoopSegment").
     */
    @Test
    void heartbeatExtension_reusesStableFromAndExtendsUntil() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));

        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));

        ArgumentCaptor<CoopSegmentMessage.Segment> aliceSegments =
                ArgumentCaptor.forClass(CoopSegmentMessage.Segment.class);
        verify(pushService, times(2)).sendCoopSegment(eq("alice"), aliceSegments.capture());
        List<CoopSegmentMessage.Segment> segs = aliceSegments.getAllValues();
        assertThat(segs).hasSize(2);
        assertThat(segs.get(1).from())
                .as("extension reuses the same `from`")
                .isEqualTo(segs.get(0).from());
        assertThat(Instant.parse(segs.get(1).until()))
                .as("until extends on the second heartbeat")
                .isAfter(Instant.parse(segs.get(0).until()));
        assertThat(segs.get(1).multiplier()).isEqualTo(segs.get(0).multiplier());
    }

    // ── 6. proactive downgrade (SC-006) ─────────────────────────────────

    /**
     * A colleague leaving the office (their heartbeat reports a new office)
     * triggers a <b>proactively pushed</b> recomputed downgrade segment to every
     * remaining office-mate, with {@code from = serverTime} (SC-006 &mdash; the
     * contribution stops at delta-propagation speed, not at lease expiry).
     */
    @Test
    void colleagueLeavingOffice_proactivelyPushesDowngradeToRemainingMates() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        registry.upsert(live("alice", "Alice", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));

        // alice heartbeats first → establishes her bonus epoch (bob present, ×1.1)
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));

        // bob leaves office_1 for office_2
        Instant before = Instant.now();
        service.applyHeartbeat("bob", new HeartbeatPayload("office_2", "coding", null));

        // alice receives a recomputed downgrade with a fresh `from` and baseline multiplier
        ArgumentCaptor<CoopSegmentMessage.Segment> aliceSegments =
                ArgumentCaptor.forClass(CoopSegmentMessage.Segment.class);
        verify(pushService, atLeastOnce()).sendCoopSegment(eq("alice"), aliceSegments.capture());
        List<CoopSegmentMessage.Segment> downgrades = aliceSegments.getAllValues().stream()
                .filter(s -> Math.abs(s.multiplier() - 1.0) < 1e-9)
                .toList();
        assertThat(downgrades)
                .as("alice is downgraded to baseline when bob leaves")
                .isNotEmpty();
        assertThat(downgrades).allSatisfy(s ->
                assertThat(!Instant.parse(s.from()).isBefore(before))
                        .as("the baseline downgrade is stamped at the leave instant or later")
                        .isTrue());
    }

    /**
     * A colleague hiding (or revoking consent) triggers a
     * {@code presence.remove} broadcast <b>and</b> a proactively pushed
     * recomputed downgrade segment to every office-mate (SC-006) &mdash; the
     * hider stops contributing to others' bonus immediately.
     */
    @Test
    void hide_proactivelyPushesDowngradeToOfficeMates() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        registry.upsert(live("alice", "Alice", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));

        // alice heartbeats first → establishes her bonus epoch (bob present, ×1.1)
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));

        // bob hides
        service.applySettings("bob", true, false);

        // presence.remove is broadcast so observers drop the avatar (SC-006) …
        verify(pushService).broadcastPresenceRemove("bob");
        // … and a proactive downgrade is pushed to alice (baseline multiplier)
        ArgumentCaptor<CoopSegmentMessage.Segment> aliceSegments =
                ArgumentCaptor.forClass(CoopSegmentMessage.Segment.class);
        verify(pushService, atLeastOnce()).sendCoopSegment(eq("alice"), aliceSegments.capture());
        assertThat(aliceSegments.getAllValues())
                .as("alice is downgraded to baseline when bob hides")
                .anyMatch(s -> Math.abs(s.multiplier() - 1.0) < 1e-9);
    }

    /**
     * A colleague joining an office a mate already occupies triggers a
     * proactively pushed recomputed <i>upgrade</i> segment to that mate
     * (SC-006 &mdash; the higher multiplier is delivered at delta-propagation
     * speed, not deferred to the mate's next heartbeat).
     */
    @Test
    void colleagueJoining_proactivelyPushesUpgradeToOfficeMates() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        registry.upsert(live("alice", "Alice", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));

        // alice heartbeats alone first → no bonus (n = 0), epoch cleared
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));

        // bob joins office_1
        Instant before = Instant.now();
        service.applyHeartbeat("bob", new HeartbeatPayload("office_1", "coding", null));

        ArgumentCaptor<CoopSegmentMessage.Segment> aliceSegments =
                ArgumentCaptor.forClass(CoopSegmentMessage.Segment.class);
        verify(pushService, atLeastOnce()).sendCoopSegment(eq("alice"), aliceSegments.capture());
        List<CoopSegmentMessage.Segment> upgrades = aliceSegments.getAllValues().stream()
                .filter(s -> Math.abs(s.multiplier() - 1.1) < 1e-9)
                .toList();
        assertThat(upgrades).as("alice is upgraded when bob joins").isNotEmpty();
        assertThat(upgrades).allSatisfy(s ->
                assertThat(!Instant.parse(s.from()).isBefore(before))
                        .as("the upgrade is stamped at the join instant or later")
                        .isTrue());
    }

    /**
     * A colleague showing (becoming visible again after hiding) triggers a
     * {@code presence.update} broadcast <b>and</b> a proactively pushed
     * recomputed <i>upgrade</i> segment to office-mates (SC-006) &mdash; the
     * shower starts contributing to others' bonus immediately again.
     */
    @Test
    void show_proactivelyPushesUpgradeToOfficeMates() {
        when(repository.findById("alice")).thenReturn(Optional.of(row("alice", true, true)));
        when(repository.findById("bob")).thenReturn(Optional.of(row("bob", true, true)));
        registry.upsert(live("alice", "Alice", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));
        registry.upsert(live("bob", "Bob", "office_1", "coding",
                Instant.now().plusSeconds(60).toString()));

        // alice heartbeats first → establishes her bonus epoch (bob present, ×1.1)
        service.applyHeartbeat("alice", new HeartbeatPayload("office_1", "coding", null));
        // bob hides → alice downgraded to baseline
        service.applySettings("bob", true, false);

        // bob shows again → alice upgraded back to ×1.1
        Instant before = Instant.now();
        service.applySettings("bob", true, true);

        ArgumentCaptor<CoopSegmentMessage.Segment> aliceSegments =
                ArgumentCaptor.forClass(CoopSegmentMessage.Segment.class);
        verify(pushService, atLeastOnce()).sendCoopSegment(eq("alice"), aliceSegments.capture());
        List<CoopSegmentMessage.Segment> upgrades = aliceSegments.getAllValues().stream()
                .filter(s -> Math.abs(s.multiplier() - 1.1) < 1e-9
                        && !Instant.parse(s.from()).isBefore(before))
                .toList();
        assertThat(upgrades).as("alice is upgraded back when bob shows").isNotEmpty();
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /** A durable row with a name/avatar and the given consent/visibility. */
    private static PlayerPresenceEntity row(String colleagueId, boolean consent, boolean visible) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(colleagueId.equals("viewer") ? "Viewer" : colleagueId + "-name");
        e.setAvatar("0");
        e.setConsentGiven(consent);
        e.setVisible(visible);
        return e;
    }

    /** A LIVE registry record with a backdated/fresh lease. */
    private static PresenceRecord live(String colleagueId, String displayName,
                                       String office, String activity, String leaseExpiresAt) {
        return new PresenceRecord(
                colleagueId, displayName, "0", office, activity, null,
                PresenceRecord.Status.LIVE, Instant.now().toString(), leaseExpiresAt);
    }
}
