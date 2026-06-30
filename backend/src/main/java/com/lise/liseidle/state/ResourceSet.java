package com.lise.liseidle.state;

/**
 * The three primary resources of the game, all modeled as big-number
 * <strong>strings</strong> (never {@code double}) per contracts.md §2 and
 * research.md ("Numeric representation across the wire"). Storing them as
 * strings guarantees lossless round-trips across the REST/WebSocket boundary
 * and the DB (Constitution Principle IV — integrity).
 *
 * <p>{@code loc} = Lines of Code (primary production), {@code cash} =
 * spendable value, {@code aiTokens} = accelerator fuel consumed by the burner
 * (see data-model.md "ResourceSet").
 *
 * <p>This is a Java record (immutable, canonical constructor) with explicit
 * {@code getX()} accessors so the DTO follows the JavaBean getter convention
 * used by the serialization layer and the round-trip tests.
 */
public record ResourceSet(String loc, String cash, String aiTokens) {

    public String getLoc() {
        return loc;
    }

    public String getCash() {
        return cash;
    }

    public String getAiTokens() {
        return aiTokens;
    }
}
