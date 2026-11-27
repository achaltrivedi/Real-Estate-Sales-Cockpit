import { z } from 'zod';
import { Id, Locale } from './common';
import {
  Availability,
  Conversation,
  ConversationStatus,
  Lead,
  Message,
  PaymentPlan,
  Project,
  Qualification,
  Unit,
  UnitType,
  UnitView,
  Viewing,
} from './entities';
import { FUNNEL_BUCKETS, LeadStage } from './stages';

// ---------- Request / response bodies ----------
export const CreateLeadBody = z.object({
  projectId: Id,
  locale: Locale,
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  unitId: Id.optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required' }) }),
  consentText: z.string(),
});
export type CreateLeadBody = z.infer<typeof CreateLeadBody>;
export const CreateLeadResponse = z.object({ lead: Lead, conversation: Conversation });

export const SendMessageBody = z.object({
  text: z.string().min(1).max(2000),
  quickReplyId: z.string().optional(),
});
export type SendMessageBody = z.infer<typeof SendMessageBody>;
export const SendMessageResponse = z.object({
  /** The buyer message + every reply produced (instant reply). */
  messages: z.array(Message),
  qualification: Qualification,
  status: ConversationStatus,
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const UnitsQuery = z.object({
  type: UnitType.optional(),
  view: UnitView.optional(),
  availability: Availability.optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minFloor: z.coerce.number().optional(),
  maxFloor: z.coerce.number().optional(),
});
export type UnitsQuery = z.infer<typeof UnitsQuery>;
export const UnitsResponse = z.object({ units: z.array(Unit) });

export const ProjectResponse = z.object({ project: Project, paymentPlans: z.array(PaymentPlan) });

export const LeadsQuery = z.object({ stage: LeadStage.optional(), projectId: Id.optional() });
export const LeadsResponse = z.object({ leads: z.array(Lead) });

export const PatchLeadBody = z.object({
  stage: LeadStage.optional(),
  assignedToId: Id.optional(),
  name: z.string().optional(),
});
export type PatchLeadBody = z.infer<typeof PatchLeadBody>;

export const CreateViewingBody = z.object({
  leadId: Id,
  unitId: Id.optional(),
  startsAt: z.string().datetime({ offset: true }),
  mode: z.enum(['in_person', 'video_call']),
});
export type CreateViewingBody = z.infer<typeof CreateViewingBody>;

export const FunnelResponse = z.object({
  buckets: z.array(z.object({ bucket: z.enum(FUNNEL_BUCKETS), count: z.number().int() })),
  medianFirstResponseMs: z.number().int().nullable(),
});
export type FunnelResponse = z.infer<typeof FunnelResponse>;

/** Minimal WhatsApp Cloud API webhook envelope. Dev B owns the full parsing in packages/messaging. */
export const WhatsAppWebhookBody = z.object({ object: z.string(), entry: z.array(z.unknown()) });

export const ApiError = z.object({ error: z.string(), details: z.unknown().optional() });

// ---------- Endpoint registry: drives the client, the server routes and OpenAPI ----------
type Method = 'GET' | 'POST' | 'PATCH';
interface EndpointDef {
  method: Method;
  path: string;
  summary: string;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  response: z.ZodTypeAny;
}
const ep = <T extends EndpointDef>(e: T) => e;

export const endpoints = {
  getProject: ep({
    method: 'GET',
    path: '/projects/:id',
    summary: 'Project + payment plans',
    response: ProjectResponse,
  }),
  listUnits: ep({
    method: 'GET',
    path: '/projects/:id/units',
    summary: 'Filterable unit inventory',
    query: UnitsQuery,
    response: UnitsResponse,
  }),
  createLead: ep({
    method: 'POST',
    path: '/leads',
    summary: 'Create lead from the chat widget; conversation contains the instant reply',
    body: CreateLeadBody,
    response: CreateLeadResponse,
  }),
  listLeads: ep({
    method: 'GET',
    path: '/leads',
    summary: 'Leads for the dashboard',
    query: LeadsQuery,
    response: LeadsResponse,
  }),
  patchLead: ep({
    method: 'PATCH',
    path: '/leads/:id',
    summary: 'Update stage / assignment',
    body: PatchLeadBody,
    response: Lead,
  }),
  getConversation: ep({
    method: 'GET',
    path: '/conversations/:id',
    summary: 'Full conversation',
    response: Conversation,
  }),
  sendMessage: ep({
    method: 'POST',
    path: '/conversations/:id/messages',
    summary: 'Buyer message -> qualifier replies',
    body: SendMessageBody,
    response: SendMessageResponse,
  }),
  requestHandoff: ep({
    method: 'POST',
    path: '/conversations/:id/handoff',
    summary: 'Hand the conversation to a human',
    response: Conversation,
  }),
  createViewing: ep({
    method: 'POST',
    path: '/viewings',
    summary: 'Book a viewing',
    body: CreateViewingBody,
    response: Viewing,
  }),
  getFunnel: ep({
    method: 'GET',
    path: '/metrics/funnel',
    summary: 'Funnel counts + response-time metric',
    response: FunnelResponse,
  }),
  whatsappWebhook: ep({
    method: 'POST',
    path: '/webhooks/whatsapp',
    summary: 'WhatsApp Cloud API inbound',
    body: WhatsAppWebhookBody,
    response: z.object({ ok: z.literal(true) }),
  }),
} as const;

export type Endpoints = typeof endpoints;
export type EndpointName = keyof Endpoints;
export type BodyOf<N extends EndpointName> = Endpoints[N] extends { body: infer B extends z.ZodTypeAny }
  ? z.infer<B>
  : never;
export type QueryOf<N extends EndpointName> = Endpoints[N] extends { query: infer Q extends z.ZodTypeAny }
  ? z.input<Q>
  : never;
export type ResponseOf<N extends EndpointName> = z.infer<Endpoints[N]['response']>;
