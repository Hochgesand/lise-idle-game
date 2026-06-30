package com.lise.liseidle.content;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves the versioned game content over REST (contracts.md §2).
 *
 * <p>The single {@code GET /api/v1/content} endpoint returns the cached
 * {@link ContentCatalog} assembled once at startup by {@link ContentLoader}.
 * Content is immutable per {@code contentVersion} and therefore cachable by
 * the client. Spring/Jackson serializes the record to JSON, using the record
 * component names as JSON keys, which match the frontend's
 * {@code ContentCatalog} wire format exactly.
 *
 * <p>This is the data-driven source of truth for balance (Constitution
 * Principle II): the pure frontend {@code advance} sim reads it via the
 * content loader, and changing a balance number never touches control-flow
 * code.
 */
@RestController
@RequestMapping("/api/v1")
public class ContentController {

    private final ContentLoader contentLoader;

    public ContentController(ContentLoader contentLoader) {
        this.contentLoader = contentLoader;
    }

    /**
     * Returns the versioned game content envelope.
     * <p>200 OK, {@code application/json}. The body shape is
     * {@code { schemaVersion, contentVersion, producers, upgrades,
     * trainings, milestones, burners }}.
     *
     * @return the cached content catalog
     */
    @GetMapping("/content")
    public ContentCatalog getContent() {
        return contentLoader.getCatalog();
    }
}
