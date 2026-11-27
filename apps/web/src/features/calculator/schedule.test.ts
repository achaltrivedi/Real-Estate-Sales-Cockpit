import type { PaymentPlan } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { buildSchedule } from './schedule';

const plan: PaymentPlan = {
  id: 'pp',
  projectId: 'p',
  name: '50/50',
  nameAr: '50/50',
  dldFeePercent: 4,
  milestones: [
    { label: 'Booking', labelAr: 'الحجز', percent: 20, trigger: 'on_booking', monthOffset: 0 },
    { label: 'C1', labelAr: 'C1', percent: 15, trigger: 'construction', monthOffset: 18 },
    { label: 'Handover', labelAr: 'H', percent: 15, trigger: 'on_handover', monthOffset: 36 },
    { label: 'PH1', labelAr: 'PH1', percent: 12.5, trigger: 'post_handover', monthOffset: 42 },
    { label: 'PH2', labelAr: 'PH2', percent: 12.5, trigger: 'post_handover', monthOffset: 48 },
    { label: 'PH3', labelAr: 'PH3', percent: 12.5, trigger: 'post_handover', monthOffset: 54 },
    { label: 'PH4', labelAr: 'PH4', percent: 12.5, trigger: 'post_handover', monthOffset: 60 },
  ],
};

describe('payment-plan schedule', () => {
  it('sums exactly to the price even with awkward rounding', () => {
    const s = buildSchedule(1_234_567, plan, new Date(2026, 10, 15));
    expect(s.rows.reduce((a, r) => a + r.amountAed, 0)).toBe(1_234_567);
    expect(s.rows.every((r) => Number.isInteger(r.amountAed))).toBe(true);
  });

  it('groups milestones into phases', () => {
    const s = buildSchedule(2_000_000, plan, new Date(2026, 10, 15));
    expect(s.phases.on_booking).toEqual({ percent: 20, amountAed: 400_000, count: 1 });
    expect(s.phases.post_handover.percent).toBe(50);
    expect(s.phases.post_handover.count).toBe(4);
  });

  it('adds DLD fee on top and dates milestones from booking', () => {
    const s = buildSchedule(2_000_000, plan, new Date(2026, 10, 15));
    expect(s.dldFeeAed).toBe(80_000);
    expect(s.totalAed).toBe(2_080_000);
    expect(s.rows[1]!.due).toEqual(new Date(2028, 4, 1)); // Nov 2026 + 18 months
    expect(s.lastPaymentDue).toEqual(new Date(2031, 10, 1));
  });
});
