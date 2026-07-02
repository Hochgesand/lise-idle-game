package com.lise.liseidle.content;

import java.util.List;

/**
 * The typed, validated game-content aggregate (contracts.md §2). This is the
 * object assembled by {@link ContentLoader} from the five classpath JSON files
 * and served by the {@code ContentController} (T020) as the
 * {@code GET /api/v1/content} response envelope.
 *
 * <p>{@code schemaVersion} is the content-format version (constant {@code 1}
 * until real content is seeded in T037/T043/T050); {@code contentVersion} is
 * the human-readable balance version (defaults to {@code "0.0.0"} for the
 * empty placeholder arrays). The five lists hold producers, upgrades,
 * trainings, milestones, and burners respectively.
 *
 * <p>Field names match the frontend's {@code ContentCatalog} in
 * {@code types.ts} exactly, so the served JSON is the shared contract.
 *
 * @param schemaVersion  content-format version
 * @param contentVersion balance version string
 * @param producers      sources of LOC/sec
 * @param upgrades       purchasable multipliers / modifiers
 * @param trainings      lise Academy permanent boosts
 * @param milestones     long-term credential goals + rewards
 * @param burners        AI-token accelerator definitions
 * @param coop           (002) co-op bonus tuning block (data-model.md "CoopConfig"; FR-015)
 */
public record ContentCatalog(
        int schemaVersion,
        String contentVersion,
        List<Producer> producers,
        List<Upgrade> upgrades,
        List<Training> trainings,
        List<Milestone> milestones,
        List<Burner> burners,
        CoopConfig coop) {
}
