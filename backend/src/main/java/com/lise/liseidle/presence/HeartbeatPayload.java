package com.lise.liseidle.presence;

/**
 * Body of the client&rarr;server {@code /app/presence.heartbeat} frame
 * (contracts &sect;3 "Client &rarr; Server"). Carries <b>no timestamps and no
 * colleagueId</b> &mdash; identity comes exclusively from the STOMP
 * {@link java.security.Principal} (the JWT {@code sub}) and every timestamp is
 * stamped by the server clock on receipt ({@code Instant.now().toString()},
 * house convention).
 *
 * <pre>
 * { "office": "office_1",            // or null while commuting
 *   "activity": "coding",
 *   "commute": { "fromOffice": "office_1", "toOffice": "office_2" }  // or null
 * }
 * </pre>
 *
 * <p>{@code office} and {@code commute} mirror the save's
 * {@code activeOffice}/{@code commute} state (data-model): {@code office} is
 * {@code null} and {@code commute} is set while a commute is in progress.
 * {@code activity} is a client-derived <b>display label</b> (commuting &rarr;
 * {@code "commuting"}, active burner &rarr; {@code "burning tokens"}, else
 * {@code "coding"}) &mdash; never stored in the save. The {@code commute}
 * object carries <b>no {@code startedAt}</b>: the server stamps
 * {@code PresenceRecord.commute.startedAt} on the first heartbeat reporting the
 * transition (contracts &sect;3), so presence timestamps never mix clock
 * domains.
 *
 * @param office   office id, or {@code null} while commuting
 * @param activity client-derived display label
 * @param commute  the in-progress commute, or {@code null}
 */
public record HeartbeatPayload(String office, String activity, CommuteRequest commute) {

    /**
     * The commute portion of a heartbeat body (no {@code startedAt} &mdash; the
     * server stamps the observer-facing transition time; contracts &sect;3).
     *
     * @param fromOffice origin office id
     * @param toOffice   destination office id
     */
    public record CommuteRequest(String fromOffice, String toOffice) {
    }
}
