import cors from '@fastify/cors';
import { EVENTS } from '@gsc/contracts';
import { createCrm } from '@gsc/crm';
import { loadSeed } from '@gsc/db';
import { createChannel } from '@gsc/messaging';
import { MockLlm, createQualifier } from '@gsc/qualifier';
import Fastify from 'fastify';
import { EventBus } from './domain/events';
import { HttpError, createLeadService, type Deps } from './domain/lead-service';
import { funnel } from './domain/metrics';
import { route } from './http/route';
import { NoopScheduler } from './scheduler';
import { MemoryStore } from './store/memory';

/** Composition root: the ONLY place that picks concrete adapters (mock vs real). */
export function buildDeps(env: Record<string, string | undefined> = process.env): Deps {
  const crm = createCrm(env);
  const bus = new EventBus();
  bus.on(EVENTS.leadStageChanged, (p) => crm.pushEvent(EVENTS.leadStageChanged, p));
  bus.on(EVENTS.leadQualified, (p) => crm.pushEvent(EVENTS.leadQualified, p));
  bus.on(EVENTS.viewingBooked, (p) => crm.pushEvent(EVENTS.viewingBooked, p));
  return {
    store: new MemoryStore(loadSeed()), // TODO(Dev B): PostgresStore when DATA_DRIVER=postgres
    qualifier: createQualifier({ llm: new MockLlm() }), // TODO(Dev B): real LLM when LLM_PROVIDER!=mock
    channel: createChannel(env),
    crm,
    scheduler: new NoopScheduler(), // TODO(Dev B): BullMQ scheduler
    bus,
  };
}

export async function buildServer(deps: Deps = buildDeps()) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: true });
  const leads = createLeadService(deps);

  app.get('/health', async () => ({ ok: true, channel: deps.channel.name, crm: deps.crm.name }));

  route(app, 'getProject', async ({ params }) => {
    const p = await deps.store.getProject(params.id!);
    if (!p) throw new HttpError(404, 'Project not found');
    return p;
  });
  route(app, 'listUnits', async ({ params, query }) => ({ units: await deps.store.listUnits(params.id!, query) }));
  route(app, 'createLead', async ({ body }) => leads.createLead(body));
  route(app, 'listLeads', async ({ query }) => ({ leads: await deps.store.listLeads(query) }));
  route(app, 'patchLead', async ({ params, body }) => leads.patchLead(params.id!, body));
  route(app, 'getConversation', async ({ params }) => {
    const c = await deps.store.getConversation(params.id!);
    if (!c) throw new HttpError(404, 'Conversation not found');
    return c;
  });
  route(app, 'sendMessage', async ({ params, body }) => leads.sendMessage(params.id!, body.text, body.quickReplyId));
  route(app, 'requestHandoff', async ({ params }) => leads.handoff(params.id!));
  route(app, 'createViewing', async ({ body }) => leads.bookViewing(body));
  route(app, 'getFunnel', async () => funnel(await deps.store.listLeads({})));
  route(app, 'whatsappWebhook', async ({ body }) => {
    // TODO(Dev B, Phase 2): map inbound phone -> lead/conversation and call leads.sendMessage
    deps.channel.parseInbound(body);
    return { ok: true as const };
  });
  // WhatsApp webhook verification handshake
  app.get('/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) return reply.send(q['hub.challenge']);
    return reply.status(403).send();
  });

  return app;
}
