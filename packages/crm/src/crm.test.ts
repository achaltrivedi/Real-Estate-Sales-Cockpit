import type { Lead } from '@gsc/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockCrm, WebhookCrm, createCrm } from './index';

const lead = {
  id: 'lead_1',
  projectId: 'prj_azure_crest',
  locale: 'en',
  source: 'web_widget',
  stage: 'new',
  consent: { given: true, at: '2026-01-01T00:00:00.000Z', text: 'I agree' },
  optedOut: false,
  interestedUnitIds: [],
  qualification: {
    score: 0,
    isQualified: false,
    missing: ['budget', 'timeline', 'unitType', 'purpose'],
  },
  conversationId: 'conv_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Lead;

describe('MockCrm', () => {
  it('upserts by id and records events', async () => {
    const crm = new MockCrm();
    await crm.upsertLead(lead);
    await crm.upsertLead({ ...lead, stage: 'contacted' });
    expect(crm.records.size).toBe(1);
    expect(crm.records.get('lead_1')?.stage).toBe('contacted');
    await crm.pushEvent('lead.stage_changed', {
      at: lead.createdAt,
      leadId: lead.id,
      from: 'new',
      to: 'contacted',
    });
    expect(crm.events).toEqual([
      { name: 'lead.stage_changed', payload: expect.objectContaining({ to: 'contacted' }) },
    ]);
  });
});

describe('WebhookCrm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs typed JSON payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const crm = new WebhookCrm('https://hooks.example.test/crm');
    await crm.upsertLead(lead);
    await crm.pushEvent('lead.qualified', { at: lead.createdAt, lead });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.test/crm');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ type: 'lead.upsert', lead });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).type).toBe('lead.qualified');
  });

  it('throws on a non-2xx response so the caller can log / retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    await expect(new WebhookCrm('https://x.test').upsertLead(lead)).rejects.toThrow(/500/);
  });
});

describe('createCrm', () => {
  it('defaults to the mock', () => expect(createCrm({}).name).toBe('mock'));
  it('falls back to the mock when the webhook URL is missing', () =>
    expect(createCrm({ CRM_ADAPTER: 'webhook' }).name).toBe('mock'));
  it('uses the webhook when configured', () =>
    expect(createCrm({ CRM_ADAPTER: 'webhook', CRM_WEBHOOK_URL: 'https://x.test' }).name).toBe(
      'webhook',
    ));
});
