import type { PaymentPlan, Unit, UnitType } from '@gsc/contracts';

const ORDER: UnitType[] = ['studio', '1br', '2br', '3br', '4br', 'penthouse', 'townhouse'];

export interface ResidenceSummary {
  type: UnitType;
  total: number;
  available: number;
  /** Lowest price among available units (falls back to any unit when all are taken). */
  fromPriceAed: number;
  areaSqft: [number, number];
}

/** Pure: inventory → one line per residence type, in a fixed luxury-brochure order. */
export function residenceSummary(units: Unit[]): ResidenceSummary[] {
  return ORDER.flatMap((type) => {
    const all = units.filter((u) => u.type === type);
    if (all.length === 0) return [];
    const avail = all.filter((u) => u.availability === 'available');
    const priced = avail.length ? avail : all;
    const areas = all.map((u) => u.areaSqft);
    return [
      {
        type,
        total: all.length,
        available: avail.length,
        fromPriceAed: Math.min(...priced.map((u) => u.priceAed)),
        areaSqft: [Math.min(...areas), Math.max(...areas)] as [number, number],
      },
    ];
  });
}

/** "60 / 40": share paid up to handover vs on/after handover. */
export function planSplit(plan: PaymentPlan): [number, number] {
  const pre = plan.milestones.filter((m) => m.trigger === 'on_booking' || m.trigger === 'construction').reduce((s, m) => s + m.percent, 0);
  return [Math.round(pre), Math.round(100 - pre)];
}
