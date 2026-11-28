import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import { EVENTS } from '@gsc/contracts';
import { createCrm } from '@gsc/crm';
import { createDb, loadSeed } from '@gsc/db';
import { createChannel } from '@gsc/messaging';
import { MockLlm, createQualifier } from '@gsc/qualifier';
import Fastify from 'fastify';
import { loadConfig, type Config } from './config';
import { HttpError } from './domain/errors';
import { EventBus } from './domain/events';
import { createLeadService, type Deps } from './domain/lead-service';
import { funnel } from './domain/metrics';
import { registerErrorHandling } from './http/errors';
import { route } from './http/route';
import { NoopScheduler } from './scheduler';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { Store } from './store/store';

function createStore(config: Config): Store {
  if (config.dataDriver === 'postgres') {
    const { db, close } = createDb(config.databaseUrl);
    return new PostgresStore(db, close);
  }
  return new MemoryStore(loadSeed());
}

/** Composition root: the ONLY place that picks concrete adapters (mock vs real). Mock is always the default. */
export function buildDeps(
  env: Record<string, string | undefined> = process.env,
  config: Config = loadConfig(env),
): Deps {
  const crm = createCrm(env);
  const bus = new EventBus();
  bus.on(EVENTS.leadStageChanged, (p) => crm.pushEvent(EVENTS.leadStageChanged, p));
  bus.on(EVENTS.leadQualified, (p) => crm.pushEvent(EVENTS.leadQualified, p));
  bus.on(EVENTS.viewingBooked, (p) => crm.pushEvent(EVENTS.viewingBooked, p));
  return {
    store: createStore(config),
    qualifier: createQualifier({ llm: new MockLlm() }), // TODO(Dev B, Phase 2): real LLM when LLM_PROVIDER!=mock
    channel: createChannel(env),
    crm,
    scheduler: new NoopScheduler(), // TODO(Dev B, Phase 2): BullMQ scheduler
    bus,
  };
}

const REQUEST_ID = /^[\w.-]{1,64}$/;

export async function buildServer(deps: Deps = buildDeps(), config: Config = loadConfig()) {
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie'],
              censor: '[redacted]',
            },
          },
    // One line per request (onResponse below) instead of Fastify's two. Bodies are never logged: they carry PII.
    disableRequestLogging: true,
    bodyLimit: 256 * 1024,
    // Honour an upstream x-request-id (proxy, front end) when it looks sane; otherwise mint one.
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID.test(h) ? h : randomUUID();
    },
  });

  registerErrorHandling(app);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    const level = req.url === '/health' ? 'debug' : reply.statusCode >= 500 ? 'error' : 'info';
    req.log[level](
      {
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });
  app.addHook('onClose', async () => deps.store.close());

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  const leads = createLeadService(deps, app.log);

  app.get('/health', async (req, reply) => {
    const info = { store: deps.store.name, channel: deps.channel.name, crm: deps.crm.name };
    try {
      await deps.store.ping();
    } catch (err) {
      req.log.error({ err }, 'health: store unreachable');
      return reply.status(503).send({ ok: false, ...info, error: 'Store unreachable' });
    }
    return { ok: true, ...info };
  });

  route(app, 'getProject', async ({ params }) => {
    const p = await deps.store.getProject(params.id!);
    if (!p) throw new HttpError(404, 'Project not found');
    return p;
  });
  route(app, 'listUnits', async ({ params, query }) => ({
    units: await deps.store.listUnits(params.id!, query),
  }));
  route(app, 'createLead', async ({ body }) => leads.createLead(body));
  route(app, 'listLeads', async ({ query }) => ({ leads: await deps.store.listLeads(query) }));
  route(app, 'patchLead', async ({ params, body }) => leads.patchLead(params.id!, body));
  route(app, 'getConversation', async ({ params }) => {
    const c = await deps.store.getConversation(params.id!);
    if (!c) throw new HttpError(404, 'Conversation not found');
    return c;
  });
  route(app, 'sendMessage', async ({ params, body }) =>
    leads.sendMessage(params.id!, body.text, body.quickReplyId),
  );
  route(app, 'requestHandoff', async ({ params }) => leads.handoff(params.id!));
  route(app, 'createViewing', async ({ body }) => leads.bookViewing(body));
  route(app, 'getFunnel', async () => funnel(await deps.store.listLeads({})));
  route(app, 'whatsappWebhook', async ({ body }) => {
    // TODO(Dev B, Phase 2): map inbound phone -> lead/conversation and call leads.sendMessage
    deps.channel.parseInbound(body);
    return { ok: true as const };
  });
  // WhatsApp webhook verification handshake (Meta calls this once when the webhook is configured).
  app.get('/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const token = config.whatsappVerifyToken;
    if (
      token &&
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] === token &&
      q['hub.challenge']
    ) {
      return reply.type('text/plain').send(q['hub.challenge']);
    }
    return reply.status(403).send({ error: 'Webhook verification failed' });
  });

  return app;
}
