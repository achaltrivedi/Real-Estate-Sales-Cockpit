import type { Locale, Purpose, Timeline, UnitType } from '@gsc/contracts';
import { extractSlots } from './extract';
import { OpenAiLlm } from './openai';

/** Slots the qualifier tries to fill. */
export interface Slots {
  budgetMinAed?: number;
  budgetMaxAed?: number;
  timeline?: Timeline;
  unitType?: UnitType;
  purpose?: Purpose;
}

/**
 * LLM behind an interface (structured output). The mock is deterministic so the
 * demo runs offline; a real provider (e.g. Anthropic) implements the same shape.
 */
export interface LlmProvider {
  readonly name: string;
  extractSlots(input: { text: string; locale: Locale }): Promise<Slots>;
}

/** Offline, rule-based stand-in for the LLM (en + ar). The rules live in `extract.ts`. */
export class MockLlm implements LlmProvider {
  readonly name = 'mock';

  async extractSlots({ text }: { text: string; locale: Locale }): Promise<Slots> {
    return extractSlots(text);
  }
}

/**
 * Picks the LLM from env. Mock is the default (offline demo, zero cost).
 * LLM_PROVIDER=openai needs LLM_API_KEY; LLM_MODEL defaults to gpt-4o-mini.
 */
export function createLlm(
  env: Record<string, string | undefined>,
  opts: { onError?: (err: unknown) => void } = {},
): LlmProvider {
  const provider = env.LLM_PROVIDER?.trim() || 'mock';
  if (provider === 'mock') return new MockLlm();
  if (provider === 'openai') {
    if (!env.LLM_API_KEY?.trim()) throw new Error('LLM_PROVIDER=openai needs LLM_API_KEY');
    return new OpenAiLlm({
      apiKey: env.LLM_API_KEY.trim(),
      model: env.LLM_MODEL?.trim() || undefined,
      onError: opts.onError,
    });
  }
  throw new Error(`Unknown LLM_PROVIDER "${provider}" (use mock | openai)`);
}
