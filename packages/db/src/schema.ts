import { boolean, integer, jsonb, pgEnum, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { LEAD_STAGES } from '@gsc/contracts';

// Mirrors the entities in @gsc/contracts. Contracts are the source of truth;
// this schema is the persistence detail owned by Dev B.

export const leadStage = pgEnum('lead_stage', LEAD_STAGES);

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  data: jsonb('data').notNull(), // full Project payload
});

export const paymentPlans = pgTable('payment_plans', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  data: jsonb('data').notNull(),
});

export const units = pgTable('units', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  code: text('code').notNull(),
  building: text('building').notNull(),
  floor: integer('floor').notNull(),
  type: text('type').notNull(),
  view: text('view').notNull(),
  areaSqft: real('area_sqft').notNull(),
  bedrooms: integer('bedrooms').notNull(),
  bathrooms: integer('bathrooms').notNull(),
  priceAed: integer('price_aed').notNull(),
  availability: text('availability').notNull(),
  paymentPlanIds: jsonb('payment_plan_ids').$type<string[]>().notNull(),
  meshId: text('mesh_id'),
});

export const salespeople = pgTable('salespeople', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  languages: jsonb('languages').$type<string[]>().notNull(),
  unitTypes: jsonb('unit_types').$type<string[]>().notNull(),
  available: boolean('available').notNull(),
});

export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  stage: leadStage('stage').notNull().default('new'),
  locale: text('locale').notNull(),
  source: text('source').notNull(),
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  consent: jsonb('consent').notNull(),
  optedOut: boolean('opted_out').notNull().default(false),
  interestedUnitIds: jsonb('interested_unit_ids').$type<string[]>().notNull(),
  qualification: jsonb('qualification').notNull(),
  assignedToId: text('assigned_to_id').references(() => salespeople.id),
  conversationId: text('conversation_id').notNull(),
  firstResponseMs: integer('first_response_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  leadId: text('lead_id').notNull(),
  status: text('status').notNull().default('bot'),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  role: text('role').notNull(),
  channel: text('channel').notNull(),
  text: text('text').notNull(),
  quickReplies: jsonb('quick_replies'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const viewings = pgTable('viewings', {
  id: text('id').primaryKey(),
  leadId: text('lead_id').notNull().references(() => leads.id),
  unitId: text('unit_id').references(() => units.id),
  salespersonId: text('salesperson_id').references(() => salespeople.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull().default('booked'),
});
