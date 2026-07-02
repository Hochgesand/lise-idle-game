package com.lise.liseidle.presence;

/**
 * Per-colleague presence &mdash; where they are and whether they are live
 * (data-model.md "PresenceRecord"; wire shape contracts &sect;2). Keyed by
 * {@code colleagueId}, which is what makes duplicate-session collapse
 * structural: any number of concurrent sessions refresh this one record, and a
 * colleague goes last-seen only when <i>all</i> of them stop heartbeating
 * (max-of-heartbeats).
 *
 * <p>This is the in-memory domain record held by {@link PresenceRegistry}; the
 * durable identity / last-seen projection lives in
 * {@link PlayerPresenceEntity}. Fields mirror the contracts &sect;2
 * {@code PresenceRecord} shape: timestamps are ISO-8601 UTC strings (house
 * convention, never numeric epoch), {@code office} is {@code null} while
 * commuting (matches the wire shape), {@code status} drives the green/red
 * avatar state (FR-023), and {@code leaseExpiresAt} is live-tier-only (the
 * bounded lease the server sweep expires). The {@code commute.startedAt} here
 * is the server-stamped observer-facing timestamp (contracts &sect;3) &mdash;
 * distinct from the save's sim-timeline {@code CommuteState.startedAt} (ms).
 *
 * <p>Java record (immutable, canonical constructor) with explicit
 * {@code getX()} accessors so it follows the JavaBean getter convention used by
 * the serialization layer (Jackson 3), matching {@code state/CommuteState}.
 *
 * @param colleagueId   the social key (Keycloak {@code sub}); the registry key
 * @param displayName   what colleagues see (data-model PlayerIdentity)
 * @param avatar        assigned avatar sprite id
 * @param office        office id the colleague is (or was last) in; {@code null} while commuting
 * @param activity      current or last-known client-derived activity label
 * @param commute       in-progress commute projection, {@code null} unless commuting
 * @param status        {@code LIVE} (green) vs {@code LAST_SEEN} (red/desaturated)
 * @param lastSeenAt    server-stamped ISO-8601 (every heartbeat / on expiry)
 * @param leaseExpiresAt live-tier only: last heartbeat + {@code leaseSeconds}
 */
public record PresenceRecord(
        String colleagueId,
        String displayName,
        String avatar,
        String office,
        String activity,
        Commute commute,
        Status status,
        String lastSeenAt,
        String leaseExpiresAt) {

    /**
     * Avatar state: {@code LIVE} (green) vs {@code LAST_SEEN}
     * (red/desaturated) &mdash; FR-023. Serialized as {@code "live"} /
     * {@code "last_seen"} on the wire (contracts &sect;2); the string mapping is
     * a {@code PresenceService}/controller concern (T059), not this record's.
     */
    public enum Status { LIVE, LAST_SEEN }

    /**
     * In-progress commute projection, {@code null} unless commuting
     * (FR-007/022). {@code startedAt} is the server-stamped ISO-8601
     * transition time (contracts &sect;3) &mdash; the server stamps it on the
     * first heartbeat reporting the commute; a client never supplies it.
     */
    public record Commute(String fromOffice, String toOffice, String startedAt) {
        public String getFromOffice() {
            return fromOffice;
        }

        public String getToOffice() {
            return toOffice;
        }

        public String getStartedAt() {
            return startedAt;
        }
    }

    public String getColleagueId() {
        return colleagueId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getAvatar() {
        return avatar;
    }

    public String getOffice() {
        return office;
    }

    public String getActivity() {
        return activity;
    }

    public Commute getCommute() {
        return commute;
    }

    public Status getStatus() {
        return status;
    }

    public String getLastSeenAt() {
        return lastSeenAt;
    }

    public String getLeaseExpiresAt() {
        return leaseExpiresAt;
    }
}
