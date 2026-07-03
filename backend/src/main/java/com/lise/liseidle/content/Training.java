package com.lise.liseidle.content;

/**
 * A lise Academy training — a permanent production boost (data-model.md
 * "Training"). Once bought, {@code permanentMultiplier} always applies.
 *
 * <p>{@code prerequisite} gates the purchase (nullable when always available).
 * Field names match the frontend's {@code Training} in {@code types.ts}.
 *
 * <p><b>(003) {@code durationSeconds}</b> is the optional run duration of a
 * timed training (003 data-model §2): {@code null} (absent in JSON) or
 * {@code 0} keeps the Spec 001 instant-purchase behavior (FR-016 backward
 * compatibility); a nonzero value makes the training a visible timed job
 * (US3). Nullable {@code Double} so pre-003 content files stay valid
 * unchanged; the frontend loader treats a served {@code null} as absent.
 *
 * @param id                   unique id
 * @param name                 display name
 * @param description          flavor text (lise Academy course)
 * @param cost                 purchase cost
 * @param permanentMultiplier  multiplies base production (persists)
 * @param prerequisite         gating requirement, or null
 * @param durationSeconds      (003) optional run duration in seconds, or null
 */
public record Training(
        String id,
        String name,
        String description,
        Cost cost,
        double permanentMultiplier,
        Requirement prerequisite,
        Double durationSeconds) {
}
