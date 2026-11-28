import type { Unit } from '@gsc/contracts';

/**
 * Illustrative floor plans, one family per unit type (pure data + geometry; unit-tested).
 *
 * Coordinates are metres, origin top-left of the internal envelope, x to the right, y down.
 * The view side (balcony / terrace, full-height glazing) is always the bottom edge (y = depth).
 * Rooms tile the envelope exactly. Plans are drawn at their template size and then scaled
 * uniformly so the internal area equals the unit's own area from the seed data.
 *
 * Bathroom counts follow the seed: where a type comes with one bathroom fewer, the room marked
 * `alt` (a guest bath) becomes that utility room instead, and its fixtures are dropped.
 */

export type RoomKind =
  | 'living'
  | 'livingDining'
  | 'studio'
  | 'kitchen'
  | 'master'
  | 'bedroom'
  | 'ensuite'
  | 'bath'
  | 'powder'
  | 'walkin'
  | 'wardrobe'
  | 'foyer'
  | 'corridor'
  | 'store'
  | 'laundry';

export const WET_ROOMS: RoomKind[] = ['ensuite', 'bath', 'powder'];
export const BEDROOMS: RoomKind[] = ['master', 'bedroom'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room extends Rect {
  id: string;
  kind: RoomKind;
  /** Kind used when the unit has one bathroom fewer than the template. */
  alt?: RoomKind;
  /** Number shown in the label ("Bedroom 2"). */
  n?: number;
}

/** A gap in a wall. `at` is the wall line; `from`..`to` the span along it. */
export interface Opening {
  axis: 'h' | 'v'; // h: wall runs along x at y = at; v: wall runs along y at x = at
  at: number;
  from: number;
  to: number;
  type: 'entry' | 'door' | 'open';
  /** Side the leaf swings into: '+' = towards larger y (h) or x (v). */
  into?: '+' | '-';
  /** Which end the leaf is hinged at. */
  hinge?: 'from' | 'to';
}

export type FixtureKind =
  | 'bed'
  | 'nightstand'
  | 'sofa'
  | 'armchair'
  | 'coffee'
  | 'dining'
  | 'counter'
  | 'island'
  | 'stools'
  | 'tub'
  | 'shower'
  | 'wc'
  | 'vanity'
  | 'wardrobe'
  | 'desk'
  | 'stair'
  | 'pool'
  | 'lounger';

export interface Fixture extends Rect {
  kind: FixtureKind;
  /** Room the fixture belongs to (or 'outdoor'). */
  room: string;
  /** Bed head / sofa back side. */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /** Chairs around a dining table, stools at an island. */
  seats?: number;
}

export interface PlanTemplate {
  id: string;
  type: Unit['type'];
  width: number;
  depth: number;
  /** Outdoor strip along the view side: wavy balcony or a penthouse terrace. */
  outdoor: { kind: 'balcony' | 'terrace'; depth: number };
  rooms: Room[];
  openings: Opening[];
  /** Full-height glazing spans on the envelope. */
  windows: Omit<Opening, 'type'>[];
  fixtures: Fixture[];
}

const SQFT_PER_M2 = 10.7639;
export const sqftToM2 = (sqft: number) => sqft / SQFT_PER_M2;

/* ------------------------------------------------------------------ templates */

const STUDIO: PlanTemplate = {
  id: 'studio',
  type: 'studio',
  width: 7.2,
  depth: 5.9,
  outdoor: { kind: 'balcony', depth: 1.5 },
  rooms: [
    { id: 'bath', kind: 'bath', x: 0, y: 0, w: 2.4, h: 2.3 },
    { id: 'foyer', kind: 'foyer', x: 2.4, y: 0, w: 1.6, h: 2.3 },
    { id: 'kitchen', kind: 'kitchen', x: 4.0, y: 0, w: 3.2, h: 2.3 },
    { id: 'living', kind: 'studio', x: 0, y: 2.3, w: 7.2, h: 3.6 },
  ],
  openings: [
    { axis: 'h', at: 0, from: 2.75, to: 3.65, type: 'entry', into: '+', hinge: 'from' },
    { axis: 'v', at: 2.4, from: 0.8, to: 1.6, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 2.3, from: 2.4, to: 4.0, type: 'open' },
    { axis: 'h', at: 2.3, from: 4.0, to: 7.2, type: 'open' },
  ],
  windows: [{ axis: 'h', at: 5.9, from: 0.3, to: 6.9 }],
  fixtures: [
    { room: 'bath', kind: 'shower', x: 0.08, y: 0.08, w: 0.95, h: 0.95 },
    { room: 'bath', kind: 'wc', x: 1.6, y: 0.1, w: 0.45, h: 0.65, side: 'top' },
    { room: 'bath', kind: 'vanity', x: 0.08, y: 1.2, w: 0.55, h: 0.95, side: 'left' },
    { room: 'kitchen', kind: 'counter', x: 4.0, y: 0.0, w: 3.2, h: 0.62, side: 'top' },
    { room: 'kitchen', kind: 'dining', x: 5.1, y: 1.2, w: 0.8, h: 0.7, seats: 2 },
    { room: 'living', kind: 'bed', x: 0.12, y: 2.75, w: 2.0, h: 1.6, side: 'left' },
    { room: 'living', kind: 'nightstand', x: 0.12, y: 4.45, w: 0.45, h: 0.4 },
    { room: 'living', kind: 'sofa', x: 6.3, y: 2.9, w: 0.85, h: 2.2, side: 'right' },
    { room: 'living', kind: 'coffee', x: 5.3, y: 3.5, w: 0.65, h: 1.0 },
    { room: 'living', kind: 'armchair', x: 3.4, y: 4.85, w: 0.75, h: 0.75 },
  ],
};

const ONE_BED: PlanTemplate = {
  id: '1br',
  type: '1br',
  width: 10.2,
  depth: 7.2,
  outdoor: { kind: 'balcony', depth: 1.6 },
  rooms: [
    { id: 'ensuite', kind: 'ensuite', x: 0, y: 0, w: 2.4, h: 2.4 },
    { id: 'walkin', kind: 'walkin', x: 2.4, y: 0, w: 1.4, h: 2.4 },
    { id: 'bed1', kind: 'bedroom', x: 0, y: 2.4, w: 3.8, h: 4.8 },
    { id: 'foyer', kind: 'foyer', x: 3.8, y: 0, w: 1.6, h: 2.6 },
    { id: 'guest', kind: 'bath', alt: 'laundry', x: 5.4, y: 0, w: 1.6, h: 2.6 },
    { id: 'kitchen', kind: 'kitchen', x: 7.0, y: 0, w: 3.2, h: 2.6 },
    { id: 'living', kind: 'livingDining', x: 3.8, y: 2.6, w: 6.4, h: 4.6 },
  ],
  openings: [
    { axis: 'h', at: 0, from: 4.15, to: 5.05, type: 'entry', into: '+', hinge: 'from' },
    { axis: 'h', at: 2.6, from: 3.8, to: 5.4, type: 'open' },
    { axis: 'h', at: 2.6, from: 7.0, to: 10.2, type: 'open' },
    { axis: 'v', at: 3.8, from: 2.9, to: 3.7, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 2.4, from: 0.9, to: 1.7, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 2.4, from: 2.6, to: 3.6, type: 'open' },
    { axis: 'v', at: 5.4, from: 1.6, to: 2.4, type: 'door', into: '+', hinge: 'to' },
  ],
  windows: [
    { axis: 'h', at: 7.2, from: 0.3, to: 3.5 },
    { axis: 'h', at: 7.2, from: 4.1, to: 9.9 },
  ],
  fixtures: [
    { room: 'ensuite', kind: 'tub', x: 0.08, y: 0.08, w: 1.7, h: 0.75 },
    { room: 'ensuite', kind: 'vanity', x: 0.08, y: 1.0, w: 0.55, h: 1.1, side: 'left' },
    { room: 'ensuite', kind: 'wc', x: 1.85, y: 1.05, w: 0.45, h: 0.65, side: 'right' },
    { room: 'walkin', kind: 'wardrobe', x: 2.45, y: 0.05, w: 0.55, h: 2.3 },
    { room: 'bed1', kind: 'bed', x: 0.1, y: 3.9, w: 2.0, h: 1.6, side: 'left' },
    { room: 'bed1', kind: 'nightstand', x: 0.1, y: 3.4, w: 0.45, h: 0.42 },
    { room: 'bed1', kind: 'nightstand', x: 0.1, y: 5.6, w: 0.45, h: 0.42 },
    { room: 'bed1', kind: 'armchair', x: 2.8, y: 6.1, w: 0.75, h: 0.75 },
    { room: 'guest', kind: 'shower', x: 5.48, y: 0.08, w: 0.9, h: 0.9 },
    { room: 'guest', kind: 'wc', x: 6.45, y: 0.1, w: 0.45, h: 0.65, side: 'top' },
    { room: 'guest', kind: 'vanity', x: 6.4, y: 1.05, w: 0.55, h: 0.8, side: 'right' },
    { room: 'kitchen', kind: 'counter', x: 7.0, y: 0, w: 3.2, h: 0.62, side: 'top' },
    { room: 'kitchen', kind: 'island', x: 7.6, y: 1.35, w: 2.0, h: 0.75 },
    { room: 'kitchen', kind: 'stools', x: 7.8, y: 2.15, w: 1.6, h: 0.35, seats: 3 },
    { room: 'living', kind: 'dining', x: 4.4, y: 3.2, w: 1.6, h: 0.9, seats: 4 },
    { room: 'living', kind: 'sofa', x: 9.3, y: 3.6, w: 0.85, h: 2.6, side: 'right' },
    { room: 'living', kind: 'coffee', x: 8.0, y: 4.3, w: 0.7, h: 1.2 },
    { room: 'living', kind: 'armchair', x: 6.7, y: 4.1, w: 0.75, h: 0.75 },
    { room: 'living', kind: 'armchair', x: 6.7, y: 5.1, w: 0.75, h: 0.75 },
  ],
};

const TWO_BED: PlanTemplate = {
  id: '2br',
  type: '2br',
  width: 12.6,
  depth: 9.0,
  outdoor: { kind: 'balcony', depth: 1.8 },
  rooms: [
    { id: 'ensuite', kind: 'ensuite', x: 0, y: 0, w: 2.6, h: 3.4 },
    { id: 'walkin', kind: 'walkin', x: 2.6, y: 0, w: 1.4, h: 3.4 },
    { id: 'master', kind: 'master', x: 0, y: 3.4, w: 4.0, h: 5.6 },
    { id: 'foyer', kind: 'foyer', x: 4.0, y: 0, w: 1.8, h: 2.8 },
    { id: 'guest', kind: 'bath', alt: 'store', x: 5.8, y: 0, w: 1.3, h: 2.8 },
    { id: 'kitchen', kind: 'kitchen', x: 7.1, y: 0, w: 1.9, h: 2.8 },
    { id: 'living', kind: 'livingDining', x: 4.0, y: 2.8, w: 5.0, h: 6.2 },
    { id: 'bath2', kind: 'bath', x: 9.0, y: 0, w: 2.4, h: 3.6 },
    { id: 'wardrobe2', kind: 'wardrobe', x: 11.4, y: 0, w: 1.2, h: 3.6 },
    { id: 'bed2', kind: 'bedroom', n: 2, x: 9.0, y: 3.6, w: 3.6, h: 5.4 },
  ],
  openings: [
    { axis: 'h', at: 0, from: 4.45, to: 5.35, type: 'entry', into: '+', hinge: 'from' },
    { axis: 'h', at: 2.8, from: 4.0, to: 5.8, type: 'open' },
    { axis: 'h', at: 2.8, from: 7.1, to: 9.0, type: 'open' },
    { axis: 'v', at: 4.0, from: 3.6, to: 4.4, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 3.4, from: 0.9, to: 1.7, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 3.4, from: 2.75, to: 3.85, type: 'open' },
    { axis: 'v', at: 5.8, from: 1.8, to: 2.6, type: 'door', into: '+', hinge: 'to' },
    { axis: 'v', at: 9.0, from: 3.8, to: 4.6, type: 'door', into: '+', hinge: 'from' },
    { axis: 'h', at: 3.6, from: 9.6, to: 10.4, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 3.6, from: 11.5, to: 12.5, type: 'open' },
  ],
  windows: [
    { axis: 'h', at: 9.0, from: 0.3, to: 3.7 },
    { axis: 'h', at: 9.0, from: 4.3, to: 8.7 },
    { axis: 'h', at: 9.0, from: 9.3, to: 12.3 },
  ],
  fixtures: [
    { room: 'ensuite', kind: 'tub', x: 0.08, y: 0.08, w: 0.8, h: 1.7 },
    { room: 'ensuite', kind: 'shower', x: 1.6, y: 0.08, w: 0.92, h: 0.92 },
    { room: 'ensuite', kind: 'wc', x: 1.95, y: 1.3, w: 0.45, h: 0.65, side: 'right' },
    { room: 'ensuite', kind: 'vanity', x: 0.08, y: 1.95, w: 0.55, h: 1.2, side: 'left' },
    { room: 'walkin', kind: 'wardrobe', x: 2.65, y: 0.05, w: 0.6, h: 3.3 },
    { room: 'master', kind: 'bed', x: 0.1, y: 5.3, w: 2.1, h: 1.8, side: 'left' },
    { room: 'master', kind: 'nightstand', x: 0.1, y: 4.8, w: 0.45, h: 0.42 },
    { room: 'master', kind: 'nightstand', x: 0.1, y: 7.2, w: 0.45, h: 0.42 },
    { room: 'master', kind: 'armchair', x: 3.0, y: 7.8, w: 0.75, h: 0.75 },
    { room: 'guest', kind: 'shower', x: 5.85, y: 0.05, w: 0.9, h: 0.9 },
    { room: 'guest', kind: 'wc', x: 6.55, y: 1.05, w: 0.45, h: 0.65, side: 'right' },
    { room: 'guest', kind: 'vanity', x: 5.85, y: 1.05, w: 0.5, h: 0.6, side: 'left' },
    { room: 'kitchen', kind: 'counter', x: 7.1, y: 0, w: 1.9, h: 0.62, side: 'top' },
    { room: 'kitchen', kind: 'counter', x: 8.38, y: 0.62, w: 0.62, h: 1.6, side: 'right' },
    { room: 'living', kind: 'dining', x: 4.5, y: 3.4, w: 1.8, h: 0.95, seats: 6 },
    { room: 'living', kind: 'sofa', x: 4.1, y: 5.6, w: 0.85, h: 2.4, side: 'left' },
    { room: 'living', kind: 'coffee', x: 5.3, y: 6.2, w: 0.7, h: 1.2 },
    { room: 'living', kind: 'armchair', x: 7.6, y: 5.9, w: 0.75, h: 0.75 },
    { room: 'living', kind: 'armchair', x: 7.6, y: 6.9, w: 0.75, h: 0.75 },
    { room: 'bath2', kind: 'tub', x: 9.08, y: 0.08, w: 1.7, h: 0.75 },
    { room: 'bath2', kind: 'vanity', x: 10.8, y: 0.95, w: 0.55, h: 1.1, side: 'right' },
    { room: 'bath2', kind: 'wc', x: 9.1, y: 1.4, w: 0.65, h: 0.45, side: 'left' },
    { room: 'wardrobe2', kind: 'wardrobe', x: 11.45, y: 0.05, w: 0.6, h: 3.3 },
    { room: 'bed2', kind: 'bed', x: 10.5, y: 5.6, w: 2.0, h: 1.6, side: 'right' },
    { room: 'bed2', kind: 'nightstand', x: 12.1, y: 5.1, w: 0.45, h: 0.42 },
    { room: 'bed2', kind: 'nightstand', x: 12.1, y: 7.3, w: 0.45, h: 0.42 },
    { room: 'bed2', kind: 'desk', x: 9.1, y: 7.9, w: 1.2, h: 0.55 },
  ],
};

const THREE_BED: PlanTemplate = {
  id: '3br',
  type: '3br',
  width: 15.2,
  depth: 10.8,
  outdoor: { kind: 'balcony', depth: 2.0 },
  rooms: [
    { id: 'ensuite', kind: 'ensuite', x: 0, y: 0, w: 2.8, h: 3.8 },
    { id: 'walkin', kind: 'walkin', x: 2.8, y: 0, w: 1.6, h: 3.8 },
    { id: 'master', kind: 'master', x: 0, y: 3.8, w: 4.4, h: 7.0 },
    { id: 'foyer', kind: 'foyer', x: 4.4, y: 0, w: 2.0, h: 3.2 },
    { id: 'guest', kind: 'bath', alt: 'store', x: 6.4, y: 0, w: 1.6, h: 3.2 },
    { id: 'kitchen', kind: 'kitchen', x: 8.0, y: 0, w: 2.8, h: 3.2 },
    { id: 'living', kind: 'livingDining', x: 4.4, y: 3.2, w: 6.4, h: 7.6 },
    { id: 'bath2', kind: 'bath', x: 10.8, y: 0, w: 2.2, h: 2.8 },
    { id: 'bath3', kind: 'ensuite', x: 13.0, y: 0, w: 2.2, h: 2.8 },
    { id: 'hall', kind: 'corridor', x: 10.8, y: 2.8, w: 1.2, h: 4.0 },
    { id: 'bed2', kind: 'bedroom', n: 2, x: 12.0, y: 2.8, w: 3.2, h: 4.0 },
    { id: 'bed3', kind: 'bedroom', n: 3, x: 10.8, y: 6.8, w: 4.4, h: 4.0 },
  ],
  openings: [
    { axis: 'h', at: 0, from: 4.95, to: 5.85, type: 'entry', into: '+', hinge: 'from' },
    { axis: 'h', at: 3.2, from: 4.4, to: 6.4, type: 'open' },
    { axis: 'h', at: 3.2, from: 8.0, to: 10.8, type: 'open' },
    { axis: 'v', at: 4.4, from: 4.0, to: 4.9, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 3.8, from: 1.0, to: 1.8, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 3.8, from: 2.95, to: 4.25, type: 'open' },
    { axis: 'v', at: 6.4, from: 2.2, to: 3.0, type: 'door', into: '+', hinge: 'to' },
    { axis: 'v', at: 10.8, from: 3.4, to: 4.6, type: 'open' },
    { axis: 'h', at: 2.8, from: 11.0, to: 11.8, type: 'door', into: '-', hinge: 'from' },
    { axis: 'v', at: 12.0, from: 3.2, to: 4.0, type: 'door', into: '+', hinge: 'from' },
    { axis: 'h', at: 2.8, from: 13.6, to: 14.4, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 6.8, from: 11.0, to: 11.8, type: 'door', into: '+', hinge: 'from' },
  ],
  windows: [
    { axis: 'h', at: 10.8, from: 0.3, to: 4.1 },
    { axis: 'h', at: 10.8, from: 4.7, to: 10.5 },
    { axis: 'h', at: 10.8, from: 11.1, to: 14.9 },
    { axis: 'v', at: 15.2, from: 3.1, to: 6.5 },
    { axis: 'v', at: 15.2, from: 7.1, to: 10.5 },
  ],
  fixtures: [
    { room: 'ensuite', kind: 'tub', x: 0.08, y: 0.08, w: 0.8, h: 1.7 },
    { room: 'ensuite', kind: 'shower', x: 1.8, y: 0.08, w: 0.92, h: 0.92 },
    { room: 'ensuite', kind: 'wc', x: 2.25, y: 1.3, w: 0.45, h: 0.65, side: 'right' },
    { room: 'ensuite', kind: 'vanity', x: 0.08, y: 2.0, w: 0.55, h: 1.4, side: 'left' },
    { room: 'walkin', kind: 'wardrobe', x: 2.85, y: 0.05, w: 0.6, h: 3.7 },
    { room: 'master', kind: 'bed', x: 0.1, y: 6.4, w: 2.1, h: 1.8, side: 'left' },
    { room: 'master', kind: 'nightstand', x: 0.1, y: 5.9, w: 0.45, h: 0.42 },
    { room: 'master', kind: 'nightstand', x: 0.1, y: 8.3, w: 0.45, h: 0.42 },
    { room: 'master', kind: 'armchair', x: 3.3, y: 9.6, w: 0.75, h: 0.75 },
    { room: 'guest', kind: 'shower', x: 6.48, y: 0.08, w: 0.9, h: 0.9 },
    { room: 'guest', kind: 'wc', x: 7.45, y: 0.12, w: 0.45, h: 0.65, side: 'top' },
    { room: 'guest', kind: 'vanity', x: 7.4, y: 1.2, w: 0.55, h: 0.9, side: 'right' },
    { room: 'kitchen', kind: 'counter', x: 8.0, y: 0, w: 2.8, h: 0.62, side: 'top' },
    { room: 'kitchen', kind: 'island', x: 8.5, y: 1.55, w: 1.8, h: 0.8 },
    { room: 'kitchen', kind: 'stools', x: 8.6, y: 2.45, w: 1.6, h: 0.35, seats: 3 },
    { room: 'living', kind: 'dining', x: 5.0, y: 4.0, w: 2.2, h: 1.0, seats: 6 },
    { room: 'living', kind: 'sofa', x: 5.0, y: 7.4, w: 0.9, h: 2.6, side: 'left' },
    { room: 'living', kind: 'coffee', x: 6.3, y: 7.9, w: 0.8, h: 1.4 },
    { room: 'living', kind: 'armchair', x: 8.0, y: 7.6, w: 0.8, h: 0.8 },
    { room: 'living', kind: 'armchair', x: 8.0, y: 8.8, w: 0.8, h: 0.8 },
    { room: 'bath2', kind: 'shower', x: 10.88, y: 0.08, w: 0.9, h: 0.9 },
    { room: 'bath2', kind: 'wc', x: 12.45, y: 0.12, w: 0.45, h: 0.65, side: 'top' },
    { room: 'bath2', kind: 'vanity', x: 12.4, y: 1.0, w: 0.55, h: 0.9, side: 'right' },
    { room: 'bath3', kind: 'tub', x: 13.08, y: 0.08, w: 1.7, h: 0.75 },
    { room: 'bath3', kind: 'wc', x: 14.65, y: 1.0, w: 0.45, h: 0.65, side: 'right' },
    { room: 'bath3', kind: 'vanity', x: 13.08, y: 1.1, w: 0.5, h: 0.85, side: 'left' },
    { room: 'bed2', kind: 'bed', x: 13.1, y: 4.0, w: 2.0, h: 1.6, side: 'right' },
    { room: 'bed2', kind: 'nightstand', x: 14.65, y: 3.5, w: 0.45, h: 0.42 },
    { room: 'bed2', kind: 'nightstand', x: 14.65, y: 5.68, w: 0.45, h: 0.42 },
    { room: 'bed3', kind: 'bed', x: 13.1, y: 8.0, w: 2.0, h: 1.6, side: 'right' },
    { room: 'bed3', kind: 'nightstand', x: 14.65, y: 7.5, w: 0.45, h: 0.42 },
    { room: 'bed3', kind: 'nightstand', x: 14.65, y: 9.68, w: 0.45, h: 0.42 },
    { room: 'bed3', kind: 'desk', x: 10.9, y: 9.95, w: 1.2, h: 0.55 },
  ],
};

const PENTHOUSE: PlanTemplate = {
  id: 'penthouse',
  type: 'penthouse',
  width: 20.0,
  depth: 14.8,
  outdoor: { kind: 'terrace', depth: 3.0 },
  rooms: [
    { id: 'ensuite', kind: 'ensuite', x: 0, y: 0, w: 3.2, h: 4.4 },
    { id: 'dressing', kind: 'walkin', x: 3.2, y: 0, w: 2.0, h: 4.4 },
    { id: 'master', kind: 'master', x: 0, y: 4.4, w: 5.2, h: 10.4 },
    { id: 'foyer', kind: 'foyer', x: 5.2, y: 0, w: 2.6, h: 3.6 },
    { id: 'powder', kind: 'powder', x: 7.8, y: 0, w: 1.6, h: 3.6 },
    { id: 'kitchen', kind: 'kitchen', x: 9.4, y: 0, w: 4.2, h: 3.6 },
    { id: 'living', kind: 'livingDining', x: 5.2, y: 3.6, w: 8.4, h: 11.2 },
    { id: 'bath2', kind: 'bath', x: 13.6, y: 0, w: 3.2, h: 3.0 },
    { id: 'bath3', kind: 'ensuite', x: 16.8, y: 0, w: 3.2, h: 3.0 },
    { id: 'hall', kind: 'corridor', x: 13.6, y: 3.0, w: 1.4, h: 7.2 },
    { id: 'bed2', kind: 'bedroom', n: 2, x: 15.0, y: 3.0, w: 5.0, h: 4.2 },
    { id: 'bed3', kind: 'bedroom', n: 3, x: 15.0, y: 7.2, w: 5.0, h: 3.0 },
    { id: 'bed4', kind: 'bedroom', n: 4, x: 13.6, y: 10.2, w: 4.2, h: 4.6 },
    { id: 'bath4', kind: 'ensuite', x: 17.8, y: 10.2, w: 2.2, h: 4.6 },
  ],
  openings: [
    { axis: 'h', at: 0, from: 6.05, to: 7.05, type: 'entry', into: '+', hinge: 'from' },
    { axis: 'h', at: 3.6, from: 5.2, to: 7.8, type: 'open' },
    { axis: 'h', at: 3.6, from: 9.4, to: 13.6, type: 'open' },
    { axis: 'v', at: 5.2, from: 4.8, to: 5.8, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 4.4, from: 1.2, to: 2.1, type: 'door', into: '-', hinge: 'from' },
    { axis: 'h', at: 4.4, from: 3.4, to: 5.0, type: 'open' },
    { axis: 'v', at: 7.8, from: 2.6, to: 3.4, type: 'door', into: '+', hinge: 'to' },
    { axis: 'v', at: 13.6, from: 4.0, to: 5.6, type: 'open' },
    { axis: 'h', at: 3.0, from: 13.8, to: 14.6, type: 'door', into: '-', hinge: 'from' },
    { axis: 'v', at: 15.0, from: 3.4, to: 4.2, type: 'door', into: '+', hinge: 'from' },
    { axis: 'h', at: 3.0, from: 17.6, to: 18.4, type: 'door', into: '-', hinge: 'from' },
    { axis: 'v', at: 15.0, from: 7.6, to: 8.4, type: 'door', into: '+', hinge: 'from' },
    { axis: 'h', at: 10.2, from: 13.85, to: 14.75, type: 'door', into: '+', hinge: 'from' },
    { axis: 'v', at: 17.8, from: 10.6, to: 11.4, type: 'door', into: '+', hinge: 'from' },
  ],
  windows: [
    { axis: 'h', at: 14.8, from: 0.3, to: 4.9 },
    { axis: 'h', at: 14.8, from: 5.5, to: 13.3 },
    { axis: 'h', at: 14.8, from: 13.9, to: 17.5 },
    { axis: 'h', at: 14.8, from: 18.1, to: 19.7 },
    { axis: 'v', at: 20.0, from: 3.3, to: 6.9 },
    { axis: 'v', at: 20.0, from: 7.5, to: 9.9 },
  ],
  fixtures: [
    { room: 'ensuite', kind: 'tub', x: 0.08, y: 0.08, w: 1.8, h: 0.85 },
    { room: 'ensuite', kind: 'shower', x: 2.2, y: 0.08, w: 0.92, h: 1.1 },
    { room: 'ensuite', kind: 'wc', x: 2.65, y: 1.5, w: 0.45, h: 0.65, side: 'right' },
    { room: 'ensuite', kind: 'vanity', x: 0.08, y: 2.0, w: 0.6, h: 1.8, side: 'left' },
    { room: 'dressing', kind: 'wardrobe', x: 3.25, y: 0.05, w: 0.6, h: 4.3 },
    { room: 'dressing', kind: 'wardrobe', x: 4.55, y: 0.05, w: 0.6, h: 3.0 },
    { room: 'master', kind: 'bed', x: 0.1, y: 8.0, w: 2.1, h: 1.8, side: 'left' },
    { room: 'master', kind: 'nightstand', x: 0.1, y: 7.5, w: 0.45, h: 0.42 },
    { room: 'master', kind: 'nightstand', x: 0.1, y: 9.9, w: 0.45, h: 0.42 },
    { room: 'master', kind: 'sofa', x: 1.6, y: 12.9, w: 2.2, h: 0.85, side: 'top' },
    { room: 'master', kind: 'desk', x: 3.8, y: 6.6, w: 1.2, h: 0.55 },
    { room: 'powder', kind: 'wc', x: 8.85, y: 0.12, w: 0.45, h: 0.65, side: 'top' },
    { room: 'powder', kind: 'vanity', x: 8.8, y: 1.2, w: 0.55, h: 0.9, side: 'right' },
    { room: 'kitchen', kind: 'counter', x: 9.4, y: 0, w: 4.2, h: 0.62, side: 'top' },
    { room: 'kitchen', kind: 'counter', x: 12.98, y: 0.62, w: 0.62, h: 1.4, side: 'right' },
    { room: 'kitchen', kind: 'island', x: 10.2, y: 1.7, w: 2.4, h: 0.9 },
    { room: 'kitchen', kind: 'stools', x: 10.4, y: 2.75, w: 2.0, h: 0.35, seats: 4 },
    { room: 'living', kind: 'dining', x: 6.0, y: 4.6, w: 2.8, h: 1.1, seats: 8 },
    { room: 'living', kind: 'stair', x: 11.4, y: 4.0, w: 2.0, h: 2.0 },
    { room: 'living', kind: 'sofa', x: 6.2, y: 10.4, w: 3.4, h: 0.95, side: 'top' },
    { room: 'living', kind: 'coffee', x: 7.1, y: 11.7, w: 1.6, h: 0.8 },
    { room: 'living', kind: 'armchair', x: 10.4, y: 10.6, w: 0.85, h: 0.85 },
    { room: 'living', kind: 'armchair', x: 10.4, y: 11.8, w: 0.85, h: 0.85 },
    { room: 'bath2', kind: 'shower', x: 13.68, y: 0.08, w: 0.92, h: 0.92 },
    { room: 'bath2', kind: 'vanity', x: 15.2, y: 0.08, w: 0.9, h: 0.55, side: 'top' },
    { room: 'bath2', kind: 'wc', x: 16.25, y: 0.9, w: 0.45, h: 0.65, side: 'right' },
    { room: 'bath3', kind: 'tub', x: 16.88, y: 0.08, w: 1.7, h: 0.75 },
    { room: 'bath3', kind: 'wc', x: 19.45, y: 0.12, w: 0.45, h: 0.65, side: 'top' },
    { room: 'bath3', kind: 'vanity', x: 19.4, y: 1.0, w: 0.55, h: 0.9, side: 'right' },
    { room: 'bed2', kind: 'bed', x: 17.9, y: 4.3, w: 2.0, h: 1.6, side: 'right' },
    { room: 'bed2', kind: 'nightstand', x: 19.45, y: 3.8, w: 0.45, h: 0.42 },
    { room: 'bed2', kind: 'nightstand', x: 19.45, y: 6.0, w: 0.45, h: 0.42 },
    { room: 'bed2', kind: 'desk', x: 15.2, y: 6.4, w: 1.2, h: 0.55 },
    { room: 'bed3', kind: 'bed', x: 17.9, y: 7.9, w: 2.0, h: 1.6, side: 'right' },
    { room: 'bed3', kind: 'nightstand', x: 19.45, y: 7.4, w: 0.45, h: 0.42 },
    { room: 'bed3', kind: 'nightstand', x: 19.45, y: 9.6, w: 0.45, h: 0.42 },
    { room: 'bed4', kind: 'bed', x: 15.4, y: 10.3, w: 1.6, h: 2.0, side: 'top' },
    { room: 'bed4', kind: 'nightstand', x: 14.85, y: 10.3, w: 0.45, h: 0.42 },
    { room: 'bed4', kind: 'nightstand', x: 17.1, y: 10.3, w: 0.45, h: 0.42 },
    { room: 'bath4', kind: 'tub', x: 19.1, y: 10.3, w: 0.8, h: 1.7 },
    { room: 'bath4', kind: 'wc', x: 17.88, y: 12.6, w: 0.65, h: 0.45, side: 'left' },
    { room: 'bath4', kind: 'vanity', x: 18.0, y: 13.9, w: 1.2, h: 0.55, side: 'bottom' },
    { room: 'outdoor', kind: 'pool', x: 6.0, y: 15.4, w: 7.0, h: 1.6 },
    { room: 'outdoor', kind: 'lounger', x: 14.5, y: 15.3, w: 0.7, h: 1.9 },
    { room: 'outdoor', kind: 'lounger', x: 15.5, y: 15.3, w: 0.7, h: 1.9 },
    { room: 'outdoor', kind: 'lounger', x: 16.5, y: 15.3, w: 0.7, h: 1.9 },
  ],
};

export const PLAN_TEMPLATES: PlanTemplate[] = [STUDIO, ONE_BED, TWO_BED, THREE_BED, PENTHOUSE];

/** 4-bed and townhouse types are not in the sample data; they borrow the closest family. */
const FAMILY: Record<Unit['type'], PlanTemplate> = {
  studio: STUDIO,
  '1br': ONE_BED,
  '2br': TWO_BED,
  '3br': THREE_BED,
  '4br': THREE_BED,
  penthouse: PENTHOUSE,
  townhouse: THREE_BED,
};

/* ------------------------------------------------------------------ geometry helpers */

export const area = (r: Rect) => r.w * r.h;
export const envelopeArea = (t: Pick<PlanTemplate, 'width' | 'depth'>) => t.width * t.depth;

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-9 && h > 1e-9 ? w * h : 0;
}

export function inside(inner: Rect, outer: Rect, eps = 1e-6): boolean {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}

export const isBathroom = (k: RoomKind) => WET_ROOMS.includes(k);
export const isBedroom = (k: RoomKind) => BEDROOMS.includes(k);
export const bathroomCount = (t: PlanTemplate) => t.rooms.filter((r) => isBathroom(r.kind)).length;
export const bedroomCount = (t: PlanTemplate) => t.rooms.filter((r) => isBedroom(r.kind)).length;

/** Rooms on either side of an opening (empty side = outside the envelope). */
export function roomsAcross(t: Pick<PlanTemplate, 'rooms'>, o: Opening): [Room | undefined, Room | undefined] {
  const eps = 1e-6;
  const covers = (r: Room) =>
    o.axis === 'h' ? r.x <= o.from + eps && r.x + r.w >= o.to - eps : r.y <= o.from + eps && r.y + r.h >= o.to - eps;
  const before = t.rooms.find((r) => covers(r) && (o.axis === 'h' ? Math.abs(r.y + r.h - o.at) < eps : Math.abs(r.x + r.w - o.at) < eps));
  const after = t.rooms.find((r) => covers(r) && (o.axis === 'h' ? Math.abs(r.y - o.at) < eps : Math.abs(r.x - o.at) < eps));
  return [before, after];
}

/* ------------------------------------------------------------------ resolved plans */

export interface ResolvedPlan extends PlanTemplate {
  /** Uniform scale applied to the template so the envelope matches the unit's area. */
  scale: number;
  areaM2: number;
  bedrooms: number;
  bathrooms: number;
}

function scaleRect<T extends Rect>(r: T, k: number): T {
  return { ...r, x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
}

/**
 * The plan for a unit (or a type at its template size). Applies the bathroom variant and scales the
 * template so its internal area equals the unit's area.
 */
export function planFor(type: Unit['type'], opts: { bathrooms?: number; areaSqft?: number } = {}): ResolvedPlan {
  const tpl = FAMILY[type];
  const full = bathroomCount(tpl);
  const fewer = opts.bathrooms !== undefined && opts.bathrooms < full;
  const dropped = new Set<string>();
  const rooms = tpl.rooms.map((r) => {
    if (fewer && r.alt) {
      dropped.add(r.id);
      return { ...r, kind: r.alt };
    }
    return r;
  });
  const fixtures = tpl.fixtures.filter((f) => !dropped.has(f.room));
  const k = opts.areaSqft ? Math.sqrt(sqftToM2(opts.areaSqft) / envelopeArea(tpl)) : 1;
  const sOpen = (o: Opening): Opening => ({ ...o, at: o.at * k, from: o.from * k, to: o.to * k });
  const resolved: PlanTemplate = {
    ...tpl,
    width: tpl.width * k,
    depth: tpl.depth * k,
    outdoor: { ...tpl.outdoor, depth: tpl.outdoor.depth * k },
    rooms: rooms.map((r) => scaleRect(r, k)),
    openings: tpl.openings.map(sOpen),
    windows: tpl.windows.map((w) => ({ ...w, at: w.at * k, from: w.from * k, to: w.to * k })),
    fixtures: fixtures.map((f) => scaleRect(f, k)),
  };
  return {
    ...resolved,
    scale: k,
    areaM2: envelopeArea(resolved),
    bedrooms: bedroomCount(resolved),
    bathrooms: bathroomCount(resolved),
  };
}

/* ------------------------------------------------------------------ walls */

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  exterior: boolean;
}

type Span = [number, number];

function union(spans: Span[]): Span[] {
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(spans: Span[], cuts: Span[]): Span[] {
  let out = spans;
  for (const [c0, c1] of cuts) {
    const next: Span[] = [];
    for (const [a, b] of out) {
      if (c1 <= a + 1e-6 || c0 >= b - 1e-6) next.push([a, b]);
      else {
        if (c0 > a + 1e-6) next.push([a, c0]);
        if (c1 < b - 1e-6) next.push([c1, b]);
      }
    }
    out = next;
  }
  return out;
}

/** Wall centre-lines: every room edge, merged, minus door/opening and window spans. */
export function wallSegments(p: PlanTemplate): Segment[] {
  const key = (v: number) => Math.round(v * 1e4) / 1e4;
  const lines: Record<'h' | 'v', Map<number, Span[]>> = { h: new Map(), v: new Map() };
  const add = (axis: 'h' | 'v', at: number, a: number, b: number) => {
    const m = lines[axis];
    const k = key(at);
    m.set(k, [...(m.get(k) ?? []), [a, b]]);
  };
  for (const r of p.rooms) {
    add('h', r.y, r.x, r.x + r.w);
    add('h', r.y + r.h, r.x, r.x + r.w);
    add('v', r.x, r.y, r.y + r.h);
    add('v', r.x + r.w, r.y, r.y + r.h);
  }
  const cutsFor = (axis: 'h' | 'v', at: number): Span[] =>
    [...p.openings, ...p.windows].filter((o) => o.axis === axis && Math.abs(o.at - at) < 1e-4).map((o) => [o.from, o.to]);
  const out: Segment[] = [];
  for (const axis of ['h', 'v'] as const) {
    for (const [at, spans] of lines[axis]) {
      const exterior = axis === 'h' ? at < 1e-4 || Math.abs(at - p.depth) < 1e-4 : at < 1e-4 || Math.abs(at - p.width) < 1e-4;
      for (const [a, b] of subtract(union(spans), cutsFor(axis, at))) {
        out.push(axis === 'h' ? { x1: a, y1: at, x2: b, y2: at, exterior } : { x1: at, y1: a, x2: at, y2: b, exterior });
      }
    }
  }
  return out;
}

/** Rooms reachable from the room behind the entry door, walking through openings. */
export function reachableRooms(p: PlanTemplate): Set<string> {
  const entry = p.openings.find((o) => o.type === 'entry');
  if (!entry) return new Set();
  const [, start] = roomsAcross(p, entry);
  const seen = new Set<string>(start ? [start.id] : []);
  const queue = start ? [start] : [];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const o of p.openings) {
      if (o.type === 'entry') continue;
      const [a, b] = roomsAcross(p, o);
      const other = a?.id === cur.id ? b : b?.id === cur.id ? a : undefined;
      if (other && !seen.has(other.id)) {
        seen.add(other.id);
        queue.push(other);
      }
    }
  }
  return seen;
}

/* ------------------------------------------------------------------ labels */

/** The square a door leaf sweeps through (kept clear of labels). */
export function doorSwing(o: Opening): Rect {
  const L = o.to - o.from;
  const s = o.into === '-' ? -1 : 1;
  return o.axis === 'h'
    ? { x: o.from, y: s > 0 ? o.at : o.at - L, w: L, h: L }
    : { x: s > 0 ? o.at : o.at - L, y: o.from, w: L, h: L };
}

/**
 * Where to put a room's label (centre of a w x h box): the candidate spot inside the room whose box overlaps the
 * room's furniture least, preferring the centre. Pure, so the drawing never has text sitting on a bed.
 */
export function labelSpot(room: Rect, fixtures: Rect[], w: number, h: number): { x: number; y: number } {
  const fr = [0.5, 0.35, 0.65, 0.25, 0.75];
  let best = { x: room.x + room.w / 2, y: room.y + room.h / 2, score: Infinity };
  for (const fy of fr)
    for (const fx of fr) {
      const cx = room.x + room.w * fx;
      const cy = room.y + room.h * fy;
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      const hit = fixtures.reduce((s, f) => s + overlap(box, f), 0);
      const outside = area(box) - overlap(box, room);
      const score = (hit + outside * 2) * 100 + Math.hypot(fx - 0.5, fy - 0.5);
      if (score < best.score) best = { x: cx, y: cy, score };
    }
  return { x: best.x, y: best.y };
}
