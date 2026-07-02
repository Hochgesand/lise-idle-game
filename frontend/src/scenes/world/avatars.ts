// T045 — Phaser avatar rendering for the campus world (Phase 3).
//
// Builds the on-canvas representation of a colleague: a sprite (green live /
// red last-seen via `avatars.png` frames), a name label, and an activity icon,
// grouped into one interactive container per colleague. This module owns the
// Phaser-specific RENDERING only — the pure derivation logic for avatar state
// transitions (live → last-seen, commute-in-progress → route position) is
// tested separately and Phaser-free in T078 (US3). CampusScene (T046) drives
// this layer from the presence model + the seat assignments from `seats.ts`.
//
// ## FR-005 × FR-024 label rule (research: Art direction + Camera decision)
// Labels render **persistently at or above a label-zoom threshold** (tuned
// between `minZoom` and `maxZoom`, see camera.ts) and on **tap/hover below it**:
// a zoomed-in office reads fully labeled while a zoomed-out campus never
// drowns in overlapping text. The threshold lives here as a constant the
// renderer flips on; `setZoom` is called each frame from CampusScene with the
// live camera zoom.
//
// ## FR-024 effective touch target
// Avatar frames are 16 px; the spec requires each avatar to stay individually
// tappable at ≥ ~24 CSS px at minimum zoom, with the effective touch target
// pushed toward the 44 px platform guideline. The padded pointer hit-area
// (`HIT_TARGET_PX`) on each sprite does exactly that — a 44×44 hit rect
// centered on the (smaller) sprite so a finger lands reliably even at the
// smallest zoom, without visually enlarging the avatar.

import Phaser from 'phaser';
// AVATAR_FRAME_PX is the canonical 16 px Phase-3 base (re-exported from the
// camera module so the FR-024 zoom math and the avatar frame size stay in sync
// from one source of truth).
import { AVATAR_FRAME_PX } from './camera';

// ── Asset keys / frame layout ────────────────────────────────────────────
//
// `avatars.png` is a 128×16 sprite sheet: 8 frames of 16×16 (see
// `scripts/gen_placeholder_assets.py`). Frame styling authored there:
//   frames 0,1,2,7 → green (live)   FR-023
//   frames 3,4     → red    (last-seen)
//   frames 5,6     → desaturated (last-seen)
// We render live with a green frame and last-seen with a red one — the most
// readable pairing at a glance from a zoomed-out view (Scenario 8 step 6).

/** Phaser texture key for `avatars.png` (loaded by CampusScene.preload). */
export const AVATAR_TEXTURE = 'avatars';

/** Live (green) avatar frame index in `avatars.png`. */
export const LIVE_FRAME = 0;
/** Last-seen (red) avatar frame index in `avatars.png`. */
export const LAST_SEEN_FRAME = 3;

// ── Label-zoom + touch-target constants ──────────────────────────────────

/**
 * Zoom at/above which avatar labels render persistently; below it labels are
 * on tap/hover only (FR-005 × FR-024). Sits below `MAX_ZOOM` (4) from the
 * camera module; unchanged by the §7 zoom-out-to-fit lower clamp (at far-out
 * zoom taps are for panning, interaction happens zoomed-in — same as CoC).
 */
export const LABEL_ZOOM_THRESHOLD = 2.5;

/**
 * Effective touch-target size (px) — the padded hit-area pushes the
 * individually-tappable surface toward the 44 px platform guideline (FR-024).
 */
export const HIT_TARGET_PX = 44;

// ── Presence projection (rendering-relevant slice of PresenceRecord) ─────

/**
 * The avatar-facing projection of a colleague's presence. The full
 * `PresenceRecord` (data-model.md) arrives with US1 (T062); CampusScene needs
 * only these fields to render, so this narrow type keeps the world layer
 * decoupled from the network/presence-client shapes until US1 wires them.
 *
 *  - `status` drives green (live) vs red (last-seen) frame selection (FR-023).
 *  - `displayName` + `activity` drive the labels (FR-005).
 */
export interface AvatarPresence {
  /** Stable social key (PresenceRecord.colleagueId); keys the container map. */
  colleagueId: string;
  /** Display name label (FR-004/005). */
  displayName: string;
  /** Current/last-known activity label (client-derived; FR-005). */
  activity: string;
  /** Liveness tier — selects the avatar frame (FR-023). */
  status: 'live' | 'lastSeen';
}

/**
 * One colleague's resolved render: a world position (from a seat assignment in
 * `seats.ts`, or a commute position in `commute.ts` once US3 lands) plus the
 * presence projection. CampusScene builds these each frame and hands them to
 * {@link AvatarLayer.update}.
 */
export interface AvatarRender {
  colleagueId: string;
  /** World-space pixel position (the container is centered here). */
  x: number;
  y: number;
  presence: AvatarPresence;
  /**
   * (T080) True while this colleague is rendered ON the commute route.
   * Drives the FR-022 in-transit label decluttering: labels are tap/hover
   * only while commuting, even at label-persistent zoom (`labelVisible`,
   * presenceView.ts). Optional: absent means seated (`false`).
   */
  inTransit?: boolean;
}

/** {@link AvatarLayer} construction options. */
export interface AvatarLayerOptions {
  /**
   * Zoom at/above which labels render persistently (default
   * {@link LABEL_ZOOM_THRESHOLD}). Overridable for tests/authoring.
   */
  labelZoomThreshold?: number;
  /**
   * Effective touch-target size in px (default {@link HIT_TARGET_PX}).
   */
  hitTargetPx?: number;
}

// ── Internal: one colleague's game objects ───────────────────────────────

/**
 * The Phaser objects for a single colleague, plus the per-avatar interaction
 * state that drives the tap/hover label rule below the zoom threshold.
 */
interface AvatarEntry {
  /** The grouping container (positioned at the colleague's world point). */
  container: Phaser.GameObjects.Container;
  /** The avatar sprite (frame encodes live/last-seen). */
  sprite: Phaser.GameObjects.Sprite;
  /** Name label text (FR-005). */
  nameText: Phaser.GameObjects.Text;
  /** Activity icon/label text (FR-005). */
  activityText: Phaser.GameObjects.Text;
  /** True while the pointer hovers this avatar (label shown below threshold). */
  hovered: boolean;
  /** True while the user has toggled the label on (tap below threshold). */
  pinned: boolean;
}

// ── The layer ────────────────────────────────────────────────────────────

/**
 * Renders and reconciles colleague avatars on the campus world.
 *
 * CampusScene constructs one `AvatarLayer`, calls {@link update} whenever the
 * presence model / seat assignments change (reconciling containers — adds new
 * colleagues, removes departed ones, updates the rest in place), and calls
 * {@link setZoom} each frame so labels obey the FR-005 × FR-024 zoom rule.
 *
 * The layer is a single Phaser Container at the world origin (depth above the
 * tile layers); each colleague is a child container holding its sprite + label
 * texts. Reconciliation is by `colleagueId` so a colleague keeps a stable
 * container across presence deltas (no pop/flicker on a field-only update).
 */
export class AvatarLayer {
  private readonly scene: Phaser.Scene;
  /** Root container for all avatars (positioned at world origin, depth high). */
  private readonly root: Phaser.GameObjects.Container;
  private readonly labelZoomThreshold: number;
  private readonly hitTargetPx: number;
  /** colleagueId → entry. */
  private readonly entries = new Map<string, AvatarEntry>();
  /** Last zoom applied (drives default label visibility). */
  private currentZoom = LABEL_ZOOM_THRESHOLD;

  constructor(scene: Phaser.Scene, opts: AvatarLayerOptions = {}) {
    this.scene = scene;
    this.labelZoomThreshold = opts.labelZoomThreshold ?? LABEL_ZOOM_THRESHOLD;
    this.hitTargetPx = opts.hitTargetPx ?? HIT_TARGET_PX;
    this.root = scene.add.container(0, 0);
    // Avatars render above the tile layers + commute paths.
    this.root.setDepth(1000);
  }

  /**
   * Reconcile the rendered avatars against `renders`. Adds containers for new
   * colleagues, removes containers for departed ones, and updates position /
   * frame / label text for the rest in place. Idempotent and order-independent
   * (keyed by `colleagueId`).
   */
  update(renders: ReadonlyArray<AvatarRender>): void {
    const seen = new Set<string>();

    for (const r of renders) {
      seen.add(r.colleagueId);
      const existing = this.entries.get(r.colleagueId);
      if (existing !== undefined) {
        this.applyPresence(existing, r);
      } else {
        const entry = this.createEntry(r);
        this.entries.set(r.colleagueId, entry);
        this.root.add(entry.container);
      }
    }

    // Remove departed colleagues (live → last-seen soft transitions are handled
    // by presence `status` updates, not removal — a last-seen colleague stays
    // rendered until the retention window drops them from the presence model).
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.destroyEntry(entry);
        this.entries.delete(id);
      }
    }
  }

  /**
   * Apply the current camera zoom, toggling each avatar's default label
   * visibility per the FR-005 × FR-024 rule (persistent at/above the threshold,
   * hidden below it unless hovered/pinned). Cheap: one boolean write per entry.
   */
  setZoom(zoom: number): void {
    this.currentZoom = zoom;
    const persistent = zoom >= this.labelZoomThreshold;
    for (const entry of this.entries.values()) {
      this.refreshLabelVisibility(entry, persistent);
    }
  }

  /** Tear down every avatar and the root container. Idempotent. */
  destroy(): void {
    for (const entry of this.entries.values()) {
      this.destroyEntry(entry);
    }
    this.entries.clear();
    this.root.destroy();
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** Build a fresh avatar entry (container + sprite + label texts) for `r`. */
  private createEntry(r: AvatarRender): AvatarEntry {
    const container = this.scene.add.container(r.x, r.y);

    // Sprite: avatar frame encodes live (green) / last-seen (red). Origin at
    // the vertical center / horizontal center so the seat point sits mid-avatar.
    const sprite = this.scene.add.sprite(0, 0, AVATAR_TEXTURE, this.frameFor(r.presence.status));
    sprite.setOrigin(0.5, 0.5);
    container.add(sprite);

    // Name label (top of the stack, above the head). Stroke keeps it legible
    // over any tile. All labels are bottom-anchored (origin y=1.0) so their `y`
    // is the text baseline; they stack name → activity → head going downward.
    const nameText = this.scene.add.text(0, -AVATAR_FRAME_PX / 2 - 14, r.presence.displayName, {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#e2e8f0',
      stroke: '#0f172a',
      strokeThickness: 3,
    });
    nameText.setOrigin(0.5, 1.0);
    container.add(nameText);

    // Activity icon/label (below the name, just above the head).
    const activityText = this.scene.add.text(
      0,
      -AVATAR_FRAME_PX / 2 - 4,
      activityGlyph(r.presence.activity),
      {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#94a3b8',
        stroke: '#0f172a',
        strokeThickness: 2,
      },
    );
    activityText.setOrigin(0.5, 1.0);
    container.add(activityText);

    // Padded hit-area: a 44×44 rect centered on the sprite, so the effective
    // touch target meets the FR-024 platform guideline without visually
    // enlarging the avatar.
    //
    // Phaser hit-area coordinates are NOT origin-relative: `pointWithinHitArea`
    // shifts the test point by `displayOriginX/Y` before invoking the callback,
    // so the space has (0,0) at the frame's TOP-LEFT (not the origin point). A
    // 16 px sprite at origin (0.5, 0.5) has its frame center at (8, 8) in this
    // space — so to center the 44 px rect on the visual avatar we offset by
    // half the frame size, not by zero.
    const half = this.hitTargetPx / 2;
    const frameHalf = AVATAR_FRAME_PX / 2;
    const hitArea = new Phaser.Geom.Rectangle(
      frameHalf - half,
      frameHalf - half,
      this.hitTargetPx,
      this.hitTargetPx,
    );
    sprite.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

    const entry: AvatarEntry = {
      container,
      sprite,
      nameText,
      activityText,
      hovered: false,
      pinned: false,
    };

    // Tap/hover label rule (below the zoom threshold): hover shows the label
    // transiently; a tap pins it on until tapped again. Above the threshold
    // labels are always shown regardless (handled by setZoom).
    sprite.on('pointerover', () => {
      entry.hovered = true;
      this.refreshLabelVisibility(entry, this.currentZoom >= this.labelZoomThreshold);
    });
    sprite.on('pointerout', () => {
      entry.hovered = false;
      this.refreshLabelVisibility(entry, this.currentZoom >= this.labelZoomThreshold);
    });
    sprite.on('pointerdown', () => {
      entry.pinned = !entry.pinned;
      this.refreshLabelVisibility(entry, this.currentZoom >= this.labelZoomThreshold);
    });

    // Initial label visibility for the current zoom.
    this.refreshLabelVisibility(entry, this.currentZoom >= this.labelZoomThreshold);
    return entry;
  }

  /** Update an existing entry's position / frame / label text in place. */
  private applyPresence(entry: AvatarEntry, r: AvatarRender): void {
    entry.container.setPosition(r.x, r.y);
    entry.sprite.setFrame(this.frameFor(r.presence.status));
    entry.nameText.setText(r.presence.displayName);
    entry.activityText.setText(activityGlyph(r.presence.activity));
  }

  /** Frame index for a liveness tier (green live / red last-seen). */
  private frameFor(status: AvatarPresence['status']): number {
    return status === 'live' ? LIVE_FRAME : LAST_SEEN_FRAME;
  }

  /**
   * Show/hide this avatar's label texts per the FR-005 × FR-024 rule:
   * visible when persistent (zoom ≥ threshold) OR hovered OR pinned.
   */
  private refreshLabelVisibility(entry: AvatarEntry, persistent: boolean): void {
    const visible = persistent || entry.hovered || entry.pinned;
    entry.nameText.setVisible(visible);
    entry.activityText.setVisible(visible);
  }

  /** Destroy one entry's game objects and detach its input listeners. */
  private destroyEntry(entry: AvatarEntry): void {
    entry.sprite.removeInteractive();
    entry.sprite.removeAllListeners();
    entry.container.destroy();
  }
}

// ── Activity icon helper ─────────────────────────────────────────────────

/**
 * Map an activity label to a short glyph for the activity icon. The bundled
 * `avatars.png` has no dedicated activity-icon frames, so the icon is a
 * one-glyph text marker derived deterministically from the activity string
 * (stable across renders). Unknown activities fall back to a neutral dot.
 * T087 (polish) may replace this with framed icons once authored.
 */
function activityGlyph(activity: string): string {
  const key = activity.toLowerCase();
  if (key.includes('commut')) return '»';
  if (key.includes('burn')) return '!';
  // Coding / idle and any unrecognized activity share the neutral dot.
  return '·';
}
