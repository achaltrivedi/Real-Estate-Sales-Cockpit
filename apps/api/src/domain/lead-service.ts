import { randomUUID } from 'node:crypto';
import {
  EVENTS,
  canTransition,
  type Channel,
  type Conversation,
  type CreateLeadBody,
  type CreateViewingBody,
  type Lead,
  type LeadStage,
  type Message,
  type PatchLeadBody,
} from '@gsc/contracts';
import type { CrmAdapter } from '@gsc/crm';
import { isOptIn, isOptOut, type MessagingChannel } from '@gsc/messaging';
import { COPY, initialQualification, openingReplies, type Qualifier, type Reply } from '@gsc/qualifier';
import type { FollowUpScheduler } from '../scheduler';
import type { Store } from '../store/store';
import type { EventBus } from './events';
import { pickSalesperson } from './routing';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Deps {
  store: Store;
  qualifier: Qualifier;
  channel: MessagingChannel;
  crm: CrmAdapter;
  scheduler: FollowUpScheduler;
  bus: EventBus;
}

const now = () => new Date().toISOString();
const id = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;

function toMessages(conversationId: string, role: Message['role'], channel: Channel, replies: Reply[]): Message[] {
  return replies.map((r) => ({ id: id('msg'), conversationId, role, channel, text: r.text, quickReplies: r.quickReplies, createdAt: now() }));
}

/** Application service: orchestrates store + qualifier + channel + CRM. No HTTP here. */
export function createLeadService(d: Deps) {
  async function changeStage(lead: Lead, to: LeadStage): Promise<Lead> {
    if (lead.stage === to) return lead;
    if (!canTransition(lead.stage, to)) throw new HttpError(409, `Cannot move ${lead.stage} -> ${to}`);
    const updated = (await d.store.updateLead(lead.id, { stage: to }))!;
    d.bus.emit(EVENTS.leadStageChanged, { at: now(), leadId: lead.id, from: lead.stage, to });
    return updated;
  }

  async function assign(lead: Lead): Promise<Lead> {
    const team = await d.store.listSalespeople();
    const load = new Map<string, number>();
    for (const l of await d.store.listLeads({})) if (l.assignedToId) load.set(l.assignedToId, (load.get(l.assignedToId) ?? 0) + 1);
    const sp = pickSalesperson(lead, team, load);
    return sp ? ((await d.store.updateLead(lead.id, { assignedToId: sp.id })) ?? lead) : lead;
  }

  return {
    async createLead(body: CreateLeadBody) {
      if (!(await d.store.getProject(body.projectId))) throw new HttpError(404, 'Project not found');
      const createdAt = now();
      const conversationId = id('conv');
      const lead: Lead = {
        id: id('lead'),
        projectId: body.projectId,
        name: body.name,
        phone: body.phone,
        email: body.email,
        locale: body.locale,
        source: 'web_widget',
        stage: 'new',
        consent: { given: true, at: createdAt, text: body.consentText },
        optedOut: false,
        interestedUnitIds: body.unitId ? [body.unitId] : [],
        qualification: initialQualification(),
        conversationId,
        createdAt,
        updatedAt: createdAt,
      };
      // Instant reply: generated synchronously, so first-response time is measured in ms.
      const messages = toMessages(conversationId, 'assistant', 'web', openingReplies(lead.locale));
      const conversation: Conversation = { id: conversationId, leadId: lead.id, status: 'bot', messages };
      lead.firstResponseMs = Date.now() - Date.parse(createdAt);
      lead.stage = 'contacted';

      await d.store.insertLead(lead);
      await d.store.insertConversation(conversation);
      await d.crm.upsertLead(lead);
      await d.scheduler.scheduleSequence(lead.id);
      d.bus.emit(EVENTS.leadCreated, { at: createdAt, lead });
      return { lead, conversation };
    },

    async sendMessage(conversationId: string, text: string, quickReplyId?: string) {
      const conv = await d.store.getConversation(conversationId);
      if (!conv) throw new HttpError(404, 'Conversation not found');
      let lead = (await d.store.getLead(conv.leadId))!;
      const buyerMsg: Message = { id: id('msg'), conversationId, role: 'buyer', channel: 'web', text, createdAt: now() };
      await d.scheduler.cancel(lead.id); // stop-on-reply

      if (isOptOut(text)) {
        lead = (await d.store.updateLead(lead.id, { optedOut: true }))!;
        const out = [buyerMsg, ...toMessages(conversationId, 'system', 'web', [{ text: COPY.optedOut[lead.locale] }])];
        await d.store.appendMessages(conversationId, out);
        return { messages: out, qualification: lead.qualification, status: conv.status };
      }
      if (isOptIn(text) && lead.optedOut) lead = (await d.store.updateLead(lead.id, { optedOut: false }))!;

      if (conv.status === 'human') {
        await d.store.appendMessages(conversationId, [buyerMsg]);
        return { messages: [buyerMsg], qualification: lead.qualification, status: conv.status };
      }

      const wasQualified = lead.qualification.isQualified;
      const turn = await d.qualifier.handleTurn({ text, quickReplyId, locale: lead.locale, current: lead.qualification });
      lead = (await d.store.updateLead(lead.id, { qualification: turn.qualification }))!;

      let status: Conversation['status'] = conv.status;
      if (turn.escalate) {
        status = 'human';
        await d.store.setConversationStatus(conversationId, status);
        lead = await assign(lead);
      }
      if (turn.qualification.isQualified && !wasQualified) {
        lead = await changeStage(lead, 'qualified');
        lead = await assign(lead);
        d.bus.emit(EVENTS.leadQualified, { at: now(), lead });
      }
      const out = [buyerMsg, ...toMessages(conversationId, 'assistant', 'web', turn.replies)];
      await d.store.appendMessages(conversationId, out);
      await d.crm.upsertLead(lead);
      return { messages: out, qualification: lead.qualification, status };
    },

    async handoff(conversationId: string) {
      const conv = await d.store.getConversation(conversationId);
      if (!conv) throw new HttpError(404, 'Conversation not found');
      const lead = (await d.store.getLead(conv.leadId))!;
      await d.store.setConversationStatus(conversationId, 'human');
      await assign(lead);
      await d.store.appendMessages(conversationId, toMessages(conversationId, 'system', 'web', [{ text: COPY.handoff[lead.locale] }]));
      return (await d.store.getConversation(conversationId))!;
    },

    async patchLead(leadId: string, body: PatchLeadBody) {
      let lead = await d.store.getLead(leadId);
      if (!lead) throw new HttpError(404, 'Lead not found');
      if (body.stage) lead = await changeStage(lead, body.stage);
      const { stage: _s, ...rest } = body;
      return (await d.store.updateLead(leadId, rest))!;
    },

    async bookViewing(body: CreateViewingBody) {
      let lead = await d.store.getLead(body.leadId);
      if (!lead) throw new HttpError(404, 'Lead not found');
      if (lead.stage !== 'qualified' && lead.stage !== 'viewing_booked') lead = await changeStage(lead, 'qualified').catch(() => lead!);
      lead = await changeStage(lead, 'viewing_booked');
      const viewing = { id: id('view'), ...body, salespersonId: lead.assignedToId, status: 'booked' as const };
      await d.store.insertViewing(viewing);
      d.bus.emit(EVENTS.viewingBooked, { at: now(), viewing, lead });
      return viewing;
    },
  };
}
export type LeadService = ReturnType<typeof createLeadService>;
