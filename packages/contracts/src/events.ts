import { z } from 'zod';
import { IsoDateTime } from './common';
import { Lead, Viewing } from './entities';
import { LeadStage } from './stages';

export const EVENTS = {
  leadCreated: 'lead.created',
  leadQualified: 'lead.qualified',
  viewingBooked: 'viewing.booked',
  leadStageChanged: 'lead.stage_changed',
} as const;
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

const at = IsoDateTime;

export const EventPayloads = {
  'lead.created': z.object({ at, lead: Lead }),
  'lead.qualified': z.object({ at, lead: Lead }),
  'viewing.booked': z.object({ at, viewing: Viewing, lead: Lead }),
  'lead.stage_changed': z.object({ at, leadId: z.string(), from: LeadStage, to: LeadStage }),
} satisfies Record<EventName, z.ZodTypeAny>;

export type EventPayload<E extends EventName> = z.infer<(typeof EventPayloads)[E]>;
