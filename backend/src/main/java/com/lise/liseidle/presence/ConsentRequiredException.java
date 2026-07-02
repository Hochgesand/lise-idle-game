package com.lise.liseidle.presence;

/**
 * Signals that a {@code PUT /api/v1/presence/settings} requested
 * {@code visible: true} without consent (contracts &sect;2; FR-003). The
 * {@code PresenceController} maps it to {@code 409} {@code consent_required}.
 */
public class ConsentRequiredException extends RuntimeException {

    /** Constructs a {@code consent_required} exception. */
    public ConsentRequiredException() {
        super("Visibility requires consent (consent_required).");
    }
}
