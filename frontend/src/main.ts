// T036 — End-to-end US1 wiring: the shippable MVP entry point.
//
// Boots the full game per quickstart.md Scenario 1:
//   new player starts at zero → fetch content → start loop → render office →
//   save on close/periodically → restore on reload.
//
// On load, offline progress is caught up via `advance(state, elapsedDt)`.
// A fresh player is granted `manual_typing` (free starter producer) so LOC
// grows from t=0.
//
// ## Constitution compliance
// - This is the ONLY module allowed to touch the wall clock (Date.now()),
//   localStorage, and the network. The pure sim (advance/actions/content) is
//   called here but its modules contain no side effects.
// - Offline-capable (Constitution IV): all network calls are best-effort; the
//   local localStorage save is authoritative for play. The game boots and runs
//   even if the backend is totally unreachable.
// - Big numbers stay strings end-to-end (never double).
//
// ## Loop-driver choice
// A thin `ControllerScene` (defined below) drives the game-loop tick via its
// `update(time)` — this avoids modifying OfficeScene (T034) or HudScene (T035)
// while ensuring the tick runs every frame. The controller launches both
// scenes as parallel overlays.

import Phaser from 'phaser';
import type { ContentCatalog, ContentEnvelope, GameState } from './sim/types';
import { loadContent } from './sim/content';
import { manualBoost } from './sim/actions';
import { bn, compare } from './sim/bigNumber';
import { GameLoop } from './game/gameLoop';
import { prepareInitialState } from './game/prepareState';
import { FALLBACK_CONTENT } from './sim/fallbackContent';
import { loadGame, saveGame, createInitialState } from './save/localStorage';
import { restClient } from './net/restClient';
import { stompClient } from './net/stompClient';
import { OfficeScene } from './scenes/OfficeScene';
import { HudScene } from './scenes/HudScene';

// ── Module-level mutable state (the single source of truth for the app) ────

/**
 * The live game state. Written by the game loop (each tick) and action
 * mutators (boost), read by the HUD. This is the authoritative in-memory copy;
 * localStorage + backend are best-effort persistence layers.
 */
let state: GameState = createInitialState();

/**
 * The validated content catalog. Starts as the bundled `FALLBACK_CONTENT`
 * (mirroring the backend's producers.json) so the game produces LOC from the
 * very first tick — even before the backend fetch resolves, and even if the
 * backend is completely unreachable (Constitution IV — offline-capable core).
 * Replaced with served content once the fetch succeeds.
 */
let content: ContentCatalog = FALLBACK_CONTENT;

/** The game loop orchestrator (constructed during boot). */
let loop: GameLoop;

// ── Player ID management ──────────────────────────────────────────────────

const PLAYER_ID_KEY = 'lise-player-id';

/**
 * Get or create the anonymous player ID (stored in localStorage). Generates a
 * fresh UUID on first boot. If localStorage is unavailable (private mode,
 * disabled), returns an ephemeral UUID (the backend sync simply won't persist
 * across sessions — non-fatal, local save is authoritative).
 */
function getOrCreatePlayerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// ── Content fetching (best-effort, offline-capable) ────────────────────────

/**
 * Fetch + validate game content from the backend. On success, updates the
 * module-level `content`. On failure (backend unreachable, malformed JSON),
 * logs a warning and keeps the empty fallback — the game stays playable
 * (Constitution IV — offline-capable core).
 */
async function fetchContent(): Promise<void> {
  try {
    const envelope: ContentEnvelope = await restClient.getContent();
    content = loadContent(envelope);
  } catch (err) {
    console.warn(
      '[main] Content fetch failed — using bundled fallback content. The game is fully playable offline.',
      err,
    );
  }
}

// ── Backend sync (best-effort) ─────────────────────────────────────────────

/**
 * Best-effort: save the current state to the backend. Failures are logged but
 * never fatal — the local localStorage save is authoritative for play.
 */
async function syncToBackend(): Promise<void> {
  try {
    const playerId = getOrCreatePlayerId();
    await restClient.saveState(playerId, state, new Date().toISOString());
  } catch (err) {
    console.warn('[main] Backend sync failed — local save is authoritative.', err);
  }
}

/**
 * Best-effort: load a server save. If the server has a state with MORE progress
 * (higher LOC) than the local save, adopt it (handles "played on another
 * device"). Otherwise keep the local save. Never reduces progress
 * (Constitution IV — never silently destroy progress).
 */
async function loadFromBackend(): Promise<void> {
  try {
    const playerId = getOrCreatePlayerId();
    const serverState = await restClient.loadSession(playerId);
    if (serverState !== null) {
      // Adopt server state only if it has strictly more LOC (more progress).
      if (compare(bn(serverState.resources.loc), bn(state.resources.loc)) > 0) {
        state = serverState;
        loop.load(state, Date.now());
        saveGame(state);
      }
    }
  } catch {
    // Backend unreachable — local save is authoritative. Non-fatal.
  }
}

// ── STOMP live channel (best-effort) ───────────────────────────────────────

/**
 * Connect the STOMP push-only channel (advisory corrections + content updates).
 * Failures are non-fatal — the game stays playable without it.
 */
function connectStomp(): void {
  try {
    stompClient.connect({
      onStateCorrection: (newState, _reason) => {
        // Replace local state with the authoritative merged state + re-anchor.
        state = newState;
        loop.load(state, Date.now());
        saveGame(state);
      },
      onContentUpdate: async (_version) => {
        await fetchContent();
      },
    });
  } catch (err) {
    console.warn('[main] STOMP connection failed — push channel disabled.', err);
  }
}

// ── Controller scene (drives the game-loop tick each frame) ────────────────

/**
 * A thin controller Phaser scene. It does NOT render anything itself — it
 * launches OfficeScene (the office) and HudScene (the overlay) as parallel
 * scenes, and its `update(time)` drives the game-loop tick.
 *
 * This is the cleanest integration point: it avoids modifying OfficeScene
 * (T034) or HudScene (T035) while ensuring the loop tick runs every frame.
 */
class ControllerScene extends Phaser.Scene {
  constructor() {
    super('ControllerScene');
  }

  create(): void {
    // Launch the office scene (renders the tilemap + dev sprite).
    this.scene.launch('OfficeScene');
    // Launch the HUD overlay with injected accessors for live state + boost.
    this.scene.launch('HudScene', {
      getState: (): GameState => state,
      getContent: (): ContentCatalog => content,
      onBoost: () => {
        state = manualBoost(state, content);
      },
    });
  }

  /**
   * Called by Phaser every frame (~60fps). Drives the game-loop tick with the
   * real elapsed dt. This is the wall-clock boundary — Phaser's time feeds the
   * loop, which computes dt internally and delegates to the pure `advance`.
   */
  update(time: number): void {
    loop.update(time);
  }
}

// ── Boot sequence ──────────────────────────────────────────────────────────

/**
 * Boot the game. This is the single entry point — called once on page load.
 *
 * Order:
 *  1. Load local save (null → fresh state) + grant starter producer.
 *  2. Construct the game loop (content is the empty fallback for now).
 *  3. Start Phaser immediately (office renders, HUD shows "LOC: 0").
 *  4. Fetch content (async, best-effort). Once loaded, catch up offline progress
 *     with the real content (so a returning player's LOC rate is correct).
 *  5. Best-effort: backend session load, STOMP connect, periodic sync.
 *
 * Offline-capability: steps 4–5 are all best-effort. If the backend is down,
 * the game still boots, renders, and saves locally (Constitution IV).
 */
async function boot(): Promise<void> {
  // 1. Load local save and prepare the initial state.
  //    `prepareInitialState` handles the fresh-vs-returning decision: a FRESH
  //    player is re-anchored to NOW (so no phantom epoch credit — the epoch
  //    default in createInitialState would otherwise credit ~1.77e9 LOC),
  //    granted manual_typing, and has LOC "0". A RETURNING player gets offline
  //    catch-up at the real rate. This is pure (nowMs passed in).
  const loaded = loadGame();
  const now = Date.now();
  state = prepareInitialState(loaded, content, now);

  // 2. Construct the game loop.
  loop = new GameLoop({
    getContent: (): ContentCatalog => content,
    getState: (): GameState => state,
    setState: (s: GameState): void => {
      state = s;
    },
    save: () => saveGame(state),
  });
  // Anchor the loop's tick to now (state is already caught up above).
  loop.load(state, now);

  // 3. Start Phaser immediately (renders office + HUD).
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0f172a',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    scene: [ControllerScene, OfficeScene, HudScene],
  });

  // 4. Fetch content (best-effort). On failure the bundled FALLBACK_CONTENT
  //    persists — the game stays fully playable offline (Constitution IV).
  await fetchContent();

  // 6. Best-effort backend sync + STOMP (all non-fatal on failure).
  void loadFromBackend();
  connectStomp();

  // 7. Periodic save + sync. Local save every 30s; backend sync every 60s.
  setInterval(() => {
    saveGame(state);
  }, 30_000);
  setInterval(() => {
    void syncToBackend();
  }, 60_000);

  // 8. Save on tab close / navigation (best-effort — beforeunload may not wait
  //    for async, so the local saveGame is the reliable path; syncToBackend is
  //    best-effort via sendBeacon-like fire-and-forget).
  window.addEventListener('beforeunload', () => {
    saveGame(state);
    void syncToBackend();
  });
}

// Kick off the boot sequence. The only throwing call is `loadGame()` on a
// corrupt save (CorruptedSaveError); a future UI iteration can catch that and
// show a recovery prompt. For now it surfaces in the console.
void boot();
