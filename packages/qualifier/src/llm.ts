import type { Locale, Purpose, Timeline, UnitType } from '@gsc/contracts';

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

const UNIT_PATTERNS: [RegExp, UnitType][] = [
  [/penthouse|بنتهاوس/i, 'penthouse'],
  [/studio|استوديو/i, 'studio'],
  [/\b1\s?(br|bed)|one bed|غرفة واحدة/i, '1br'],
  [/\b2\s?(br|bed)|two bed|غرفتين/i, '2br'],
  [/\b3\s?(br|bed)|three bed|ثلاث غرف/i, '3br'],
  [/townhouse|تاون هاوس/i, 'townhouse'],
];

/** Offline, rule-based stand-in for the LLM. */
export class MockLlm implements LlmProvider {
  readonly name = 'mock';

  async extractSlots({ text }: { text: string; locale: Locale }): Promise<Slots> {
    const t = text.toLowerCase();
    const out: Slots = {};

    for (const [re, type] of UNIT_PATTERNS) if (re.test(t)) out.unitType = type;

    if (/invest|rental|yield|roi|استثمار/.test(t)) out.purpose = 'investor';
    else if (/live|family|move in|my home|للسكن|عائلة/.test(t)) out.purpose = 'end_user';

    if (/now|asap|immediately|this month|الآن|فورا/.test(t)) out.timeline = 'now';
    else if (/(1|2|3|three|few) months|quarter|خلال ٣ أشهر/.test(t)) out.timeline = '0_3_months';
    else if (/6 months|half a year|ستة أشهر/.test(t)) out.timeline = '3_6_months';
    else if (/year|12 months|سنة/.test(t)) out.timeline = '6_12_months';
    else if (/just looking|exploring|browsing|أتصفح/.test(t)) out.timeline = 'exploring';

    // "2m", "2.5 million", "1,500,000", "AED 900k"
    // Scan every number and keep the largest plausible amount (so "2br" is not read as a budget).
    let best = 0;
    for (const m of t.matchAll(/(\d+(?:[.,]\d+)*)\s*(million|mn|m\b|thousand|k\b|مليون|ألف)?/g)) {
      const raw = m[1]!;
      let n = parseFloat(/,\d{3}/.test(raw) ? raw.replace(/,/g, '') : raw.replace(',', '.'));
      const unit = m[2] ?? '';
      if (/^(m|mn|million|مليون)$/.test(unit)) n *= 1_000_000;
      else if (/^(k|thousand|ألف)$/.test(unit)) n *= 1_000;
      if (n > best) best = n;
    }
    if (best >= 200_000) {
      out.budgetMaxAed = Math.round(best);
      out.budgetMinAed = Math.round(best * 0.7);
    }
    return out;
  }
}
