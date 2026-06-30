package com.lise.liseidle.content;

/**
 * A predicate gating an unlock or milestone (data-model.md "Requirement").
 *
 * <p>{@code type} is one of {@code "resourceGte"}, {@code "ownsProducer"},
 * {@code "ownsUpgrade"}, {@code "ownsTraining"}, {@code "ownsMilestone"}
 * (the frontend's {@code RequirementType}). {@code targetId} references a
 * content id for the {@code owns-*} types (nullable for {@code resourceGte});
 * {@code threshold} is a big-number <strong>string</strong> used by
 * {@code resourceGte} (nullable otherwise).
 *
 * <p>Both {@code targetId} and {@code threshold} are nullable to match the
 * frontend's discriminated-union wire format. Jackson 3 deserializes this
 * record natively, defaulting absent fields to {@code null}.
 *
 * @param type      the requirement type
 * @param targetId  id ref for owns-* types, else null
 * @param threshold big-number string for resourceGte, else null
 */
public record Requirement(String type, String targetId, String threshold) {
}
