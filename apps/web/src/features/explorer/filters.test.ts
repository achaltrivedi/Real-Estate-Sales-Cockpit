import type { Unit } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, filterUnits, inventoryStats, isFiltered, toggle } from './filters';

const u = (over: Partial<Unit>): Unit => ({
  id: 'u',
  projectId: 'p',
  code: 'T1-0301',
  building: 'T1',
  floor: 3,
  type: '1br',
  view: 'sea',
  areaSqft: 800,
  bedrooms: 1,
  bathrooms: 1,
  priceAed: 1_000_000,
  availability: 'available',
  paymentPlanIds: [],
  ...over,
});

const units = [
  u({ id: 'a', type: '1br', view: 'sea', priceAed: 1_500_000, floor: 5 }),
  u({ id: 'b', type: '2br', view: 'city', priceAed: 2_500_000, floor: 12, availability: 'sold' }),
  u({ id: 'c', type: '2br', view: 'sea', priceAed: 2_100_000, floor: 20, building: 'T2' }),
  u({ id: 'd', type: 'studio', view: 'park', priceAed: 900_000, floor: 3 }),
];

describe('explorer filters', () => {
  it('returns everything sorted by price when no filters are set', () => {
    expect(filterUnits(units, EMPTY_FILTERS).map((x) => x.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('combines type, view, availability, price and floor', () => {
    const r = filterUnits(units, { ...EMPTY_FILTERS, types: ['2br'], views: ['sea'], maxPrice: 2_200_000, minFloor: 10 });
    expect(r.map((x) => x.id)).toEqual(['c']);
    expect(filterUnits(units, { ...EMPTY_FILTERS, types: ['2br'], availableOnly: true }).map((x) => x.id)).toEqual(['c']);
    expect(filterUnits(units, { ...EMPTY_FILTERS, building: 'T2' }).map((x) => x.id)).toEqual(['c']);
  });

  it('toggles chip values and detects active filters', () => {
    expect(toggle(['1br'], '2br')).toEqual(['1br', '2br']);
    expect(toggle(['1br', '2br'], '1br')).toEqual(['2br']);
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTERS, availableOnly: true })).toBe(true);
  });

  it('computes headline stats from available units only', () => {
    const s = inventoryStats(units);
    expect(s.available).toBe(3);
    expect(s.fromPriceAed).toBe(900_000);
    expect(s.priceRange).toEqual([900_000, 2_500_000]);
    expect(s.buildings).toEqual(['T1', 'T2']);
    expect(s.byAvailability.sold).toBe(1);
  });
});
