package com.lise.liseidle.state;

/**
 * Represents an active AI-token burner (data-model.md "BurnerState").
 *
 * <p>{@code definitionId} references a {@code Burner} content definition;
 * {@code startedAt} is an ISO-8601 timestamp; {@code fuelRemaining} is a
 * big-number string (tokens left to burn). The field type is {@code String}
 * for wire-format fidelity (big numbers as strings everywhere).
 */
public record BurnerState(String definitionId, String startedAt, String fuelRemaining) {

    public String getDefinitionId() {
        return definitionId;
    }

    public String getStartedAt() {
        return startedAt;
    }

    public String getFuelRemaining() {
        return fuelRemaining;
    }
}
