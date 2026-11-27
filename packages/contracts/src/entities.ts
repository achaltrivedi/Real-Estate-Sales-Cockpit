import { z } from 'zod';
import { Currency, Id, IsoDateTime, Locale, MoneyAed, SampleFlag } from './common';
import { LeadStage } from './stages';

// ---------- Inventory ----------
export const UnitType = z.enum(['studio', '1br', '2br', '3br', '4br', 'penthouse', 'townhouse']);
export type UnitType = z.infer<typeof UnitType>;

export const UnitView = z.enum(['sea', 'city', 'park', 'pool', 'marina']);
export type UnitView = z.infer<typeof UnitView>;

export const Availability = z.enum(['available', 'reserved', 'sold', 'hold']);
export type Availability = z.infer<typeof Availability>;

export const Unit = z.object({
  id: Id,
  projectId: Id,
  code: z.string(), // e.g. "T1-2304"
  building: z.string(),
  floor: z.number().int(),
  type: UnitType,
  view: UnitView,
  areaSqft: z.number().positive(),
  bedrooms: z.number().int().nonnegative(),
  bathrooms: z.number().int().nonnegative(),
  priceAed: MoneyAed,
  availability: Availability,
  paymentPlanIds: z.array(Id),
  /** Mesh name in the glTF model, so packages/3d can highlight the unit. */
  meshId: z.string().optional(),
  floorplanUrl: z.string().optional(),
});
export type Unit = z.infer<typeof Unit>;

export const MilestoneTrigger = z.enum(['on_booking', 'construction', 'on_handover', 'post_handover']);
export type MilestoneTrigger = z.infer<typeof MilestoneTrigger>;

export const PaymentMilestone = z.object({
  label: z.string(),
  labelAr: z.string(),
  percent: z.number().min(0).max(100),
  trigger: MilestoneTrigger,
  /** Months after booking. */
  monthOffset: z.number().int().nonnegative(),
});
export type PaymentMilestone = z.infer<typeof PaymentMilestone>;

export const PaymentPlan = z
  .object({
    id: Id,
    projectId: Id,
    name: z.string(),
    nameAr: z.string(),
    /** DLD registration fee percent, shown separately from the plan. */
    dldFeePercent: z.number().min(0).max(10),
    milestones: z.array(PaymentMilestone).min(1),
  })
  .refine((p) => Math.round(p.milestones.reduce((s, m) => s + m.percent, 0)) === 100, {
    message: 'Payment plan milestones must sum to 100%',
  });
export type PaymentPlan = z.infer<typeof PaymentPlan>;

export const Project = z.object({
  id: Id,
  name: z.string(),
  nameAr: z.string(),
  developer: z.string(),
  location: z.string(),
  handoverDate: z.string(), // YYYY-MM
  currency: Currency,
  sample: SampleFlag,
  disclaimer: z.string(),
  buildings: z.array(z.object({ id: Id, name: z.string(), floors: z.number().int() })),
  modelUrl: z.string().optional(),
});
export type Project = z.infer<typeof Project>;

// ---------- People ----------
export const Salesperson = z.object({
  id: Id,
  name: z.string(),
  languages: z.array(Locale),
  unitTypes: z.array(UnitType),
  available: z.boolean(),
});
export type Salesperson = z.infer<typeof Salesperson>;

export const Timeline = z.enum(['now', '0_3_months', '3_6_months', '6_12_months', 'exploring']);
export type Timeline = z.infer<typeof Timeline>;
export const Purpose = z.enum(['investor', 'end_user']);
export type Purpose = z.infer<typeof Purpose>;

export const QualificationField = z.enum(['budget', 'timeline', 'unitType', 'purpose']);
export type QualificationField = z.infer<typeof QualificationField>;

export const Qualification = z.object({
  budgetMinAed: MoneyAed.optional(),
  budgetMaxAed: MoneyAed.optional(),
  timeline: Timeline.optional(),
  unitType: UnitType.optional(),
  purpose: Purpose.optional(),
  /** 0–100, computed by packages/qualifier. */
  score: z.number().min(0).max(100),
  isQualified: z.boolean(),
  missing: z.array(QualificationField),
});
export type Qualification = z.infer<typeof Qualification>;

export const LeadSource = z.enum(['web_widget', 'whatsapp', 'manual']);
export type LeadSource = z.infer<typeof LeadSource>;

export const Lead = z.object({
  id: Id,
  projectId: Id,
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  locale: Locale,
  source: LeadSource,
  stage: LeadStage,
  consent: z.object({ given: z.literal(true), at: IsoDateTime, text: z.string() }),
  optedOut: z.boolean(),
  interestedUnitIds: z.array(Id),
  qualification: Qualification,
  assignedToId: Id.optional(),
  conversationId: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** ms between lead creation and first outbound reply: the headline dashboard metric. */
  firstResponseMs: z.number().int().nonnegative().optional(),
});
export type Lead = z.infer<typeof Lead>;

// ---------- Conversation ----------
export const MessageRole = z.enum(['buyer', 'assistant', 'agent', 'system']);
export type MessageRole = z.infer<typeof MessageRole>;
export const Channel = z.enum(['web', 'whatsapp']);
export type Channel = z.infer<typeof Channel>;

export const QuickReply = z.object({ id: z.string(), label: z.string() });
export type QuickReply = z.infer<typeof QuickReply>;

export const Message = z.object({
  id: Id,
  conversationId: Id,
  role: MessageRole,
  channel: Channel,
  text: z.string(),
  quickReplies: z.array(QuickReply).optional(),
  createdAt: IsoDateTime,
});
export type Message = z.infer<typeof Message>;

export const ConversationStatus = z.enum(['bot', 'human', 'closed']);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

export const Conversation = z.object({
  id: Id,
  leadId: Id,
  status: ConversationStatus,
  messages: z.array(Message),
});
export type Conversation = z.infer<typeof Conversation>;

// ---------- Viewing ----------
export const Viewing = z.object({
  id: Id,
  leadId: Id,
  unitId: Id.optional(),
  salespersonId: Id.optional(),
  startsAt: IsoDateTime,
  mode: z.enum(['in_person', 'video_call']),
  status: z.enum(['booked', 'done', 'no_show', 'cancelled']),
});
export type Viewing = z.infer<typeof Viewing>;

// ---------- Seed file shape (assets/seed/project.json) ----------
export const SeedFile = z.object({
  project: Project,
  paymentPlans: z.array(PaymentPlan),
  units: z.array(Unit),
  salespeople: z.array(Salesperson),
});
export type SeedFile = z.infer<typeof SeedFile>;
