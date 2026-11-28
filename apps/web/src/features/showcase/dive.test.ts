import { describe, expect, it } from 'vitest';
import { B, coverScale, diveState, type Box, type Rect4 } from './dive';

const crown: Rect4 = [0.53, 0.14, 0.67, 0.27];
const box: Box = { vw: 1440, vh: 810, fw: 1440, fh: 810 };

describe('scroll-dive choreography', () => {
  it('starts at rest: untouched layers, title visible, shot C hidden', () => {
    const s = diveState(0, crown, box);
    for (const l of [s.bg, s.towers, s.mid, s.fgLeft, s.fgRight]) {
      expect(l.s).toBeCloseTo(1);
      expect(l.tx).toBeCloseTo(0);
      expect(l.ty).toBeCloseTo(0);
    }
    expect(s.intro).toBe(1);
    expect(s.portal.o).toBe(0);
  });

  it('centres the crown by the hand-off point and keeps zooming without a pause', () => {
    const a = diveState(B - 0.01, crown, box);
    const b = diveState(B, crown, box);
    const c = diveState(B + 0.01, crown, box);
    expect(b.towers.tx).toBeCloseTo(0.5 - (crown[0] + crown[2]) / 2);
    const before = Math.log(b.towers.s) - Math.log(a.towers.s);
    const after = Math.log(c.towers.s) - Math.log(b.towers.s);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
    expect(after / before).toBeGreaterThan(0.5); // speeds roughly match across the phase boundary
    expect(after / before).toBeLessThan(2);
  });

  it('opens the portal from the crown to full screen and shows the closing line', () => {
    const open = diveState(B + 0.02, crown, box);
    expect(open.portal.left).toBeGreaterThan(0);
    expect(open.portal.right).toBeGreaterThan(0);
    const end = diveState(1, crown, box);
    expect(end.portal).toMatchObject({ top: 0, left: 0, right: 0, bottom: 0, radius: 0, o: 1 });
    expect(end.view.s).toBeCloseTo(1);
    expect(end.terrace.s).toBeCloseTo(1);
    expect(end.outro).toBe(1);
    expect(end.intro).toBe(0);
  });

  it('fully opens the portal on a tall phone, where the crown is wide and short', () => {
    const phone: Box = { vw: 375, vh: 812, fw: 457, fh: 812 };
    const end = diveState(1, [0.5506, 0.2998, 0.7995, 0.3709], phone);
    expect(end.portal).toMatchObject({ top: 0, left: 0, right: 0, bottom: 0 });
  });

  it('never uncovers the opaque sky layer', () => {
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const { bg, origin } = diveState(u, crown, box);
      const top = origin[1] + (0 - origin[1]) * bg.s + bg.ty;
      const bottom = origin[1] + (1 - origin[1]) * bg.s + bg.ty;
      const left = origin[0] + (0 - origin[0]) * bg.s + bg.tx;
      const right = origin[0] + (1 - origin[0]) * bg.s + bg.tx;
      expect(top).toBeLessThanOrEqual(1e-9);
      expect(left).toBeLessThanOrEqual(1e-9);
      expect(bottom).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(right).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('coverScale is 1 when nothing moves', () => {
    expect(coverScale(0.3, 0)).toBe(1);
    expect(coverScale(0.2, 0.1)).toBeCloseTo(1.5);
  });
});
