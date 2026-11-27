import type { Unit } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { layoutUnits, unitCenter, unitFacing } from './layout';

const unit = (code: string, building: string, floor: number) =>
  ({ id: code, code, building, floor }) as Unit;

describe('3d layout', () => {
  it('stacks floors vertically and separates towers', () => {
    const low = unitCenter(unit('T1-0301', 'T1', 3));
    const high = unitCenter(unit('T1-1001', 'T1', 10));
    const other = unitCenter(unit('T2-0301', 'T2', 3));
    expect(high[1]).toBeGreaterThan(low[1]);
    expect(Math.sign(low[0])).not.toBe(Math.sign(other[0]));
  });

  it('puts positions 01/02 on the sea side (-z) and faces units outward', () => {
    const sea = unitCenter(unit('T1-0501', 'T1', 5));
    const city = unitCenter(unit('T1-0504', 'T1', 5));
    expect(sea[2]).toBeLessThan(0);
    expect(city[2]).toBeGreaterThan(0);
    const [fx, fz] = unitFacing(unit('T2-0502', 'T2', 5));
    expect(fx).toBeGreaterThan(0);
    expect(fz).toBeLessThan(0);
    expect(Math.hypot(fx, fz)).toBeCloseTo(1);
  });

  it('gives every unit a distinct position', () => {
    const units = ['01', '02', '03', '04'].map((p) => unit(`T1-05${p}`, 'T1', 5));
    const keys = new Set(layoutUnits(units).map((b) => b.position.join(',')));
    expect(keys.size).toBe(4);
  });
});
