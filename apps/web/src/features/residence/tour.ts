import type { Unit, UnitType } from '@gsc/contracts';
import { type RoomKind, planFor } from './floorplans';

/**
 * Immersive 360° tours: one panorama per stop, rendered in Blender (assets/models/source/tours.py) from the
 * same floor plans the site draws. This file is the single source of truth for where each panorama is taken:
 * `pnpm --filter @gsc/web tours:export` writes it (with the plans) to assets/models/source/tours.json for Blender.
 *
 * Plan coordinates: metres, x to the right, y towards the view side (balcony / glazing), as in ./floorplans.
 * Panorama convention: the centre of every image looks towards +y (the view); yaw grows clockwise seen from above.
 */

export type StopLabel = RoomKind | 'balcony' | 'terrace' | AmenityStopLabel;
export type AmenityStopLabel = 'arrival' | 'lounge' | 'bar' | 'pool' | 'relax' | 'studio' | 'deck' | 'boardwalk';

export interface TourStop {
  id: string;
  label: StopLabel;
  /** Number shown after the label ("Bedroom 2"). */
  n?: number;
  /** Camera position in plan metres (template scale for residences). */
  at: [number, number];
  /** Direction the viewer faces on arrival, degrees (0 = towards the view, 90 = towards +x). */
  yaw?: number;
}

/** Residence types with their own interiors. 4-bed and townhouse borrow the 3-bed tour (as they borrow its plan). */
export type TourType = 'studio' | '1br' | '2br' | '3br' | 'penthouse';

export const TOUR_TYPE: Record<UnitType, TourType> = {
  studio: 'studio',
  '1br': '1br',
  '2br': '2br',
  '3br': '3br',
  '4br': '3br',
  penthouse: 'penthouse',
  townhouse: '3br',
};

/** Where the views are taken from (the exterior model): the representative residence of each type. */
export const TOUR_VIEWPOINT: Record<TourType, { building: 'T1'; floor: number; position: '01' | '02' | '03' | '04' }> = {
  studio: { building: 'T1', floor: 10, position: '03' },
  '1br': { building: 'T1', floor: 12, position: '01' },
  '2br': { building: 'T1', floor: 14, position: '02' },
  '3br': { building: 'T1', floor: 16, position: '04' },
  penthouse: { building: 'T1', floor: 24, position: '04' },
};

export const RESIDENCE_TOURS: Record<TourType, TourStop[]> = {
  studio: [
    { id: 'living', label: 'studio', at: [3.0, 3.5], yaw: 20 },
    { id: 'kitchen', label: 'kitchen', at: [4.5, 1.45], yaw: 150 },
    { id: 'bath', label: 'bath', at: [1.25, 1.55], yaw: 200 },
    { id: 'balcony', label: 'balcony', at: [3.6, 6.65], yaw: 0 },
  ],
  '1br': [
    { id: 'living', label: 'livingDining', at: [5.5, 5.5], yaw: 20 },
    { id: 'kitchen', label: 'kitchen', at: [8.6, 1.0], yaw: 20 },
    { id: 'bedroom', label: 'bedroom', at: [2.6, 4.7], yaw: -60 },
    { id: 'ensuite', label: 'ensuite', at: [1.35, 1.6], yaw: 180 },
    { id: 'balcony', label: 'balcony', at: [6.9, 8.0], yaw: 0 },
  ],
  '2br': [
    { id: 'living', label: 'livingDining', at: [6.5, 5.6], yaw: 0 },
    { id: 'kitchen', label: 'kitchen', at: [7.75, 1.7], yaw: 150 },
    { id: 'master', label: 'master', at: [2.6, 6.3], yaw: -70 },
    { id: 'ensuite', label: 'ensuite', at: [1.3, 1.6], yaw: 180 },
    { id: 'bedroom2', label: 'bedroom', n: 2, at: [9.8, 4.4], yaw: 40 },
    { id: 'balcony', label: 'balcony', at: [6.5, 9.95], yaw: 0 },
  ],
  '3br': [
    { id: 'living', label: 'livingDining', at: [7.6, 6.6], yaw: 0 },
    { id: 'kitchen', label: 'kitchen', at: [9.4, 1.1], yaw: 20 },
    { id: 'master', label: 'master', at: [2.9, 7.1], yaw: -70 },
    { id: 'ensuite', label: 'ensuite', at: [1.4, 2.0], yaw: 180 },
    { id: 'bedroom2', label: 'bedroom', n: 2, at: [12.7, 4.8], yaw: 80 },
    { id: 'balcony', label: 'balcony', at: [7.6, 11.9], yaw: 0 },
  ],
  penthouse: [
    { id: 'living', label: 'livingDining', at: [9.4, 8.6], yaw: 0 },
    { id: 'kitchen', label: 'kitchen', at: [11.4, 1.2], yaw: 20 },
    { id: 'master', label: 'master', at: [3.3, 9.0], yaw: -70 },
    { id: 'ensuite', label: 'ensuite', at: [1.7, 2.6], yaw: 180 },
    { id: 'bedroom2', label: 'bedroom', n: 2, at: [16.6, 5.1], yaw: 80 },
    { id: 'terrace', label: 'terrace', at: [3.6, 16.3], yaw: 30 },
  ],
};

/* ------------------------------------------------------------------ amenities */

export type AmenityKey = 'lobby' | 'podium-pool' | 'sky-lounge' | 'spa' | 'gym' | 'promenade';

export interface AmenityTour {
  stops: TourStop[];
  /** Footprint (metres) used for the mini map; stops are placed in it. */
  size: [number, number];
  /**
   * Camera fly-in in the live 3D scene (three.js coordinates, 1 unit = 1 floor):
   * the point the camera looks at and where it ends up just before the cut to the panorama.
   */
  fly: { target: [number, number, number]; camera: [number, number, number] };
}

export const AMENITY_TOURS: Record<AmenityKey, AmenityTour> = {
  lobby: {
    size: [16, 12],
    stops: [
      { id: 'arrival', label: 'arrival', at: [8, 8.6], yaw: 180 },
      { id: 'lounge', label: 'lounge', at: [7.0, 4.4], yaw: -50 },
    ],
    fly: { target: [0, 0.8, -6.6], camera: [0, 1.4, -14] },
  },
  'podium-pool': {
    size: [24, 12],
    stops: [{ id: 'deck', label: 'deck', at: [12, 6], yaw: 0 }],
    fly: { target: [0, 2.2, 0], camera: [0, 6, -12] },
  },
  'sky-lounge': {
    size: [16, 10],
    stops: [
      { id: 'lounge', label: 'lounge', at: [8, 6.2], yaw: 0 },
      { id: 'bar', label: 'bar', at: [8, 2.6], yaw: 0 },
    ],
    fly: { target: [-8, 24.9, -1], camera: [-8, 25.7, -9.5] },
  },
  spa: {
    size: [14, 10],
    stops: [
      { id: 'pool', label: 'pool', at: [3.0, 3.0], yaw: 60 },
      { id: 'relax', label: 'relax', at: [12.0, 5.6], yaw: -60 },
    ],
    fly: { target: [6, 0.8, -6.6], camera: [8, 1.6, -13] },
  },
  gym: {
    size: [14, 9],
    stops: [{ id: 'studio', label: 'studio', at: [7, 4.2], yaw: 0 }],
    fly: { target: [-6, 0.8, -6.6], camera: [-8, 1.6, -13] },
  },
  promenade: {
    size: [40, 8],
    stops: [{ id: 'boardwalk', label: 'boardwalk', at: [20, 4], yaw: 0 }],
    fly: { target: [6, 0.6, -10.6], camera: [16, 3.5, -22] },
  },
};

/* ------------------------------------------------------------------ files + geometry */

export const TOUR_ROOT = '/tours';

/** Panorama URLs: 2048 px on phones, 4096 px elsewhere. */
export function panoUrl(group: string, stop: string, size: 2048 | 4096) {
  return `${TOUR_ROOT}/${group}/${stop}-${size}.webp`;
}

/** Bearing (degrees, clockwise seen from above, 0 = towards +y) from one plan point to another. */
export function bearing(from: [number, number], to: [number, number]): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Stops of a residence type scaled to a unit's plan (the mini map draws the unit's own plan). */
export function residenceStops(type: UnitType, scale = 1): TourStop[] {
  return RESIDENCE_TOURS[TOUR_TYPE[type]].map((s) => ({ ...s, at: [s.at[0] * scale, s.at[1] * scale] }));
}

/** Everything Blender needs, as plain JSON (see the export script). */
export function tourExport() {
  const types = Object.keys(RESIDENCE_TOURS) as TourType[];
  return {
    residences: Object.fromEntries(
      types.map((t) => {
        const p = planFor(t);
        return [t, { plan: p, stops: RESIDENCE_TOURS[t], viewpoint: TOUR_VIEWPOINT[t] }];
      }),
    ),
    amenities: AMENITY_TOURS,
  };
}

/* ------------------------------------------------------------------ opening a tour */

export type TourRequest = { kind: 'residence'; type: UnitType; unit?: Unit | null } | { kind: 'amenity'; key: AmenityKey };

const TOUR_EVENT = 'gsc:tour';
const bus: EventTarget | null = typeof EventTarget === 'undefined' ? null : new EventTarget();
interface TourEventDetail {
  request: TourRequest;
  handled: boolean;
}

/**
 * Ask the page's live 3D model to fly into the residence / amenity and open its tour.
 * Returns false when nothing on the page can (no 3D section, or WebGL unavailable): open the tour directly then.
 */
export function requestTourDive(request: TourRequest): boolean {
  if (!bus) return false;
  const detail: TourEventDetail = { request, handled: false };
  bus.dispatchEvent(new CustomEvent<TourEventDetail>(TOUR_EVENT, { detail }));
  return detail.handled;
}

/** For the 3D section: take tour requests (return true to claim one). */
export function onTourRequest(handler: (request: TourRequest) => boolean): () => void {
  const listener = (e: Event) => {
    const d = (e as CustomEvent<TourEventDetail>).detail;
    if (!d.handled && handler(d.request)) d.handled = true;
  };
  bus?.addEventListener(TOUR_EVENT, listener);
  return () => bus?.removeEventListener(TOUR_EVENT, listener);
}

/** The residence whose views the tour shows (its code, e.g. "T1-1003"). */
export function viewpointCode(type: UnitType): string {
  const v = TOUR_VIEWPOINT[TOUR_TYPE[type]];
  return `${v.building}-${String(v.floor).padStart(2, '0')}${v.position}`;
}
