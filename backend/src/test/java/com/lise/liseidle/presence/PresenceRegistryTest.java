package com.lise.liseidle.presence;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Presence skeleton tests (T019 RED &rarr; T033 GREEN).
 *
 * <p>Two concerns, both from tasks.md T019:
 * <ol>
 *   <li><b>{@link PresenceRegistry} structural collapse</b> &mdash; upsert is
 *       keyed by {@code colleagueId}, so a duplicate session (a second upsert
 *       for the same colleague) <i>refreshes the same record</i> instead of
 *       adding a second one: two sessions, one record (data-model
 *       "Duplicate-session collapse"; contracts &sect;3).</li>
 *   <li><b>{@link PlayerPresenceEntity} round-trip</b> through
 *       {@link PresenceRepository} &mdash; the durable {@code player_presence}
 *       row persists colleague id, display name, avatar, office, activity,
 *       {@code last_seen_at} (ISO-8601 string), and the consent/visibility
 *       flags.</li>
 * </ol>
 *
 * <p>The registry-collapse cases are pure unit tests on a fresh
 * {@code new PresenceRegistry()} instance (isolated, no shared bean state); the
 * entity round-trip is a full {@link SpringBootTest} against the in-memory H2
 * (matching {@code state/PlayerStateRepositoryTest}), proving {@code ddl-auto:
 * update} creates the {@code player_presence} columns.
 *
 * <p><b>RED note (T019).</b> Both concerns are genuinely RED against the T019
 * stubs: the {@link PresenceRegistry} collapse behaviour is unimplemented
 * (empty snapshot / empty lookup), and the new {@code player_presence} columns
 * are {@code @Transient} stubs that do not survive a save&rarr;find, so the
 * round-trip assertions fail. T033 implements the registry (real
 * {@code ConcurrentHashMap}) and wires the entity columns ({@code @Transient}
 * &rarr; {@code @Column}); both flip GREEN. (The fresh-identity defaults case
 * is a default-value smoke test: it stays green throughout because Java
 * primitive booleans default to {@code false} &mdash; exactly the un-consented /
 * hidden defaults a fresh identity should have.)
 */
@SpringBootTest
class PresenceRegistryTest {

    @Autowired
    private PresenceRepository presenceRepository;

    /**
     * Each {@code @SpringBootTest} class shares one application context (and one
     * in-memory H2) across the suite; {@code SessionControllerTest} may persist
     * {@code player_presence} rows under identity-bound ids. Wipe the table
     * before every test to keep these round-trip assertions deterministic.
     */
    @BeforeEach
    void cleanTable() {
        presenceRepository.deleteAll();
    }

    // ---- PresenceRegistry: structural collapse (duplicate session -> one record) ----

    @Test
    void upsert_isKeyedByColleagueId_soTwoSessionsCollapseToOneRecord() {
        PresenceRegistry registry = new PresenceRegistry();

        PresenceRecord sessionA = presence("alice", "Alice (laptop)", "office_1", "coding");
        PresenceRecord sessionB = presence("alice", "Alice (phone)", "office_2", "reviewing");

        registry.upsert(sessionA);
        registry.upsert(sessionB); // duplicate session, same colleagueId -> refresh

        assertThat(registry.snapshot()).hasSize(1); // structural collapse
        assertThat(registry.get("alice")).contains(sessionB); // latest wins
    }

    @Test
    void upsert_refreshesTheSameRecord_notADuplicate() {
        PresenceRegistry registry = new PresenceRegistry();

        registry.upsert(presence("alice", "Alice", "office_1", "coding"));
        registry.upsert(presence("bob", "Bob", "office_1", "coding"));
        registry.upsert(presence("alice", "Alice", "office_2", "commuting")); // alice again

        assertThat(registry.snapshot()).hasSize(2); // one entry per colleagueId
        assertThat(registry.get("alice"))
                .map(PresenceRecord::office)
                .contains("office_2"); // refreshed, not duplicated
    }

    @Test
    void remove_dropsARecordByColleagueId() {
        PresenceRegistry registry = new PresenceRegistry();
        registry.upsert(presence("alice", "Alice", "office_1", "coding"));
        registry.upsert(presence("bob", "Bob", "office_1", "coding"));

        registry.remove("alice");

        assertThat(registry.snapshot()).hasSize(1);
        assertThat(registry.get("alice")).isEmpty();
        assertThat(registry.get("bob")).isPresent();
    }

    // ---- PlayerPresenceEntity round-trip through PresenceRepository ----

    @Test
    void playerPresenceEntity_roundTripsThroughRepositoryWithAllFields() {
        PlayerPresenceEntity entity = new PlayerPresenceEntity("alice-sub");
        entity.setDisplayName("Alice Example");
        entity.setAvatar("avatar_03");
        entity.setOffice("office_1");
        entity.setActivity("coding");
        entity.setLastSeenAt("2026-07-01T09:00:00Z"); // ISO-8601 string
        entity.setConsentGiven(true);
        entity.setVisible(true);

        presenceRepository.save(entity);

        Optional<PlayerPresenceEntity> reloaded = presenceRepository.findById("alice-sub");
        assertThat(reloaded).isPresent();
        PlayerPresenceEntity got = reloaded.get();
        assertThat(got.getColleagueId()).isEqualTo("alice-sub");
        assertThat(got.getDisplayName()).isEqualTo("Alice Example");
        assertThat(got.getAvatar()).isEqualTo("avatar_03");
        assertThat(got.getOffice()).isEqualTo("office_1");
        assertThat(got.getActivity()).isEqualTo("coding");
        assertThat(got.getLastSeenAt()).isEqualTo("2026-07-01T09:00:00Z");
        assertThat(got.isConsentGiven()).isTrue();
        assertThat(got.isVisible()).isTrue();
    }

    @Test
    void playerPresenceEntity_freshIdentityDefaultsConsentAndVisibilityFalse() {
        PlayerPresenceEntity fresh = new PlayerPresenceEntity("bob-sub");
        // a fresh identity is un-consented and not visible (contracts §2 / FR-003)

        presenceRepository.save(fresh);

        PlayerPresenceEntity got = presenceRepository.findById("bob-sub").orElseThrow();
        assertThat(got.isConsentGiven()).isFalse();
        assertThat(got.isVisible()).isFalse();
    }

    // helper: build a live PresenceRecord for one colleague
    private static PresenceRecord presence(String colleagueId, String displayName,
                                           String office, String activity) {
        return new PresenceRecord(
                colleagueId,
                displayName,
                "avatar_1",
                office,
                activity,
                null, // not commuting
                PresenceRecord.Status.LIVE,
                "2026-07-01T09:00:00Z",
                "2026-07-01T09:01:00Z");
    }
}
