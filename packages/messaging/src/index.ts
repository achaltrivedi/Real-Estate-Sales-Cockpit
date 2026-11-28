import type { Locale, QuickReply } from '@gsc/contracts';

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
  /** Id of the tapped quick reply (WhatsApp button / list reply), so the qualifier can skip free-text parsing. */
  quickReplyId?: string;
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
/**
 * Keyword must be the whole message (so "don't stop the follow-ups" is not an opt-out), tolerating case,
 * surrounding punctuation/emoji, "please", and Arabic spelling variants (hamza, ta marbuta, tashkeel).
 */
function keyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(please|pls|plz)\b|من فضلك|لو سمحت/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const OPT_OUT = new Set([
  'stop',
  'stop all',
  'unsubscribe',
  'cancel',
  'opt out',
  'optout',
  'ايقاف',
  'الغاء',
  'الغاء الاشتراك',
  'توقف',
  'وقف',
]);
const OPT_IN = new Set(['start', 'subscribe', 'resume', 'unstop', 'ابدا', 'اشترك', 'استئناف']);
export const isOptOut = (text: string) => OPT_OUT.has(keyword(text));
export const isOptIn = (text: string) => OPT_IN.has(keyword(text));

// ---------- Templates ----------
export const TEMPLATES = {
  follow_up_1: {
    en: 'Hi {{name}}, still interested in Azure Crest? Reply to continue.',
    ar: 'مرحباً {{name}}، هل ما زلت مهتماً بأزور كرست؟',
  },
  viewing_reminder: {
    en: 'Reminder: your viewing is at {{time}}.',
    ar: 'تذكير: موعد معاينتك {{time}}.',
  },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

/** Fills `{{var}}` placeholders. Missing vars render as an empty string (never "undefined"); extra spaces are tidied. */
export function renderTemplate(
  name: TemplateName,
  locale: Locale,
  vars: Record<string, string | undefined> = {},
): string {
  return TEMPLATES[name][locale]
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\s+([,،.?؟])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------- Mock adapter (default; demo runs offline) ----------
export class MockChannel implements MessagingChannel {
  readonly name = 'mock' as const;
  readonly outbox: (OutboundMessage & { at: string })[] = [];
  private seq = 0;

  async send(msg: OutboundMessage) {
    this.outbox.push({ ...msg, at: new Date().toISOString() });
    return { providerMessageId: `mock_${++this.seq}` };
  }

  /** Mock webhook body: `{ from, text, quickReplyId? }` or WhatsApp-shaped body. */
  parseInbound(body: unknown): InboundMessage[] {
    const b = body as { from?: unknown; text?: unknown; quickReplyId?: unknown };
    if (typeof b?.from === 'string' && typeof b.text === 'string' && b.from && b.text) {
      return [
        {
          from: b.from,
          text: b.text,
          quickReplyId: typeof b.quickReplyId === 'string' ? b.quickReplyId : undefined,
          providerMessageId: `mock_in_${++this.seq}`,
          receivedAt: new Date().toISOString(),
        },
      ];
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
            action: {
              buttons: msg.quickReplies
                .slice(0, 3)
                .map((q) => ({ type: 'reply', reply: { id: q.id, title: q.label.slice(0, 20) } })),
            },
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

interface WaMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

/**
 * Text + interactive (button / list) replies and template quick-reply buttons.
 * Delivery statuses, media and malformed entries are skipped, never thrown on (webhooks must always 200).
 * TODO(Dev B, Phase 2): media / location.
 */
export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries as { changes?: unknown }[]) {
    if (!Array.isArray(e?.changes)) continue;
    for (const c of e.changes as { value?: { messages?: unknown } }[]) {
      const msgs = c?.value?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const m of msgs as WaMessage[]) {
        const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
        const text = m.text?.body ?? reply?.title ?? m.button?.text;
        if (!text || !m.from || !m.id) continue;
        const ts = Number(m.timestamp);
        out.push({
          from: m.from,
          text,
          quickReplyId: reply?.id ?? m.button?.payload,
          providerMessageId: m.id,
          receivedAt: (Number.isFinite(ts) && ts > 0
            ? new Date(ts * 1000)
            : new Date()
          ).toISOString(),
        });
      }
    }
  }
  return out;
}

export function createChannel(env: Record<string, string | undefined>): MessagingChannel {
  if (env.MESSAGING_CHANNEL === 'whatsapp') {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
      throw new Error('WhatsApp env vars missing');
    return new WhatsAppChannel({
      token: env.WHATSAPP_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    });
  }
  return new MockChannel();
}
