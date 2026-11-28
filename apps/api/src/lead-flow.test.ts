import {
  CreateLeadResponse,
  FunnelResponse,
  LeadsResponse,
  SendMessageResponse,
  Conversation,
  Lead,
} from '@gsc/contracts';
import { MockCrm } from '@gsc/crm';
import { loadSeed, seedDatabase, type DbHandle } from '@gsc/db';
import { createTestDb, resetLeadData } from '@gsc/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import type { Deps } from './domain/lead-service';
import { buildDeps, buildServer } from './server';
import { PostgresStore } from './store/postgres';

const config = loadConfig({ NODE_ENV: 'test' });
let pg: DbHandle | undefined;
afterAll(() => pg?.close());

/** Every adapter mocked (the offline demo path); only the store differs. */
const drivers: [string, () => Promise<Deps>][] = [
  ['memory', async () => buildDeps({}, config)],
  [
    'postgres',
    async () => {
      if (!pg) {
        pg = await createTestDb();
        await seedDatabase(pg.db, loadSeed());
      }
      await resetLeadData(pg.db);
      return { ...buildDeps({}, config), store: new PostgresStore(pg.db) };
    },
  ],
];

// Exactly what apps/web ChatProvider sends (see features/chat-widget).
const widgetLead = (over: Record<string, unknown> = {}) => ({
  projectId: 'prj_azure_crest',
  locale: 'en',
  name: 'Sample Buyer',
  phone: '+971500000001',
  unitId: 'unit_t1_0301',
  consent: true,
  consentText: 'I agree to be contacted about this sample project.',
  ...over,
});

describe.each(drivers)('lead flow [%s store]', (_name, makeDeps) => {
  it('widget lead → instant reply → qualified → routed → viewing booked → funnel', async () => {
    const app = await buildServer(await makeDeps(), config);

    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      headers: { origin: 'http://localhost:3000' },
      payload: widgetLead(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const created = CreateLeadResponse.parse(res.json());
    expect(created.conversation.messages.length).toBeGreaterThan(0); // instant reply
    expect(created.lead).toMatchObject({
      stage: 'contacted',
      name: 'Sample Buyer',
      interestedUnitIds: ['unit_t1_0301'],
    });
    expect(created.lead.firstResponseMs).toBeLessThan(1000);

    const convUrl = `/conversations/${created.conversation.id}/messages`;
    let last;
    for (const id of [
      'purpose:investor',
      'unitType:2br',
      'budget:1000000-2500000',
      'timeline:now',
    ]) {
      last = SendMessageResponse.parse(
        (
          await app.inject({
            method: 'POST',
            url: convUrl,
            payload: { text: id, quickReplyId: id },
          })
        ).json(),
      );
    }
    expect(last!.qualification.isQualified).toBe(true);

    const leads = LeadsResponse.parse(
      (await app.inject({ method: 'GET', url: '/leads' })).json(),
    ).leads;
    expect(leads[0]!.stage).toBe('qualified');
    expect(leads[0]!.assignedToId).toBeDefined();

    // The whole conversation reads back in order, and matches the contract.
    const conv = Conversation.parse(
      (
        await app.inject({ method: 'GET', url: `/conversations/${created.conversation.id}` })
      ).json(),
    );
    expect(conv.messages.filter((m) => m.role === 'buyer').map((m) => m.text)).toEqual([
      'purpose:investor',
      'unitType:2br',
      'budget:1000000-2500000',
      'timeline:now',
    ]);

    const viewing = await app.inject({
      method: 'POST',
      url: '/viewings',
      payload: {
        leadId: created.lead.id,
        unitId: 'unit_t1_0301',
        startsAt: new Date().toISOString(),
        mode: 'video_call',
      },
    });
    expect(viewing.statusCode).toBe(200);
    expect(viewing.json().salespersonId).toBe(leads[0]!.assignedToId);

    const f = FunnelResponse.parse(
      (await app.inject({ method: 'GET', url: '/metrics/funnel' })).json(),
    );
    expect(f.buckets.find((b) => b.bucket === 'viewing')?.count).toBe(1);
    expect(f.medianFirstResponseMs).not.toBeNull();
  });

  it('qualifies an Arabic buyer from free text (Arabic digits, ranges, dialect)', async () => {
    const app = await buildServer(await makeDeps(), config);
    const created = CreateLeadResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/leads',
          payload: widgetLead({ locale: 'ar', unitId: undefined }),
        })
      ).json(),
    );
    expect(created.conversation.messages[0]!.text).toContain('مرحباً');

    const send = async (text: string) =>
      SendMessageResponse.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/conversations/${created.conversation.id}/messages`,
            payload: { text },
          })
        ).json(),
      );
    await send('أبغى شقة غرفتين وصالة للاستثمار');
    const r = await send('ميزانيتي من ١٫٥ إلى ٢ مليون، وأبي أشتري خلال ٣ أشهر');
    expect(r.qualification).toMatchObject({
      unitType: '2br',
      purpose: 'investor',
      budgetMinAed: 1_500_000,
      budgetMaxAed: 2_000_000,
      timeline: '0_3_months',
      isQualified: true,
    });
    expect(r.messages.at(-1)!.text).toContain('معاينة'); // Arabic "book a viewing" reply

    const lead = Lead.parse((await app.inject({ method: 'GET', url: '/leads' })).json().leads[0]);
    expect(lead.stage).toBe('qualified');
    // Routed to an available Arabic speaker who handles 2br (seed: Layla or Omar).
    expect(['sp_layla', 'sp_omar']).toContain(lead.assignedToId);
  });

  it('says it did not understand instead of silently repeating the question', async () => {
    const app = await buildServer(await makeDeps(), config);
    const created = CreateLeadResponse.parse(
      (await app.inject({ method: 'POST', url: '/leads', payload: widgetLead() })).json(),
    );
    const r = SendMessageResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/conversations/${created.conversation.id}/messages`,
          payload: { text: 'hmm' },
        })
      ).json(),
    );
    expect(r.messages.at(-1)!.text).toMatch(/^Sorry, I did not catch that\./);
  });

  it('keeps the lead when the widget sends an unknown unit id', async () => {
    const app = await buildServer(await makeDeps(), config);
    const r = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: widgetLead({ unitId: 'unit_does_not_exist' }),
    });
    expect(r.statusCode).toBe(200);
    expect(CreateLeadResponse.parse(r.json()).lead.interestedUnitIds).toEqual([]);
  });

  it('rejects unknown units for viewings and unknown salespeople for assignment (400, not a DB error)', async () => {
    const app = await buildServer(await makeDeps(), config);
    const { lead } = CreateLeadResponse.parse(
      (await app.inject({ method: 'POST', url: '/leads', payload: widgetLead() })).json(),
    );
    const v = await app.inject({
      method: 'POST',
      url: '/viewings',
      payload: {
        leadId: lead.id,
        unitId: 'unit_nope',
        startsAt: new Date().toISOString(),
        mode: 'in_person',
      },
    });
    expect(v.statusCode).toBe(400);
    expect(v.json().error).toBe('Unknown unit for this project');
    const p = await app.inject({
      method: 'PATCH',
      url: `/leads/${lead.id}`,
      payload: { assignedToId: 'sp_nobody' },
    });
    expect(p.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PATCH',
      url: `/leads/${lead.id}`,
      payload: { assignedToId: 'sp_james', stage: 'lost' },
    });
    expect(ok.json()).toMatchObject({ assignedToId: 'sp_james', stage: 'lost' });
  });

  it('opt-out and opt-in', async () => {
    const app = await buildServer(await makeDeps(), config);
    const { conversation, lead } = CreateLeadResponse.parse(
      (await app.inject({ method: 'POST', url: '/leads', payload: widgetLead() })).json(),
    );
    const url = `/conversations/${conversation.id}/messages`;
    const out = SendMessageResponse.parse(
      (await app.inject({ method: 'POST', url, payload: { text: 'Stop.' } })).json(),
    );
    expect(out.messages.at(-1)).toMatchObject({
      role: 'system',
      text: expect.stringContaining('unsubscribed'),
    });
    const get = async () =>
      LeadsResponse.parse((await app.inject({ method: 'GET', url: '/leads' })).json()).leads.find(
        (l) => l.id === lead.id,
      )!;
    expect((await get()).optedOut).toBe(true);
    await app.inject({ method: 'POST', url, payload: { text: 'START' } });
    expect((await get()).optedOut).toBe(false);
  });

  it('human handoff assigns a salesperson and stops bot replies', async () => {
    const app = await buildServer(await makeDeps(), config);
    const { conversation } = CreateLeadResponse.parse(
      (await app.inject({ method: 'POST', url: '/leads', payload: widgetLead() })).json(),
    );
    const h = Conversation.parse(
      (
        await app.inject({ method: 'POST', url: `/conversations/${conversation.id}/handoff` })
      ).json(),
    );
    expect(h.status).toBe('human');
    const r = SendMessageResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/conversations/${conversation.id}/messages`,
          payload: { text: '2br please' },
        })
      ).json(),
    );
    expect(r.messages).toHaveLength(1); // only the buyer message; a human answers now
    expect(r.messages[0]!.role).toBe('buyer');
  });
});

describe('resilience', () => {
  it('a failing CRM never loses the lead or delays the reply', async () => {
    const deps = buildDeps({}, config);
    class DownCrm extends MockCrm {
      override async upsertLead(): Promise<void> {
        throw new Error('CRM is down');
      }
    }
    const app = await buildServer({ ...deps, crm: new DownCrm() }, config);
    const r = await app.inject({ method: 'POST', url: '/leads', payload: widgetLead() });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/leads' })).json().leads).toHaveLength(1);
  });

  it('rejects a lead without consent', async () => {
    const app = await buildServer(buildDeps({}, config), config);
    const r = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: widgetLead({ consent: false, consentText: '' }),
    });
    expect(r.statusCode).toBe(400);
  });
});
