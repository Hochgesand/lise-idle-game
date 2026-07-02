package com.lise.liseidle.presence;

/**
 * The stored result of {@code PUT /api/v1/presence/settings} (contracts &sect;2)
 * &mdash; {@code { "consentGiven": bool, "visible": bool }} echoed back as the
 * 200 body. A 200 means the settings were stored; a {@code visible:true}
 * without consent is rejected with {@code 409 consent_required} before this is
 * produced (see {@link ConsentRequiredException}).
 *
 * @param consentGiven app-side first-run consent (FR-003)
 * @param visible      appear/hide toggle (FR-003)
 */
public record SettingsResult(boolean consentGiven, boolean visible) {
}
