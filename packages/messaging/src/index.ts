import type { QuickReply } from '@gsc/contracts';

export interface OutboundMessage {
  to: string; // phone (E.164) for WhatsApp, conversationId for web
  text: string;
  quickReplies?: QuickReply[];
  /** Pre-approved WhatsApp template name (needed outside the 24h window). */
  template?: TemplateName;
}

export interface InboundMessage {
  from: string;
  text: string;
  providerMessageId: string;
  receivedAt: string;
}

/** Every channel (WhatsApp, mock, later SMS/email) implements this. */
export interface MessagingChannel {
  readonly name: 'mock' | 'whatsapp';
  send(msg: OutboundMessage): Promise<{ providerMessageId: string }>;
  /** Parse a provider webhook body into zero or more inbound messages. */
  parseInbound(body: unknown): InboundMessage[];
}

// ---------- Opt-in / opt-out ----------
const OPT_OUT = /^\s*(stop|unsubscribe|cancel|إيقاف|الغاء|إلغاء)\s*$/i;
const OPT_IN = /^\s*(start|subscribe|ابدأ)\s*$/i;
export const isOptOut = (text: string) => OPT_OUT.test(text);
export const isOptIn = (text: string) => OPT_IN.test(text);

// ---------- Templates ----------
export const TEMPLATES = {
  follow_up_1: { en: 'Hi {{name}}, still interested in Azure Crest? Reply to continue.', ar: 'مرحباً {{name}}، هل ما زلت مهتماً بأزور كرست؟' },
  viewing_reminder: { en: 'Reminder: your viewing is at {{time}}.', ar: 'تذكير: موعد معاينتك {{time}}.' },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

// ---------- Mock adapter (default; demo runs offline) ----------
export class MockChannel implements MessagingChannel {
  readonly name = 'mock' as const;
  readonly outbox: (OutboundMessage & { at: string })[] = [];
  private seq = 0;

  async send(msg: OutboundMessage) {
    this.outbox.push({ ...msg, at: new Date().toISOString() });
    return { providerMessageId: `mock_${++this.seq}` };
  }

  /** Mock webhook body: `{ from, text }` or WhatsApp-shaped body. */
  parseInbound(body: unknown): InboundMessage[] {
    const b = body as { from?: string; text?: string };
    if (b?.from && b.text) {
      return [{ from: b.from, text: b.text, providerMessageId: `mock_in_${++this.seq}`, receivedAt: new Date().toISOString() }];
    }
    return parseWhatsAppWebhook(body);
  }
}

// ---------- WhatsApp Cloud API adapter (Phase 4: sandbox) ----------
export class WhatsAppChannel implements MessagingChannel {
  readonly name = 'whatsapp' as const;
  constructor(private cfg: { token: string; phoneNumberId: string; apiVersion?: string }) {}

  async send(msg: OutboundMessage) {
    const url = `https://graph.facebook.com/${this.cfg.apiVersion ?? 'v21.0'}/${this.cfg.phoneNumberId}/messages`;
    const payload = msg.quickReplies?.length
      ? {
          messaging_product: 'whatsapp',
          to: msg.to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: msg.text },
            // WhatsApp allows max 3 reply buttons, 20 chars each.
            action: { buttons: msg.quickReplies.slice(0, 3).map((q) => ({ type: 'reply', reply: { id: q.id, title: q.label.slice(0, 20) } })) },
          },
        }
      : { messaging_product: 'whatsapp', to: msg.to, type: 'text', text: { body: msg.text } };
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
    const json = (await res.json()) as { messages?: { id: string }[] };
    return { providerMessageId: json.messages?.[0]?.id ?? 'unknown' };
  }

  parseInbound(body: unknown) {
    return parseWhatsAppWebhook(body);
  }
}

/** TODO(Dev B): extend for interactive replies, statuses, media. */
export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: { changes?: { value?: { messages?: unknown[] } }[] }[] })?.entry ?? [];
  for (const e of entries)
    for (const c of e.changes ?? [])
      for (const m of (c.value?.messages ?? []) as { from: string; id: string; timestamp: string; text?: { body: string }; interactive?: { button_reply?: { title: string } } }[]) {
        const text = m.text?.body ?? m.interactive?.button_reply?.title;
        if (text) out.push({ from: m.from, text, providerMessageId: m.id, receivedAt: new Date(Number(m.timestamp) * 1000).toISOString() });
      }
  return out;
}

export function createChannel(env: Record<string, string | undefined>): MessagingChannel {
  if (env.MESSAGING_CHANNEL === 'whatsapp') {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Error('WhatsApp env vars missing');
    return new WhatsAppChannel({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID });
  }
  return new MockChannel();
}
