package com.lise.liseidle.state;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for the JPA persistence layer (T021).
 *
 * <p>Uses {@link SpringBootTest} (full context) rather than {@code @DataJpaTest}
 * because Spring Boot 4 may have altered JPA slice semantics; a full context
 * also proves that {@code ddl-auto: update} creates the {@code player_state}
 * table and that Hibernate scans the entity during normal startup.
 *
 * <p>Exercises the real {@link PlayerStateService} + {@link
 * PlayerStateRepository} against the in-memory H2 datasource, proving a
 * GameState survives a full serialize → DB → deserialize round-trip with no
 * loss (Constitution Principle IV — integrity), including the big-number
 * string and nullable nested burner.
 */
@SpringBootTest
class PlayerStateRepositoryTest {

    @Autowired
    private PlayerStateService service;

    @Autowired
    private PlayerStateRepository repository;

    /**
     * Each {@code @SpringBootTest} class shares a single application context (and
     * thus one in-memory H2) across tests in the suite; other test classes
     * (e.g. {@code SessionControllerTest}) also persist players. To keep the
     * row-count assertions below deterministic and order-independent, wipe the
     * table before every test.
     */
    @BeforeEach
    void cleanTable() {
        repository.deleteAll();
    }

    @Test
    void loadState_returnsEmpty_whenNoSaveExists() {
        Optional<GameState> loaded = service.loadState("no-such-player");
        assertThat(loaded).isEmpty();
    }

    @Test
    void saveState_thenLoadState_roundTripsThroughDatabaseWithoutLoss() {
        GameState original = SampleStates.populated();

        service.saveState("player-1", original);

        // Prove it actually hit the DB (entity row + JSON column present).
        assertThat(repository.existsByPlayerId("player-1")).isTrue();

        Optional<GameState> loaded = service.loadState("player-1");
        assertThat(loaded).isPresent();
        // Same DTO record shape as T011 — recursive comparison covers resources,
        // ownership sets, the nested burner, milestones, settings, timestamp.
        assertThat(loaded.get()).usingRecursiveComparison().isEqualTo(original);
    }

    @Test
    void saveState_upsertsExistingRow_whenPlayerAlreadySaved() {
        GameState first = SampleStates.fresh();
        GameState second = SampleStates.populated();

        service.saveState("player-2", first);
        service.saveState("player-2", second);

        // Upsert must not create a duplicate row.
        assertThat(repository.count()).isEqualTo(1);
        Optional<GameState> loaded = service.loadState("player-2");
        assertThat(loaded).isPresent();
        assertThat(loaded.get()).usingRecursiveComparison().isEqualTo(second);
    }

    @Test
    void saveState_preservesBigNumberStringAndNullBurner() {
        GameState withNullBurner = SampleStates.withNoActiveBurner();

        service.saveState("player-3", withNullBurner);

        Optional<GameState> loaded = service.loadState("player-3");
        assertThat(loaded).isPresent();
        GameState got = loaded.get();
        // Big-number string preserved losslessly (no double coercion).
        assertThat(got.getResources().getLoc()).isEqualTo("10");
        assertThat(got.getActiveBurner()).isNull();
        assertThat(got.getSchemaVersion()).isEqualTo(1);
    }
}
