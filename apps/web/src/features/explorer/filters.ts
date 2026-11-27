import type { Availability, Unit, UnitType, UnitView } from '@gsc/contracts';

export interface UnitFilters {
  types: UnitType[];
  views: UnitView[];
  building: 'all' | string;
  availableOnly: boolean;
  maxPrice: number | null;
  minFloor: number | null;
}

export const EMPTY_FILTERS: UnitFilters = {
  types: [],
  views: [],
  building: 'all',
  availableOnly: false,
  maxPrice: null,
  minFloor: null,
};

/** Pure + synchronous so filtering feels instant (whole inventory is loaded once). */
export function filterUnits(units: Unit[], f: UnitFilters): Unit[] {
  return units
    .filter(
      (u) =>
        (f.types.length === 0 || f.types.includes(u.type)) &&
        (f.views.length === 0 || f.views.includes(u.view)) &&
        (f.building === 'all' || u.building === f.building) &&
        (!f.availableOnly || u.availability === 'available') &&
        (f.maxPrice === null || u.priceAed <= f.maxPrice) &&
        (f.minFloor === null || u.floor >= f.minFloor),
    )
    .sort((a, b) => a.priceAed - b.priceAed);
}

export function isFiltered(f: UnitFilters): boolean {
  return JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);
}

/** Toggle a value in a multi-select chip group. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export interface InventoryStats {
  total: number;
  available: number;
  fromPriceAed: number | null;
  priceRange: [number, number];
  floorRange: [number, number];
  types: UnitType[];
  views: UnitView[];
  buildings: string[];
  byAvailability: Record<Availability, number>;
}

export function inventoryStats(units: Unit[]): InventoryStats {
  const prices = units.map((u) => u.priceAed);
  const floors = units.map((u) => u.floor);
  const available = units.filter((u) => u.availability === 'available');
  const byAvailability: Record<Availability, number> = { available: 0, reserved: 0, sold: 0, hold: 0 };
  for (const u of units) byAvailability[u.availability]++;
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    total: units.length,
    available: available.length,
    fromPriceAed: available.length ? Math.min(...available.map((u) => u.priceAed)) : null,
    priceRange: units.length ? [Math.min(...prices), Math.max(...prices)] : [0, 0],
    floorRange: units.length ? [Math.min(...floors), Math.max(...floors)] : [0, 0],
    types: uniq(units.map((u) => u.type)),
    views: uniq(units.map((u) => u.view)),
    buildings: uniq(units.map((u) => u.building)).sort(),
    byAvailability,
  };
}

export const pricePerSqft = (u: Unit) => Math.round(u.priceAed / u.areaSqft);
