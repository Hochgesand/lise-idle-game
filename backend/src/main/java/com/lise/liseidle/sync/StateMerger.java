package com.lise.liseidle.sync;

import com.lise.liseidle.state.BurnerState;
import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerSettings;
import com.lise.liseidle.state.ResourceSet;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Deterministic, conflict-free "max + union" monotonic merge of two
 * {@link GameState} snapshots (research.md §merge; contracts.md §2 PUT
 * {@code /api/v1/session/{id}/state}).
 *
 * <p>Idle-game state is monotonic by genre, so merging is conflict-free and
 * lossless (Constitution Principle I — determinism; Principle IV — integrity):
 * <ul>
 *   <li><b>resources</b> ({@code loc}/{@code cash}/{@code aiTokens}, big-number
 *       strings): take the per-field <b>max</b>, compared via
 *       {@link BigDecimal#compareTo}. The original winning string is returned
 *       verbatim (not re-normalized) so the canonical wire form is preserved;
 *       resource strings are always canonical plain-decimal integers in this
 *       domain, so the result is order-independent (commutative).</li>
 *   <li><b>ownership sets</b> ({@code ownedProducers}/{@code ownedUpgrades}/
 *       {@code ownedTrainings}/{@code earnedMilestones}): the <b>union</b> of
 *       both sets, materialized in a stable-order {@link LinkedHashSet}.</li>
 *   <li><b>{@code schemaVersion}</b>: {@link Math#max}.</li>
 *   <li><b>{@code lastAdvancedAt}</b>: the <b>max</b> of the two ISO-8601 UTC
 *       strings (lexicographic comparison is correct for same-format ISO-8601
 *       UTC timestamps).</li>
 *   <li><b>{@code activeBurner}</b> (MVP decision): if exactly one side is
 *       non-null, keep that one; if both are non-null, keep the one with the
 *       newer {@code startedAt} (a player can only have one active burner, so
 *       the most recently activated one wins); if both null, the result is
 *       null.</li>
 *   <li><b>{@code settings}</b> (MVP decision — UI prefs, not progress): taken
 *       from whichever state has the newer {@code lastAdvancedAt}; on a tie the
 *       <b>server</b> state's settings win (the server is the authoritative
 *       merge target).</li>
 * </ul>
 *
 * <p>This is a stateless, side-effect-free Spring {@link Component} so it can be
 * injected by {@code SessionController} (T023). It performs no I/O.
 */
@Component
public class StateMerger {

    /**
     * Merge two {@link GameState} snapshots into a single authoritative state.
     *
     * @param client the client's local state (the PUT body)
     * @param server the server's currently-persisted state
     * @return a new, merged {@link GameState}
     */
    public GameState merge(GameState client, GameState server) {
        ResourceSet mergedResources = new ResourceSet(
                maxBig(client.resources().loc(), server.resources().loc()),
                maxBig(client.resources().cash(), server.resources().cash()),
                maxBig(client.resources().aiTokens(), server.resources().aiTokens()));

        // Union ownership / milestone sets into stable-order mutable sets.
        Set<String> mergedProducers = union(client.ownedProducers(), server.ownedProducers());
        Set<String> mergedUpgrades = union(client.ownedUpgrades(), server.ownedUpgrades());
        Set<String> mergedTrainings = union(client.ownedTrainings(), server.ownedTrainings());
        Set<String> mergedMilestones = union(client.earnedMilestones(), server.earnedMilestones());

        BurnerState mergedBurner = mergeBurner(client.activeBurner(), server.activeBurner());

        String mergedLastAdvancedAt = maxString(client.lastAdvancedAt(), server.lastAdvancedAt());
        int mergedSchemaVersion = Math.max(client.schemaVersion(), server.schemaVersion());

        // Settings follow the newer state; tie → server.
        PlayerSettings mergedSettings = client.lastAdvancedAt().compareTo(server.lastAdvancedAt()) > 0
                ? client.settings()
                : server.settings();

        return new GameState(
                mergedResources,
                mergedProducers,
                mergedUpgrades,
                mergedTrainings,
                mergedBurner,
                mergedMilestones,
                mergedLastAdvancedAt,
                mergedSchemaVersion,
                mergedSettings,
                // (002) coopSegments / activeOffice / commute: the real merge
                // rule (segment union keyed by `from` taking max until /
                // max multiplier; office/commute merged as a pair from the
                // state with the later lastAdvancedAt, client on tie) lands in
                // T029. Until then these fields pass through from the client so
                // the merge path does not drop them; the null-normalization on
                // read (PlayerStateService) keeps any pre-existing v1 row safe.
                client.getCoopSegments(),
                client.getActiveOffice(),
                client.getCommute());
    }

    /**
     * @return the argument representing the numerically larger big number,
     *         returning its original (canonical) string verbatim. On a tie the
     *         first argument wins; since resource strings are canonical plain
     *         integers in this domain, equal values share one string form and
     *         the result is order-independent.
     */
    private static String maxBig(String a, String b) {
        return new BigDecimal(a).compareTo(new BigDecimal(b)) >= 0 ? a : b;
    }

    /**
     * @return the lexicographically larger string. Correct for same-format
     *         ISO-8601 UTC timestamps (and for big-number-free scalar strings).
     */
    private static String maxString(String a, String b) {
        return a.compareTo(b) >= 0 ? a : b;
    }

    /**
     * Merge two ownership sets into a new {@link LinkedHashSet} (stable order,
     * deduplicated) preserving all elements from both inputs.
     */
    private static Set<String> union(Set<String> a, Set<String> b) {
        Set<String> result = new LinkedHashSet<>(a);
        result.addAll(b);
        return result;
    }

    /**
     * Merge two (possibly null) active burners: a lone non-null wins; with two
     * non-null burners the one with the newer {@code startedAt} wins; two nulls
     * yield null.
     */
    private static BurnerState mergeBurner(BurnerState client, BurnerState server) {
        if (client == null) {
            return server;
        }
        if (server == null) {
            return client;
        }
        // Both non-null: keep the most recently activated burner.
        return client.startedAt().compareTo(server.startedAt()) >= 0 ? client : server;
    }
}
