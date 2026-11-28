import { describe, expect, it } from 'vitest';
import {
  PLAN_TEMPLATES,
  area,
  bathroomCount,
  bedroomCount,
  envelopeArea,
  inside,
  overlap,
  planFor,
  reachableRooms,
  roomsAcross,
  sqftToM2,
  wallSegments,
} from './floorplans';

/** Bedroom / bathroom counts and areas straight from the API seed (apps/api seed data). */
const SEED = [
  { type: 'studio', bedrooms: 0, bathrooms: 1, areaSqft: 460 },
  { type: '1br', bedrooms: 1, bathrooms: 2, areaSqft: 820 },
  { type: '1br', bedrooms: 1, bathrooms: 1, areaSqft: 760 },
  { type: '2br', bedrooms: 2, bathrooms: 3, areaSqft: 1240 },
  { type: '2br', bedrooms: 2, bathrooms: 3, areaSqft: 1190 },
  { type: '2br', bedrooms: 2, bathrooms: 2, areaSqft: 1150 },
  { type: '3br', bedrooms: 3, bathrooms: 4, areaSqft: 1780 },
  { type: '3br', bedrooms: 3, bathrooms: 3, areaSqft: 1650 },
  { type: 'penthouse', bedrooms: 4, bathrooms: 5, areaSqft: 3200 },
] as const;

describe.each(PLAN_TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_, t) => {
  const env = { x: 0, y: 0, w: t.width, h: t.depth };

  it('keeps every room inside the envelope', () => {
    for (const r of t.rooms) expect(inside(r, env), r.id).toBe(true);
  });

  it('has no overlapping rooms', () => {
    for (let i = 0; i < t.rooms.length; i++)
      for (let j = i + 1; j < t.rooms.length; j++) expect(overlap(t.rooms[i]!, t.rooms[j]!), `${t.rooms[i]!.id}/${t.rooms[j]!.id}`).toBe(0);
  });

  it('tiles the envelope exactly', () => {
    const sum = t.rooms.reduce((s, r) => s + area(r), 0);
    expect(sum).toBeCloseTo(envelopeArea(t), 6);
  });

  it('puts every door and opening on a wall shared by two rooms (or the entry on the envelope)', () => {
    for (const o of t.openings) {
      const [a, b] = roomsAcross(t, o);
      if (o.type === 'entry') {
        expect(o.at, 'entry on the corridor wall').toBe(0);
        expect(b, 'entry leads into a room').toBeDefined();
      } else {
        expect(a, `room before ${o.axis}@${o.at} ${o.from}-${o.to}`).toBeDefined();
        expect(b, `room after ${o.axis}@${o.at} ${o.from}-${o.to}`).toBeDefined();
      }
      expect(o.to).toBeGreaterThan(o.from);
    }
  });

  it('can walk from the front door to every room', () => {
    const reach = reachableRooms(t);
    for (const r of t.rooms) expect(reach.has(r.id), r.id).toBe(true);
  });

  it('keeps windows on the envelope, entry on the corridor side', () => {
    for (const w of t.windows) {
      const onEdge = w.axis === 'h' ? w.at === t.depth || w.at === 0 : w.at === t.width || w.at === 0;
      expect(onEdge).toBe(true);
      expect(w.from).toBeGreaterThanOrEqual(0);
      expect(w.to).toBeLessThanOrEqual(w.axis === 'h' ? t.width : t.depth);
    }
  });

  it('places furniture inside its room', () => {
    for (const f of t.fixtures) {
      if (f.room === 'outdoor') {
        expect(f.y).toBeGreaterThanOrEqual(t.depth);
        expect(f.y + f.h).toBeLessThanOrEqual(t.depth + t.outdoor.depth + 1e-6);
        continue;
      }
      const room = t.rooms.find((r) => r.id === f.room);
      expect(room, f.room).toBeDefined();
      expect(inside(f, room!, 0.02), `${f.kind} in ${f.room}`).toBe(true);
    }
  });

  it('draws wall segments with positive length', () => {
    const segs = wallSegments(t);
    expect(segs.length).toBeGreaterThan(t.rooms.length);
    for (const s of segs) expect(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).toBeGreaterThan(0);
  });
});

describe('planFor (seed units)', () => {
  it.each(SEED)('$type $bedrooms bd / $bathrooms ba / $areaSqft sqft', (u) => {
    const p = planFor(u.type, { bathrooms: u.bathrooms, areaSqft: u.areaSqft });
    expect(p.bedrooms).toBe(u.bedrooms);
    expect(p.bathrooms).toBe(u.bathrooms);
    expect(p.areaM2).toBeCloseTo(sqftToM2(u.areaSqft), 6);
    // Template proportions stay realistic: scaling within ±6% linear.
    expect(Math.abs(p.scale - 1)).toBeLessThan(0.06);
  });

  it('templates carry the larger bathroom variant', () => {
    for (const t of PLAN_TEMPLATES) {
      const max = Math.max(...SEED.filter((s) => s.type === t.type).map((s) => s.bathrooms));
      expect(bathroomCount(t), t.id).toBe(max);
      expect(bedroomCount(t), t.id).toBe(SEED.find((s) => s.type === t.type)!.bedrooms);
    }
  });

  it('drops the fixtures of a guest bath that becomes a store', () => {
    const p = planFor('2br', { bathrooms: 2 });
    expect(p.rooms.find((r) => r.id === 'guest')!.kind).toBe('store');
    expect(p.fixtures.some((f) => f.room === 'guest')).toBe(false);
  });

  it('falls back to a sibling family for types not in the sample data', () => {
    expect(planFor('4br').rooms.length).toBeGreaterThan(0);
    expect(planFor('townhouse').rooms.length).toBeGreaterThan(0);
  });
});
