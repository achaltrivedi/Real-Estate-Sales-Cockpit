import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import { EVENTS } from '@gsc/contracts';
import { createCrm } from '@gsc/crm';
import { createDb, loadSeed } from '@gsc/db';
import { createChannel, verifyWhatsAppSignature } from '@gsc/messaging';
import { createLlm, createQualifier } from '@gsc/qualifier';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type Config } from './config';
import { HttpError } from './domain/errors';
import { EventBus } from './domain/events';
import { createLeadService, type Deps, type Logger } from './domain/lead-service';
import { funnel } from './domain/metrics';
import { registerErrorHandling } from './http/errors';
import { route } from './http/route';
import { JobScheduler, MemoryJobStore, PostgresJobStore, type JobStore } from './scheduler';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { Store } from './store/store';

function createPersistence(config: Config): { store: Store; jobs: JobStore } {
  if (config.dataDriver === 'postgres') {
    const { db, close } = createDb(config.databaseUrl);
    return { store: new PostgresStore(db, close), jobs: new PostgresJobStore(db) };
  }
  return { store: new MemoryStore(loadSeed()), jobs: new MemoryJobStore() };
}

/** Logger used before Fastify's exists; `useLogger` swaps in `app.log`. */
const bootLogger: Logger = {
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};

export interface AppDeps extends Deps {
  /** Points adapter logging (LLM fallback, scheduler) at the app logger. */
  useLogger?(log: Logger): void;
}

/** Composition root: the ONLY place that picks concrete adapters (mock vs real). Mock is always the default. */
export function buildDeps(
  env: Record<string, string | undefined> = process.env,
  config: Config = loadConfig(env),
): AppDeps {
  let log: Logger = bootLogger;
  const crm = createCrm(env);
  const bus = new EventBus();
  bus.on(EVENTS.leadStageChanged, (p) => crm.pushEvent(EVENTS.leadStageChanged, p));
  bus.on(EVENTS.leadQualified, (p) => crm.pushEvent(EVENTS.leadQualified, p));
  bus.on(EVENTS.viewingBooked, (p) => crm.pushEvent(EVENTS.viewingBooked, p));

  const llm = createLlm(env, {
    onError: (err) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'LLM failed, used rule-based fallback',
      ),
  });
  const { store, jobs } = createPersistence(config);
  const scheduler = new JobScheduler(jobs, {
    followUpDelaysMs: config.followUpDelaysMs,
    quietHours: config.quietHours,
    timeZone: config.timeZone,
    pollMs: config.schedulerPollMs,
    log: { warn: (o, m) => log.warn(o, m), error: (o, m) => log.error(o, m) },
  });

  return {
    store,
    qualifier: createQualifier({ llm }),
    channel: createChannel(env),
    crm,
    scheduler,
    bus,
    useLogger: (l) => {
      log = l;
    },
  };
}

const REQUEST_ID = /^[\w.-]{1,64}$/;

export async function buildServer(
  deps: AppDeps = buildDeps(),
  config: Config = loadConfig(),
  /** Test hook: a fake clock for timestamps / the WhatsApp 24h window. */
  opts: { now?: () => Date } = {},
) {
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
  deps.useLogger?.(app.log);

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
  app.addHook('onClose', async () => {
    await deps.scheduler.stop();
    await deps.store.close();
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  const leads = createLeadService(deps, app.log, {
    defaultProjectId: config.defaultProjectId,
    defaultCountryCode: config.defaultCountryCode,
    now: opts.now,
  });
  deps.scheduler.setHandler((job) => leads.runJob(job));

  app.get('/health', async (req, reply) => {
    const info = {
      store: deps.store.name,
      channel: deps.channel.name,
      crm: deps.crm.name,
      llm: deps.qualifier.llmName,
    };
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

  await app.register(async (scope) => whatsappWebhook(scope, deps, config, leads));

  return app;
}

/**
 * WhatsApp Cloud API webhook, in its own scope so it can keep the raw body for signature checks.
 * Always answers 200 once authenticated: Meta retries anything else, which would duplicate replies.
 */
function whatsappWebhook(
  app: FastifyInstance,
  deps: AppDeps,
  config: Config,
  leads: ReturnType<typeof createLeadService>,
) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  if (config.whatsappAppSecret) {
    const secret = config.whatsappAppSecret;
    app.addHook('preHandler', async (req, reply) => {
      if (req.method !== 'POST') return;
      const raw = (req as { rawBody?: string }).rawBody ?? '';
      const sig = req.headers['x-hub-signature-256'];
      if (!verifyWhatsAppSignature(raw, typeof sig === 'string' ? sig : undefined, secret)) {
        req.log.warn('whatsapp webhook: bad signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    });
  }

  route(app, 'whatsappWebhook', async ({ body }) => {
    for (const inbound of deps.channel.parseInbound(body)) {
      try {
        await leads.receiveWhatsApp(inbound);
      } catch (err) {
        app.log.error(
          { err, providerMessageId: inbound.providerMessageId },
          'whatsapp inbound failed',
        );
      }
    }
    return { ok: true as const };
  });

  // Verification handshake (Meta calls this once when the webhook is configured).
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
}
