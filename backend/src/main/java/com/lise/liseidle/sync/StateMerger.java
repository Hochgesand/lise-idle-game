package com.lise.liseidle.sync;

import com.lise.liseidle.state.BurnerState;
import com.lise.liseidle.state.CommuteState;
import com.lise.liseidle.state.CoopSegment;
import com.lise.liseidle.state.GameState;
import com.lise.liseidle.state.PlayerSettings;
import com.lise.liseidle.state.ResourceSet;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
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
 *   <li><b>(002) {@code coopSegments}</b>: <b>union keyed by {@code from}</b>, 
 *       each key taking {@code max(until)} AND {@code max(multiplier)} — the
 *       identical, conflict-free rule the client-side {@code applyCoopPresence}
 *       applies (contracts §1/§2), so client merge and server merge cannot
 *       disagree. Segment multipliers are ≥ 1, so monotonicity is preserved.
 *   <li><b>(002) {@code activeOffice}/{@code commute}</b>: merged <b>as a
 *       pair</b> from whichever state has the later {@code lastAdvancedAt} (the
 *       <b>client</b> copy on a tie — consistent with the sim owning that
 *       state; note this is the opposite tie-break from {@code settings}).
 *   <li><b>(002) null-normalization first</b>: a pre-existing v1 row or a
 *       pre-002 PUT body deserializes the overlay fields as {@code null}; they
 *       are normalized ({@code coopSegments} → {@code []}, {@code activeOffice}
 *       → {@code "office_1"}, {@code commute} stays {@code null}) <b>before</b>
 *       the union/pair rules run, so the first sync of any v1 player never NPEs
 *       or leaks {@code null} to a v2 client (contracts §2; depends on T028).</li>
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
        // (002) Normalize null overlay fields BEFORE merging (contracts §2):
        // a pre-existing v1 row or a pre-002 PUT body deserializes them as
        // null. Normalizing here (in addition to PlayerStateService's
        // read/write path) is defense in depth so the segment-union never NPEs
        // and a null never leaks through the merge.
        List<CoopSegment> clientSegments = normalizeSegments(client.getCoopSegments());
        List<CoopSegment> serverSegments = normalizeSegments(server.getCoopSegments());
        String clientOffice = normalizeOffice(client.getActiveOffice());
        String serverOffice = normalizeOffice(server.getActiveOffice());
        // commute's normalized default IS null (baseline) — nothing to coerce.
        CommuteState clientCommute = client.getCommute();
        CommuteState serverCommute = server.getCommute();

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

        // (002) activeOffice/commute merge as a PAIR from the state with the
        // later lastAdvancedAt (client copy on a tie — the opposite tie-break
        // from settings, consistent with the sim owning that state).
        boolean clientIsLaterOrTied = client.lastAdvancedAt().compareTo(server.lastAdvancedAt()) >= 0;
        String mergedActiveOffice = clientIsLaterOrTied ? clientOffice : serverOffice;
        CommuteState mergedCommute = clientIsLaterOrTied ? clientCommute : serverCommute;

        // (002) coopSegments: union keyed by `from`, taking max(until) AND
        // max(multiplier) — identical to the client-side applyCoopPresence.
        List<CoopSegment> mergedCoopSegments = unionSegments(clientSegments, serverSegments);

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
                mergedCoopSegments,
                mergedActiveOffice,
                mergedCommute);
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
     * (002) Union two coop-segment lists keyed by {@code from}, taking
     * {@code max(until)} AND {@code max(multiplier)} per key (contracts §1/§2 —
     * identical to the client-side {@code applyCoopPresence} upsert, so the two
     * merges can never disagree). The result preserves a stable insertion
     * order (client segments first, then server-only keys) for determinism.
     */
    private static List<CoopSegment> unionSegments(List<CoopSegment> client, List<CoopSegment> server) {
        LinkedHashMap<Long, CoopSegment> byFrom = new LinkedHashMap<>();
        for (CoopSegment segment : client) {
            upsertSegment(byFrom, segment);
        }
        for (CoopSegment segment : server) {
            upsertSegment(byFrom, segment);
        }
        return new ArrayList<>(byFrom.values());
    }

    /**
     * Upsert one segment into the keyed map, taking the max {@code until} and
     * the max {@code multiplier} against any existing entry with the same
     * {@code from}.
     */
    private static void upsertSegment(LinkedHashMap<Long, CoopSegment> byFrom, CoopSegment segment) {
        CoopSegment existing = byFrom.get(segment.from());
        if (existing == null) {
            byFrom.put(segment.from(), segment);
            return;
        }
        byFrom.put(segment.from(), new CoopSegment(
                existing.from(),
                Math.max(existing.until(), segment.until()),
                Math.max(existing.multiplier(), segment.multiplier())));
    }

    /**
     * (002) Normalize a possibly-null {@code coopSegments} list to the
     * {@code []} default (leniency for a v1-shaped row / pre-002 PUT body).
     */
    private static List<CoopSegment> normalizeSegments(List<CoopSegment> segments) {
        return segments != null ? segments : List.of();
    }

    /**
     * (002) Normalize a possibly-null {@code activeOffice} to the
     * {@code "office_1"} default (leniency for a v1-shaped row / pre-002 body).
     */
    private static String normalizeOffice(String office) {
        return office != null ? office : "office_1";
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
