package com.lise.liseidle.state;

/**
 * UI preferences (not gameplay) per data-model.md "PlayerSettings".
 * {@code reducedMotion} = accessibility, {@code muted} = audio.
 */
public record PlayerSettings(boolean reducedMotion, boolean muted) {

    public boolean isReducedMotion() {
        return reducedMotion;
    }

    public boolean isMuted() {
        return muted;
    }
}
