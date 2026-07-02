package com.lise.liseidle.sync;

import com.lise.liseidle.state.BurnerState;
import com.lise.liseidle.state.CommuteState;
import com.lise.liseidle.state.CoopSegment;
import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerSettings;
import com.lise.liseidle.state.ResourceSet;
import com.lise.liseidle.state.SampleStates;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Phase 2 TDD RED→GREEN test for {@link StateMerger} (T022) — the
 * deterministic, conflict-free "max + union" monotonic merge of two
 * {@link GameState} snapshots (research.md §merge; contracts.md §2).
 *
 * <p>This locks in Constitution Principle I (determinism — the merge MUST be
 * commutative and idempotent) and Principle IV (integrity — the merge MUST
 * never lose accumulated progress: resources take the per-field max, ownership
 * sets take the union).
 *
 * <p>{@link StateMerger} does not exist yet; therefore this test does not
 * compile, which is the required RED state before T022's implementation.
 */
class StateMergerTest {

    private final StateMerger merger = new StateMerger();

    // ── controlled-state builders ───────────────────────────────────────

    private static GameState state(String loc, String cash, String aiTokens,
                                   Set<String> producers, Set<String> upgrades,
                                   Set<String> trainings, BurnerState burner,
                                   Set<String> milestones, String lastAdvancedAt,
                                   int schemaVersion, PlayerSettings settings) {
        return new GameState(
                new ResourceSet(loc, cash, aiTokens),
                producers, upgrades, trainings,
                burner,
                milestones,
                lastAdvancedAt,
                schemaVersion,
                settings,
                /* coopSegments */ List.of(),
                /* activeOffice */ "office_1",
                /* commute */ null);
    }

    private static GameState emptyState() {
        return state("0", "0", "0",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));
    }

    private static GameState emptyStateWith(BurnerState burner, String lastAdvancedAt,
                                           PlayerSettings settings) {
        return state("0", "0", "0",
                Set.of(), Set.of(), Set.of(), burner, Set.of(),
                lastAdvancedAt, 1, settings);
    }

    // ── 1. resources: per-field max via BigDecimal (beyond MAX_SAFE_INTEGER) ─

    @Test
    void resources_arePerFieldMax_pickingFromEitherSide() {
        // loc & cash larger on server; aiTokens larger on client — proves the
        // max is per-field, not "always take server" or "always take client".
        GameState client = state(
                "9007199254740993", "5", "100",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));
        GameState server = state(
                "9007199254740995", "99", "1",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));

        GameState merged = merger.merge(client, server);

        assertThat(merged.resources().loc()).isEqualTo("9007199254740995");
        assertThat(merged.resources().cash()).isEqualTo("99");
        assertThat(merged.resources().aiTokens()).isEqualTo("100");
    }

    @Test
    void resources_maxCommutative_forEitherArgumentOrder() {
        GameState client = state("10", "5", "100",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));
        GameState server = state("42", "99", "1",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));

        GameState merged = merger.merge(server, client);

        assertThat(merged.resources().loc()).isEqualTo("42");
        assertThat(merged.resources().cash()).isEqualTo("99");
        assertThat(merged.resources().aiTokens()).isEqualTo("100");
    }

    // ── 2. ownership sets: union (disjoint + overlap, no duplicates) ─────

    @Test
    void ownershipSets_areUnion_withOverlapAndDisjointIds() {
        GameState client = state("0", "0", "0",
                Set.of("a", "b"), Set.of("u1"), Set.of("t1"), null,
                Set.of("m1", "m2"),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));
        GameState server = state("0", "0", "0",
                Set.of("b", "c"), Set.of("u1", "u2"), Set.of(), null,
                Set.of("m3"),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));

        GameState merged = merger.merge(client, server);

        assertThat(merged.ownedProducers()).containsExactlyInAnyOrder("a", "b", "c");
        assertThat(merged.ownedUpgrades()).containsExactlyInAnyOrder("u1", "u2");
        assertThat(merged.ownedTrainings()).containsExactlyInAnyOrder("t1");
        assertThat(merged.earnedMilestones()).containsExactlyInAnyOrder("m1", "m2", "m3");
    }

    // ── 3. lastAdvancedAt: max ISO-8601 UTC timestamp ───────────────────

    @Test
    void lastAdvancedAt_isMaxTimestamp_regardlessOfOrder() {
        GameState older = emptyStateWith(null, "2026-06-30T12:00:00.000Z",
                new PlayerSettings(false, false));
        GameState newer = emptyStateWith(null, "2026-07-01T09:00:00.000Z",
                new PlayerSettings(false, false));

        assertThat(merger.merge(older, newer).lastAdvancedAt())
                .isEqualTo("2026-07-01T09:00:00.000Z");
        assertThat(merger.merge(newer, older).lastAdvancedAt())
                .isEqualTo("2026-07-01T09:00:00.000Z");
    }

    // ── 4. schemaVersion: max ───────────────────────────────────────────

    @Test
    void schemaVersion_isMax_regardlessOfOrder() {
        GameState v1 = state("0", "0", "0",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 1, new PlayerSettings(false, false));
        GameState v3 = state("0", "0", "0",
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                "2026-06-30T12:00:00.000Z", 3, new PlayerSettings(false, false));

        assertThat(merger.merge(v1, v3).schemaVersion()).isEqualTo(3);
        assertThat(merger.merge(v3, v1).schemaVersion()).isEqualTo(3);
    }

    // ── 5. activeBurner: non-null wins over null; both-null → null ──────

    @Test
    void activeBurner_nonNullWinsOverNull_andBothNullStaysNull() {
        BurnerState burner = new BurnerState("b1", "2026-06-30T12:00:00.000Z", "100");
        GameState withBurner = emptyStateWith(burner, "2026-06-30T12:00:00.000Z",
                new PlayerSettings(false, false));
        GameState noBurner = emptyStateWith(null, "2026-06-30T12:00:00.000Z",
                new PlayerSettings(false, false));

        assertThat(merger.merge(withBurner, noBurner).activeBurner()).isEqualTo(burner);
        assertThat(merger.merge(noBurner, withBurner).activeBurner()).isEqualTo(burner);
        assertThat(merger.merge(noBurner, noBurner).activeBurner()).isNull();
    }

    @Test
    void activeBurner_bothNonNull_newerStartedAtWins() {
        BurnerState olderBurner = new BurnerState("b1", "2026-06-30T10:00:00.000Z", "50");
        BurnerState newerBurner = new BurnerState("b2", "2026-06-30T14:00:00.000Z", "80");
        GameState withOlder = emptyStateWith(olderBurner, "2026-06-30T12:00:00.000Z",
                new PlayerSettings(false, false));
        GameState withNewer = emptyStateWith(newerBurner, "2026-06-30T12:00:00.000Z",
                new PlayerSettings(false, false));

        assertThat(merger.merge(withOlder, withNewer).activeBurner()).isEqualTo(newerBurner);
        assertThat(merger.merge(withNewer, withOlder).activeBurner()).isEqualTo(newerBurner);
    }

    // ── 6. Commutativity / determinism (Constitution I) ─────────────────
    //
    // merge(a, b) == merge(b, a). Built with *different* lastAdvancedAt so the
    // settings tie-break (newer lastAdvancedAt) is order-independent; this is
    // the "components compare cleanly" requirement.

    @Test
    void merge_isCommutative_deterministic() {
        GameState a = state(
                "10", "5", "100",
                Set.of("a", "b"), Set.of("u1"), Set.of("t1"),
                new BurnerState("b1", "2026-06-30T10:00:00.000Z", "50"),
                Set.of("m1"),
                "2026-06-30T10:00:00.000Z",
                1, new PlayerSettings(true, false));
        GameState b = state(
                "42", "99", "1",
                Set.of("b", "c"), Set.of("u1", "u2"), Set.of(),
                new BurnerState("b2", "2026-06-30T14:00:00.000Z", "80"),
                Set.of("m2"),
                "2026-07-01T09:00:00.000Z",
                3, new PlayerSettings(false, true));

        GameState ab = merger.merge(a, b);
        GameState ba = merger.merge(b, a);

        // Record equals uses Set.equals (content-based) for the set components,
        // so concrete set type (Set.of vs LinkedHashSet) does not matter.
        assertThat(ab).isEqualTo(ba);
    }

    // ── 7. Idempotency: merge(a, a) == a ────────────────────────────────

    @Test
    void merge_isIdempotent() {
        GameState a = SampleStates.populated();
        GameState merged = merger.merge(a, a);

        // Recursive comparison handles the LinkedHashSet-vs-Set.of difference
        // the same way the established round-trip test does (compares set
        // contents). merge(a, a) must reproduce a exactly.
        assertThat(merged).usingRecursiveComparison().isEqualTo(a);
    }

    // ── 8. (002) coopSegments: union keyed by `from`, max(until) + max(multiplier)
    //
    // Identical by contract to the client-side `applyCoopPresence` upsert
    // (contracts §1/§2): an existing segment with the same `from` takes
    // `until = max(...)` AND `multiplier = max(...)`; disjoint segments are
    // kept. Client merge and server merge MUST NOT disagree.

    @Test
    void coopSegments_areUnion_keyedByFrom_takingMaxUntilAndMaxMultiplier() {
        // Client carries two segments: one shares `from` with a server segment
        // (must upsert to max until + max multiplier); the other is client-only.
        List<CoopSegment> clientSegs = List.of(
                new CoopSegment(100L, 200L, 1.2),
                new CoopSegment(300L, 400L, 1.3));
        List<CoopSegment> serverSegs = List.of(
                new CoopSegment(100L, 250L, 1.1), // same `from` as client's first
                new CoopSegment(500L, 600L, 1.4)); // server-only

        GameState client = stateWithOverlay(clientSegs, "office_1", null, TIE_TIME);
        GameState server = stateWithOverlay(serverSegs, "office_1", null, TIE_TIME);

        GameState merged = merger.merge(client, server);

        assertThat(merged.getCoopSegments()).containsExactlyInAnyOrder(
                new CoopSegment(100L, 250L, 1.2), // max(200,250) until, max(1.2,1.1) mult
                new CoopSegment(300L, 400L, 1.3),
                new CoopSegment(500L, 600L, 1.4));
    }

    @Test
    void coopSegments_upsertTakesMaxUntilAndMultiplier_whenServerSideIsHigher() {
        // Same `from`; the server side carries the higher until AND the higher
        // multiplier — proves the upsert takes the max from EITHER side, not
        // "always client" or "always server".
        List<CoopSegment> clientSegs = List.of(new CoopSegment(100L, 150L, 1.1));
        List<CoopSegment> serverSegs = List.of(new CoopSegment(100L, 200L, 1.5));

        GameState client = stateWithOverlay(clientSegs, "office_1", null, TIE_TIME);
        GameState server = stateWithOverlay(serverSegs, "office_1", null, TIE_TIME);

        GameState merged = merger.merge(client, server);

        assertThat(merged.getCoopSegments()).containsExactly(new CoopSegment(100L, 200L, 1.5));
    }

    // ── 9. (002) activeOffice/commute: a PAIR from the state with the later
    //         lastAdvancedAt (client copy on a tie) — data-model.md invariant.

    @Test
    void activeOfficeAndCommute_takenAsPairFromClient_whenClientLater() {
        CommuteState clientCommute = new CommuteState("office_1", "office_2", 1000L);
        GameState client = stateWithOverlay(List.of(), "office_2", clientCommute,
                "2026-07-01T09:00:00.000Z");
        GameState server = stateWithOverlay(List.of(), "office_1", null,
                "2026-06-30T12:00:00.000Z");

        GameState merged = merger.merge(client, server);

        assertThat(merged.getActiveOffice()).isEqualTo("office_2");
        assertThat(merged.getCommute()).isEqualTo(clientCommute);
    }

    @Test
    void activeOfficeAndCommute_takenAsPairFromServer_whenServerLater() {
        CommuteState serverCommute = new CommuteState("office_2", "office_1", 2000L);
        GameState client = stateWithOverlay(List.of(), "office_2", null,
                "2026-06-30T12:00:00.000Z");
        GameState server = stateWithOverlay(List.of(), "office_1", serverCommute,
                "2026-07-01T09:00:00.000Z");

        GameState merged = merger.merge(client, server);

        assertThat(merged.getActiveOffice()).isEqualTo("office_1");
        assertThat(merged.getCommute()).isEqualTo(serverCommute);
    }

    @Test
    void activeOfficeAndCommute_clientWinsOnTie() {
        // Identical lastAdvancedAt: the CLIENT's office/commute pair wins
        // (consistent with the sim owning that state) — note this is the
        // opposite tie-break from `settings` (server on tie).
        CommuteState clientCommute = new CommuteState("office_1", "office_2", 3000L);
        GameState client = stateWithOverlay(List.of(), "office_2", clientCommute, TIE_TIME);
        GameState server = stateWithOverlay(List.of(), "office_1", null, TIE_TIME);

        GameState merged = merger.merge(client, server);

        assertThat(merged.getActiveOffice()).isEqualTo("office_2");
        assertThat(merged.getCommute()).isEqualTo(clientCommute);
    }

    // ── 10. (002) null-normalization of the overlay BEFORE merging (no NPE)
    //
    // A pre-existing v1 row or a pre-002 PUT body deserializes the overlay
    // fields as null; the merge MUST normalize (coopSegments → [], activeOffice
    // → "office_1", commute → null) itself before the segment-union, otherwise
    // the first sync of any v1 player NPEs (contracts §2).

    @Test
    void nullOverlayFields_normalizedBeforeMerge_neverNpe() {
        // A v1-shaped client (null overlay) merged against a normal server.
        GameState client = v1Shaped("2026-07-01T09:00:00.000Z");
        GameState server = stateWithOverlay(List.of(), "office_1", null,
                "2026-06-30T12:00:00.000Z");

        GameState merged = merger.merge(client, server);

        assertThat(merged.getCoopSegments()).isEmpty();
        assertThat(merged.getActiveOffice()).isEqualTo("office_1");
        assertThat(merged.getCommute()).isNull();
    }

    @Test
    void nullOverlayOnServer_normalizedBeforeMerge_preservingClientSegments() {
        // A v1-shaped SERVER (null coopSegments) merged against a client with
        // real segments — the union must keep the client's segment, not NPE on
        // the server's null. Client is later so its office/commute pair wins.
        CoopSegment seg = new CoopSegment(100L, 200L, 1.2);
        GameState client = stateWithOverlay(List.of(seg), "office_2", null,
                "2026-07-01T09:00:00.000Z");
        GameState server = v1Shaped("2026-06-30T12:00:00.000Z");

        GameState merged = merger.merge(client, server);

        assertThat(merged.getCoopSegments()).containsExactly(seg);
        assertThat(merged.getActiveOffice()).isEqualTo("office_2");
        assertThat(merged.getCommute()).isNull();
    }

    // ── (002) controlled-state builders ─────────────────────────────────

    private static final String TIE_TIME = "2026-06-30T12:00:00.000Z";

    /** A GameState carrying explicit (002) co-op overlay fields. */
    private static GameState stateWithOverlay(List<CoopSegment> coopSegments,
                                              String activeOffice, CommuteState commute,
                                              String lastAdvancedAt) {
        return new GameState(
                new ResourceSet("0", "0", "0"),
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                lastAdvancedAt, 1, new PlayerSettings(false, false),
                coopSegments, activeOffice, commute);
    }

    /**
     * A v1-shaped state whose (002) overlay fields are {@code null} — the shape
     * a freshly deserialized pre-002 row has before normalization. StateMerger
     * must normalize this itself (contracts §2 "normalized ... before merging").
     */
    private static GameState v1Shaped(String lastAdvancedAt) {
        return new GameState(
                new ResourceSet("0", "0", "0"),
                Set.of(), Set.of(), Set.of(), null, Set.of(),
                lastAdvancedAt, 1, new PlayerSettings(false, false),
                /* coopSegments */ null,
                /* activeOffice */ null,
                /* commute */ null);
    }
}
