import type { EventName, EventPayload, Lead } from '@gsc/contracts';

/** CRM behind an interface: mock for the demo, webhook for real client CRMs (Zapier/Make/HubSpot). */
export interface CrmAdapter {
  readonly name: 'mock' | 'webhook';
  upsertLead(lead: Lead): Promise<void>;
  pushEvent<E extends EventName>(name: E, payload: EventPayload<E>): Promise<void>;
}

export class MockCrm implements CrmAdapter {
  readonly name = 'mock' as const;
  readonly records = new Map<string, Lead>();
  readonly events: { name: EventName; payload: unknown }[] = [];

  async upsertLead(lead: Lead) {
    this.records.set(lead.id, lead);
  }
  async pushEvent<E extends EventName>(name: E, payload: EventPayload<E>) {
    this.events.push({ name, payload });
  }
}

export class WebhookCrm implements CrmAdapter {
  readonly name = 'webhook' as const;
  constructor(
    private url: string,
    private timeoutMs = 5000,
  ) {}

  private async post(body: unknown) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs), // a hung CRM must not pile up requests
    });
    if (!res.ok) throw new Error(`CRM webhook failed: ${res.status}`);
  }
  upsertLead(lead: Lead) {
    return this.post({ type: 'lead.upsert', lead });
  }
  pushEvent<E extends EventName>(name: E, payload: EventPayload<E>) {
    return this.post({ type: name, payload });
  }
}

export function createCrm(env: Record<string, string | undefined>): CrmAdapter {
  if (env.CRM_ADAPTER === 'webhook' && env.CRM_WEBHOOK_URL)
    return new WebhookCrm(env.CRM_WEBHOOK_URL);
  return new MockCrm();
}
