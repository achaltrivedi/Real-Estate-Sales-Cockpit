import type { Locale, QualificationField } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { slotsFromQuickReply } from './engine';
import {
  extractBudget,
  extractPurpose,
  extractSlots,
  extractTimeline,
  extractUnitType,
} from './extract';
import { QUESTIONS } from './prompts';
import { normalize } from './text';

const n = normalize;

describe('normalize', () => {
  it('maps Arabic-Indic and Persian digits and separators to ASCII', () => {
    expect(n('٢٫٥ مليون')).toBe('2.5 مليون');
    expect(n('١٬٥٠٠٬٠٠٠')).toBe('1,500,000');
    expect(n('۳ غرف')).toBe('3 غرف');
  });
  it('folds alef/ya/ta-marbuta variants, strips tashkeel + tatweel, unifies dashes', () => {
    expect(n('أكثرُ  مـن')).toBe('اكثر من');
    expect(n('إلى')).toBe('الي');
    expect(n('غرفة')).toBe('غرفه');
    expect(n('1M – 2M')).toBe('1m - 2m');
  });
});

describe('extractBudget', () => {
  const cases: [string, number | undefined, number | undefined][] = [
    // single figures: [0.7x, x]
    ['budget 2.5 million', 1_750_000, 2_500_000],
    ['AED 900k', 630_000, 900_000],
    ['1,500,000', 1_050_000, 1_500_000],
    ['2,5 million', 1_750_000, 2_500_000],
    ['1.500.000 aed', 1_050_000, 1_500_000],
    ['2m', 1_400_000, 2_000_000],
    ['3 mil', 2_100_000, 3_000_000],
    ['half a million', 350_000, 500_000],
    ['two million', 1_400_000, 2_000_000],
    ['one and a half million', 1_050_000, 1_500_000],
    ['my budget is around 3', 2_700_000, 3_300_000], // bare small number + budget context → millions; "around" → ±10%
    // ranges
    ['1.5-2m', 1_500_000, 2_000_000],
    ['between 800k and 1.2m', 800_000, 1_200_000],
    ['1.2 million to 1.5', 1_200_000, 1_500_000],
    ['from 2 to 3 million', 2_000_000, 3_000_000],
    ['1M – 2.5M', 1_000_000, 2_500_000],
    ['2 or 3 million', 2_000_000, 3_000_000],
    ['800 - 1.2m', 800_000, 1_200_000],
    ['1,000,000 - 2,000,000 AED', 1_000_000, 2_000_000],
    // bounds
    ['up to 3 million', 0, 3_000_000],
    ['under 2m', 0, 2_000_000],
    ['5M+', 5_000_000, 20_000_000],
    ['more than 3 million', 3_000_000, 20_000_000],
    ['at least 30m', 30_000_000, 30_000_000],
    // currency
    ['$500k', Math.round(350_000 * 3.6725), Math.round(500_000 * 3.6725)],
    // Arabic
    ['٢٫٥ مليون', 1_750_000, 2_500_000],
    ['ميزانيتي ١٫٥ مليون درهم', 1_050_000, 1_500_000],
    ['مليون ونص', 1_050_000, 1_500_000],
    ['مليونين', 1_400_000, 2_000_000],
    ['3 ملايين', 2_100_000, 3_000_000],
    ['نص مليون', 350_000, 500_000],
    ['خمسمية ألف', 350_000, 500_000],
    ['ثلاثة ملايين', 2_100_000, 3_000_000],
    ['من مليون إلى مليونين', 1_000_000, 2_000_000],
    ['بين ١ و ٢ مليون', 1_000_000, 2_000_000],
    ['حتى ١ مليون', 0, 1_000_000],
    ['أقل من ٣ مليون', 0, 3_000_000],
    ['أكثر من ٥ مليون', 5_000_000, 20_000_000],
    ['٢ مليون وأكثر', 2_000_000, 20_000_000],
    // not money
    ['I want a 2br', undefined, undefined],
    ['3 bedrooms within 6 months', undefined, undefined],
    ['handover in 2027', undefined, undefined],
    ['call me on +971 50 123 4567', undefined, undefined],
    ['my number is 0501234567', undefined, undefined],
    ['budget for 2 br', undefined, undefined],
    ['the villa in 3 years', undefined, undefined],
    ['الفيلا ٣ غرف', undefined, undefined],
    ['2k', undefined, undefined],
  ];
  it.each(cases)('%s → %s – %s', (text, min, max) => {
    expect(extractBudget(n(text))).toEqual(
      min === undefined ? {} : { budgetMinAed: min, budgetMaxAed: max },
    );
  });

  it('ignores a phone number even when a budget is also given', () => {
    expect(extractBudget(n('budget 2m, call +971 50 123 4567'))).toEqual({
      budgetMinAed: 1_400_000,
      budgetMaxAed: 2_000_000,
    });
  });
  it('picks the largest single figure when several are given', () => {
    expect(extractBudget(n('900k for a studio or 1.4m for a 1br')).budgetMaxAed).toBe(1_400_000);
  });
});

describe('extractUnitType', () => {
  const cases: [string, string | undefined][] = [
    ['looking for a 2br', '2br'],
    ['2 bedroom apartment', '2br'],
    ['two-bedroom', '2br'],
    ['1 bed', '1br'],
    ['one bedroom please', '1br'],
    ['3bhk', '3br'],
    ['4 beds', '4br'],
    ['a studio', 'studio'],
    ['pent house with sea view', 'penthouse'],
    ['townhouse', 'townhouse'],
    ['2br or 3br', '2br'], // first mentioned wins
    ['studio or 1 bedroom', 'studio'],
    ['11 bedrooms', undefined],
    ['استوديو', 'studio'],
    ['شقة غرفة وصالة', '1br'],
    ['غرفة نوم واحدة', '1br'],
    ['غرفتين وصالة', '2br'],
    ['غرفتا نوم', '2br'],
    ['٣ غرف نوم', '3br'],
    ['ثلاث غرف', '3br'],
    ['٤ غرف', '4br'],
    ['بنتهاوس', 'penthouse'],
    ['تاون هاوس', 'townhouse'],
    ['hello', undefined],
  ];
  it.each(cases)('%s → %s', (text, type) => expect(extractUnitType(n(text))).toBe(type));
});

describe('extractPurpose', () => {
  const cases: [string, string | undefined][] = [
    ['for investment', 'investor'],
    ['good rental yield?', 'investor'],
    ['I want to rent it out on airbnb', 'investor'],
    ['to live in with my family', 'end_user'],
    ['for myself', 'end_user'],
    ['invest, not to live', 'investor'],
    ['delivery date?', undefined], // "live" inside "delivery" must not match
    ['استثمار', 'investor'],
    ['للاستثمار والعائد', 'investor'],
    ['للسكن', 'end_user'],
    ['سكن عائلي', 'end_user'],
    ['مساكن أزور كرست', undefined],
  ];
  it.each(cases)('%s → %s', (text, purpose) => expect(extractPurpose(n(text))).toBe(purpose));
});

describe('extractTimeline', () => {
  const cases: [string, string | undefined][] = [
    ['buying now', 'now'],
    ['asap', 'now'],
    ["I don't know yet", undefined], // "know" is not "now"
    ['not now, maybe next year', '6_12_months'],
    ['within 3 months', '0_3_months'],
    ['next month', '0_3_months'],
    ['in 12 months', '6_12_months'], // must not be read as "2 months"
    ['6 months', '3_6_months'],
    ['half a year', '3_6_months'],
    ['this year', '6_12_months'],
    ['just exploring', 'exploring'],
    ['no rush', 'exploring'],
    ['soon', '0_3_months'],
    ['الآن', 'now'],
    ['فوراً', 'now'],
    ['خلال ٣ أشهر', '0_3_months'],
    ['خلال 13 شهر', undefined], // "13" is not "3"
    ['بعد ٦ شهور', '3_6_months'],
    ['هذا العام', '6_12_months'],
    ['السنة الجاية', '6_12_months'],
    ['أتصفح فقط', 'exploring'],
    ['مو مستعجل', 'exploring'],
    ['مستعجل', 'now'],
    ['طعام', undefined], // contains "عام" but is not "year"
  ];
  it.each(cases)('%s → %s', (text, timeline) => expect(extractTimeline(n(text))).toBe(timeline));
});

describe('free text = quick reply', () => {
  // WhatsApp button replies can arrive as the label text: typing a label must fill the same slot as clicking it.
  const fields = Object.keys(QUESTIONS) as QualificationField[];
  const rows = fields.flatMap((f) =>
    (['en', 'ar'] as Locale[]).flatMap((locale) =>
      QUESTIONS[f].quickReplies[locale].map((q) => [locale, q.label, q.id] as const),
    ),
  );
  it.each(rows)('[%s] "%s" ≡ %s', (_locale, label, id) => {
    expect(extractSlots(label)).toMatchObject(slotsFromQuickReply(id)!);
  });
});

describe('slotsFromQuickReply', () => {
  it('accepts contract values', () => {
    expect(slotsFromQuickReply('unitType:2br')).toEqual({ unitType: '2br' });
    expect(slotsFromQuickReply('budget:2500000-1000000')).toEqual({
      budgetMinAed: 1_000_000,
      budgetMaxAed: 2_500_000,
    });
  });
  it('rejects values outside the contract so they never reach the API response', () => {
    for (const id of [
      'unitType:castle',
      'purpose:flip',
      'timeline:never',
      'budget:abc-1',
      'budget:-5-10',
      'budget:1.5-2',
      'nope',
      'budget:',
      undefined,
    ]) {
      expect(slotsFromQuickReply(id)).toBeNull();
    }
  });
});
