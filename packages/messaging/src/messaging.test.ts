import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockChannel,
  WhatsAppChannel,
  createChannel,
  isOptIn,
  isOptOut,
  parseWhatsAppWebhook,
  renderTemplate,
} from './index';

describe('opt-out / opt-in', () => {
  it.each([
    'STOP',
    'stop',
    ' Stop. ',
    'stop!',
    'please stop',
    'Unsubscribe',
    'إيقاف',
    'ايقاف',
    'إلغاء',
    'الغاء الاشتراك',
    'توقف 🙏',
  ])('opt-out: %s', (t) => expect(isOptOut(t)).toBe(true));
  it.each([
    "don't stop",
    'stop sending me 3br options and show 2br',
    'cancel my viewing on friday',
    'hello',
  ])('not opt-out: %s', (t) => expect(isOptOut(t)).toBe(false));
  it.each(['START', 'start.', 'Subscribe', 'ابدأ', 'ابدا'])('opt-in: %s', (t) =>
    expect(isOptIn(t)).toBe(true),
  );
  it('does not treat a normal message as opt-in', () =>
    expect(isOptIn('start the process for a 2br')).toBe(false));
});

describe('renderTemplate', () => {
  it('fills placeholders per locale', () => {
    expect(renderTemplate('viewing_reminder', 'en', { time: '5pm' })).toBe(
      'Reminder: your viewing is at 5pm.',
    );
    expect(renderTemplate('follow_up_1', 'ar', { name: 'سارة' })).toContain('سارة');
  });
  it('never prints "undefined" for a missing variable', () => {
    const t = renderTemplate('follow_up_1', 'en', {});
    expect(t).not.toContain('undefined');
    expect(t.startsWith('Hi, still interested')).toBe(true);
  });
});

const waBody = (messages: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { messages } }] }],
});

describe('parseWhatsAppWebhook', () => {
  it('parses text messages', () => {
    const [m] = parseWhatsAppWebhook(
      waBody([
        {
          from: '971500000001',
          id: 'wamid.1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'hi' },
        },
      ]),
    );
    expect(m).toEqual({
      from: '971500000001',
      text: 'hi',
      quickReplyId: undefined,
      providerMessageId: 'wamid.1',
      receivedAt: '2023-11-14T22:13:20.000Z',
    });
  });
  it('keeps the quick-reply id of button and list replies', () => {
    const out = parseWhatsAppWebhook(
      waBody([
        {
          from: '1',
          id: 'a',
          timestamp: '1700000000',
          type: 'interactive',
          interactive: { button_reply: { id: 'unitType:2br', title: '2 Bedrooms' } },
        },
        {
          from: '1',
          id: 'b',
          timestamp: '1700000000',
          type: 'interactive',
          interactive: { list_reply: { id: 'budget:1000000-2500000', title: '1M – 2.5M' } },
        },
        {
          from: '1',
          id: 'c',
          timestamp: '1700000000',
          type: 'button',
          button: { text: 'Book a viewing', payload: 'action:book_viewing' },
        },
      ]),
    );
    expect(out.map((m) => [m.text, m.quickReplyId])).toEqual([
      ['2 Bedrooms', 'unitType:2br'],
      ['1M – 2.5M', 'budget:1000000-2500000'],
      ['Book a viewing', 'action:book_viewing'],
    ]);
  });
  it('skips statuses, media and malformed payloads without throwing', () => {
    expect(
      parseWhatsAppWebhook({
        object: 'x',
        entry: [{ changes: [{ value: { statuses: [{ id: 's' }] } }] }],
      }),
    ).toEqual([]);
    expect(
      parseWhatsAppWebhook(
        waBody([{ from: '1', id: 'img', timestamp: '1', type: 'image', image: {} }]),
      ),
    ).toEqual([]);
    expect(parseWhatsAppWebhook(waBody([{ text: { body: 'no sender' } }]))).toEqual([]);
    for (const junk of [
      null,
      undefined,
      42,
      'x',
      { entry: 'nope' },
      { entry: [null] },
      { entry: [{ changes: [null] }] },
    ]) {
      expect(parseWhatsAppWebhook(junk)).toEqual([]);
    }
  });
});

describe('MockChannel', () => {
  it('records outbound messages', async () => {
    const ch = new MockChannel();
    const r = await ch.send({ to: '+971500000001', text: 'hello' });
    expect(r.providerMessageId).toMatch(/^mock_/);
    expect(ch.outbox).toHaveLength(1);
  });
  it('parses the simple mock inbound shape, with optional quick reply id', () => {
    const ch = new MockChannel();
    expect(
      ch.parseInbound({ from: '+971', text: 'hi', quickReplyId: 'purpose:investor' })[0],
    ).toMatchObject({
      from: '+971',
      text: 'hi',
      quickReplyId: 'purpose:investor',
    });
    expect(ch.parseInbound({ from: 1, text: {} })).toEqual([]);
  });
});

describe('WhatsAppChannel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends quick replies as max 3 interactive buttons with 20-char titles', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const ch = new WhatsAppChannel({ token: 't', phoneNumberId: '123' });
    const r = await ch.send({
      to: '971500000001',
      text: 'Pick one',
      quickReplies: [
        { id: 'a', label: 'A label that is far too long for WhatsApp' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ],
    });
    expect(r.providerMessageId).toBe('wamid.X');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/123/messages');
    expect(init.headers.authorization).toBe('Bearer t');
    const body = JSON.parse(init.body);
    expect(body.interactive.action.buttons).toHaveLength(3);
    expect(body.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(
      new WhatsAppChannel({ token: 't', phoneNumberId: '1' }).send({ to: '1', text: 'x' }),
    ).rejects.toThrow(/401/);
  });
});

describe('createChannel', () => {
  it('defaults to the mock', () => expect(createChannel({}).name).toBe('mock'));
  it('requires credentials for WhatsApp', () => {
    expect(() => createChannel({ MESSAGING_CHANNEL: 'whatsapp' })).toThrow(
      /WhatsApp env vars missing/,
    );
    expect(
      createChannel({
        MESSAGING_CHANNEL: 'whatsapp',
        WHATSAPP_TOKEN: 't',
        WHATSAPP_PHONE_NUMBER_ID: '1',
      }).name,
    ).toBe('whatsapp');
  });
});
