package com.lise.liseidle.content;

/**
 * The cost to purchase a producer, upgrade, or training (data-model.md "Cost").
 *
 * <p>{@code resource} is one of {@code "loc"}, {@code "cash"}, {@code "aiTokens"}
 * (the shared {@code ResourceType} enum, kept as a loose string here so the
 * wire format matches the frontend's {@code types.ts}); {@code amount} is a
 * big-number <strong>string</strong> (never {@code double}) per contracts.md §2
 * and the constitution's numeric-integrity constraint.
 *
 * <p>This is a Java record: Jackson 3 serializes/deserializes it natively from
 * the canonical components, matching the frontend field names exactly.
 *
 * @param resource the resource to spend ("loc" | "cash" | "aiTokens")
 * @param amount   how much, as a big-number string
 */
public record Cost(String resource, String amount) {
}
