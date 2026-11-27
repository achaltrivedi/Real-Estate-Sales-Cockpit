import type { MilestoneTrigger, PaymentPlan } from '@gsc/contracts';

export interface ScheduleRow {
  index: number;
  label: string;
  labelAr: string;
  trigger: MilestoneTrigger;
  percent: number;
  amountAed: number;
  /** Due month (first day), computed from booking date + monthOffset. */
  due: Date;
}

export type PhaseKey = 'on_booking' | 'construction' | 'on_handover' | 'post_handover';

export interface PlanBreakdown {
  rows: ScheduleRow[];
  phases: Record<PhaseKey, { percent: number; amountAed: number; count: number }>;
  priceAed: number;
  dldFeeAed: number;
  totalAed: number;
  lastPaymentDue: Date;
}

const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/**
 * Pure payment-plan maths. Amounts are integer AED; any rounding remainder goes
 * on the final instalment so the schedule always sums exactly to the price.
 */
export function buildSchedule(priceAed: number, plan: PaymentPlan, bookingDate: Date): PlanBreakdown {
  const rows: ScheduleRow[] = plan.milestones.map((m, i) => ({
    index: i + 1,
    label: m.label,
    labelAr: m.labelAr,
    trigger: m.trigger,
    percent: m.percent,
    amountAed: Math.round((priceAed * m.percent) / 100),
    due: addMonths(bookingDate, m.monthOffset),
  }));
  const diff = priceAed - rows.reduce((s, r) => s + r.amountAed, 0);
  if (rows.length) rows[rows.length - 1]!.amountAed += diff;

  const phases = {
    on_booking: { percent: 0, amountAed: 0, count: 0 },
    construction: { percent: 0, amountAed: 0, count: 0 },
    on_handover: { percent: 0, amountAed: 0, count: 0 },
    post_handover: { percent: 0, amountAed: 0, count: 0 },
  } satisfies PlanBreakdown['phases'];
  for (const r of rows) {
    const p = phases[r.trigger];
    p.percent += r.percent;
    p.amountAed += r.amountAed;
    p.count += 1;
  }

  const dldFeeAed = Math.round((priceAed * plan.dldFeePercent) / 100);
  return {
    rows,
    phases,
    priceAed,
    dldFeeAed,
    totalAed: priceAed + dldFeeAed,
    lastPaymentDue: rows.reduce((d, r) => (r.due > d ? r.due : d), bookingDate),
  };
}
