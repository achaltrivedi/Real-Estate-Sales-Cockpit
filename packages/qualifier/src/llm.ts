import type { Locale, Purpose, Timeline, UnitType } from '@gsc/contracts';
import { extractSlots } from './extract';

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
