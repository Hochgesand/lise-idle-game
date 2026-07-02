package com.lise.liseidle.presence;

import java.util.List;

/**
 * The {@code GET /api/v1/presence} snapshot body (contracts &sect;2
 * "GET /api/v1/presence"). One read on load delivers the whole visible office
 * population (SC-001); live deltas then arrive via STOMP
 * ({@code /topic/presence}, contracts &sect;3).
 *
 * <p>Serialized by Jackson as
 * {@code {"serverTime":"...", "self": PresenceRecordView|null, "colleagues":[ PresenceRecordView... ]}}.
 * {@code self} is the viewer's own record, echoed even while hidden (so the UI
 * can show own status); {@code colleagues} lists every <b>visible</b> colleague
 * (hidden/un-consented filtered server-side, FR-009), self excluded. Each entry
 * is the FR-004 allowlist {@link PresenceRecordView}.
 *
 * @param serverTime ISO-8601 server instant the snapshot is authoritative as of
 * @param self        the viewer's own record (echoed even while hidden), or a minimal record
 * @param colleagues  one {@link PresenceRecordView} per VISIBLE colleague, self excluded
 */
public record PresenceSnapshot(String serverTime, PresenceRecordView self,
                               List<PresenceRecordView> colleagues) {
}
