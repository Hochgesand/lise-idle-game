package com.lise.liseidle.presence;

/**
 * Wire view of a {@link PresenceRecord} carrying <b>exactly</b> the FR-004
 * field allowlist (contracts &sect;2 {@code PresenceRecord}; data-model.md
 * "PresenceRecord"). This is the shape exposed to viewers on the REST snapshot
 * ({@code GET /api/v1/presence} {@code self}/{@code colleagues}) and on the
 * STOMP broadcast ({@code /topic/presence} {@code presence.update.record}).
 *
 * <p><b>Why a dedicated view (not the domain record):</b> the domain
 * {@link PresenceRecord} carries a live-tier-only {@code leaseExpiresAt} that
 * MUST NOT be exposed to clients (FR-004 &mdash; "no field beyond the allowlist
 * may be exposed"), and its {@link PresenceRecord.Status} enum must serialize as
 * the wire strings {@code "live"} / {@code "last_seen"} (FR-006/023), not the
 * Java enum name. {@link PresenceRecord}'s javadoc delegates exactly this
 * mapping to the service/controller layer (T059); this view is that mapping.
 * The {@link PresenceRecord.Commute} projection is reused verbatim (it already
 * serializes to {@code fromOffice}/{@code toOffice}/{@code startedAt}).
 *
 * <p>Java record (immutable, canonical constructor). No explicit {@code getX()}
 * accessors are needed: the components are read by Jackson via the canonical
 * accessors and the nested-commute accessors already expose the JavaBean names.
 *
 * @param colleagueId the social key (Keycloak {@code sub})
 * @param displayName what colleagues see (data-model PlayerIdentity)
 * @param avatar      assigned avatar sprite id
 * @param office      office id, or {@code null} while commuting
 * @param activity    current/last-known client-derived activity label
 * @param commute     in-progress commute projection, {@code null} unless commuting
 * @param status      {@code "live"} or {@code "last_seen"} (FR-006/023)
 * @param lastSeenAt  server-stamped ISO-8601 (every heartbeat / on expiry)
 */
public record PresenceRecordView(
        String colleagueId,
        String displayName,
        String avatar,
        String office,
        String activity,
        PresenceRecord.Commute commute,
        String status,
        String lastSeenAt) {

    /** Wire value for {@link PresenceRecord.Status#LIVE} (FR-023 green avatar). */
    static final String STATUS_LIVE = "live";

    /** Wire value for {@link PresenceRecord.Status#LAST_SEEN} (FR-023 red avatar). */
    static final String STATUS_LAST_SEEN = "last_seen";

    /**
     * Project a domain {@link PresenceRecord} onto the FR-004 allowlist view
     * (dropping {@code leaseExpiresAt} and mapping the status enum to its wire
     * string).
     *
     * @param record the domain record (live or last-seen)
     * @return the wire view
     */
    static PresenceRecordView of(PresenceRecord record) {
        return new PresenceRecordView(
                record.colleagueId(),
                record.displayName(),
                record.avatar(),
                record.office(),
                record.activity(),
                record.commute(),
                record.status() == PresenceRecord.Status.LIVE ? STATUS_LIVE : STATUS_LAST_SEEN,
                record.lastSeenAt());
    }
}
