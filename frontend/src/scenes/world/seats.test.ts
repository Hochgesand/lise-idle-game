// T037 — RED tests for the seats module (frontend/src/scenes/world/seats.ts).
//
// The seats module is the PURE, Phaser-free seat-assignment core consumed by
// `CampusScene` (T046): it deterministically assigns colleagues (presences
// present in an office) to distinct `SeatAnchors` within the same building,
// overflowing any excess to standing/roaming spots. It reads NO Phaser API
// directly — `CampusScene` extracts the `SeatAnchors` object layer via
// `map.getObjectLayer('SeatAnchors').objects` and hands the already-parsed
// objects to `extractSeatAnchors`; the assignment math (`assignSeats`) is pure.
//
// ## Invariants under test (T037 / data-model.md "Seat capacity invariant")
//  - deterministic assignment: stable ordering by `colleagueId` regardless of
//    input order, and stable regardless of anchor input order;
//  - per-building anchor tags respected: a colleague in `office_1` gets a seat
//    in `office_1`;
//  - distinct anchors: no two colleagues ever share the same anchor;
//  - overflow: colleagues beyond the available anchors fall back to standing
//    spots — never hidden, never stacked on an anchor or on each other.
//
// This file imports `./seats`, which does not exist yet (T037 RED). The import
// fails to resolve, so every assertion FAILS — the correct TDD RED. The real
// implementation lands in T043.

import { describe, it, expect } from 'vitest';
import { assignSeats, extractSeatAnchors, reservedAnchorFor } from './seats';
import type { SeatAnchor, SeatedColleague, RawSeatAnchor } from './seats';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A normalized anchor in `building` at pixel `(x, y)`. Mirrors the shape
 * `extractSeatAnchors` produces from the Tiled `SeatAnchors` objects.
 */
function anchor(building: string, x: number, y: number): SeatAnchor {
  return { x, y, building };
}

/** A colleague present in `office` (a presence NOT currently commuting). */
function colleague(colleagueId: string, office: string): SeatedColleague {
  return { colleagueId, office };
}

/**
 * A raw Tiled `SeatAnchors` point object. `form` selects whether the
 * `building` tag is stored in the array form (the default Tiled JSON export —
 * what campus.json actually uses) or the object form.
 */
function raw(
  building: string,
  x: number,
  y: number,
  form: 'array' | 'object' = 'array',
  name = `seat_${building}_${x}`,
): RawSeatAnchor {
  const properties =
    form === 'array'
      ? [{ name: 'building', type: 'string', value: building }]
      : ({ building } as Record<string, unknown>);
  return { x, y, name, properties };
}

/** Two small buildings' worth of anchors (3 seats each), spread on a 16 px grid. */
function twoBuildingsAnchors(): SeatAnchor[] {
  return [
    anchor('office_1', 16, 16),
    anchor('office_1', 32, 16),
    anchor('office_1', 48, 16),
    anchor('office_2', 160, 16),
    anchor('office_2', 176, 16),
    anchor('office_2', 192, 16),
  ];
}

// ---------------------------------------------------------------------------
// assignSeats — deterministic assignment to distinct anchors
// ---------------------------------------------------------------------------

describe('assignSeats — deterministic assignment to distinct anchors', () => {
  it('assigns each colleague to a distinct anchor in the same building', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_2'),
    ];

    const result = assignSeats(anchors, colleagues);

    expect(result).toHaveLength(3);
    // Every colleague is present (never hidden).
    expect(result.map((a) => a.colleagueId).sort()).toEqual(['alice', 'bob', 'carol']);
    // All seated, each on a DISTINCT position (no two share an anchor).
    const seated = result.filter((a) => a.kind === 'seated');
    expect(seated).toHaveLength(3);
    const positions = seated.map((a) => `${a.x},${a.y}`);
    expect(new Set(positions).size).toBe(seated.length);
  });

  it('respects per-building anchor tags (office_1 colleague → office_1 seat)', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [colleague('alice', 'office_1'), colleague('bob', 'office_2')];

    const result = assignSeats(anchors, colleagues);

    const byId = new Map(result.map((a) => [a.colleagueId, a]));
    const alice = byId.get('alice')!;
    const bob = byId.get('bob')!;

    // Each seated colleague's position matches an anchor tagged with THEIR
    // building — never the other building's anchor.
    expect(alice.kind).toBe('seated');
    expect(anchors.some((an) => an.x === alice.x && an.y === alice.y && an.building === 'office_1'))
      .toBe(true);
    expect(bob.kind).toBe('seated');
    expect(anchors.some((an) => an.x === bob.x && an.y === bob.y && an.building === 'office_2'))
      .toBe(true);
  });

  it('never stacks two colleagues on the same anchor (positions globally unique)', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_1'),
      colleague('dave', 'office_2'),
    ];

    const result = assignSeats(anchors, colleagues);

    // Across ALL assignments (seated + standing), no two colleagues share a
    // pixel position — the strongest "never stack" guarantee.
    const positions = result.map((a) => `${a.x},${a.y}`);
    expect(new Set(positions).size).toBe(result.length);
  });
});

// ---------------------------------------------------------------------------
// assignSeats — building isolation
// ---------------------------------------------------------------------------

describe('assignSeats — building isolation', () => {
  it('seats colleagues in their own building only, even with spare anchors elsewhere', () => {
    // office_1 has 3 anchors, office_2 has 3 anchors. Two office_1 colleagues
    // must NOT spill into office_2's empty anchors.
    const anchors = twoBuildingsAnchors();
    const colleagues = [colleague('alice', 'office_1'), colleague('bob', 'office_1')];

    const result = assignSeats(anchors, colleagues);

    for (const a of result) {
      // Each assigned position lies on an office_1 anchor.
      expect(a.building).toBe('office_1');
      expect(anchors.some((an) => an.x === a.x && an.y === a.y && an.building === 'office_1')).toBe(
        true,
      );
    }
  });

  it('a colleague in a building with no anchors overflows to standing (still rendered)', () => {
    // office_1 has anchors; office_3 has none. The office_3 colleague must not
    // be hidden — they fall back to a standing spot.
    const anchors = [anchor('office_1', 16, 16), anchor('office_1', 32, 16)];
    const colleagues = [colleague('alice', 'office_1'), colleague('zoe', 'office_3')];

    const result = assignSeats(anchors, colleagues);

    expect(result).toHaveLength(2); // never hidden
    const zoe = result.find((a) => a.colleagueId === 'zoe')!;
    expect(zoe.kind).toBe('standing');
    expect(zoe.building).toBe('office_3'); // stays associated with their building
  });
});

// ---------------------------------------------------------------------------
// assignSeats — overflow → standing spots
// ---------------------------------------------------------------------------

describe('assignSeats — overflow beyond anchors falls back to standing', () => {
  it('seats up to the anchor count and sends the excess to standing', () => {
    // office_1 has exactly 2 anchors; 4 colleagues want in.
    const anchors = [anchor('office_1', 16, 16), anchor('office_1', 32, 16)];
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_1'),
      colleague('dave', 'office_1'),
    ];

    const result = assignSeats(anchors, colleagues);

    expect(result).toHaveLength(4);
    const seated = result.filter((a) => a.kind === 'seated');
    const standing = result.filter((a) => a.kind === 'standing');
    expect(seated).toHaveLength(2); // exactly the anchor count
    expect(standing).toHaveLength(2); // the overflow
  });

  it('standing colleagues are never hidden and never share a position', () => {
    const anchors = [anchor('office_1', 16, 16)]; // 1 seat
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_1'),
    ];

    const result = assignSeats(anchors, colleagues);

    expect(result).toHaveLength(3); // none hidden
    const standing = result.filter((a) => a.kind === 'standing');
    expect(standing).toHaveLength(2);
    // Standing positions are pairwise distinct.
    const standingPos = standing.map((a) => `${a.x},${a.y}`);
    expect(new Set(standingPos).size).toBe(standing.length);
  });

  it('a standing spot never coincides with a seated anchor position', () => {
    const anchors = [
      anchor('office_1', 16, 16),
      anchor('office_1', 32, 16),
      anchor('office_1', 48, 16),
    ];
    const colleagues = Array.from({ length: 8 }, (_, i) =>
      colleague(`c${i}`, 'office_1'),
    );

    const result = assignSeats(anchors, colleagues);

    const seatedPos = new Set(
      result.filter((a) => a.kind === 'seated').map((a) => `${a.x},${a.y}`),
    );
    const standing = result.filter((a) => a.kind === 'standing');
    for (const s of standing) {
      expect(seatedPos.has(`${s.x},${s.y}`)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// assignSeats — determinism / stability
// ---------------------------------------------------------------------------

describe('assignSeats — determinism / stability', () => {
  it('emits the assignment ordered by colleagueId (stable ordering)', () => {
    const anchors = twoBuildingsAnchors();
    // Deliberately out-of-order colleague ids.
    const colleagues = [
      colleague('zoe', 'office_1'),
      colleague('alice', 'office_1'),
      colleague('mike', 'office_1'),
    ];

    const result = assignSeats(anchors, colleagues);

    expect(result.map((a) => a.colleagueId)).toEqual(['alice', 'mike', 'zoe']);
  });

  it('is independent of colleague input order', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_2'),
      colleague('carol', 'office_1'),
      colleague('dave', 'office_2'),
    ];

    const reference = assignSeats(anchors, colleagues);
    const shuffled = assignSeats(anchors, [...colleagues].reverse());

    expect(shuffled).toEqual(reference);
  });

  it('is independent of anchor input order', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_2'),
    ];

    const reference = assignSeats(anchors, colleagues);
    // Shuffle the anchors (reverse halves).
    const shuffledAnchors = [...anchors].reverse();

    expect(assignSeats(shuffledAnchors, colleagues)).toEqual(reference);
  });

  it('is stable across repeated calls with identical input', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_1'),
      colleague('dave', 'office_1'),
    ];

    const first = assignSeats(anchors, colleagues);
    const second = assignSeats(anchors, colleagues);

    expect(second).toEqual(first);
  });

  it('does not mutate the input arrays', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [colleague('alice', 'office_1'), colleague('bob', 'office_1')];
    const anchorsSnapshot = anchors.map((a) => ({ ...a }));
    const colleaguesSnapshot = colleagues.map((c) => ({ ...c }));

    assignSeats(anchors, colleagues);

    expect(anchors).toEqual(anchorsSnapshot);
    expect(colleagues).toEqual(colleaguesSnapshot);
  });
});

// ---------------------------------------------------------------------------
// extractSeatAnchors — Tiled object-layer normalization
// ---------------------------------------------------------------------------

describe('extractSeatAnchors — Tiled SeatAnchors normalization', () => {
  it('reads the building tag from the array property form (campus.json default)', () => {
    const rawAnchors: RawSeatAnchor[] = [
      raw('office_1', 80, 96, 'array'),
      raw('office_2', 200, 96, 'array'),
    ];

    const result = extractSeatAnchors(rawAnchors);

    expect(result).toEqual([
      { x: 80, y: 96, building: 'office_1' },
      { x: 200, y: 96, building: 'office_2' },
    ]);
  });

  it('reads the building tag from the object property form', () => {
    const rawAnchors: RawSeatAnchor[] = [
      raw('office_1', 16, 32, 'object'),
      raw('office_2', 160, 32, 'object'),
    ];

    const result = extractSeatAnchors(rawAnchors);

    expect(result).toEqual([
      { x: 16, y: 32, building: 'office_1' },
      { x: 160, y: 32, building: 'office_2' },
    ]);
  });

  it('drops anchors missing the building tag (a malformed anchor cannot be assigned)', () => {
    const rawAnchors: RawSeatAnchor[] = [
      raw('office_1', 16, 16),
      { x: 32, y: 16, name: 'untagged' }, // no properties at all
      { x: 48, y: 16, name: 'other', properties: [{ name: 'color', value: 'blue' }] }, // wrong tag
    ];

    const result = extractSeatAnchors(rawAnchors);

    expect(result).toEqual([{ x: 16, y: 16, building: 'office_1' }]);
  });

  it('round-trips through assignSeats (extract then assign end-to-end)', () => {
    const rawAnchors: RawSeatAnchor[] = [
      raw('office_1', 16, 16),
      raw('office_1', 32, 16),
      raw('office_2', 160, 16),
    ];
    const colleagues = [
      colleague('alice', 'office_1'),
      colleague('bob', 'office_1'),
      colleague('carol', 'office_2'),
    ];

    const result = assignSeats(extractSeatAnchors(rawAnchors), colleagues);

    expect(result).toHaveLength(3);
    expect(result.every((a) => a.kind === 'seated')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T016 (US1) — player seat reservation (FR-003; research Decision 2)
// ---------------------------------------------------------------------------
//
// `reservedAnchorFor` picks the player's seat: the FIRST anchor of the active
// office in the existing stable `(y, x)` order (top-left first) — zero new
// data, deterministic across sessions/devices/reloads. `assignSeats` gains an
// optional reserved-anchor input: the reserved anchor is EXCLUDED from
// colleague assignment (colleague k shifts by one), and the player anchor and
// colleague positions never overlap at any crowd size, including overflow
// (standing spots stay strictly below every anchor — reserved included).
// `reservedAnchorFor` does not exist yet (T016 RED); the implementation
// lands in T019.

describe('reservedAnchorFor — the deterministic player seat (T016)', () => {
  it('picks the first anchor of the office in the stable (y, x) order', () => {
    // Deliberately shuffled input: (y, x) order puts (16, 32) — topmost row,
    // leftmost x — first for office_1.
    const anchors = [
      anchor('office_1', 48, 32),
      anchor('office_2', 160, 16),
      anchor('office_1', 32, 16),
      anchor('office_1', 64, 16),
      anchor('office_1', 16, 48),
    ];

    expect(reservedAnchorFor(anchors, 'office_1')).toEqual({
      x: 32,
      y: 16,
      building: 'office_1',
    });
  });

  it('is independent of anchor input order (deterministic across calls)', () => {
    const anchors = twoBuildingsAnchors();
    const reversed = [...anchors].reverse();

    expect(reservedAnchorFor(anchors, 'office_2')).toEqual(
      reservedAnchorFor(reversed, 'office_2'),
    );
    expect(reservedAnchorFor(anchors, 'office_2')).toEqual({
      x: 160,
      y: 16,
      building: 'office_2',
    });
  });

  it('returns null when the office has no anchors (map desync — defensive)', () => {
    expect(reservedAnchorFor(twoBuildingsAnchors(), 'office_3')).toBeNull();
    expect(reservedAnchorFor([], 'office_1')).toBeNull();
  });
});

describe('assignSeats — reserved player anchor (T016)', () => {
  it('never seats a colleague on the reserved anchor; colleague k shifts by one', () => {
    const anchors = twoBuildingsAnchors();
    const reserved = reservedAnchorFor(anchors, 'office_1')!;
    const colleagues = [colleague('alice', 'office_1'), colleague('bob', 'office_1')];

    const withoutReservation = assignSeats(anchors, colleagues);
    const withReservation = assignSeats(anchors, colleagues, reserved);

    // Unreserved baseline: alice takes anchor 0 (the (y,x)-first one).
    expect(withoutReservation[0]).toMatchObject({ colleagueId: 'alice', x: 16, y: 16 });

    // Reserved: nobody sits on the reserved anchor; everyone shifts by one.
    expect(withReservation).toHaveLength(2);
    for (const a of withReservation) {
      expect({ x: a.x, y: a.y }).not.toEqual({ x: reserved.x, y: reserved.y });
    }
    expect(withReservation[0]).toMatchObject({
      colleagueId: 'alice',
      kind: 'seated',
      x: 32,
      y: 16,
    });
    expect(withReservation[1]).toMatchObject({
      colleagueId: 'bob',
      kind: 'seated',
      x: 48,
      y: 16,
    });
  });

  it('never collides with the player anchor at any crowd size, including overflow', () => {
    const anchors = twoBuildingsAnchors(); // 3 anchors in office_1
    const reserved = reservedAnchorFor(anchors, 'office_1')!;
    // 12 colleagues into a 3-anchor building with one anchor reserved:
    // 2 seated, 10 standing.
    const crowd = Array.from({ length: 12 }, (_, i) =>
      colleague(`c-${String(i).padStart(2, '0')}`, 'office_1'),
    );

    const result = assignSeats(anchors, crowd, reserved);

    expect(result).toHaveLength(12); // never hidden
    const positions = new Set(result.map((a) => `${a.x},${a.y}`));
    expect(positions.size).toBe(12); // never stacked
    expect(positions.has(`${reserved.x},${reserved.y}`)).toBe(false); // never the player's seat
    expect(result.filter((a) => a.kind === 'seated')).toHaveLength(2);
  });

  it('leaves the other building untouched by the reservation', () => {
    const anchors = twoBuildingsAnchors();
    const reserved = reservedAnchorFor(anchors, 'office_1')!;
    const colleagues = [colleague('carol', 'office_2'), colleague('dave', 'office_2')];

    const withReservation = assignSeats(anchors, colleagues, reserved);

    expect(withReservation).toEqual(assignSeats(anchors, colleagues));
    expect(withReservation[0]).toMatchObject({ colleagueId: 'carol', x: 160, y: 16 });
  });

  it('excludes EVERY anchor sharing the reserved position (duplicate-anchor map quirk)', () => {
    // Two anchors at the same pixel in the same building (a map-authoring
    // error): the no-overlap guarantee wins over capacity — both duplicates
    // are reserved, so no colleague can ever share the player's pixel.
    const anchors = [
      anchor('office_1', 16, 16),
      anchor('office_1', 16, 16),
      anchor('office_1', 32, 16),
    ];
    const reserved = reservedAnchorFor(anchors, 'office_1')!;
    const colleagues = [colleague('alice', 'office_1'), colleague('bob', 'office_1')];

    const result = assignSeats(anchors, colleagues, reserved);

    expect(result).toHaveLength(2); // never hidden
    for (const a of result) {
      expect({ x: a.x, y: a.y }).not.toEqual({ x: reserved.x, y: reserved.y });
    }
    expect(result.filter((a) => a.kind === 'seated')).toHaveLength(1); // only (32,16) remains
  });

  it('is deterministic across calls with the reservation (pure)', () => {
    const anchors = twoBuildingsAnchors();
    const reserved = reservedAnchorFor(anchors, 'office_1')!;
    const crowd = Array.from({ length: 7 }, (_, i) => colleague(`c-${i}`, 'office_1'));

    expect(assignSeats(anchors, crowd, reserved)).toEqual(assignSeats(anchors, crowd, reserved));
  });

  it('treats an explicit null/undefined reservation exactly like the two-arg call', () => {
    const anchors = twoBuildingsAnchors();
    const colleagues = [colleague('alice', 'office_1'), colleague('bob', 'office_2')];

    expect(assignSeats(anchors, colleagues, null)).toEqual(assignSeats(anchors, colleagues));
    expect(assignSeats(anchors, colleagues, undefined)).toEqual(assignSeats(anchors, colleagues));
  });
});
