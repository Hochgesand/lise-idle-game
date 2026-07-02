// T036 — End-to-end game wiring: the shippable entry point (002: campus +
// DOM overlay; 001 loop preserved).
//
// Boots the full game per quickstart.md Scenario 1:
//   new player starts at zero → fetch content → start loop → render campus →
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
// A thin `ControllerScene` (defined below) drives the game-loop tick AND the
// DOM overlay refresh via its `update(time)`. T051 retires the three in-canvas
// Phaser UI scenes (OfficeScene/HudScene/EconomyScene/AcademyScene): the
// controller now launches the campus world (`CampusScene`) and mounts the DOM
// overlay (HUD/Economy/Academy panels) — the canvas renders the world only
// (research: UI architecture — DOM overlay).

import Phaser from 'phaser';
import type { ContentCatalog, ContentEnvelope, GameState } from './sim/types';
import { loadContent } from './sim/content';
import { manualBoost, cashOut, purchaseUpgrade, activateBurner, purchaseTraining, InsufficientResourcesError } from './sim/actions';
import { bn, compare } from './sim/bigNumber';
import { GameLoop } from './game/gameLoop';
import { prepareInitialState } from './game/prepareState';
import { FALLBACK_CONTENT } from './sim/fallbackContent';
import { loadGame, saveGame, createInitialState } from './save/localStorage';
import { restClient } from './net/restClient';
import { stompClient } from './net/stompClient';
import { initAuth, handleSigninCallback, restoreSession, isSignedIn, authTokenSource } from './net/auth';
import { deriveHeartbeat, heartbeatIntervalMs } from './net/heartbeat';
// T051: the retired in-canvas Phaser UI scenes (OfficeScene/HudScene/
// EconomyScene/AcademyScene) are replaced by CampusScene (the world) + a DOM
// overlay (the three UI panels). The world renders campus tiles + avatars; the
// DOM overlay renders HUD/Economy/Academy from the existing pure view models.
import { CampusScene } from './scenes/world/CampusScene';
import { createOverlay, type Overlay } from './ui/overlay';
import { hudPanel } from './ui/hudPanel';
import { economyPanel } from './ui/economyPanel';
import { academyPanel } from './ui/academyPanel';
import { CASH_RATE } from './game/economyConfig';

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

// ── Presence heartbeat (002 T063, best-effort) ─────────────────────────────
//
// While signed in AND presence consent is granted (contracts §2
// `PUT /api/v1/presence/settings` — consent is app-side state, FR-003), main.ts
// (the clock-owning module, matching the 30 s save / 60 s sync pattern below)
// publishes a STOMP heartbeat every `content.coop.heartbeatSeconds` with
// `{ office, activity, commute }` derived from the save state (net/heartbeat.ts
// — pure; `activity` is a display label, never stored in the save).
//
// Gating: `syncHeartbeat()` starts/stops the interval from the current
// auth + consent state — call it whenever either changes (boot does, via
// `refreshPresenceConsent()`; the consent UI, T064, re-calls it after a
// settings change). Belt-and-braces: each tick re-checks the gate, so a
// mid-session token expiry stops publishing on the very next tick even with
// no state-change notification; `publishHeartbeat` itself no-ops while the
// socket is down (the lease simply lapses — advisory, FR-016).

/** The live heartbeat interval handle, or null while gated off. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * The player's presence consent (`consentGiven` from `GET /api/v1/me` —
 * app-side `player_presence` state). Defaults to false: no heartbeat is ever
 * published before consent is positively confirmed (FR-003).
 */
let presenceConsentGiven = false;

/** Start the heartbeat interval (idempotent; cadence from the content catalog). */
function startHeartbeat(): void {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(() => {
    // Re-check the gate every tick: a token expiry or consent withdrawal must
    // silence the heartbeat immediately, not wait for a sync call.
    if (!isSignedIn() || !presenceConsentGiven) return;
    stompClient.publishHeartbeat(deriveHeartbeat(state));
  }, heartbeatIntervalMs(content));
}

/** Stop the heartbeat interval (idempotent). */
function stopHeartbeat(): void {
  if (heartbeatTimer === null) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/** Start/stop the heartbeat from the CURRENT auth + consent state. */
function syncHeartbeat(): void {
  if (isSignedIn() && presenceConsentGiven) {
    startHeartbeat();
  } else {
    stopHeartbeat();
  }
}

/**
 * Refresh `presenceConsentGiven` from `GET /api/v1/me` (signed-in only) and
 * re-sync the heartbeat gate. Best-effort: on any failure consent stays/false
 * — unknown consent means NO heartbeat (FR-003), and the game plays on solo.
 */
async function refreshPresenceConsent(): Promise<void> {
  if (!isSignedIn()) {
    presenceConsentGiven = false;
    syncHeartbeat();
    return;
  }
  try {
    const me = await restClient.getMe();
    presenceConsentGiven = me.consentGiven;
  } catch (err) {
    presenceConsentGiven = false;
    console.warn('[main] Consent lookup failed — presence heartbeat stays off.', err);
  }
  syncHeartbeat();
}

// ── Controller scene (drives the game-loop tick each frame) ────────────────

/**
 * DOM-overlay refresh cadence (ms). The loop drives `overlay.refresh()` every
 * frame, but the DOM only repaints at most this often, applying the latest
 * state (overlay.ts leading + trailing throttle). 10 fps is plenty for an
 * idle-game HUD and keeps per-frame DOM churn off the 60 fps budget.
 */
const OVERLAY_REFRESH_MS = 100;

/**
 * A thin controller Phaser scene. It renders nothing itself — it launches the
 * campus world (`CampusScene`) as a parallel scene and mounts the DOM overlay
 * (HUD/Economy/Academy), and its `update(time)` drives both the game-loop tick
 * and `overlay.refresh()` each frame.
 *
 * The campus renders tiles + avatars; the DOM overlay renders the three UI
 * panels from the existing pure view models (research: UI architecture — DOM
 * overlay). This retires the three in-canvas Phaser UI scenes (OfficeScene /
 * HudScene / EconomyScene / AcademyScene, deleted in T051).
 */
class ControllerScene extends Phaser.Scene {
  /** The mounted DOM overlay, refreshed each frame in `update`. */
  private overlay: Overlay | null = null;

  constructor() {
    super('ControllerScene');
  }

  create(): void {
    // Launch the campus world scene (renders the tilemap + camera/avatars).
    this.scene.launch('CampusScene');

    // Mount the DOM overlay (FR-019). Action callbacks bind to the pure
    // mutators + state update — the same closures the retired scenes received
    // via their `*SceneInit`. Each economy/academy callback wraps in
    // try/catch — an InsufficientResourcesError (e.g. an unaffordable tap that
    // slipped past the affordance greying) must NOT crash the game. After a
    // successful mutation, save immediately (idempotent; the periodic save
    // also persists the new state).
    const ui = document.getElementById('ui');
    if (ui !== null) {
      this.overlay = createOverlay({
        mount: ui,
        accessors: {
          getState: (): GameState => state,
          getContent: (): ContentCatalog => content,
        },
        sections: [
          hudPanel({
            onBoost: () => {
              state = manualBoost(state, content);
            },
          }),
          economyPanel({
            onCashOut: (locAmount: string) => {
              try {
                state = cashOut(state, locAmount, CASH_RATE);
                saveGame(state);
              } catch (err) {
                if (!(err instanceof InsufficientResourcesError)) throw err;
              }
            },
            onPurchaseUpgrade: (upgradeId: string) => {
              try {
                state = purchaseUpgrade(state, content, upgradeId);
                saveGame(state);
              } catch (err) {
                if (!(err instanceof InsufficientResourcesError)) throw err;
              }
            },
            onActivateBurner: (burnerId: string) => {
              try {
                state = activateBurner(state, content, burnerId);
                saveGame(state);
              } catch (err) {
                if (!(err instanceof InsufficientResourcesError)) throw err;
              }
            },
          }),
          academyPanel({
            onPurchaseTraining: (trainingId: string) => {
              try {
                state = purchaseTraining(state, content, trainingId);
                saveGame(state);
              } catch (err) {
                if (!(err instanceof InsufficientResourcesError)) throw err;
              }
            },
          }),
        ],
        refreshMinIntervalMs: OVERLAY_REFRESH_MS,
      });
    }
  }

  /**
   * Called by Phaser every frame (~60fps). Drives the game-loop tick with the
   * real elapsed dt (the wall-clock boundary — Phaser's time feeds the loop,
   * which computes dt internally and delegates to the pure `advance`), then
   * refreshes the DOM overlay (throttled internally so the DOM repaints at
   * most every `OVERLAY_REFRESH_MS`). The overlay handle is null only if the
   * `<div id="ui">` mount was missing; the loop still runs.
   */
  update(time: number): void {
    loop.update(time);
    this.overlay?.refresh();
  }
}

// ── Boot sequence ──────────────────────────────────────────────────────────

/**
 * Boot the game. This is the single entry point — called once on page load.
 *
 * Order:
 *  1. Load local save (null → fresh state) + grant starter producer.
 *  2. Construct the game loop (content is the empty fallback for now).
 *  3. Start Phaser immediately (campus renders, DOM overlay shows "LOC: 0").
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

  // 3. Start Phaser immediately (renders the campus world + DOM overlay).
  // campus-layout.md §2: the real campus is flat-design art (not pixel art),
  // so bilinear smoothing renders it cleanly at every zoom — `pixelArt: false`
  // with antialias ON and `roundPixels` off (supersedes the T046
  // nearest-neighbor config that suited the placeholder 16px pixel tiles).
  // ControllerScene (first in the array) is auto-started and launches
  // CampusScene; the three retired in-canvas Phaser UI scenes are gone (T051)
  // — the DOM overlay replaces them.
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0f172a',
    pixelArt: false,
    antialias: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    scene: [ControllerScene, CampusScene],
  });

  // 4. Fetch content (best-effort). On failure the bundled FALLBACK_CONTENT
  //    persists — the game stays fully playable offline (Constitution IV).
  await fetchContent();

  // 5. Auth (best-effort, never blocking — FR-001/002): initialize OIDC,
  //    complete a sign-in redirect callback if present, else restore a stored
  //    session. The token sources are bound BEFORE the STOMP connect so the
  //    CONNECT frame carries the bearer (contracts §3 — the heartbeat's
  //    identity comes from the STOMP Principal). Every failure inside auth.ts
  //    degrades to signed-out solo play.
  initAuth();
  restClient.setTokenSource(authTokenSource);
  stompClient.setTokenSource(authTokenSource);
  if ((await handleSigninCallback()) === null) {
    await restoreSession();
  }

  // 6. Best-effort backend sync + STOMP (all non-fatal on failure).
  void loadFromBackend();
  connectStomp();

  // 6b. Presence heartbeat gate (T063): look up consent (signed-in only) and
  //     start the heartbeat interval when signed in AND consent is granted —
  //     signed-out or no-consent players never publish presence (FR-003).
  void refreshPresenceConsent();

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
