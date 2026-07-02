// T043 — The seats module: deterministic seat assignment for the campus world.
//
// PURE and Phaser-free (Constitution Principle I). `CampusScene` (T046) reads
// the Tiled `SeatAnchors` object layer via `map.getObjectLayer('SeatAnchors')`
// and hands the already-parsed point objects to `extractSeatAnchors`; the
// assignment math (`assignSeats`) is a pure function of (anchors, colleagues).
// No `Date.now()`, no Phaser, no I/O — fully unit-testable (seats.test.ts).
//
// ## What it does (data-model.md "Seat capacity invariant"; FR-021)
// Deterministically assigns colleagues — presences PRESENT in an office, i.e.
// not commuting — to distinct `SeatAnchors` within the SAME building. Overflow
// beyond the available anchors degrades to standing/roaming spots rather than
// hiding colleagues or stacking them illegibly (spec edge cases "peak crowd" /
// "more colleagues than seats"). Per-building anchor tags are respected: a
// colleague in `office_1` gets a seat in `office_1`, never the other
// building's spare anchor.
//
// ## Determinism (the core guarantee)
// Two stable orderings make the assignment a pure function of its inputs,
// independent of input order:
//  - colleagues are sorted by `colleagueId` (lexicographic) within a building;
//  - anchors are sorted by `(y, x, building)` within a building.
// Colleague `k` (0-based, by id) takes anchor `k` (0-based, top-left first);
// the first `min(colleagues, anchors)` are seated, the rest stand. The output
// is emitted sorted by `colleagueId` so callers get a stable list.

// ── Types ────────────────────────────────────────────────────────────────

/**
 * A normalized seat anchor: a pixel position plus the building id it belongs
 * to. Produced by `extractSeatAnchors` from the raw Tiled `SeatAnchors`
 * objects. `building` is the value of the Tiled `building` custom property
 * (e.g. `"office_1"`), matching the `office` a presence reports.
 */
export interface SeatAnchor {
  x: number;
  y: number;
  building: string;
}

/**
 * A raw `SeatAnchors` point object as read from the Tiled object layer via
 * `map.getObjectLayer('SeatAnchors').objects`. Tiled exports custom properties
 * as an **array** of `{ name, type, value }` (the form campus.json uses); the
 * object form `{ building }` is accepted too for robustness. Only `x`/`y` and
 * the `building` property are consumed; the rest (`id`, `name`, `rotation`,
 * `point`, …) is dropped.
 */
/** A single Tiled custom-property entry (`{ name, type, value }` in JSON exports). */
export interface TiledProperty {
  name: string;
  value: unknown;
  type?: string;
}

export interface RawSeatAnchor {
  x: number;
  y: number;
  name?: string;
  properties?: ReadonlyArray<TiledProperty> | Readonly<Record<string, unknown>>;
}

/**
 * A colleague to seat: a presence that is PRESENT in an office (not
 * commuting). Commuting colleagues (`office == null`) are rendered on the
 * commute path by `commute.ts` (T044) and are never passed here. `office` is
 * the building id the presence reports — it must match a `SeatAnchor.building`
 * for the colleague to be seated; otherwise they overflow to standing.
 */
export interface SeatedColleague {
  colleagueId: string;
  office: string;
}

/** How a colleague was placed. */
export type SeatKind = 'seated' | 'standing';

/**
 * One colleague's resolved placement.
 *
 *  - `kind === 'seated'`: the colleague occupies a distinct `SeatAnchor`;
 *    `(x, y)` is that anchor's pixel position.
 *  - `kind === 'standing'`: overflow beyond the anchors; `(x, y)` is a
 *    deterministic standing/roaming spot in the same building region.
 *
 * `building` is always the colleague's `office` (echoed for the renderer: it
 * needs no anchor lookup to know which building a standing colleague is in).
 */
export interface SeatAssignment {
  colleagueId: string;
  building: string;
  kind: SeatKind;
  x: number;
  y: number;
}

// ── Internals ────────────────────────────────────────────────────────────

/**
 * Pixel spacing between standing/roaming spots. Sized toward the FR-024
 * minimum tap target (~24 CSS px at minimum zoom) so overflow avatars stay
 * individually tappable rather than overlapping.
 */
const STANDING_SPACING = 24;

/** Read the `building` tag from either Tiled property form, or `null` if absent. */
function readBuildingProperty(properties: RawSeatAnchor['properties']): string | null {
  if (properties === undefined) {
    return null;
  }
  if (Array.isArray(properties)) {
    const entry = properties.find((p: TiledProperty) => p.name === 'building');
    const value = entry?.value;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  // Object form: { building: 'office_1' }.
  const value = (properties as Record<string, unknown>).building;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Deterministic 31× rolling hash of a string → non-negative int. Pure; used
 * only to spread standing spots for the (map-authoring-error) case of a
 * building with zero anchors, so two such buildings never land on the same
 * spot. Not cryptographic — just stable.
 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Deterministic anchor sort key: top-to-bottom, then left-to-right, then id. */
function anchorSortKey(a: SeatAnchor): string {
  // Pad coordinates so the string ordering matches numeric ordering.
  const xs = a.x.toFixed(3).padStart(12, '0');
  const ys = a.y.toFixed(3).padStart(12, '0');
  return `${ys}|${xs}|${a.building}`;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Normalize raw Tiled `SeatAnchors` point objects into `SeatAnchor[]`.
 *
 * Reads the `building` custom property from either the array form (campus.json
 * default: `[{ name: 'building', value: 'office_1' }]`) or the object form
 * (`{ building: 'office_1' }`). Anchors missing the tag are dropped — a
 * building-less anchor cannot be assigned to any colleague and would only
 * confuse the renderer. Pure: returns a fresh array, never mutates the input.
 */
export function extractSeatAnchors(raw: ReadonlyArray<RawSeatAnchor>): SeatAnchor[] {
  const out: SeatAnchor[] = [];
  for (const o of raw) {
    const building = readBuildingProperty(o.properties);
    if (building === null) {
      continue; // malformed anchor: no building tag → cannot be assigned
    }
    out.push({ x: o.x, y: o.y, building });
  }
  return out;
}

/**
 * Deterministically assign `colleagues` to distinct `anchors`, per building,
 * overflowing the excess to standing/roaming spots.
 *
 * ## Algorithm
 *  1. Group colleagues by `office` (building).
 *  2. Within each building, sort colleagues by `colleagueId` and anchors by
 *     `(y, x, building)` — both stable, so the result is independent of input
 *     order.
 *  3. Seat colleague `k` at anchor `k` for `k < min(count, anchors)`.
 *  4. The remaining colleagues get standing spots on a deterministic lattice
 *     laid out just below the building's seat area (distinct per overflow
 *     index, and strictly below every anchor so a standing spot never
 *     coincides with a seated one). A building with zero anchors places its
 *     standing colleagues at a per-building hash offset.
 *  5. Emit the result sorted by `colleagueId`.
 *
 * ## Guarantees (asserted in seats.test.ts)
 *  - every input colleague appears in the output (never hidden);
 *  - no two colleagues ever share a pixel position (never stacked);
 *  - a seated colleague always sits on an anchor tagged with their building;
 *  - the same inputs always yield the same output (pure & deterministic).
 *
 * @param anchors    normalized seat anchors (from `extractSeatAnchors`)
 * @param colleagues presences present in an office (NOT commuting)
 * @returns a fresh, `colleagueId`-sorted array of placements
 */
export function assignSeats(
  anchors: ReadonlyArray<SeatAnchor>,
  colleagues: ReadonlyArray<SeatedColleague>,
): SeatAssignment[] {
  // Index anchors by building, deterministically sorted within each building.
  // (Sort copies so the caller's array is never mutated.)
  const sortedAnchors = [...anchors].sort((a, b) => anchorSortKey(a).localeCompare(anchorSortKey(b)));
  const anchorsByBuilding = new Map<string, SeatAnchor[]>();
  for (const a of sortedAnchors) {
    const list = anchorsByBuilding.get(a.building);
    if (list === undefined) {
      anchorsByBuilding.set(a.building, [a]);
    } else {
      list.push(a);
    }
  }

  // Group colleagues by office, sorted by colleagueId within each building.
  const colleaguesByOffice = new Map<string, SeatedColleague[]>();
  for (const c of colleagues) {
    const list = colleaguesByOffice.get(c.office);
    if (list === undefined) {
      colleaguesByOffice.set(c.office, [c]);
    } else {
      list.push(c);
    }
  }
  for (const list of colleaguesByOffice.values()) {
    list.sort((a, b) => a.colleagueId.localeCompare(b.colleagueId));
  }

  const assignments: SeatAssignment[] = [];

  // Assign per building. Iterating the (deterministically key-ordered) map of
  // colleagues keeps the partition stable; the final emit sorts by colleagueId.
  for (const [office, officeColleagues] of colleaguesByOffice) {
    const officeAnchors = anchorsByBuilding.get(office) ?? [];

    // Seated: up to the anchor count, colleague[k] → anchor[k].
    const seatedCount = Math.min(officeColleagues.length, officeAnchors.length);
    for (let k = 0; k < seatedCount; k++) {
      const c = officeColleagues[k];
      const a = officeAnchors[k];
      assignments.push({ colleagueId: c.colleagueId, building: office, kind: 'seated', x: a.x, y: a.y });
    }

    // Standing: the overflow, on a deterministic lattice.
    if (officeColleagues.length > seatedCount) {
      // Base point for the standing lattice. When the building has anchors,
      // anchor the lattice at the seat area's bottom-left and grow downward
      // (strictly below every anchor y, so a standing spot never coincides
      // with a seated anchor). With no anchors (a map-authoring error),
      // spread buildings apart by a stable hash so they never collide.
      let baseX: number;
      let baseY: number;
      if (officeAnchors.length > 0) {
        baseX = Math.min(...officeAnchors.map((a) => a.x));
        const maxY = Math.max(...officeAnchors.map((a) => a.y));
        baseY = maxY + STANDING_SPACING;
      } else {
        baseX = hashString(office) % 1024;
        baseY = STANDING_SPACING;
      }

      const overflow = officeColleagues.slice(seatedCount);
      for (let k = 0; k < overflow.length; k++) {
        const col = k % 4; // rows of four, wrapping — keeps the cluster compact
        const row = Math.floor(k / 4);
        assignments.push({
          colleagueId: overflow[k].colleagueId,
          building: office,
          kind: 'standing',
          x: baseX + col * STANDING_SPACING,
          y: baseY + row * STANDING_SPACING,
        });
      }
    }
  }

  // Stable emit: sorted by colleagueId.
  assignments.sort((a, b) => a.colleagueId.localeCompare(b.colleagueId));
  return assignments;
}
