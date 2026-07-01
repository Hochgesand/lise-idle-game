package com.lise.liseidle.content;

import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/**
 * Loads the versioned game content from the bundled classpath JSON files
 * ({@code classpath:content/*.json}) into a typed {@link ContentCatalog}.
 *
 * <p>Content is immutable per version and bundled in the JAR, so it is loaded
 * exactly once at startup ({@link #init() @PostConstruct}) and cached. The
 * catalog is then served by the {@code ContentController} (T020) and is the
 * single source of truth for balance (Constitution Principle II).
 *
 * <p><b>Fail-fast:</b> a missing or malformed content file is essential — the
 * game must never run with half-parsed balance data (Constitution Principle II
 * / frontend {@code ContentValidationError}). Such failures throw an
 * {@link IllegalStateException} during context initialization, surfacing the
 * problem at startup rather than at request time.
 *
 * <p>Until real content is seeded (T037/T043/T050) the files are valid empty
 * arrays ({@code []}); the loader produces a valid empty catalog with
 * {@code schemaVersion = 1} and {@code contentVersion = "0.0.0"}.
 */
@Component
public class ContentLoader {

    /** Content-format schema version (constant until a breaking change). */
    static final int SCHEMA_VERSION = 1;

    /** Balance version — bumped to 1.0.0 with the first real content (T037). */
    static final String CONTENT_VERSION = "1.0.0";

    private final ObjectMapper objectMapper;

    private volatile ContentCatalog catalog;

    public ContentLoader(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Eagerly loads and caches the content catalog during context
     * initialization. If a content file is missing or malformed this throws,
     * failing the application startup fast.
     */
    @PostConstruct
    void init() {
        this.catalog = loadContent();
    }

    /**
     * @return the cached content catalog (loaded once at startup).
     */
    public ContentCatalog getCatalog() {
        return catalog;
    }

    /**
     * Loads the five content files from the classpath and assembles a
     * {@link ContentCatalog}.
     *
     * @return a fully populated content catalog
     * @throws IllegalStateException if any content file is missing or malformed
     */
    public ContentCatalog loadContent() {
        List<Producer> producers = loadList("content/producers.json", Producer.class);
        List<Upgrade> upgrades = loadList("content/upgrades.json", Upgrade.class);
        List<Training> trainings = loadList("content/trainings.json", Training.class);
        List<Milestone> milestones = loadList("content/milestones.json", Milestone.class);
        List<Burner> burners = loadList("content/burners.json", Burner.class);
        return new ContentCatalog(
                SCHEMA_VERSION, CONTENT_VERSION,
                producers, upgrades, trainings, milestones, burners);
    }

    /**
     * Reads a classpath JSON file into a list of the given element type.
     *
     * @param path        the classpath resource path (e.g. "content/producers.json")
     * @param elementType the record class to deserialize each element into
     * @param <T>         the element type
     * @return the parsed list (empty for an empty JSON array)
     * @throws IllegalStateException if the resource is missing or unparseable
     */
    private <T> List<T> loadList(String path, Class<T> elementType) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return objectMapper.readValue(in,
                    objectMapper.getTypeFactory()
                            .constructCollectionType(List.class, elementType));
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException(
                    "Failed to load content resource '" + path
                            + "' — the game cannot start with missing or malformed content",
                    e);
        }
    }
}
