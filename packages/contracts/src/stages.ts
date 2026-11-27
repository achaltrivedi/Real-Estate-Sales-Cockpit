import { z } from 'zod';

export const LEAD_STAGES = [
  'new',
  'contacted',
  'qualified',
  'viewing_booked',
  'viewed',
  'reserved',
  'lost',
] as const;

export const LeadStage = z.enum(LEAD_STAGES);
export type LeadStage = z.infer<typeof LeadStage>;

/** Allowed moves. `lost` is reachable from any stage; a lost lead can be re-opened. */
export const STAGE_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'lost'],
  qualified: ['viewing_booked', 'lost'],
  viewing_booked: ['viewed', 'qualified', 'lost'],
  viewed: ['reserved', 'viewing_booked', 'lost'],
  reserved: ['lost'],
  lost: ['new'],
};

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

/** Funnel buckets shown in the dashboard (lead → qualified → viewing → reservation). */
export const FUNNEL_BUCKETS = ['lead', 'qualified', 'viewing', 'reservation'] as const;
export type FunnelBucket = (typeof FUNNEL_BUCKETS)[number];
