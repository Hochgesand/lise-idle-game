package com.lise.liseidle.presence;

import com.lise.liseidle.content.ContentLoader;
import com.lise.liseidle.content.CoopConfig;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Dev-only presence seeder (T066): fills the in-memory registry with synthetic
 * colleagues so the campus world and the co-op tuning can be exercised locally
 * without two real browsers (quickstart Scenarios 4, 7, 8). <b>Never loaded in
 * prod</b> &mdash; {@link Profile}({@code "dev"}) keeps the bean (and its
 * endpoints) absent outside the dev profile, and {@code SecurityConfig} permits
 * {@code /api/v1/dev/**} <i>only</i> under that profile.
 *
 * <p>Two endpoints, both callable <b>without a bearer</b> under the dev profile
 * (contracts &sect;2; T030):
 * <ul>
 *   <li>{@code POST /api/v1/dev/presence/seed} with
 *       {@code { "live": n, "lastSeen": n, "commuting": n, "office": "office_1"? }}
 *       &mdash; creates the synthetic colleagues in the registry with matching
 *       {@code player_presence} rows (consented + visible so they appear in
 *       snapshots/broadcasts). {@code live} entries are {@code LIVE} with a
 *       fresh lease ({@code now + leaseSeconds}) so the normal
 *       {@code @Scheduled} sweep ages them out after one lease (they send no
 *       heartbeats); {@code lastSeen} entries are {@code LAST_SEEN}; commuting
 *       entries are {@code LIVE} with {@code office=null} and a commute set.
 *       When {@code office} is given every colleague is placed there
 *       (single-building); otherwise they are distributed across the two
 *       offices.</li>
 *   <li>{@code DELETE /api/v1/dev/presence/seed} &mdash; clears every
 *       synthetic colleague this seeder created (registry + rows).</li>
 * </ul>
 *
 * <p>Synthetic ids are deterministic ({@code dev-seed-<n>}) and tracked in a
 * {@link ConcurrentHashMap} key set so {@code DELETE} removes only synthetic
 * colleagues, never a real signed-in one. The seeder holds no authority over
 * any real player's state &mdash; it only adds/removes its own synthetic
 * records (FR-008).
 *
 * <p><b>Ephemeral scope.</b> The dev profile runs an in-memory H2 database
 * (T006), so both the registry and the {@code player_presence} rows are
 * ephemeral and clear together on a backend restart &mdash; there are no
 * orphaned rows to leak. The seeder targets the seed-then-load flow (page load
 * reads {@code GET /api/v1/presence}); it does not push {@code presence.update}/
 * {@code presence.remove} on seed/clear, so an already-open browser must re-fetch
 * the snapshot to see changes (real-time avatar transitions are not its job).
 */
@RestController
@Profile("dev")
@RequestMapping("/api/v1/dev/presence/seed")
public class DevPresenceSeeder {

    /** Offices synthetic colleagues are distributed across when none is requested. */
    private static final String[] OFFICES = {"office_1", "office_2"};

    private final PresenceRegistry registry;
    private final PresenceRepository repository;
    private final CoopConfig coop;

    /** Monotonic counter for deterministic synthetic ids. */
    private final AtomicInteger counter = new AtomicInteger();

    /** The synthetic ids this seeder has created (so DELETE clears only these). */
    private final Set<String> seededIds = ConcurrentHashMap.newKeySet();

    public DevPresenceSeeder(PresenceRegistry registry, PresenceRepository repository,
                             ContentLoader contentLoader) {
        this.registry = registry;
        this.repository = repository;
        this.coop = contentLoader.getCatalog().coop();
    }

    /** {@code POST /api/v1/dev/presence/seed} body (all optional; default 0 / null). */
    record SeedRequest(Integer live, Integer lastSeen, Integer commuting, String office) {
    }

    /** Response echoing the applied counts + the synthetic ids created/removed. */
    record SeedResponse(int live, int lastSeen, int commuting, String office, List<String> seeded) {
    }

    /**
     * Seed synthetic colleagues into the registry.
     *
     * @param request the seed request (nullable; null/absent counts default to 0)
     * @return the applied counts + the synthetic ids created
     */
    @PostMapping
    public SeedResponse seed(@RequestBody(required = false) SeedRequest request) {
        SeedRequest req = request != null ? request : new SeedRequest(0, 0, 0, null);
        int live = orZero(req.live());
        int lastSeen = orZero(req.lastSeen());
        int commuting = orZero(req.commuting());
        String singleOffice = (req.office() != null && !req.office().isBlank()) ? req.office() : null;

        Instant now = Instant.now();
        String leaseExpiresAt = now.plusSeconds(coop.leaseSeconds()).toString();
        List<String> ids = new ArrayList<>();
        int idx = 0;

        for (int i = 0; i < live; i++) {
            ids.add(seedSynthetic(office(idx++, singleOffice), "coding", null,
                    PresenceRecord.Status.LIVE, now, leaseExpiresAt));
        }
        for (int i = 0; i < lastSeen; i++) {
            ids.add(seedSynthetic(office(idx++, singleOffice), "coding", null,
                    PresenceRecord.Status.LAST_SEEN, now, null));
        }
        for (int i = 0; i < commuting; i++) {
            PresenceRecord.Commute commute = new PresenceRecord.Commute(
                    "office_1", "office_2", now.toString());
            ids.add(seedSynthetic(null, "commuting", commute,
                    PresenceRecord.Status.LIVE, now, leaseExpiresAt));
        }

        return new SeedResponse(live, lastSeen, commuting, singleOffice, ids);
    }

    /**
     * Clear every synthetic colleague this seeder created.
     *
     * @return the removed synthetic ids
     */
    @DeleteMapping
    public SeedResponse clear() {
        List<String> removed = new ArrayList<>(seededIds);
        for (String id : removed) {
            registry.remove(id);
            repository.findById(id).ifPresent(repository::delete);
        }
        seededIds.clear();
        return new SeedResponse(0, 0, 0, null, removed);
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private static int orZero(Integer n) {
        return n != null ? n : 0;
    }

    /** Distributed office (round-robin) unless a single office was requested. */
    private static String office(int idx, String singleOffice) {
        return singleOffice != null ? singleOffice : OFFICES[idx % OFFICES.length];
    }

    /**
     * Create one synthetic colleague: a {@code LIVE}/{@code LAST_SEEN} registry
     * record plus a consented+visible {@code player_presence} row, registering
     * the id for {@link #clear()}.
     */
    private String seedSynthetic(String office, String activity, PresenceRecord.Commute commute,
                                 PresenceRecord.Status status, Instant now, String leaseExpiresAt) {
        int n = counter.incrementAndGet();
        String id = "dev-seed-" + n;
        String name = "Seed " + n;
        String avatar = String.valueOf(Math.floorMod(id.hashCode(), PresenceService.AVATAR_FRAME_COUNT));

        PlayerPresenceEntity row = new PlayerPresenceEntity(id);
        row.setDisplayName(name);
        row.setAvatar(avatar);
        row.setOffice(office);
        row.setActivity(activity);
        row.setLastSeenAt(now.toString());
        row.setConsentGiven(true);
        row.setVisible(true);
        repository.save(row);

        registry.upsert(new PresenceRecord(
                id, name, avatar, office, activity, commute,
                status, now.toString(), leaseExpiresAt));

        seededIds.add(id);
        return id;
    }
}
