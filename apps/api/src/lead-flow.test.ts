import { CreateLeadResponse, FunnelResponse, SendMessageResponse } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { buildServer } from './server';

// End-to-end through HTTP with every adapter mocked (the offline demo path).
describe('lead flow (mock adapters)', () => {
  it('widget lead → instant reply → qualified → routed → viewing booked', async () => {
    const app = await buildServer();

    const created = CreateLeadResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/leads',
          payload: { projectId: 'prj_azure_crest', locale: 'en', consent: true, consentText: 'I agree' },
        })
      ).json(),
    );
    expect(created.conversation.messages.length).toBeGreaterThan(0); // instant reply
    expect(created.lead.firstResponseMs).toBeLessThan(1000);

    const convUrl = `/conversations/${created.conversation.id}/messages`;
    let last;
    for (const id of ['purpose:investor', 'unitType:2br', 'budget:1000000-2500000', 'timeline:now']) {
      last = SendMessageResponse.parse((await app.inject({ method: 'POST', url: convUrl, payload: { text: id, quickReplyId: id } })).json());
    }
    expect(last!.qualification.isQualified).toBe(true);

    const leads = (await app.inject({ method: 'GET', url: '/leads' })).json().leads;
    expect(leads[0].stage).toBe('qualified');
    expect(leads[0].assignedToId).toBeDefined();

    const viewing = await app.inject({
      method: 'POST',
      url: '/viewings',
      payload: { leadId: created.lead.id, startsAt: new Date().toISOString(), mode: 'video_call' },
    });
    expect(viewing.statusCode).toBe(200);

    const f = FunnelResponse.parse((await app.inject({ method: 'GET', url: '/metrics/funnel' })).json());
    expect(f.buckets.find((b) => b.bucket === 'viewing')?.count).toBe(1);
  });

  it('rejects a lead without consent', async () => {
    const app = await buildServer();
    const r = await app.inject({ method: 'POST', url: '/leads', payload: { projectId: 'prj_azure_crest', locale: 'en', consent: false, consentText: '' } });
    expect(r.statusCode).toBe(400);
  });
});
