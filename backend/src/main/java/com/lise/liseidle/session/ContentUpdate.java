package com.lise.liseidle.session;

/**
 * A push-only server&rarr;client message signalling that game content has been
 * updated and the client should re-fetch {@code /api/v1/content}
 * (contracts.md §3).
 *
 * <p>Serialized by Jackson as
 * {@code {"type":"content.update", "contentVersion":"1.0.0"}}.
 *
 * <p>Use the {@link #update(String)} factory to stamp the {@code type}
 * discriminator automatically.
 *
 * @param type           the discriminator; always {@code "content.update"}
 * @param contentVersion the new content version the client should fetch
 */
public record ContentUpdate(String type, String contentVersion) {

    /** The wire discriminator for this message type. */
    public static final String TYPE = "content.update";

    /**
     * Build a {@link ContentUpdate} with the type discriminator stamped.
     *
     * @param contentVersion the new content version
     * @return an update message ready to push
     */
    public static ContentUpdate update(String contentVersion) {
        return new ContentUpdate(TYPE, contentVersion);
    }
}
