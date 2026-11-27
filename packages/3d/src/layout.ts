import type { Unit } from '@gsc/contracts';

export interface UnitBox {
  unit: Unit;
  position: [number, number, number];
  size: [number, number, number];
}

const FLOOR_H = 1;
const BUILDING_OFFSET: Record<string, number> = { T1: -7, T2: 7 };
const POS_OFFSET: Record<string, [number, number]> = {
  '01': [-2, -2],
  '02': [2, -2],
  '03': [-2, 2],
  '04': [2, 2],
};

/** Pure function: seed units → box positions. Unit-tested without WebGL. */
export function layoutUnits(units: Unit[]): UnitBox[] {
  return units.map((unit) => {
    const pos = unit.code.slice(-2);
    const [dx, dz] = POS_OFFSET[pos] ?? [0, 0];
    return {
      unit,
      position: [(BUILDING_OFFSET[unit.building] ?? 0) + dx, unit.floor * FLOOR_H, dz],
      size: [3.8, FLOOR_H * 0.9, 3.8],
    };
  });
}
