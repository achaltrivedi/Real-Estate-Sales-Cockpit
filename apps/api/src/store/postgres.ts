import {
  PaymentPlan,
  Project,
  type Conversation,
  type Lead,
  type Message,
  type Salesperson,
  type Unit,
  type UnitsQuery,
  type Viewing,
} from '@gsc/contracts';
import { and, asc, desc, eq, gte, lte, schema, sql, type Db } from '@gsc/db';
import type { LeadFilter, Store } from './store';

type LeadRow = typeof schema.leads.$inferSelect;
type LeadInsert = typeof schema.leads.$inferInsert;
type UnitRow = typeof schema.units.$inferSelect;
type MessageRow = typeof schema.messages.$inferSelect;

// ---------- row <-> contract mapping (nullable columns become absent optional fields) ----------
const iso = (d: Date) => d.toISOString();
const orUndef = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

function rowToUnit(r: UnitRow): Unit {
  const u: Unit = {
    id: r.id,
    projectId: r.projectId,
    code: r.code,
    building: r.building,
    floor: r.floor,
    type: r.type as Unit['type'],
    view: r.view as Unit['view'],
    areaSqft: r.areaSqft,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    priceAed: r.priceAed,
    availability: r.availability as Unit['availability'],
    paymentPlanIds: r.paymentPlanIds,
  };
  if (r.meshId !== null) u.meshId = r.meshId;
  if (r.floorplanUrl !== null) u.floorplanUrl = r.floorplanUrl;
  return u;
}

function rowToLead(r: LeadRow): Lead {
  const lead: Lead = {
    id: r.id,
    projectId: r.projectId,
    locale: r.locale as Lead['locale'],
    source: r.source as Lead['source'],
    stage: r.stage,
    consent: r.consent as Lead['consent'],
    optedOut: r.optedOut,
    interestedUnitIds: r.interestedUnitIds,
    qualification: r.qualification as Lead['qualification'],
    conversationId: r.conversationId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
  const optional = {
    name: orUndef(r.name),
    phone: orUndef(r.phone),
    email: orUndef(r.email),
    assignedToId: orUndef(r.assignedToId),
    firstResponseMs: orUndef(r.firstResponseMs),
  };
  for (const [k, v] of Object.entries(optional))
    if (v !== undefined) (lead as Record<string, unknown>)[k] = v;
  return lead;
}

/** Only the keys present in `patch` (and not undefined) are written. `id` / `createdAt` are immutable. */
function leadToRow(patch: Partial<Lead>): Partial<LeadInsert> {
  const row: Partial<LeadInsert> = {};
  const set = <K extends keyof LeadInsert>(k: K, v: LeadInsert[K] | undefined) => {
    if (v !== undefined) row[k] = v;
  };
  set('projectId', patch.projectId);
  set('stage', patch.stage);
  set('locale', patch.locale);
  set('source', patch.source);
  set('name', patch.name);
  set('phone', patch.phone);
  set('email', patch.email);
  set('consent', patch.consent);
  set('optedOut', patch.optedOut);
  set('interestedUnitIds', patch.interestedUnitIds);
  set('qualification', patch.qualification);
  set('assignedToId', patch.assignedToId);
  set('conversationId', patch.conversationId);
  set('firstResponseMs', patch.firstResponseMs);
  return row;
}

function rowToMessage(r: MessageRow): Message {
  const m: Message = {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role as Message['role'],
    channel: r.channel as Message['channel'],
    text: r.text,
    createdAt: iso(r.createdAt),
  };
  if (r.quickReplies !== null) m.quickReplies = r.quickReplies as Message['quickReplies'];
  return m;
}

const messageToRow = (m: Message) => ({
  id: m.id,
  conversationId: m.conversationId,
  role: m.role,
  channel: m.channel,
  text: m.text,
  quickReplies: m.quickReplies ?? null,
  createdAt: new Date(m.createdAt),
});

/**
 * Postgres implementation of `Store` (DATA_DRIVER=postgres). Works with any Drizzle Postgres driver:
 * postgres-js in the app, PGlite in tests. Needs migrations + seed (`pnpm --filter @gsc/db migrate && … seed`).
 */
export class PostgresStore implements Store {
  readonly name = 'postgres' as const;

  constructor(
    private db: Db,
    private onClose: () => Promise<void> = async () => {},
  ) {}

  async getProject(id: string) {
    const [p] = await this.db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!p) return null;
    const plans = await this.db
      .select()
      .from(schema.paymentPlans)
      .where(eq(schema.paymentPlans.projectId, id))
      .orderBy(asc(schema.paymentPlans.id));
    // jsonb payloads are validated on the way out: a hand-edited row fails loudly here, not in the browser.
    return {
      project: Project.parse(p.data),
      paymentPlans: plans.map((x) => PaymentPlan.parse(x.data)),
    };
  }

  async listUnits(projectId: string, q: UnitsQuery) {
    const u = schema.units;
    const where = and(
      eq(u.projectId, projectId),
      q.type ? eq(u.type, q.type) : undefined,
      q.view ? eq(u.view, q.view) : undefined,
      q.availability ? eq(u.availability, q.availability) : undefined,
      q.minPrice !== undefined ? gte(u.priceAed, q.minPrice) : undefined,
      q.maxPrice !== undefined ? lte(u.priceAed, q.maxPrice) : undefined,
      q.minFloor !== undefined ? gte(u.floor, q.minFloor) : undefined,
      q.maxFloor !== undefined ? lte(u.floor, q.maxFloor) : undefined,
    );
    return (await this.db.select().from(u).where(where).orderBy(asc(u.id))).map(rowToUnit);
  }

  async getUnit(id: string) {
    const [r] = await this.db.select().from(schema.units).where(eq(schema.units.id, id));
    return r ? rowToUnit(r) : null;
  }

  async listSalespeople(): Promise<Salesperson[]> {
    const rows = await this.db
      .select()
      .from(schema.salespeople)
      .orderBy(asc(schema.salespeople.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      languages: r.languages as Salesperson['languages'],
      unitTypes: r.unitTypes as Salesperson['unitTypes'],
      available: r.available,
    }));
  }

  async insertLead(lead: Lead) {
    await this.db.insert(schema.leads).values({
      ...(leadToRow(lead) as LeadInsert),
      id: lead.id,
      createdAt: new Date(lead.createdAt),
      updatedAt: new Date(lead.updatedAt),
    });
  }

  async updateLead(id: string, patch: Partial<Lead>) {
    const [r] = await this.db
      .update(schema.leads)
      .set({ ...leadToRow(patch), updatedAt: new Date() })
      .where(eq(schema.leads.id, id))
      .returning();
    return r ? rowToLead(r) : null;
  }

  async getLead(id: string) {
    const [r] = await this.db.select().from(schema.leads).where(eq(schema.leads.id, id));
    return r ? rowToLead(r) : null;
  }

  async findLeadByPhone(phone: string) {
    const [r] = await this.db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.phone, phone))
      .orderBy(desc(schema.leads.createdAt))
      .limit(1);
    return r ? rowToLead(r) : null;
  }

  async listLeads(f: LeadFilter) {
    const l = schema.leads;
    const rows = await this.db
      .select()
      .from(l)
      .where(
        and(
          f.stage ? eq(l.stage, f.stage) : undefined,
          f.projectId ? eq(l.projectId, f.projectId) : undefined,
        ),
      )
      .orderBy(desc(l.createdAt), desc(l.id));
    return rows.map(rowToLead);
  }

  async insertConversation(c: Conversation) {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.conversations)
        .values({ id: c.id, leadId: c.leadId, status: c.status });
      if (c.messages.length) await tx.insert(schema.messages).values(c.messages.map(messageToRow));
    });
  }

  async getConversation(id: string) {
    const [c] = await this.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    if (!c) return null;
    const msgs = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, id))
      .orderBy(asc(schema.messages.seq));
    return {
      id: c.id,
      leadId: c.leadId,
      status: c.status as Conversation['status'],
      messages: msgs.map(rowToMessage),
    };
  }

  async appendMessages(conversationId: string, msgs: Message[]) {
    if (!msgs.length) return;
    // Insert in one statement: serial `seq` follows VALUES order, preserving message order.
    await this.db
      .insert(schema.messages)
      .values(msgs.map((m) => ({ ...messageToRow(m), conversationId })));
  }

  async setConversationStatus(id: string, status: Conversation['status']) {
    await this.db
      .update(schema.conversations)
      .set({ status })
      .where(eq(schema.conversations.id, id));
  }

  async insertViewing(v: Viewing) {
    await this.db.insert(schema.viewings).values({
      id: v.id,
      leadId: v.leadId,
      unitId: v.unitId ?? null,
      salespersonId: v.salespersonId ?? null,
      startsAt: new Date(v.startsAt),
      mode: v.mode,
      status: v.status,
    });
  }

  async ping() {
    await this.db.execute(sql`select 1`);
  }

  async close() {
    await this.onClose();
  }
}
