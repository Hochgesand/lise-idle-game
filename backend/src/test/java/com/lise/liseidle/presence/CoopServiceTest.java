package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentCatalog;
import com.lise.liseidle.content.CoopConfig;
import com.lise.liseidle.content.ContentLoader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.Mockito.when;

/**
 * T068 &mdash; RED tests for {@link CoopService} (TDD; T071 makes them GREEN).
 * Pins the distinct-visible-colleague multiplier derivation and its cap
 * (FR-010/011/014), the self/hidden/un-consented/other-office exclusions, the
 * commute suspension, the duplicate-session collapse, and the server-authored
 * lease-segment shape (contracts &sect;3; data-model.md "CoopConfig").
 *
 * <p><b>Mockito unit test</b> (mirrors {@code PresenceServiceTest}'s style): a
 * real {@link PresenceRegistry} + a real {@link CoopConfig} record, with
 * {@link PresenceRepository} mocked so the visibility (consent/visible) filter
 * is asserted precisely. {@link CoopService} reads {@link CoopConfig} once at
 * construction from the (mocked) {@link ContentLoader}. No network, no STOMP.
 *
 * <p><b>RED state</b>: {@link CoopService} does not exist yet (implemented in
 * T071), so this test does not compile &mdash; the correct TDD RED state per
 * Constitution Principle III.
 */
@ExtendWith(MockitoExtension.class)
class CoopServiceTest {

    private static final CoopConfig COOP = new CoopConfig(0.10, 1.5, 60, 20, 30, 14);

    @Mock
    private PresenceRepository repository;

    @Mock
    private ContentLoader contentLoader;

    /** Real registry so the distinct-count + office-filter logic runs against actual state. */
    private final PresenceRegistry registry = new PresenceRegistry();

    private CoopService coopService;

    @BeforeEach
    void setUp() {
        when(contentLoader.getCatalog()).thenReturn(
                new ContentCatalog(1, "test", List.of(), List.of(), List.of(), List.of(), List.of(), COOP));
        coopService = new CoopService(registry, repository, contentLoader);
    }

    // ── 1. multiplier = min(1 + n × perColleagueMultiplier, maxMultiplier) ──

    /**
     * Zero distinct visible colleagues &rarr; baseline multiplier 1.0
     * (FR-014 baseline). The formula floor is 1, never below.
     */
    @Test
    void multiplier_zeroColleagues_isBaselineOne() {
        assertThat(coopService.multiplier(0)).isEqualTo(1.0);
    }

    /**
     * Each distinct visible colleague adds exactly {@code perColleagueMultiplier}
     * (FR-010): 1 &rarr; 1.1, 2 &rarr; 1.2, 3 &rarr; 1.3, 4 &rarr; 1.4.
     */
    @Test
    void multiplier_scalesByPerColleagueMultiplier() {
        assertThat(coopService.multiplier(1)).isEqualTo(1.1, within(1e-9));
        assertThat(coopService.multiplier(2)).isEqualTo(1.2, within(1e-9));
        assertThat(coopService.multiplier(3)).isEqualTo(1.3, within(1e-9));
        assertThat(coopService.multiplier(4)).isEqualTo(1.4, within(1e-9));
    }

    /**
     * The cap holds for any crowd size (FR-011): 5 colleagues would compute
     * 1.5 (exactly the cap), and a design-load crowd (e.g. 30) still clamps at
     * {@code maxMultiplier} &mdash; never above.
     */
    @Test
    void multiplier_capsAtMaxForAnyCrowdSize() {
        assertThat(coopService.multiplier(5)).isEqualTo(1.5, within(1e-9));
        assertThat(coopService.multiplier(20)).isEqualTo(1.5, within(1e-9));
        assertThat(coopService.multiplier(1_000)).isEqualTo(1.5, within(1e-9));
    }

    // ── 2. n counts DISTINCT, VISIBLE colleagueIds in the sender's office ──

    /**
     * The sender is excluded from their own count (self excluded): alice in
     * office_1 with two other visible colleagues &rarr; n = 2 (not 3).
     */
    @Test
    void countVisibleColleagues_selfExcluded() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        when(repository.findById("carol")).thenReturn(Optional.of(viewable("carol")));
        registry.upsert(live("alice", "office_1"));
        registry.upsert(live("bob", "office_1"));
        registry.upsert(live("carol", "office_1"));

        assertThat(coopService.countVisibleColleagues("alice", "office_1")).isEqualTo(2);
    }

    /**
     * Colleagues in a different office do not contribute (FR-014 &mdash; the
     * bonus is per active office): only office_1 colleagues count for an
     * office_1 sender.
     */
    @Test
    void countVisibleColleagues_otherOfficeExcluded() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        registry.upsert(live("bob", "office_1"));
        registry.upsert(live("carol", "office_2")); // different office

        assertThat(coopService.countVisibleColleagues("alice", "office_1")).isEqualTo(1);
    }

    /**
     * Hidden and un-consented colleagues are excluded (FR-009): they contribute
     * to no one's bonus. Only the visible + consented colleague counts.
     */
    @Test
    void countVisibleColleagues_hiddenAndUnconsentedExcluded() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        when(repository.findById("hidden")).thenReturn(Optional.of(row("hidden", true, false)));
        when(repository.findById("unconsented")).thenReturn(Optional.of(row("unconsented", false, true)));
        registry.upsert(live("bob", "office_1"));
        registry.upsert(live("hidden", "office_1"));
        registry.upsert(live("unconsented", "office_1"));

        assertThat(coopService.countVisibleColleagues("alice", "office_1")).isEqualTo(1);
    }

    /**
     * The count is over <i>distinct colleagueIds</i>, never sessions: presence is
     * keyed by {@code colleagueId} (the registry collapses any number of sessions
     * to one record), so {@link CoopService}'s headcount matches the colleague
     * set &mdash; a second tab or device for either colleague refreshes the same
     * record and cannot double-count toward anyone's bonus (contracts &sect;3
     * "Duplicate-session collapse").
     */
    @Test
    void countVisibleColleagues_countsDistinctColleagueIds() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        when(repository.findById("carol")).thenReturn(Optional.of(viewable("carol")));
        registry.upsert(live("bob", "office_1"));
        registry.upsert(live("carol", "office_1"));

        // Two distinct visible colleagues (bob, carol) -> n = 2 for alice.
        assertThat(coopService.countVisibleColleagues("alice", "office_1")).isEqualTo(2);
    }

    /**
     * {@code null} office (the sender is commuting) yields zero visible
     * colleagues &mdash; the dev is present in no office while commuting
     * (data-model CommuteState invariant). The count short-circuits on the
     * null office before consulting the registry/repository.
     */
    @Test
    void countVisibleColleagues_nullOffice_isZero() {
        registry.upsert(live("bob", "office_1"));

        assertThat(coopService.countVisibleColleagues("alice", null)).isZero();
    }

    // ── 3. NO segment while the sender is commuting (spec edge case) ───────

    /**
     * No coop segment is issued while the sender is commuting
     * ({@code office = null}) &mdash; the bonus is suspended in transit
     * (contracts &sect;3 "Server effects of one heartbeat" (3); spec edge case
     * "co-op bonus during a commute"). Even with a colleague present in
     * office_1, a commuting sender receives no segment.
     */
    @Test
    void heartbeatSegment_noSegmentWhileCommuting() {
        registry.upsert(live("bob", "office_1"));

        assertThat(coopService.heartbeatSegment("alice", null, Instant.now())).isEmpty();
    }

    /**
     * A sender with no other visible colleague in their office receives no
     * segment (contracts &sect;3 &mdash; a segment is issued only when &ge; 1
     * other distinct visible colleague shares the office).
     */
    @Test
    void heartbeatSegment_noSegmentWhenAlone() {
        registry.upsert(live("alice", "office_1")); // only self

        assertThat(coopService.heartbeatSegment("alice", "office_1", Instant.now())).isEmpty();
    }

    // ── 4. segment shape: server-authored, capped, until = now + lease ─────

    /**
     * A heartbeat with another visible colleague present issues a server-authored
     * lease segment: {@code from} is the server instant, {@code until} =
     * {@code from + leaseSeconds}, {@code multiplier} is the capped value
     * (contracts &sect;3 {@code coop.segment}).
     */
    @Test
    void heartbeatSegment_withColleague_issuesCappedServerAuthoredSegment() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        registry.upsert(live("bob", "office_1"));

        Instant now = Instant.parse("2026-07-01T09:00:00Z");
        Optional<CoopSegmentMessage.Segment> segment = coopService.heartbeatSegment("alice", "office_1", now);

        assertThat(segment).isPresent();
        CoopSegmentMessage.Segment seg = segment.orElseThrow();
        assertThat(seg.from()).isEqualTo("2026-07-01T09:00:00Z");
        assertThat(Instant.parse(seg.until()))
                .as("until = from + leaseSeconds")
                .isEqualTo(now.plusSeconds(COOP.leaseSeconds()));
        assertThat(seg.multiplier()).isEqualTo(1.1, within(1e-9));
    }

    /**
     * The cap is enforced at segment issuance: a crowd of 30 still yields a
     * segment multiplier of exactly {@code maxMultiplier} (FR-011, defense in
     * depth &mdash; the client clamps again, but the server never over-issues).
     */
    @Test
    void heartbeatSegment_withCrowd_issuesCappedMultiplier() {
        for (int i = 0; i < 30; i++) {
            String id = "c" + i;
            when(repository.findById(id)).thenReturn(Optional.of(viewable(id)));
            registry.upsert(live(id, "office_1"));
        }
        Optional<CoopSegmentMessage.Segment> segment = coopService.heartbeatSegment("alice", "office_1", Instant.now());

        assertThat(segment).isPresent();
        assertThat(segment.orElseThrow().multiplier()).isEqualTo(1.5, within(1e-9));
    }

    // ── 5. stable `from` on extension, new `from` on multiplier change ────

    /**
     * The segment {@code from} is stable across lease extensions: repeated
     * heartbeats with the same crowd push the same {@code from} and only extend
     * {@code until} &mdash; the client's {@code applyCoopPresence} upserts by
     * {@code from} so a steady 20 s cadence does not proliferate segments
     * (contracts &sect;3; data-model.md "CoopSegment").
     */
    @Test
    void heartbeatSegment_stableFromOnExtension() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        registry.upsert(live("bob", "office_1"));

        Instant first = Instant.parse("2026-07-01T09:00:00Z");
        Instant later = first.plusSeconds(20);

        CoopSegmentMessage.Segment s1 = coopService.heartbeatSegment("alice", "office_1", first).orElseThrow();
        CoopSegmentMessage.Segment s2 = coopService.heartbeatSegment("alice", "office_1", later).orElseThrow();

        assertThat(s2.from())
                .as("extension reuses the same `from`")
                .isEqualTo(s1.from());
        assertThat(Instant.parse(s2.until()))
                .as("until extends to the later heartbeat + leaseSeconds")
                .isEqualTo(later.plusSeconds(COOP.leaseSeconds()));
        assertThat(s2.multiplier()).isEqualTo(s1.multiplier());
        // and the lease did extend (later until > earlier until)
        assertThat(Duration.between(Instant.parse(s1.until()), Instant.parse(s2.until())).getSeconds())
                .isEqualTo(20);
    }

    /**
     * A multiplier change starts a new epoch ({@code from = serverNow}): when a
     * second colleague joins, the recomputed higher multiplier carries a fresh
     * {@code from} so the client's latest-{@code from}-wins overlap rule makes
     * it effective from that instant (contracts &sect;1 Overlap rule; &sect;3
     * "Multiplier changes").
     */
    @Test
    void heartbeatSegment_newFromOnMultiplierChange() {
        when(repository.findById("bob")).thenReturn(Optional.of(viewable("bob")));
        when(repository.findById("carol")).thenReturn(Optional.of(viewable("carol")));
        registry.upsert(live("bob", "office_1"));

        Instant t1 = Instant.parse("2026-07-01T09:00:00Z");
        CoopSegmentMessage.Segment oneColleague = coopService.heartbeatSegment("alice", "office_1", t1).orElseThrow();
        assertThat(oneColleague.multiplier()).isEqualTo(1.1, within(1e-9));

        // carol joins → multiplier rises to 1.2 with a fresh `from`.
        registry.upsert(live("carol", "office_1"));
        Instant t2 = t1.plusSeconds(20);
        CoopSegmentMessage.Segment twoColleagues = coopService.heartbeatSegment("alice", "office_1", t2).orElseThrow();
        assertThat(twoColleagues.multiplier()).isEqualTo(1.2, within(1e-9));
        assertThat(twoColleagues.from())
                .as("a multiplier change starts a new epoch (fresh `from`)")
                .isEqualTo(t2.toString());
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /** A durable row that is consented + visible (counts toward others' bonus). */
    private static PlayerPresenceEntity viewable(String colleagueId) {
        return row(colleagueId, true, true);
    }

    /** A durable row with the given consent/visibility. */
    private static PlayerPresenceEntity row(String colleagueId, boolean consent, boolean visible) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(colleagueId);
        e.setAvatar("0");
        e.setConsentGiven(consent);
        e.setVisible(visible);
        return e;
    }

    /** A LIVE registry record in the given office. */
    private static PresenceRecord live(String colleagueId, String office) {
        return new PresenceRecord(
                colleagueId, colleagueId, "0", office, "coding", null,
                PresenceRecord.Status.LIVE, Instant.now().toString(),
                Instant.now().plusSeconds(60).toString());
    }
}
