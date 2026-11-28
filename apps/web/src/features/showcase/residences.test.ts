import type { PaymentPlan, Unit } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { planSplit, residenceSummary } from './residences';

const u = (type: Unit['type'], priceAed: number, availability: Unit['availability'], areaSqft = 800) =>
  ({ id: `${type}${priceAed}`, type, priceAed, availability, areaSqft }) as Unit;

describe('residenceSummary', () => {
  it('orders types and prices from available stock', () => {
    const rows = residenceSummary([u('2br', 3_000_000, 'sold'), u('studio', 900_000, 'available', 450), u('2br', 3_200_000, 'available', 1240)]);
    expect(rows.map((r) => r.type)).toEqual(['studio', '2br']);
    expect(rows[1]).toMatchObject({ total: 2, available: 1, fromPriceAed: 3_200_000, areaSqft: [800, 1240] });
  });

  it('falls back to the lowest price when a type is sold out', () => {
    expect(residenceSummary([u('penthouse', 9_000_000, 'sold')])[0]?.fromPriceAed).toBe(9_000_000);
  });
});

describe('planSplit', () => {
  it('splits construction-linked vs handover payments', () => {
    const plan = {
      milestones: [
        { trigger: 'on_booking', percent: 20 },
        { trigger: 'construction', percent: 40 },
        { trigger: 'on_handover', percent: 40 },
      ],
    } as PaymentPlan;
    expect(planSplit(plan)).toEqual([60, 40]);
  });
});
