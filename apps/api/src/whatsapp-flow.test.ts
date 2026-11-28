import { createHmac, randomUUID } from 'node:crypto';
import { CreateLeadResponse, Lead, LeadsResponse } from '@gsc/contracts';
import { loadSeed, seedDatabase, type DbHandle } from '@gsc/db';
import { createTestDb, resetLeadData } from '@gsc/db/testing';
import { MockChannel, type OutboundMessage } from '@gsc/messaging';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { JobScheduler, MemoryJobStore, PostgresJobStore, type JobStore } from './scheduler';
import { buildDeps, buildServer } from './server';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { Store } from './store/store';

const H = 3_600_000;
const config = loadConfig({ NODE_ENV: 'test' });

/** Mock WhatsApp that can be told to fail the next N sends (to exercise instant-reply retry). */
class FlakyChannel extends MockChannel {
  failNext = 0;
  override async send(msg: OutboundMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('WhatsApp send failed: 503');
    }
    return super.send(msg);
  }
}

let pg: DbHandle | undefined;
afterAll(() => pg?.close());

const drivers: [string, () => Promise<{ store: Store; jobs: JobStore }>][] = [
  ['memory', async () => ({ store: new MemoryStore(loadSeed()), jobs: new MemoryJobStore() })],
  [
    'postgres',
    async () => {
      if (!pg) {
        pg = await createTestDb();
        await seedDatabase(pg.db, loadSeed());
      }
      await resetLeadData(pg.db);
      return { store: new PostgresStore(pg.db), jobs: new PostgresJobStore(pg.db) };
    },
  ],
];

async function setup(
  makeStores: () => Promise<{ store: Store; jobs: JobStore }>,
  env: Record<string, string> = {},
) {
  let t = new Date('2026-03-10T10:00:00+04:00').getTime(); // daytime in Dubai
  const now = () => new Date(t);
  const cfg = loadConfig({ NODE_ENV: 'test', ...env });
  const { store, jobs } = await makeStores();
  const channel = new FlakyChannel();
  const scheduler = new JobScheduler(jobs, {
    followUpDelaysMs: [1 * H, 24 * H, 72 * H],
    quietHours: cfg.quietHours,
    timeZone: cfg.timeZone,
    now,
  });
  const deps = { ...buildDeps({}, cfg), store, channel, scheduler };
  const app = await buildServer(deps, cfg, { now });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: body as object, headers });
  const leads = async () =>
    LeadsResponse.parse((await app.inject({ method: 'GET', url: '/leads' })).json()).leads;
  return { app, store, jobs, channel, scheduler, post, leads, advance: (ms: number) => (t += ms) };
}

/** WhatsApp Cloud API webhook body with one message. */
function wa(from: string, m: { text?: string; buttonId?: string; title?: string; id?: string }) {
  const message = m.buttonId
    ? {
        from,
        id: m.id ?? `wamid.${randomUUID()}`,
        timestamp: '1773122400',
        type: 'interactive',
        interactive: { button_reply: { id: m.buttonId, title: m.title ?? m.buttonId } },
      }
    : {
        from,
        id: m.id ?? `wamid.${randomUUID()}`,
        timestamp: '1773122400',
        type: 'text',
        text: { body: m.text },
      };
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messages: [message] } }] }],
  };
}

const BUYER = '971501112233';

describe.each(drivers)('WhatsApp conversation [%s store]', (_name, makeStores) => {
  it('a fake buyer on WhatsApp is greeted, qualified with buttons and routed', async () => {
    const { post, channel, leads } = await setup(makeStores);

    expect((await post(wa(BUYER, { text: 'Hi' }))).statusCode).toBe(200);
    let [lead] = await leads();
    expect(lead).toMatchObject({
      source: 'whatsapp',
      phone: '+971501112233',
      locale: 'en',
      stage: 'contacted',
    });
    expect(lead!.firstResponseMs).toBeGreaterThanOrEqual(0);
    expect(channel.outbox.map((m) => m.to)).toEqual(['+971501112233', '+971501112233']);
    expect(channel.outbox[0]!.text).toMatch(/^Hi! 👋/); // greeting, not "didn't catch that"
    expect(channel.outbox[1]!.quickReplies?.map((q) => q.id)).toEqual([
      'purpose:investor',
      'purpose:end_user',
    ]);

    for (const [id, title] of [
      ['purpose:investor', 'Investment'],
      ['unitType:2br', '2 Bedrooms'],
      ['budget:1000000-2500000', '1M – 2.5M'],
      ['timeline:now', 'Right now'],
    ]) {
      await post(wa(BUYER, { buttonId: id, title }));
    }
    [lead] = await leads();
    expect(lead!.stage).toBe('qualified');
    expect(lead!.qualification).toMatchObject({
      isQualified: true,
      unitType: '2br',
      purpose: 'investor',
    });
    expect(['sp_james', 'sp_layla']).toContain(lead!.assignedToId); // English 2br specialists
    expect(channel.outbox.at(-1)!.quickReplies?.map((q) => q.id)).toEqual([
      'action:book_viewing',
      'action:handoff',
    ]);
  });

  it('reads a first Arabic message, replies in Arabic and skips questions already answered', async () => {
    const { post, channel, leads } = await setup(makeStores);
    await post(wa(BUYER, { text: 'مرحبا، أبحث عن شقة غرفتين للاستثمار' }));
    const [lead] = await leads();
    expect(lead).toMatchObject({
      locale: 'ar',
      qualification: { unitType: '2br', purpose: 'investor' },
    });
    expect(channel.outbox[0]!.text).toContain('مرحباً'); // greeting
    expect(channel.outbox[1]!.text).toBe('ما هي ميزانيتك التقريبية (درهم)؟'); // next missing slot: budget
  });

  it('ignores Meta re-deliveries of the same message', async () => {
    const { post, channel, leads } = await setup(makeStores);
    const body = wa(BUYER, { text: 'Hi', id: 'wamid.SAME' });
    await post(body);
    await post(body);
    expect(await leads()).toHaveLength(1);
    expect(channel.outbox).toHaveLength(2);
  });

  it('continues the web lead when the same buyer later writes on WhatsApp', async () => {
    const { app, post, leads, store } = await setup(makeStores);
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: {
        projectId: 'prj_azure_crest',
        locale: 'en',
        phone: '050 111 2233',
        consent: true,
        consentText: 'ok',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const web = CreateLeadResponse.parse(res.json());
    expect(web.lead.phone).toBe('+971501112233'); // normalised to E.164
    await post(wa(BUYER, { text: 'I want a 3br' }));
    const all = await leads();
    expect(all).toHaveLength(1);
    expect(all[0]!.qualification.unitType).toBe('3br');
    const conv = await store.getConversation(web.conversation.id);
    expect(conv!.messages.filter((m) => m.channel === 'whatsapp').map((m) => m.role)).toEqual([
      'buyer',
      'assistant',
    ]);
  });

  it('STOP opts out: only the confirmation is sent and reminders are cancelled', async () => {
    const { post, channel, leads, jobs } = await setup(makeStores);
    await post(wa(BUYER, { text: 'Hi' }));
    const [lead] = await leads();
    expect((await jobs.listForLead(lead!.id)).filter((j) => j.status === 'pending')).toHaveLength(
      3,
    );
    channel.outbox.length = 0;
    await post(wa(BUYER, { text: 'STOP' }));
    expect((await leads())[0]!.optedOut).toBe(true);
    expect(channel.outbox.map((m) => m.text)).toEqual([
      'You have been unsubscribed. Reply START to resume.',
    ]);
    expect((await jobs.listForLead(lead!.id)).filter((j) => j.status === 'pending')).toHaveLength(
      0,
    );
  });

  it('"Book a viewing" hands the chat to the assigned salesperson', async () => {
    const { post, channel, leads, store } = await setup(makeStores);
    await post(wa(BUYER, { text: 'Hi' }));
    await post(wa(BUYER, { buttonId: 'action:book_viewing', title: 'Book a viewing' }));
    const [lead] = await leads();
    expect(lead!.assignedToId).toBeDefined();
    expect((await store.getConversation(lead!.conversationId))!.status).toBe('human');
    expect(channel.outbox.at(-1)!.text).toMatch(/advisor will message you/);
    // A human now owns the chat: the bot stays quiet.
    const before = channel.outbox.length;
    await post(wa(BUYER, { text: 'Saturday 11am works' }));
    expect(channel.outbox).toHaveLength(before);
  });

  it('retries a reply that failed to send (instant-reply retry)', async () => {
    const { post, channel, scheduler, advance, leads, jobs } = await setup(makeStores);
    channel.failNext = 1;
    await post(wa(BUYER, { text: 'Hi' }));
    expect(channel.outbox).toHaveLength(1); // greeting failed, question went out
    const [lead] = await leads();
    expect((await jobs.listForLead(lead!.id)).filter((j) => j.kind === 'send_retry')).toHaveLength(
      1,
    );
    advance(30_000);
    await scheduler.runDue();
    expect(channel.outbox.map((m) => m.text)[1]).toMatch(/^Hi! 👋/);
  });

  it('follows up when the buyer goes quiet: free text inside 24h, an approved template after', async () => {
    const { post, channel, scheduler, advance, leads, store } = await setup(makeStores);
    await post(wa(BUYER, { text: 'Hi' }));
    channel.outbox.length = 0;

    advance(1 * H);
    expect(await scheduler.runDue()).toBe(1);
    expect(channel.outbox[0]!.template).toBeUndefined();
    expect(channel.outbox[0]!.text).toContain('still interested in Azure Crest');
    expect(channel.outbox[0]!.quickReplies?.[0]?.id).toBe('purpose:investor'); // nudge re-asks the open question

    advance(23 * H); // 24h after the buyer's message: outside the customer-service window
    await scheduler.runDue();
    expect(channel.outbox[1]!.template).toEqual({
      name: 'follow_up_2',
      locale: 'en',
      vars: { name: undefined },
    });

    const [lead] = await leads();
    const conv = await store.getConversation(lead!.conversationId);
    expect(
      conv!.messages.filter((m) => m.role === 'assistant' && m.channel === 'whatsapp'),
    ).toHaveLength(4); // 2 replies + 2 nudges
  });

  it('a reply stops the pending reminders and restarts the clock', async () => {
    const { post, channel, scheduler, advance } = await setup(makeStores);
    await post(wa(BUYER, { text: 'Hi' }));
    advance(50 * 60_000);
    await post(wa(BUYER, { buttonId: 'purpose:investor', title: 'Investment' }));
    channel.outbox.length = 0;
    advance(20 * 60_000); // 1h10 after the first message, 20 min after the reply
    expect(await scheduler.runDue()).toBe(0);
    advance(40 * 60_000); // 1h after the reply
    expect(await scheduler.runDue()).toBe(1);
  });

  it('no reminders once the buyer is qualified', async () => {
    const { post, channel, scheduler, advance } = await setup(makeStores);
    await post(wa(BUYER, { text: 'Hi' }));
    for (const id of ['purpose:investor', 'unitType:2br', 'budget:1000000-2500000', 'timeline:now'])
      await post(wa(BUYER, { buttonId: id }));
    channel.outbox.length = 0;
    advance(100 * H);
    await scheduler.runDue();
    expect(channel.outbox).toEqual([]);
  });
});

describe('WhatsApp webhook security', () => {
  const body = JSON.stringify(wa(BUYER, { text: 'Hi' }));
  const sign = (raw: string, secret: string) =>
    'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  const makeMem = async () => ({
    store: new MemoryStore(loadSeed()) as Store,
    jobs: new MemoryJobStore() as JobStore,
  });

  it('rejects unsigned or wrongly signed posts when WHATSAPP_APP_SECRET is set', async () => {
    const { app, leads } = await setup(makeMem, { WHATSAPP_APP_SECRET: 'app-secret' });
    const send = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        payload: body,
        headers: { 'content-type': 'application/json', ...headers },
      });
    expect((await send({})).statusCode).toBe(401);
    expect((await send({ 'x-hub-signature-256': sign(body, 'wrong') })).statusCode).toBe(401);
    expect(await leads()).toHaveLength(0);
    expect((await send({ 'x-hub-signature-256': sign(body, 'app-secret') })).statusCode).toBe(200);
    expect(await leads()).toHaveLength(1);
  });

  it('acknowledges status-only callbacks without creating leads', async () => {
    const { post, leads } = await setup(makeMem);
    const r = await post({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }],
    });
    expect(r.statusCode).toBe(200);
    expect(await leads()).toHaveLength(0);
  });

  it('still parses malformed JSON as a 400', async () => {
    const { app } = await setup(makeMem);
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      payload: '{bad',
      headers: { 'content-type': 'application/json' },
    });
    expect(r.statusCode).toBe(400);
  });
});

it('Lead from WhatsApp matches the contract', async () => {
  const { post, leads } = await setup(drivers[0]![1]);
  await post(wa(BUYER, { text: 'Hi' }));
  expect(Lead.safeParse((await leads())[0]).success).toBe(true);
  void config;
});
