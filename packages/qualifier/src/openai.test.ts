import { describe, expect, it, vi } from 'vitest';
import { createLlm, MockLlm } from './llm';
import { OpenAiLlm } from './openai';

const completion = (content: unknown, init: ResponseInit = { status: 200 }) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: typeof content === 'string' ? content : JSON.stringify(content) } },
      ],
    }),
    init,
  );

const allNull = {
  budgetMinAed: null,
  budgetMaxAed: null,
  timeline: null,
  unitType: null,
  purpose: null,
};

describe('OpenAiLlm', () => {
  it('sends a strict JSON-schema request and maps the structured output', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        completion({
          ...allNull,
          budgetMinAed: 1_500_000,
          budgetMaxAed: 2_000_000,
          timeline: '0_3_months',
          unitType: '2br',
          purpose: 'investor',
        }),
      );
    const llm = new OpenAiLlm({ apiKey: 'sk-test', fetchImpl });
    const slots = await llm.extractSlots({
      text: 'شقة غرفتين للاستثمار بين مليون ونص ومليونين خلال ٣ أشهر',
      locale: 'ar',
    });
    expect(slots).toEqual({
      budgetMinAed: 1_500_000,
      budgetMaxAed: 2_000_000,
      timeline: '0_3_months',
      unitType: '2br',
      purpose: 'investor',
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toHaveLength(5);
    expect(body.messages[1].content).toContain('Buyer locale: ar');
  });

  it('lets the rules fill slots the model left null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion({ ...allNull, unitType: '3br' }));
    const slots = await new OpenAiLlm({ apiKey: 'k', fetchImpl }).extractSlots({
      text: '3 bedrooms, budget 4m',
      locale: 'en',
    });
    expect(slots).toMatchObject({ unitType: '3br', budgetMaxAed: 4_000_000 });
  });

  it('derives a min when the model gives only a max, and orders min <= max', async () => {
    const one = vi.fn().mockResolvedValue(completion({ ...allNull, budgetMaxAed: 1_000_000 }));
    expect(
      await new OpenAiLlm({ apiKey: 'k', fetchImpl: one }).extractSlots({
        text: 'x',
        locale: 'en',
      }),
    ).toMatchObject({
      budgetMinAed: 700_000,
      budgetMaxAed: 1_000_000,
    });
    const swapped = vi
      .fn()
      .mockResolvedValue(
        completion({ ...allNull, budgetMinAed: 3_000_000, budgetMaxAed: 2_000_000 }),
      );
    expect(
      await new OpenAiLlm({ apiKey: 'k', fetchImpl: swapped }).extractSlots({
        text: 'x',
        locale: 'en',
      }),
    ).toMatchObject({
      budgetMinAed: 2_000_000,
      budgetMaxAed: 3_000_000,
    });
  });

  it.each([
    ['HTTP 429', () => Promise.resolve(new Response('{}', { status: 429 }))],
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['invalid JSON content', () => Promise.resolve(completion('not json'))],
    [
      'out-of-contract value',
      () => Promise.resolve(completion({ ...allNull, unitType: 'castle' })),
    ],
    [
      'refusal',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: null, refusal: 'no' } }] }),
          ),
        ),
    ],
  ])('falls back to the rules on %s and reports the error', async (_name, impl) => {
    const onError = vi.fn();
    const llm = new OpenAiLlm({
      apiKey: 'sk-secret',
      fetchImpl: vi.fn().mockImplementation(impl),
      onError,
    });
    const slots = await llm.extractSlots({
      text: 'looking for a 2br to invest, 2.5 million, buying now',
      locale: 'en',
    });
    expect(slots).toMatchObject({
      unitType: '2br',
      purpose: 'investor',
      budgetMaxAed: 2_500_000,
      timeline: 'now',
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).not.toContain('sk-secret');
  });

  it('caps the text sent to the model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(completion(allNull));
    await new OpenAiLlm({ apiKey: 'k', fetchImpl }).extractSlots({
      text: 'a'.repeat(5000),
      locale: 'en',
    });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).messages[1].content.length).toBeLessThan(
      1100,
    );
  });
});

describe('createLlm', () => {
  it('defaults to the offline mock', async () => {
    expect(createLlm({})).toBeInstanceOf(MockLlm);
    expect(createLlm({ LLM_PROVIDER: '' }).name).toBe('mock');
  });
  it('builds OpenAI only with a key', async () => {
    expect(() => createLlm({ LLM_PROVIDER: 'openai' })).toThrow(/LLM_API_KEY/);
    expect(createLlm({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-x' }).name).toBe('openai');
  });
  it('rejects unknown providers', async () => {
    expect(() => createLlm({ LLM_PROVIDER: 'anthropic' })).toThrow(/Unknown LLM_PROVIDER/);
  });
});
