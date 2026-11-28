import { describe, expect, it } from 'vitest';
import { planFor } from './floorplans';
import {
  AMENITY_TOURS,
  RESIDENCE_TOURS,
  TOUR_TYPE,
  TOUR_VIEWPOINT,
  type TourType,
  bearing,
  onTourRequest,
  panoUrl,
  requestTourDive,
  residenceStops,
  viewpointCode,
} from './tour';

const TYPES = Object.keys(RESIDENCE_TOURS) as TourType[];

describe('residence tour stops', () => {
  for (const type of TYPES) {
    const plan = planFor(type);
    const stops = RESIDENCE_TOURS[type];

    it(`${type}: ids are unique`, () => {
      expect(new Set(stops.map((s) => s.id)).size).toBe(stops.length);
    });

    for (const s of stops) {
      it(`${type}/${s.id} stands in its ${s.label}`, () => {
        const [x, y] = s.at;
        if (s.label === 'balcony' || s.label === 'terrace') {
          expect(plan.outdoor.kind).toBe(s.label);
          expect(x).toBeGreaterThan(0.3);
          expect(x).toBeLessThan(plan.width - 0.3);
          expect(y).toBeGreaterThan(plan.depth + 0.3);
          expect(y).toBeLessThan(plan.depth + plan.outdoor.depth);
          return;
        }
        const room = plan.rooms.find((r) => x > r.x + 0.3 && x < r.x + r.w - 0.3 && y > r.y + 0.3 && y < r.y + r.h - 0.3);
        expect(room, 'inside a room, 30 cm clear of its walls').toBeDefined();
        expect(room!.kind).toBe(s.label);
      });

      it(`${type}/${s.id} is clear of furniture`, () => {
        const [x, y] = s.at;
        const hit = plan.fixtures.find((f) => x > f.x - 0.25 && x < f.x + f.w + 0.25 && y > f.y - 0.25 && y < f.y + f.h + 0.25);
        expect(hit?.kind).toBeUndefined();
      });
    }
  }

  it('every unit type has a tour whose plan family matches', () => {
    for (const [unitType, tourType] of Object.entries(TOUR_TYPE)) {
      expect(planFor(unitType as keyof typeof TOUR_TYPE).width).toBeCloseTo(planFor(tourType).width);
    }
  });

  it('scales stops onto a unit plan', () => {
    expect(residenceStops('studio', 2)[0]!.at).toEqual([RESIDENCE_TOURS.studio[0]!.at[0] * 2, RESIDENCE_TOURS.studio[0]!.at[1] * 2]);
  });
});

describe('amenity tours', () => {
  for (const [key, tour] of Object.entries(AMENITY_TOURS)) {
    it(`${key}: stops lie inside the footprint`, () => {
      for (const s of tour.stops) {
        expect(s.at[0]).toBeGreaterThan(0);
        expect(s.at[0]).toBeLessThan(tour.size[0]);
        expect(s.at[1]).toBeGreaterThan(0);
        expect(s.at[1]).toBeLessThan(tour.size[1]);
      }
    });
  }
});

describe('helpers', () => {
  it('bearing: 0 towards the view (+y), 90 towards +x', () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
    expect(Math.abs(bearing([0, 0], [0, -1]))).toBeCloseTo(180);
  });

  it('panorama urls', () => {
    expect(panoUrl('studio', 'living', 2048)).toBe('/tours/studio/living-2048.webp');
  });

  it('viewpoint codes follow the seed (building-floor-position)', () => {
    expect(viewpointCode('studio')).toBe(`T1-${TOUR_VIEWPOINT.studio.floor}03`);
    expect(viewpointCode('penthouse')).toBe('T1-2404');
    expect(viewpointCode('townhouse')).toBe(viewpointCode('3br'));
  });

  it('a tour request is claimed by a listener, or falls back', () => {
    expect(requestTourDive({ kind: 'amenity', key: 'spa' })).toBe(false);
    const seen: string[] = [];
    const off = onTourRequest((r) => {
      seen.push(r.kind);
      return true;
    });
    expect(requestTourDive({ kind: 'residence', type: 'studio' })).toBe(true);
    off();
    expect(requestTourDive({ kind: 'residence', type: 'studio' })).toBe(false);
    expect(seen).toEqual(['residence']);
  });
});
