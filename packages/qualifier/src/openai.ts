import { Purpose, Timeline, UnitType, type Locale } from '@gsc/contracts';
import { z } from 'zod';
import { extractSlots } from './extract';
import type { LlmProvider, Slots } from './llm';
import { SLOT_EXTRACTION_SYSTEM_PROMPT } from './prompts';

/** What the model must return (OpenAI structured outputs, strict mode: every key present, null = unknown). */
const ModelSlots = z.object({
  budgetMinAed: z.number().int().nonnegative().nullable(),
  budgetMaxAed: z.number().int().nonnegative().nullable(),
  timeline: Timeline.nullable(),
  unitType: UnitType.nullable(),
  purpose: Purpose.nullable(),
});

const nullableEnum = (values: readonly string[]) => ({
  type: ['string', 'null'],
  enum: [...values, null],
});
const JSON_SCHEMA = {
  name: 'buyer_slots',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['budgetMinAed', 'budgetMaxAed', 'timeline', 'unitType', 'purpose'],
    properties: {
      budgetMinAed: {
        type: ['integer', 'null'],
        description: 'Lower budget bound in AED (integer), or null',
      },
      budgetMaxAed: {
        type: ['integer', 'null'],
        description: 'Upper budget bound in AED (integer), or null',
      },
      timeline: nullableEnum(Timeline.options),
      unitType: nullableEnum(UnitType.options),
      purpose: nullableEnum(Purpose.options),
    },
  },
} as const;

export interface OpenAiLlmOptions {
  apiKey: string;
  /** Cheap + fast is right for slot extraction. */
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Called when the API fails and the rule-based fallback is used (never with the API key). */
  onError?: (err: unknown) => void;
}

/** Longest buyer message sent to the model: bounds cost per turn. */
const MAX_INPUT_CHARS = 1000;

/**
 * OpenAI behind `LlmProvider`. Structured output is validated with Zod; any failure (network, timeout,
 * refusal, bad JSON, out-of-contract value) falls back to the deterministic rules, so a buyer never
 * waits on, or gets stuck because of, the LLM. Slots the model leaves null are filled by the rules.
 */
export class OpenAiLlm implements LlmProvider {
  readonly name = 'openai';
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAiLlmOptions) {
    if (!opts.apiKey) throw new Error('OpenAiLlm needs an API key');
    this.model = opts.model ?? 'gpt-4o-mini';
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async extractSlots(input: { text: string; locale: Locale }): Promise<Slots> {
    const rules = extractSlots(input.text);
    try {
      const fromModel = await this.callModel(input.text.slice(0, MAX_INPUT_CHARS), input.locale);
      return { ...rules, ...fromModel };
    } catch (err) {
      this.opts.onError?.(err);
      return rules;
    }
  }

  private async callModel(text: string, locale: Locale): Promise<Slots> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
        messages: [
          { role: 'system', content: SLOT_EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: `Buyer locale: ${locale}\nBuyer message:\n${text}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    };
    const msg = json.choices?.[0]?.message;
    if (!msg?.content)
      throw new Error(msg?.refusal ? 'OpenAI refused' : 'OpenAI returned no content');
    const parsed = ModelSlots.parse(JSON.parse(msg.content));

    const out: Slots = {};
    if (parsed.budgetMaxAed !== null) {
      const max = parsed.budgetMaxAed;
      const min = parsed.budgetMinAed ?? Math.round(max * 0.7);
      out.budgetMinAed = Math.min(min, max);
      out.budgetMaxAed = Math.max(min, max);
    }
    if (parsed.timeline) out.timeline = parsed.timeline;
    if (parsed.unitType) out.unitType = parsed.unitType;
    if (parsed.purpose) out.purpose = parsed.purpose;
    return out;
  }
}
