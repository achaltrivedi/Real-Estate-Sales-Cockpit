import type { Unit } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { layoutUnits, unitCenter } from './layout';

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

  it('gives every unit a distinct position', () => {
    const units = ['01', '02', '03', '04'].map((p) => unit(`T1-05${p}`, 'T1', 5));
    const keys = new Set(layoutUnits(units).map((b) => b.position.join(',')));
    expect(keys.size).toBe(4);
  });
});
