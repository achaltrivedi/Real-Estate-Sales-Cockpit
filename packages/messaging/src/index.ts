import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Locale, QuickReply } from '@gsc/contracts';

export interface OutboundMessage {
  to: string; // phone (E.164) for WhatsApp, conversationId for web
  /** Rendered text (also what we store in the conversation). */
  text: string;
  quickReplies?: QuickReply[];
  /** Language for channel chrome (e.g. the WhatsApp list button). */
  locale?: Locale;
  /**
   * Pre-approved WhatsApp template, required outside the 24h customer-service window.
   * The channel sends the template; `text` stays the human-readable rendering.
   */
  template?: { name: TemplateName; locale: Locale; vars?: Record<string, string | undefined> };
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
/**
 * Outbound templates. Names must match templates approved in WhatsApp Manager; `params` is the
 * positional order ({{1}}, {{2}}…) WhatsApp expects. The text is our rendering for the conversation log.
 */
export const TEMPLATES = {
  follow_up_1: {
    params: ['name'],
    en: 'Hi {{name}}, still interested in Azure Crest? Reply to continue.',
    ar: 'مرحباً {{name}}، هل ما زلت مهتماً بأزور كرست؟',
  },
  follow_up_2: {
    params: ['name'],
    en: 'Hi {{name}}, our advisors can share floor plans and payment plans for Azure Crest. Reply anytime and we will pick up where we left off.',
    ar: 'مرحباً {{name}}، يمكن لمستشارينا مشاركة المخططات وخطط الدفع لأزور كرست. راسلنا في أي وقت لنكمل من حيث توقفنا.',
  },
  follow_up_3: {
    params: ['name'],
    en: 'Hi {{name}}, this is our last check-in about Azure Crest. Reply any time if you would like help. Reply STOP to opt out.',
    ar: 'مرحباً {{name}}، هذه آخر رسالة متابعة بخصوص أزور كرست. راسلنا متى شئت إن احتجت مساعدة. أرسل STOP لإيقاف الرسائل.',
  },
  viewing_reminder: {
    params: ['time'],
    en: 'Reminder: your viewing is at {{time}}.',
    ar: 'تذكير: موعد معاينتك {{time}}.',
  },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

// ---------- Phone numbers ----------
/**
 * Normalises a phone number to E.164 (`+971501234567`) so the same buyer matches across channels
 * (widget "050 123 4567", WhatsApp "971501234567"). Local numbers (leading 0) get `defaultCountryCode`.
 * Returns null for anything that cannot be a phone number.
 */
export function normalizePhone(raw: string | undefined, defaultCountryCode = '971'): string | null {
  if (!raw) return null;
  const ascii = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
  if (/[^\d\s+().-]/.test(ascii)) return null;
  let digits = ascii.replace(/\D/g, '');
  if (ascii.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = defaultCountryCode + digits.slice(1);
  } else if (digits.length <= 9) {
    digits = defaultCountryCode + digits; // national number without the trunk 0 (e.g. 501234567)
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

// ---------- Webhook signature ----------
/** Verifies Meta's `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret), constant-time. */
export function verifyWhatsAppSignature(
  rawBody: string,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

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
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(whatsAppPayload(msg)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
    const json = (await res.json()) as { messages?: { id: string }[] };
    return { providerMessageId: json.messages?.[0]?.id ?? 'unknown' };
  }

  parseInbound(body: unknown) {
    return parseWhatsAppWebhook(body);
  }
}

const LIST_BUTTON: Record<Locale, string> = { en: 'Choose', ar: 'اختر' };

/** Cloud API body: template > interactive (≤3 reply buttons, else a list of ≤10 rows) > text. */
export function whatsAppPayload(msg: OutboundMessage): Record<string, unknown> {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: msg.to.replace(/^\+/, ''),
  };
  if (msg.template) {
    const def = TEMPLATES[msg.template.name];
    const vars = msg.template.vars ?? {};
    const params: readonly string[] = def.params;
    return {
      ...base,
      type: 'template',
      template: {
        name: msg.template.name,
        language: { code: msg.template.locale },
        components: params.length
          ? [
              {
                type: 'body',
                parameters: params.map((p) => ({ type: 'text', text: vars[p] || '-' })),
              },
            ]
          : [],
      },
    };
  }
  const options = msg.quickReplies ?? [];
  const body = { text: msg.text.slice(0, 1024) };
  if (options.length > 0 && options.length <= 3) {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body,
        action: {
          buttons: options.map((q) => ({
            type: 'reply',
            reply: { id: q.id, title: q.label.slice(0, 20) },
          })),
        },
      },
    };
  }
  if (options.length > 3) {
    const label = LIST_BUTTON[msg.locale ?? 'en'];
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list',
        body,
        action: {
          button: label,
          sections: [
            {
              title: label,
              rows: options
                .slice(0, 10)
                .map((q) => ({ id: q.id.slice(0, 200), title: q.label.slice(0, 24) })),
            },
          ],
        },
      },
    };
  }
  return { ...base, type: 'text', text: { body: msg.text.slice(0, 4096), preview_url: false } };
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
