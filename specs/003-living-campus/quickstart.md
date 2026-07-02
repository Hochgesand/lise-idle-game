# Quickstart & Validation: Living Campus — Player Character, Activities on the Map, Visible Timed Jobs

**Feature**: `003-living-campus` | **Date**: 2026-07-02 | **Spec**: [spec.md](spec.md)

Manual browser validation scenarios, run against the local dev stack
(`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`, or Vite
dev server on `:5173` + compose backend — see the 002 quickstart
prerequisites) and, at the per-phase deploy tasks, against prod
(`https://lise-game.schmitz.gg`). Scenario ↔ story mapping is noted per
heading; the phase deploy task in tasks.md lists which scenarios it must run.

## Prerequisites

- The 002 stack is up (campus renders, DOM overlay works, presence available
  when signed in). 003 requires **no** new services, env vars, or endpoints.
- For signed-in checks: the 002 realm test users `alice`/`bob`
  (password `postit`).
- For crowd checks: the 002 dev seeder
  (`POST /api/v1/dev/presence/seed`, dev profile only).
- For fast timed-job checks on dev: temporarily set a small
  `durationSeconds` (e.g. 15) on one training in
  `backend/src/main/resources/content/trainings.json` — a content-only
  change, which is itself part of the point (FR-021).
- Two devices/viewports: desktop and phone portrait 375×812 (device or
  devtools emulation).

---

## Scenario 1 — The Player Exists, Offline and Signed Out (US1) 🎯

*Backs FR-001/002/003, SC-005, SC-007.*

1. Open the game in a fresh browser profile (no save, signed out). Optional
   stronger variant: load the page, then set the browser offline
   (devtools → Network → Offline) before interacting.
2. **Verify**: the campus renders and a player avatar sits at a desk in
   Office #1 — visually distinct (highlight ring, distinct styling) and
   labeled **"Du"**.
3. Reload. **Verify**: the avatar sits at the **same** desk (deterministic
   seat).
4. Import/restore an existing v2 (002) save (or play on a profile that has
   one). **Verify**: it loads cleanly, resources and progress intact, and
   the player avatar appears — nothing else changed (v2→v3 migration is
   invisible).
5. Sign in as `alice`. **Verify**: the label switches from "Du" to Alice's
   display name; the seat does not change; sign out → label returns to "Du".

## Scenario 2 — Find Me (US1)

*Backs FR-005, SC-001.*

1. Pan the camera far away from the player's office and zoom fully out.
2. Tap/click the **find-me** affordance in the HUD.
3. **Verify**: the camera centers on the player avatar at a zoom where its
   label renders persistently; total time under ~2 s.
4. Repeat on the phone (375×812) with a touch tap. **Verify**: the affordance
   is reachable one-handed and ≥ 44 px.
5. Enable reduced motion (OS setting or in-game toggle). Repeat. **Verify**:
   instant jump instead of a glide; same end state.

## Scenario 3 — My Own Commute (US1)

*Backs FR-004, SC-002.*

1. With Office #2 unlocked (or a save that has it), trigger **switch office**
   from the overlay.
2. **Verify**: the player avatar leaves the desk and travels the street/tram
   commute route toward the other building — no teleport; find-me during the
   commute centers on the moving avatar.
3. **Verify**: on arrival (after `coop.commuteSeconds`), the avatar sits at a
   desk in the destination office.
4. Two-browser variant (signed in as `alice`, observer as `bob`): **verify**
   Bob sees Alice's avatar commuting on the same route over the same span the
   player herself sees (002 Scenario 7 correspondence).
5. Offline variant: switch office, immediately close the tab, reopen after
   the commute duration. **Verify**: the avatar is seated in the destination
   office (commute resolved by `advance` during the offline span — 002
   behavior, now visible on your own body).

## Scenario 4 — Seats Never Collide (US1 edge case)

*Backs FR-003.*

1. On the dev stack, seed a crowd into the player's office:
   `POST /api/v1/dev/presence/seed {"live": 25, "office": "office_1"}`.
2. **Verify**: no colleague renders on the player's seat; the player avatar
   remains distinct and unoccluded; overflow colleagues use standing spots as
   in 002.
3. Clear the seed (`DELETE /api/v1/dev/presence/seed`). **Verify**: the
   player avatar is unaffected.

## Scenario 5 — Tap a Station, Walk, Panel Opens (US2)

*Backs FR-007/008/009/010, SC-003.*

1. Zoom into the active office. **Verify**: station markers are visible at
   the spec's rooms — Academy in `skier`, burner at the Break Room coffee
   point, cash-out in the `Office` — plus the player's own desk (boost).
2. Tap the **cash-out** station. **Verify**: the player avatar walks there
   over the data-driven duration (~2 s) and the economy panel opens on
   arrival, scrolled/focused to cash-out.
3. Perform a cash-out. **Verify**: exact Spec 001 semantics (LOC decreases,
   cash increases by the same amounts as before this feature).
4. Close the panel. **Verify**: the overlay returns to HUD-only (FR-014);
   the avatar stays at/near the station until the next interaction.
5. Tap the **Academy** station. **Verify**: walk + Academy panel on arrival.
6. Tap the player's **own desk**. **Verify**: the avatar walks back and the
   manual boost fires on arrival (float text, LOC grant — no panel).
7. Phone portrait: repeat step 2. **Verify**: markers tappable (≥ 44 px
   effective), the panel opens as a bottom sheet, and the world stays
   visible above it.

## Scenario 6 — Walk Interruption & Reduced Motion (US2 edge cases)

*Backs FR-011/012.*

1. Tap the Academy station; **mid-walk**, tap the cash-out station.
2. **Verify**: the avatar retargets from its current position (latest tap
   wins); the Academy panel never opens; the economy panel opens on arrival.
3. Tap a station; mid-walk, trigger **switch office**. **Verify**: the walk
   cancels, no panel opens, the commute proceeds normally.
4. Rapid-tap three different stations within a second. **Verify**: exactly
   one walk (to the last), exactly one panel at the end.
5. Enable reduced motion; tap a station. **Verify**: the panel opens
   promptly without the walk animation (outcome preserved).

## Scenario 7 — Fallback Menu & On-Demand Panels (US2, accessibility)

*Backs FR-013/014, SC-009.*

1. From the default view, open the **fallback list menu** from the HUD.
2. **Verify**: every activity (Academy, burner, cash-out, boost, social) is
   listed; selecting one opens its panel directly — no walking.
3. Keyboard-only pass (desktop): Tab to the menu button, Enter to open,
   arrow/Tab through entries, Enter to open the Academy panel, Escape/close
   control to dismiss. **Verify**: full loop with no pointer; focus order is
   sane; controls carry accessible names.
4. **Verify**: any activity whose station is in the *other* building (e.g.
   Academy while based in Office #2) opens via the menu without a commute.
5. **Verify**: no panel is open on a fresh load (HUD-only default), and at
   most one activity panel is open at a time.

## Scenario 8 — Visible Burner Run (US3)

*Backs FR-015.*

1. Acquire AI tokens and activate the burner (via its station or the menu).
2. **Verify**: a progress indicator renders above the burner station,
   visibly draining as fuel burns; it matches the fuel-remaining figure in
   the economy panel.
3. Let the fuel run out. **Verify**: the indicator disappears; no stale bar.
4. Close the game mid-burn; reopen after the burn would have ended.
   **Verify**: no indicator; the offline credit matches Spec 001 burner math.

## Scenario 9 — Timed Training, Online (US3)

*Backs FR-016/017/019/020.*

1. On dev content with a short-duration training (see prerequisites), open
   the Academy and start it. **Verify**: the cost is deducted immediately;
   the current LOC rate does **not** yet include the training's multiplier.
2. **Verify**: a progress indicator renders above the Academy station and the
   player avatar relocates to the Academy (occupied) for the duration.
3. While it runs: manual boost, cash out, buy an upgrade, activate the
   burner, and switch offices. **Verify**: all work normally (never
   hard-gated); starting a **second** training is unavailable with a clear
   state (FR-020).
4. On completion: **verify** the avatar returns to its desk (or its
   destination-office desk if you commuted), the indicator clears, the
   training appears as owned, and the LOC rate now includes its multiplier.
5. Trainings without a duration: **verify** they purchase instantly, exactly
   as before (FR-016 backward compatibility).

## Scenario 10 — Timed Training, Offline Completion (US3) 🎯

*Backs FR-018, SC-004 — the determinism proof.*

1. Note current LOC and rate. Start the short training, then immediately
   close the tab.
2. Wait clearly past the training's end (e.g. duration + 60 s). Reopen.
3. **Verify**: the training is complete and owned; the offline LOC credit
   reflects the base rate up to the completion point and the boosted rate
   after it (visibly more than a no-training baseline over the same span,
   less than a full-span boost).
4. Determinism replay: export/copy the save (localStorage) before reopening
   in step 2 if you want the strong form — load the same save twice with the
   same wall-clock gap and **verify** identical resources both times.
5. Load-mid-training variant: close the tab *during* the run, reopen
   *before* the end. **Verify**: the indicator resumes at the correct
   progress and the avatar is occupied at the Academy.

## Scenario 11 — Regression: 001/002 Untouched (cross-cutting)

*Backs SC-007/008, FR-023.*

1. Anonymous, offline: full Spec 001 loop (boost, cash-out, upgrades,
   burner, academy via menu) works.
2. Signed in as `alice` with `bob` present: presence avatars, co-op bonus
   badge, and hide-me behave exactly per the 002 quickstart (spot-check its
   Scenarios 1, 3, 4).
3. Backend down (stop the container): solo play + "social offline" badge;
   the player avatar, stations, walks, and timed jobs all still work
   (003 is offline-complete).
4. **Verify** the full frontend suite is green (`cd frontend && npx vitest
   run`) and the backend suite likewise (`cd backend && ./mvnw test`).

## Scenario 12 — Phone Portrait & Performance (cross-cutting)

*Backs FR-024, SC-006.*

1. Phone portrait 375×812, dev stack, seed `{"live": 30, "lastSeen": 20}`.
2. **Verify**: 60 fps feel while panning/zooming with the player avatar, all
   station markers, and an active burner + training indicator rendered
   (devtools performance overlay for the strong form).
3. **Verify**: find-me, a station walk + panel, and the fallback menu are
   all usable one-handed; nothing overlaps the HUD unusably.

## Cross-cutting checks (run during every scenario)

- No console errors; no failed requests besides deliberate offline tests.
- The save never resets or loses fields (inspect
  `localStorage` — `schemaVersion: 3`, `activeTraining` present).
- Reduced motion honored wherever motion exists (walks, camera, indicators,
  occupation transitions).
- Nothing here requires sign-in: every 003 affordance must be demonstrable
  in an anonymous session.
