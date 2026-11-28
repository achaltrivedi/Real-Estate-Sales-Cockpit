import type { Unit } from '@gsc/contracts';

export interface UnitBox {
  unit: Unit;
  position: [number, number, number];
  size: [number, number, number];
}

/*
 * Scene coordinate contract, shared with the Blender build script
 * (assets/models/source/build_tower.py). Change both together.
 * 1 unit = 1 floor; sea faces -z; unit positions 01/02 are on the sea side.
 */
export const FLOOR_H = 1;
/** Towers start on top of the 2-unit-high podium. */
const PODIUM_TOP = 2;
export const BUILDING_OFFSET: Record<string, number> = { T1: -8, T2: 8 };
const UNIT_OFFSET = 1.9;
const UNIT_SIZE = 3.76;
const POS_OFFSET: Record<string, [number, number]> = {
  '01': [-1, -1],
  '02': [1, -1],
  '03': [-1, 1],
  '04': [1, 1],
};

/** Centre of a unit in scene space. Pure; used for layout and camera focus. */
export function unitCenter(unit: Unit): [number, number, number] {
  const [sx, sz] = POS_OFFSET[unit.code.slice(-2)] ?? [0, 0];
  return [
    (BUILDING_OFFSET[unit.building] ?? 0) + sx * UNIT_OFFSET,
    PODIUM_TOP + (unit.floor - 3) * FLOOR_H + FLOOR_H / 2,
    sz * UNIT_OFFSET,
  ];
}

/** Horizontal direction a unit faces, away from its tower's core (unit vector in x/z). */
export function unitFacing(unit: Unit): [number, number] {
  const [sx, sz] = POS_OFFSET[unit.code.slice(-2)] ?? [1, 1];
  return [sx / Math.SQRT2, sz / Math.SQRT2];
}

/** Pure function: seed units → box positions. Unit-tested without WebGL. */
export function layoutUnits(units: Unit[]): UnitBox[] {
  return units.map((unit) => ({ unit, position: unitCenter(unit), size: [UNIT_SIZE, FLOOR_H * 0.86, UNIT_SIZE] }));
}

/** Camera "dive" into a residence: ends just outside its corner glazing at eye level, looking in. */
export interface Dive {
  target: [number, number, number];
  camera: [number, number, number];
}

export function unitDive(unit: Unit): Dive {
  const [x, , z] = unitCenter(unit);
  const y = PODIUM_TOP + (unit.floor - 3) * FLOOR_H + 0.47;
  const [fx, fz] = unitFacing(unit);
  return { target: [x, y, z], camera: [x + fx * 3.4, y + 0.08, z + fz * 3.4] };
}
