package com.lise.liseidle.state;

// NOTE: Spring Boot 4.1 ships Jackson 3.x, which relocated packages from
// com.fasterxml.jackson.databind -> tools.jackson.databind.
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Phase 2 TDD RED test (T011) — proves {@link GameState} serialization is a
 * lossless round-trip, the core of Constitution Principle IV ("never silently
 * destroy or wipe player progress").
 *
 * <p>The {@link GameState} DTO (and {@link ResourceSet}, {@link BurnerState},
 * {@link PlayerSettings}) do not exist yet — they are implemented by T018.
 * Therefore this test does not compile, which is the required RED state.
 *
 * <p>Wire-format contract (contracts.md §2 / research.md): all big-number
 * fields are serialized as <strong>strings</strong>, never {@code double} or
 * {@code long}. These tests lock that contract in.
 */
class GameStateRoundTripTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void gameState_roundTripsIdentically_throughJson() throws Exception {
        GameState original = SampleStates.populated();

        String json = mapper.writeValueAsString(original);
        GameState roundTripped = mapper.readValue(json, GameState.class);

        assertThat(roundTripped).usingRecursiveComparison().isEqualTo(original);
    }

    @Test
    void bigNumberFieldsRemainStrings_afterRoundTrip() throws Exception {
        GameState original = SampleStates.populated();

        String json = mapper.writeValueAsString(original);
        GameState roundTripped = mapper.readValue(json, GameState.class);

        // Numeric-integrity contract: loc MUST stay a String (not parsed to a
        // double/long), and the exact value must survive unaltered.
        assertThat(roundTripped.getResources().getLoc())
                .asString()
                .isEqualTo("9007199254740993");
    }

    @Test
    void activeBurnerNull_roundTrips() throws Exception {
        GameState original = SampleStates.withNoActiveBurner();

        String json = mapper.writeValueAsString(original);
        GameState roundTripped = mapper.readValue(json, GameState.class);

        assertThat(roundTripped).usingRecursiveComparison().isEqualTo(original);
        assertThat(roundTripped.getActiveBurner()).isNull();
    }

    @Test
    void emptyOwnershipSets_roundTrip() throws Exception {
        GameState original = SampleStates.fresh();

        String json = mapper.writeValueAsString(original);
        GameState roundTripped = mapper.readValue(json, GameState.class);

        assertThat(roundTripped).usingRecursiveComparison().isEqualTo(original);
        assertThat(roundTripped.getOwnedProducers()).isEmpty();
        assertThat(roundTripped.getOwnedUpgrades()).isEmpty();
        assertThat(roundTripped.getOwnedTrainings()).isEmpty();
        assertThat(roundTripped.getEarnedMilestones()).isEmpty();
    }
}
