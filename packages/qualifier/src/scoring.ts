import type { Qualification, QualificationField } from '@gsc/contracts';
import type { Slots } from './llm';

const WEIGHTS = { budget: 30, timeline: 30, unitType: 20, purpose: 20 } as const;
const TIMELINE_BONUS = { now: 1, '0_3_months': 0.9, '3_6_months': 0.7, '6_12_months': 0.4, exploring: 0.1 };

export const QUALIFIED_THRESHOLD = 70;

export function missingFields(s: Slots): QualificationField[] {
  const missing: QualificationField[] = [];
  if (s.budgetMaxAed === undefined) missing.push('budget');
  if (!s.timeline) missing.push('timeline');
  if (!s.unitType) missing.push('unitType');
  if (!s.purpose) missing.push('purpose');
  return missing;
}

/** Pure scoring rules: easy to tune with sales, easy to unit test. */
export function score(s: Slots): Qualification {
  let total = 0;
  if (s.budgetMaxAed !== undefined) total += WEIGHTS.budget;
  if (s.timeline) total += WEIGHTS.timeline * TIMELINE_BONUS[s.timeline];
  if (s.unitType) total += WEIGHTS.unitType;
  if (s.purpose) total += WEIGHTS.purpose;
  const rounded = Math.round(total);
  return {
    ...s,
    score: rounded,
    isQualified: rounded >= QUALIFIED_THRESHOLD,
    missing: missingFields(s),
  };
}
