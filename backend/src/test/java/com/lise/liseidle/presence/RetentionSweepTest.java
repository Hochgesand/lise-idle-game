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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * T084 &mdash; RED tests for the last-seen retention sweep (Phase 7; data-model
 * PresenceRecord "Retention &amp; offboarding"; tasks.md T084/T085). A durable
 * {@code player_presence} row whose {@code lastSeenAt} is older than
 * {@code coop.lastSeenRetentionDays} (placeholder 14) is:
 * <ol>
 *   <li><b>filtered</b> from the snapshot (and from the rendered population) &mdash;
 *       it does not appear in {@code GET /api/v1/presence} colleagues; and</li>
 *   <li><b>deleted</b> by a daily {@code @Scheduled} sweep &mdash; the offboarding
 *       path by which a disabled/removed Keycloak account ages out of the world
 *       with no IdP integration (a stopped account simply stops heartbeating and
 *       its last-seen row passes the retention window).</li>
 * </ol>
 *
 * <p><b>Mockito unit test</b> (mirrors {@link PresenceServiceTest}): a real
 * {@link PresenceRegistry} + real {@link CoopConfig}, with
 * {@link PresenceRepository} and {@link PresencePushService} mocked so the
 * delete/remove/broadcast side effects are asserted precisely via {@code verify}.
 *
 * <p><b>RED state</b>: {@link PresenceService#sweepRetainedOut()} and
 * {@link PresenceRepository#findByLastSeenAtLessThan(String)} do not exist yet
 * (implemented in T085), so this test does not compile &mdash; the correct TDD RED
 * state per Constitution Principle III (matching {@code PresenceServiceTest}'s
 * RED note). The snapshot-filter cases would additionally fail at runtime against
 * the current {@code buildSnapshot}, which does not yet apply the retention
 * window.
 */
@ExtendWith(MockitoExtension.class)
class RetentionSweepTest {

    private static final CoopConfig COOP = new CoopConfig(0.10, 1.5, 60, 20, 30, 14);

    @Mock
    private PresenceRepository repository;

    @Mock
    private PresencePushService pushService;

    @Mock
    private ContentLoader contentLoader;

    /** Real registry so the retention delete/remove runs against actual state. */
    private final PresenceRegistry registry = new PresenceRegistry();

    private PresenceService service;

    @BeforeEach
    void setUp() {
        when(contentLoader.getCatalog()).thenReturn(
                new ContentCatalog(1, "test", List.of(), List.of(), List.of(), List.of(), List.of(), COOP));
        CoopService coopService = new CoopService(registry, repository, contentLoader);
        service = new PresenceService(registry, repository, pushService, contentLoader, coopService);
    }

    // ── 1. daily sweep deletes rows beyond the window + removes the record ───

    /**
     * The daily retention sweep deletes every {@code player_presence} row whose
     * {@code lastSeenAt} is older than {@code lastSeenRetentionDays}, removes
     * the colleague's live registry record (so they disappear from snapshots),
     * and broadcasts a {@code presence.remove} so observers drop the avatar
     * (the offboarding path). A within-window row is left untouched.
     */
    @Test
    void dailySweep_deletesRowsBeyondWindow_removesRegistryRecord_broadcastsRemove() {
        PlayerPresenceEntity stale = row("stale", true, true);
        stale.setLastSeenAt(Instant.now().minus(Duration.ofDays(COOP.lastSeenRetentionDays() + 1)).toString());
        PlayerPresenceEntity fresh = row("fresh", true, true);
        fresh.setLastSeenAt(Instant.now().minus(Duration.ofDays(1)).toString());

        // the registry holds both as last-seen; the sweep must remove only stale.
        registry.upsert(lastSeen("stale", stale.getLastSeenAt()));
        registry.upsert(lastSeen("fresh", fresh.getLastSeenAt()));

        // only the beyond-window row is returned by the retention query.
        when(repository.findByLastSeenAtLessThan(anyString())).thenReturn(List.of(stale));

        service.sweepRetainedOut();

        // the beyond-window row is deleted; the within-window row is not.
        verify(repository).delete(stale);
        verify(repository, never()).delete(fresh);
        // the registry record is removed (disappears from snapshots) ...
        assertThat(registry.get("stale"))
                .as("the retained-out colleague's registry record is removed")
                .isEmpty();
        assertThat(registry.get("fresh"))
                .as("the within-window colleague's registry record is kept")
                .isPresent();
        // ... and observers are told to drop the avatar (presence.remove).
        verify(pushService).broadcastPresenceRemove("stale");
        verify(pushService, never()).broadcastPresenceRemove("fresh");
    }

    /**
     * A row within the retention window is not returned by the retention query,
     * so the sweep deletes nothing, removes no record, and broadcasts nothing.
     */
    @Test
    void dailySweep_leavesRowsWithinWindow_untouched() {
        PlayerPresenceEntity fresh = row("fresh", true, true);
        fresh.setLastSeenAt(Instant.now().minus(Duration.ofDays(2)).toString());
        registry.upsert(lastSeen("fresh", fresh.getLastSeenAt()));

        when(repository.findByLastSeenAtLessThan(anyString())).thenReturn(List.of());

        service.sweepRetainedOut();

        verify(repository, never()).delete(any());
        assertThat(registry.get("fresh")).as("within-window record is kept").isPresent();
        verify(pushService, never()).broadcastPresenceRemove(anyString());
    }

    /**
     * A non-viewable (hidden / un-consented) retained-out row is still deleted
     * (offboarding is identity hygiene, not visibility), but no
     * {@code presence.remove} is broadcast &mdash; the colleague was already
     * filtered from every snapshot/broadcast by visibility (FR-009), so there
     * is no rendered avatar to drop.
     */
    @Test
    void dailySweep_deletesHiddenRetainedOutRow_butDoesNotBroadcast() {
        PlayerPresenceEntity hidden = row("hidden", true, false); // consented but hidden
        hidden.setLastSeenAt(Instant.now().minus(Duration.ofDays(COOP.lastSeenRetentionDays() + 1)).toString());
        registry.upsert(lastSeen("hidden", hidden.getLastSeenAt()));

        when(repository.findByLastSeenAtLessThan(anyString())).thenReturn(List.of(hidden));

        service.sweepRetainedOut();

        verify(repository).delete(hidden); // offboarding deletes regardless of visibility
        assertThat(registry.get("hidden")).isEmpty();
        verify(pushService, never()).broadcastPresenceRemove(anyString()); // nothing rendered → nothing to drop
    }

    // ── 2. snapshot filters out colleagues beyond the window ────────────────

    /**
     * The snapshot excludes a last-seen colleague whose {@code lastSeenAt} is
     * beyond the retention window (they no longer render "idle at desk",
     * FR-006), while a within-window last-seen colleague and a live colleague
     * (fresh {@code lastSeenAt}) still appear (data-model PresenceRecord
     * "Retention &amp; offboarding").
     */
    @Test
    void snapshot_filtersOutColleaguesBeyondRetentionWindow_butKeepsWithinAndLive() {
        when(repository.findById("viewer")).thenReturn(Optional.of(row("viewer", true, true)));
        when(repository.findById("stale")).thenReturn(Optional.of(row("stale", true, true)));
        when(repository.findById("recent")).thenReturn(Optional.of(row("recent", true, true)));
        when(repository.findById("live-c")).thenReturn(Optional.of(row("live-c", true, true)));

        String beyond = Instant.now().minus(Duration.ofDays(COOP.lastSeenRetentionDays() + 1)).toString();
        String within = Instant.now().minus(Duration.ofDays(2)).toString();
        registry.upsert(lastSeen("stale", beyond));
        registry.upsert(lastSeen("recent", within));
        registry.upsert(live("live-c"));

        PresenceSnapshot snapshot = service.buildSnapshot("viewer");

        assertThat(snapshot.colleagues()).extracting(PresenceRecordView::colleagueId)
                .as("beyond-window last-seen is filtered; within-window + live appear")
                .containsExactlyInAnyOrder("recent", "live-c")
                .doesNotContain("stale");
    }

    // ── helpers ───────────────────────────────────────────────────────────

    /** A durable row with a name/avatar and the given consent/visibility. */
    private static PlayerPresenceEntity row(String colleagueId, boolean consent, boolean visible) {
        PlayerPresenceEntity e = new PlayerPresenceEntity(colleagueId);
        e.setDisplayName(colleagueId + "-name");
        e.setAvatar("0");
        e.setConsentGiven(consent);
        e.setVisible(visible);
        return e;
    }

    /** A LAST_SEEN registry record at the given lastSeenAt (no lease). */
    private static PresenceRecord lastSeen(String colleagueId, String lastSeenAt) {
        return new PresenceRecord(
                colleagueId, colleagueId + "-name", "0", "office_1", "coding", null,
                PresenceRecord.Status.LAST_SEEN, lastSeenAt, null);
    }

    /** A LIVE registry record with a fresh lastSeenAt (within any retention window). */
    private static PresenceRecord live(String colleagueId) {
        return new PresenceRecord(
                colleagueId, colleagueId + "-name", "0", "office_1", "coding", null,
                PresenceRecord.Status.LIVE, Instant.now().toString(),
                Instant.now().plusSeconds(60).toString());
    }
}
