import type { Unit } from '@gsc/contracts';

export interface UnitBox {
  unit: Unit;
  position: [number, number, number];
  size: [number, number, number];
}

export const FLOOR_H = 1;
/** Towers start on top of the 2-unit-high podium. */
const PODIUM_TOP = 2;
const BUILDING_OFFSET: Record<string, number> = { T1: -7, T2: 7 };
const POS_OFFSET: Record<string, [number, number]> = {
  '01': [-2, -2],
  '02': [2, -2],
  '03': [-2, 2],
  '04': [2, 2],
};

/** Centre of a unit in scene space. Pure; used for layout and camera focus. */
export function unitCenter(unit: Unit): [number, number, number] {
  const [dx, dz] = POS_OFFSET[unit.code.slice(-2)] ?? [0, 0];
  return [(BUILDING_OFFSET[unit.building] ?? 0) + dx, PODIUM_TOP + (unit.floor - 3) * FLOOR_H + FLOOR_H / 2, dz];
}

/** Pure function: seed units → box positions. Unit-tested without WebGL. */
export function layoutUnits(units: Unit[]): UnitBox[] {
  return units.map((unit) => ({ unit, position: unitCenter(unit), size: [3.8, FLOOR_H * 0.9, 3.8] }));
}
