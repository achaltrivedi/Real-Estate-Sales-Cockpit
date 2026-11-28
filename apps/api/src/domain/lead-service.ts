import { randomUUID } from 'node:crypto';
import {
  EVENTS,
  canTransition,
  type Channel,
  type Conversation,
  type CreateLeadBody,
  type CreateViewingBody,
  type Lead,
  type LeadSource,
  type LeadStage,
  type Locale,
  type Message,
  type PatchLeadBody,
} from '@gsc/contracts';
import type { CrmAdapter } from '@gsc/crm';
import {
  isOptIn,
  isOptOut,
  normalizePhone,
  renderTemplate,
  type InboundMessage,
  type MessagingChannel,
  type OutboundMessage,
  type TemplateName,
} from '@gsc/messaging';
import {
  COPY,
  initialQualification,
  nextQuestion,
  openingReplies,
  type Qualifier,
  type Reply,
} from '@gsc/qualifier';
import type { FollowUpScheduler, Job } from '../scheduler';
import type { Store } from '../store/store';
import { HttpError } from './errors';
import type { EventBus } from './events';
import { activeLoad, routeLead } from './routing';

export { HttpError };

/** Minimal logger shape (Fastify's `app.log` and `console` both fit). */
export interface Logger {
  info?(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface Deps {
  store: Store;
  qualifier: Qualifier;
  channel: MessagingChannel;
  crm: CrmAdapter;
  scheduler: FollowUpScheduler;
  bus: EventBus;
}

export interface LeadServiceOptions {
  /** Project that inbound WhatsApp leads belong to. */
  defaultProjectId: string;
  /** For local phone numbers ("050…"). */
  defaultCountryCode: string;
  now?: () => Date;
}

const id = (p: string) => `${p}_${randomUUID().slice(0, 8)}`;
const ARABIC = /[؀-ۿ]/;
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bot follow-ups stop once a lead is qualified (a salesperson owns it) or closed. */
const NURTURE_STAGES: readonly LeadStage[] = ['new', 'contacted'];
const FOLLOW_UP_TEMPLATES: TemplateName[] = ['follow_up_1', 'follow_up_2', 'follow_up_3'];
const WHATSAPP_CONSENT_TEXT = 'Buyer started the conversation on WhatsApp (inbound message).';

/** Application service: orchestrates store + qualifier + channel + CRM + scheduler. No HTTP here. */
export function createLeadService(
  d: Deps,
  log: Logger = consoleLogger,
  opts: LeadServiceOptions = { defaultProjectId: 'prj_azure_crest', defaultCountryCode: '971' },
) {
  const clock = opts.now ?? (() => new Date());
  const now = () => clock().toISOString();

  const toMessages = (
    conversationId: string,
    role: Message['role'],
    channel: Channel,
    replies: Reply[],
  ): Message[] =>
    replies.map((r) => ({
      id: id('msg'),
      conversationId,
      role,
      channel,
      text: r.text,
      quickReplies: r.quickReplies,
      createdAt: now(),
    }));

  /**
   * Side integrations (CRM, scheduler) must never lose a lead: failures are logged, not thrown.
   * CRM sync is fire-and-forget so a slow webhook never delays the instant reply.
   */
  const background = (what: string, leadId: string, p: Promise<unknown>) => {
    p.catch((err: unknown) => log.error({ err, leadId }, `${what} failed`));
  };
  const attempt = async (what: string, leadId: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      log.error({ err, leadId }, `${what} failed`);
    }
  };

  async function unitInProject(unitId: string | undefined, projectId: string) {
    if (!unitId) return null;
    const unit = await d.store.getUnit(unitId);
    return unit && unit.projectId === projectId ? unit : null;
  }

  async function changeStage(lead: Lead, to: LeadStage): Promise<Lead> {
    if (lead.stage === to) return lead;
    if (!canTransition(lead.stage, to))
      throw new HttpError(409, `Cannot move ${lead.stage} -> ${to}`);
    const updated = (await d.store.updateLead(lead.id, { stage: to }))!;
    d.bus.emit(EVENTS.leadStageChanged, { at: now(), leadId: lead.id, from: lead.stage, to });
    if (!NURTURE_STAGES.includes(to))
      await attempt('scheduler.cancel', lead.id, () => d.scheduler.cancel(lead.id));
    return updated;
  }

  /** Sticky: a lead keeps its salesperson once assigned (e.g. the one who took the handoff). */
  async function assign(lead: Lead): Promise<Lead> {
    if (lead.assignedToId) return lead;
    const decision = routeLead(
      lead,
      await d.store.listSalespeople(),
      activeLoad(await d.store.listLeads({}), lead.id),
    );
    if (!decision) {
      log.warn({ leadId: lead.id }, 'routing: no salesperson available, lead left unassigned');
      return lead;
    }
    log.info?.(
      { leadId: lead.id, salespersonId: decision.salesperson.id, reasons: decision.reasons },
      'lead routed',
    );
    return (await d.store.updateLead(lead.id, { assignedToId: decision.salesperson.id })) ?? lead;
  }

  const wantsNurture = (lead: Lead, status: Conversation['status']) =>
    status === 'bot' &&
    !lead.optedOut &&
    !lead.qualification.isQualified &&
    NURTURE_STAGES.includes(lead.stage);

  /** Creates lead + conversation. The caller decides what goes in the conversation. */
  async function insertLead(input: {
    projectId: string;
    locale: Locale;
    source: LeadSource;
    consentText: string;
    name?: string;
    phone?: string;
    email?: string;
    unitId?: string;
    messages?: (conversationId: string) => Message[];
  }) {
    const createdAt = now();
    const conversationId = id('conv');
    const lead: Lead = {
      id: id('lead'),
      projectId: input.projectId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      locale: input.locale,
      source: input.source,
      stage: 'new',
      consent: { given: true, at: createdAt, text: input.consentText },
      optedOut: false,
      interestedUnitIds: input.unitId ? [input.unitId] : [],
      qualification: initialQualification(),
      conversationId,
      createdAt,
      updatedAt: createdAt,
    };
    const conversation: Conversation = {
      id: conversationId,
      leadId: lead.id,
      status: 'bot',
      messages: input.messages?.(conversationId) ?? [],
    };
    return { lead, conversation };
  }

  interface TurnInput {
    text: string;
    quickReplyId?: string;
    channel: Channel;
    /** First message of a new WhatsApp lead: greet before answering. */
    opening?: boolean;
  }

  /**
   * One buyer turn, shared by the web widget and WhatsApp: stop-on-reply, opt-out/in, human mode,
   * qualifier, escalation, viewing request, qualification → stage + routing, nurture restart.
   * Returns the stored messages; delivery over a channel is the caller's job.
   */
  async function processTurn(leadIn: Lead, conv: Conversation, input: TurnInput) {
    let lead = leadIn;
    const { text, quickReplyId, channel } = input;
    const buyerMsg: Message = {
      id: id('msg'),
      conversationId: conv.id,
      role: 'buyer',
      channel,
      text,
      createdAt: now(),
    };
    await attempt('scheduler.cancel', lead.id, () => d.scheduler.cancel(lead.id)); // stop-on-reply

    if (isOptOut(text)) {
      lead = (await d.store.updateLead(lead.id, { optedOut: true }))!;
      const replies = toMessages(conv.id, 'system', channel, [
        { text: COPY.optedOut[lead.locale] },
      ]);
      await d.store.appendMessages(conv.id, [buyerMsg, ...replies]);
      background('crm.upsertLead', lead.id, d.crm.upsertLead(lead));
      return { lead, status: conv.status, buyerMsg, replies };
    }
    if (isOptIn(text) && lead.optedOut)
      lead = (await d.store.updateLead(lead.id, { optedOut: false }))!;

    if (conv.status !== 'bot') {
      // A human owns the conversation: store the message, the salesperson answers.
      await d.store.appendMessages(conv.id, [buyerMsg]);
      return { lead, status: conv.status, buyerMsg, replies: [] as Message[] };
    }

    const wasQualified = lead.qualification.isQualified;
    const turn = await d.qualifier.handleTurn({
      text,
      quickReplyId,
      locale: lead.locale,
      current: lead.qualification,
    });
    lead = (await d.store.updateLead(lead.id, { qualification: turn.qualification }))!;

    let status: Conversation['status'] = conv.status;
    let replies: Reply[] = turn.replies;
    if (turn.escalate || turn.wantsViewing) {
      status = 'human';
      await d.store.setConversationStatus(conv.id, status);
      lead = await assign(lead);
      if (turn.wantsViewing) replies = [{ text: COPY.viewingRequested[lead.locale] }];
    }
    if (turn.qualification.isQualified && !wasQualified) {
      if (canTransition(lead.stage, 'qualified')) lead = await changeStage(lead, 'qualified');
      lead = await assign(lead);
      d.bus.emit(EVENTS.leadQualified, { at: now(), lead });
    }
    if (input.opening) {
      // New WhatsApp lead: greet first. "Hi" (nothing understood) gets the standard opening question.
      replies = turn.understood
        ? [{ text: COPY.greeting[lead.locale] }, ...replies]
        : openingReplies(lead.locale);
    }

    const replyMsgs = toMessages(conv.id, 'assistant', channel, replies);
    await d.store.appendMessages(conv.id, [buyerMsg, ...replyMsgs]);
    background('crm.upsertLead', lead.id, d.crm.upsertLead(lead));
    if (wantsNurture(lead, status)) {
      await attempt('scheduler.scheduleSequence', lead.id, () =>
        d.scheduler.scheduleSequence(lead.id),
      );
    }
    return { lead, status, buyerMsg, replies: replyMsgs };
  }

  /** Sends over the messaging channel; a failure queues a retry instead of losing the reply. */
  async function deliver(lead: Lead, msg: OutboundMessage): Promise<boolean> {
    try {
      await d.channel.send(msg);
      return true;
    } catch (err) {
      log.warn({ err, leadId: lead.id }, 'send failed, retry queued');
      await attempt('scheduler.retrySend', lead.id, () => d.scheduler.retrySend(lead.id, msg));
      return false;
    }
  }

  const toOutbound = (lead: Lead, m: Message): OutboundMessage => ({
    to: lead.phone!,
    text: m.text,
    quickReplies: m.quickReplies,
    locale: lead.locale,
  });

  /** Recently processed WhatsApp message ids: Meta re-delivers webhooks, buyers must not get double replies. */
  const seenInbound = new Set<string>();
  const markSeen = (providerId: string) => {
    if (seenInbound.has(providerId)) return false;
    seenInbound.add(providerId);
    if (seenInbound.size > 5000) seenInbound.delete(seenInbound.values().next().value!);
    return true;
  };

  function inWhatsAppWindow(conv: Conversation, at: Date) {
    const lastInbound = [...conv.messages]
      .reverse()
      .find((m) => m.role === 'buyer' && m.channel === 'whatsapp');
    return !!lastInbound && at.getTime() - Date.parse(lastInbound.createdAt) < WHATSAPP_WINDOW_MS;
  }

  return {
    async createLead(body: CreateLeadBody) {
      const started = performance.now();
      if (!(await d.store.getProject(body.projectId)))
        throw new HttpError(404, 'Project not found');
      // An unknown unit id (stale page, typo) must not cost us the lead: keep the lead, drop the unit.
      const unit = await unitInProject(body.unitId, body.projectId);
      if (body.unitId && !unit)
        log.warn({ unitId: body.unitId }, 'createLead: unknown unit id ignored');
      // E.164 so a later WhatsApp message from the same buyer lands in the same conversation.
      const phone = body.phone
        ? (normalizePhone(body.phone, opts.defaultCountryCode) ?? body.phone.trim())
        : undefined;

      const { lead, conversation } = await insertLead({
        projectId: body.projectId,
        locale: body.locale,
        source: 'web_widget',
        consentText: body.consentText,
        name: body.name,
        phone,
        email: body.email,
        unitId: unit?.id,
        // Instant reply: generated synchronously, so first-response time is measured in ms.
        messages: (cid) => toMessages(cid, 'assistant', 'web', openingReplies(body.locale)),
      });
      // Measured on a monotonic clock (never mixed with the possibly-faked wall clock behind createdAt).
      lead.firstResponseMs = Math.round(performance.now() - started);
      lead.stage = 'contacted';

      await d.store.insertLead(lead);
      await d.store.insertConversation(conversation);
      background('crm.upsertLead', lead.id, d.crm.upsertLead(lead));
      await attempt('scheduler.scheduleSequence', lead.id, () =>
        d.scheduler.scheduleSequence(lead.id),
      );
      d.bus.emit(EVENTS.leadCreated, { at: lead.createdAt, lead });
      return { lead, conversation };
    },

    async sendMessage(conversationId: string, text: string, quickReplyId?: string) {
      const conv = await d.store.getConversation(conversationId);
      if (!conv) throw new HttpError(404, 'Conversation not found');
      const lead = (await d.store.getLead(conv.leadId))!;
      const r = await processTurn(lead, conv, { text, quickReplyId, channel: 'web' });
      return {
        messages: [r.buyerMsg, ...r.replies],
        qualification: r.lead.qualification,
        status: r.status,
      };
    },

    /**
     * WhatsApp inbound: phone → lead (created on first contact) → same turn logic as the widget →
     * replies sent back over the channel. Duplicate deliveries are ignored.
     */
    async receiveWhatsApp(inbound: InboundMessage) {
      if (!markSeen(inbound.providerMessageId)) return { duplicate: true as const };
      const started = performance.now();
      const phone =
        normalizePhone(inbound.from, opts.defaultCountryCode) ??
        `+${inbound.from.replace(/\D/g, '')}`;

      let lead = await d.store.findLeadByPhone(phone);
      let conv: Conversation | null = lead
        ? await d.store.getConversation(lead.conversationId)
        : null;
      const isNew = !lead || !conv;
      if (!lead || !conv) {
        if (!(await d.store.getProject(opts.defaultProjectId))) {
          log.error(
            { projectId: opts.defaultProjectId },
            'whatsapp: DEFAULT_PROJECT_ID not found; message dropped',
          );
          return { duplicate: false as const, leadId: null };
        }
        const created = await insertLead({
          projectId: opts.defaultProjectId,
          locale: ARABIC.test(inbound.text) ? 'ar' : 'en',
          source: 'whatsapp',
          consentText: WHATSAPP_CONSENT_TEXT,
          phone,
        });
        await d.store.insertLead(created.lead);
        await d.store.insertConversation(created.conversation);
        d.bus.emit(EVENTS.leadCreated, { at: created.lead.createdAt, lead: created.lead });
        lead = created.lead;
        conv = created.conversation;
      }

      const r = await processTurn(lead, conv, {
        text: inbound.text,
        quickReplyId: inbound.quickReplyId,
        channel: 'whatsapp',
        opening: isNew,
      });
      lead = r.lead;

      let firstSent = false;
      for (const m of r.replies) {
        if (lead.optedOut && m.role !== 'system') continue; // only the opt-out confirmation
        firstSent = (await deliver(lead, toOutbound(lead, m))) || firstSent;
      }
      if (isNew) {
        const patch: Partial<Lead> = {};
        if (firstSent) patch.firstResponseMs = Math.round(performance.now() - started);
        if (lead.stage === 'new') {
          lead = await changeStage(lead, 'contacted');
        }
        if (Object.keys(patch).length) lead = (await d.store.updateLead(lead.id, patch)) ?? lead;
      }
      return { duplicate: false as const, leadId: lead.id };
    },

    /** Executes a scheduled job (registered with the scheduler in server.ts). Throw = retry. */
    async runJob(job: Job) {
      if (job.payload.kind === 'send_retry') {
        await d.channel.send(job.payload.message);
        return;
      }
      const lead = await d.store.getLead(job.leadId);
      const conv = lead ? await d.store.getConversation(lead.conversationId) : null;
      if (!lead || !conv || !wantsNurture(lead, conv.status)) return; // replied, qualified, opted out or handed off

      const template =
        FOLLOW_UP_TEMPLATES[Math.min(job.payload.step, FOLLOW_UP_TEMPLATES.length) - 1]!;
      const text = renderTemplate(template, lead.locale, { name: lead.name });
      const next = nextQuestion(lead.qualification.missing, lead.locale);

      if (lead.phone) {
        // Inside WhatsApp's 24h window free text (with the next question's buttons) is allowed;
        // outside it only a pre-approved template may be sent.
        const at = clock();
        const msg: OutboundMessage = inWhatsAppWindow(conv, at)
          ? {
              to: lead.phone,
              text: next ? `${text}\n\n${next.text}` : text,
              quickReplies: next?.quickReplies,
              locale: lead.locale,
            }
          : {
              to: lead.phone,
              text,
              locale: lead.locale,
              template: { name: template, locale: lead.locale, vars: { name: lead.name } },
            };
        await d.channel.send(msg); // throws → scheduler retries this follow-up
        await d.store.appendMessages(
          conv.id,
          toMessages(conv.id, 'assistant', 'whatsapp', [
            { text: msg.text, quickReplies: msg.quickReplies },
          ]),
        );
      } else {
        // Web-only lead: the nudge waits in the conversation for when the buyer reopens the widget.
        await d.store.appendMessages(
          conv.id,
          toMessages(conv.id, 'assistant', 'web', [{ text }, ...(next ? [next] : [])]),
        );
      }
      log.info?.({ leadId: lead.id, step: job.payload.step }, 'follow-up sent');
    },

    async handoff(conversationId: string) {
      const conv = await d.store.getConversation(conversationId);
      if (!conv) throw new HttpError(404, 'Conversation not found');
      const lead = (await d.store.getLead(conv.leadId))!;
      await d.store.setConversationStatus(conversationId, 'human');
      await attempt('scheduler.cancel', lead.id, () => d.scheduler.cancel(lead.id));
      await assign(lead);
      await d.store.appendMessages(
        conversationId,
        toMessages(conversationId, 'system', 'web', [{ text: COPY.handoff[lead.locale] }]),
      );
      return (await d.store.getConversation(conversationId))!;
    },

    async patchLead(leadId: string, body: PatchLeadBody) {
      let lead = await d.store.getLead(leadId);
      if (!lead) throw new HttpError(404, 'Lead not found');
      if (
        body.assignedToId &&
        !(await d.store.listSalespeople()).some((s) => s.id === body.assignedToId)
      ) {
        throw new HttpError(400, 'Unknown salesperson', { assignedToId: body.assignedToId });
      }
      if (body.stage) lead = await changeStage(lead, body.stage);
      const { stage: _s, ...rest } = body;
      return (await d.store.updateLead(leadId, rest))!;
    },

    async bookViewing(body: CreateViewingBody) {
      let lead = await d.store.getLead(body.leadId);
      if (!lead) throw new HttpError(404, 'Lead not found');
      if (body.unitId && !(await unitInProject(body.unitId, lead.projectId))) {
        throw new HttpError(400, 'Unknown unit for this project', { unitId: body.unitId });
      }
      if (lead.stage !== 'qualified' && lead.stage !== 'viewing_booked')
        lead = await changeStage(lead, 'qualified').catch(() => lead!);
      lead = await changeStage(lead, 'viewing_booked');
      lead = await assign(lead); // someone has to host the viewing
      const viewing = {
        id: id('view'),
        ...body,
        salespersonId: lead.assignedToId,
        status: 'booked' as const,
      };
      await d.store.insertViewing(viewing);
      d.bus.emit(EVENTS.viewingBooked, { at: now(), viewing, lead });
      return viewing;
    },
  };
}
export type LeadService = ReturnType<typeof createLeadService>;

const consoleLogger: Logger = {
  info: () => {},
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};
