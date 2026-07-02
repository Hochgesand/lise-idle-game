package com.lise.liseidle.sync;

import com.lise.liseidle.state.BurnerState;
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
}
