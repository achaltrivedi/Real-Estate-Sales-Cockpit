import type { Purpose, Timeline, UnitType } from '@gsc/contracts';
import { arabicFold, normalize, rx } from './text';

/**
 * Deterministic, rule-based slot extraction (en + ar, Gulf dialect basics).
 * Powers `MockLlm` (offline demo) and is the fallback when a real LLM is down.
 * Every function takes text already passed through `normalize()`.
 */

const r = String.raw;

// ---------------------------------------------------------------- unit type
const BED = r`(?:br|b\/r|bed|beds|bedroom|bedrooms|bhk|bdr|bdrm)`;
const bedrooms = (words: string) => rx(r`\b(?:${words})[\s-]?${BED}\b`);

const UNIT_RULES: [RegExp, UnitType][] = [
  [rx(r`pent ?house|بنتهاوس|بنت هاوس`), 'penthouse'],
  [rx(r`town ?house|تاون ?هاوس`), 'townhouse'],
  [rx(r`\bstudio\b|استوديو|ستوديو|استديو`), 'studio'],
  [bedrooms('1|one|single'), '1br'],
  [bedrooms('2|two'), '2br'],
  [bedrooms('3|three'), '3br'],
  [bedrooms('4|four'), '4br'],
  [rx(r`(?<!\d)4 ?غرف|أربع(?:ة)? غرف`), '4br'],
  [rx(r`(?<!\d)3 ?غرف|ثلاث(?:ة)? غرف`), '3br'],
  [rx(r`(?<!\d)2 ?غرف|غرفتين|غرفتي نوم|غرفتا نوم`), '2br'],
  [rx(r`(?<!\d)1 ?غرف|غرفة (?:و ?صالة|نوم|واحدة)`), '1br'],
];

/** The unit type mentioned first wins ("2br or 3br" → 2br). */
export function extractUnitType(t: string): UnitType | undefined {
  let best: { at: number; type: UnitType } | undefined;
  for (const [re, type] of UNIT_RULES) {
    const at = t.search(re);
    if (at >= 0 && (!best || at < best.at)) best = { at, type };
  }
  return best?.type;
}

// ---------------------------------------------------------------- purpose
const INVEST_STRONG = rx(
  r`\binvest|\byields?\b|\broi\b|rental (?:income|yield|return)|rent (?:it )?out|\bairbnb\b|holiday home|capital (?:gain|appreciation)|استثمار|عائد|تأجير`,
);
const END_USER = rx(
  r`\b(?:live|living|move in|moving in|my home|our home|family|for myself|own use|end[ -]?user|primary residence|reside|settle)\b|(?<!\p{L})(?:لل|ل|ال|و)?سكن(?!\p{L})|أسكن|نسكن|عائلة|عائلتي|لنفسي|منزل`,
);
const INVEST_WEAK = rx(r`\brental\b|\brent\b|إيجار`);

export function extractPurpose(t: string): Purpose | undefined {
  if (INVEST_STRONG.test(t)) return 'investor';
  if (END_USER.test(t)) return 'end_user';
  if (INVEST_WEAK.test(t)) return 'investor';
  return undefined;
}

// ---------------------------------------------------------------- timeline
const MONTHS_AR = r`(?:أشهر|شهور|شهر)`;
/** First matching rule wins: negations ("no rush") before urgency, explicit durations before vague words. */
const TIMELINE_RULES: [RegExp, Timeline][] = [
  [
    rx(
      r`just (?:looking|browsing)|\bexplor(?:e|ing)\b|\bbrowsing\b|no rush|no hurry|not in a (?:rush|hurry)|\bsomeday\b|أتصفح|استكشف|مجرد (?:اطلاع|استفسار)|(?:مو|مش|غير|لست) مستعجل`,
    ),
    'exploring',
  ],
  [
    rx(
      r`\b(?:7|8|9|10|11|12|seven|eight|nine|ten|eleven|twelve) months?\b|(?<!\d)(?:7|8|9|10|11|12) ?${MONTHS_AR}`,
    ),
    '6_12_months',
  ],
  [
    rx(
      r`\b(?:4|5|6|four|five|six) months?\b|half (?:a )?year|(?<!\d)(?:4|5|6) ?${MONTHS_AR}|ستة ${MONTHS_AR}|نصف? سنة`,
    ),
    '3_6_months',
  ],
  [
    rx(
      r`\b(?:1|2|3|one|two|three|a few|few|a couple of|couple of) months?\b|\bnext month\b|\b(?:this|next) quarter\b|\bwithin (?:a|one) month\b|(?<!\d)(?:1|2|3) ?${MONTHS_AR}|شهرين|ثلاث(?:ة)? ${MONTHS_AR}|الشهر (?:القادم|الجاي|المقبل)|خلال شهر`,
    ),
    '0_3_months',
  ],
  [
    rx(
      r`(?<!\bnot (?:right )?)\bnow\b|\basap\b|\bimmediately\b|\bright away\b|\bthis (?:month|week)\b|\bready to (?:buy|book|pay)\b|\burgent(?:ly)?\b|\btoday\b|الآن|الحين|فورا|حالا|هذا الشهر|مستعجل|بأسرع وقت|اليوم`,
    ),
    'now',
  ],
  [
    rx(
      r`\byears?\b|هذا العام|هذه السنة|هذي السنة|السنة (?:القادمة|الجاية|المقبلة)|العام (?:القادم|المقبل)|نهاية السنة|(?<!\p{L})(?:ال|خلال )?(?:سنة|عام)(?!\p{L})`,
    ),
    '6_12_months',
  ],
  [rx(r`\bsoon\b|قريبا`), '0_3_months'],
];

export function extractTimeline(t: string): Timeline | undefined {
  return TIMELINE_RULES.find(([re]) => re.test(t))?.[1];
}

// ---------------------------------------------------------------- budget
export const AED_PER_USD = 3.6725;
/** Plausible property budget window (AED). Filters out bedroom counts, years, phone numbers. */
export const MIN_BUDGET_AED = 200_000;
export const MAX_BUDGET_AED = 200_000_000;
/** Upper bound recorded for open-ended budgets ("5M+", "more than 3 million"), matching the "5M+" quick reply. */
export const OPEN_BUDGET_CEILING_AED = 20_000_000;

const EN_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};
const AR_NUMBERS: [string, number][] = [
  ['واحد', 1],
  ['اثنين', 2],
  ['اثنان', 2],
  ['ثلاثة', 3],
  ['ثلاث', 3],
  ['أربعة', 4],
  ['أربع', 4],
  ['خمسة', 5],
  ['خمس', 5],
  ['ستة', 6],
  ['ست', 6],
  ['سبعة', 7],
  ['سبع', 7],
  ['ثمانية', 8],
  ['ثمان', 8],
  ['تسعة', 9],
  ['تسع', 9],
  ['عشرة', 10],
  ['عشر', 10],
];
const AR_HUNDREDS: [string, number][] = [
  ['ثلاث', 3],
  ['أربع', 4],
  ['خمس', 5],
  ['ست', 6],
  ['سبع', 7],
  ['ثمان', 8],
  ['تسع', 9],
];
const AR_SCALE = r`(?:مليون|ملايين|ألف|آلاف)`;

/** Rewrites number words into digits so a single amount regex can do the rest. */
function digitizeWords(t: string): string {
  let s = t;
  // English
  s = s.replace(rx(r`\b(${Object.keys(EN_NUMBERS).join('|')})\b`, 'g'), (_, w: string) =>
    String(EN_NUMBERS[w]),
  );
  s = s.replace(
    rx(r`(\d+(?:\.\d+)?) and a half (million|mil|mn|m)\b`, 'g'),
    (_, n: string, u: string) => `${Number(n) + 0.5} ${u}`,
  );
  s = s.replace(rx(r`\bhalf (?:a )?(?:million|mil|mn|m)\b`, 'g'), '0.5 million');
  s = s.replace(rx(r`\b(?:a )?quarter (?:of a )?million\b`, 'g'), '0.25 million');
  s = s.replace(rx(r`\ba million\b`, 'g'), '1 million');
  s = s.replace(
    rx(r`(\d+) hundred(?: and)? (thousand|k)\b`, 'g'),
    (_, n: string) => `${Number(n) * 100} thousand`,
  );
  // Arabic
  s = s.replace(rx(r`مليونين`, 'g'), '2 مليون');
  s = s.replace(rx(r`(?:ميتين|مائتين|مئتين|مائتي|مئتي) ألف`, 'g'), '200 ألف');
  for (const [w, n] of AR_HUNDREDS)
    s = s.replace(rx(`${w}(?:مية|مئة|مائة|ميه)`, 'g'), String(n * 100));
  s = s.replace(rx(r`(?<![\d\p{L}])(?:مية|مئة|مائة|ميه) ألف`, 'g'), '100 ألف');
  for (const [w, n] of AR_NUMBERS)
    s = s.replace(rx(`(?<!\\p{L})${w} (?=${AR_SCALE})`, 'g'), `${n} `);
  s = s.replace(
    rx(r`(\d+(?:\.\d+)?)? ?مليون و ?نص(?:ف)?`, 'g'),
    (_, n?: string) => `${Number(n ?? 1) + 0.5} مليون`,
  );
  s = s.replace(rx(r`(?<!\p{L})نص(?:ف)? مليون`, 'g'), '0.5 مليون');
  s = s.replace(rx(r`(?<!\p{L})ربع مليون`, 'g'), '0.25 مليون');
  s = s.replace(rx(r`ملايين`, 'g'), 'مليون');
  s = s.replace(rx(r`آلاف`, 'g'), 'ألف');
  s = s.replace(rx(r`(?<![\d.]\s?)مليون`, 'g'), '1 مليون'); // bare "مليون" = one million
  return s;
}

/** Keys are folded like the input ("ألف" is matched as "الف"). */
const SCALES: Record<string, number> = Object.fromEntries(
  Object.entries({
    million: 1e6,
    millions: 1e6,
    mil: 1e6,
    mln: 1e6,
    mio: 1e6,
    mn: 1e6,
    m: 1e6,
    مليون: 1e6,
    thousand: 1e3,
    k: 1e3,
    ألف: 1e3,
  }).map(([k, v]) => [arabicFold(k), v]),
);
const AMOUNT = rx(
  r`(\+)?(\d+(?:[.,]\d+)*)\s?(million|millions|mil|mln|mio|mn|m|thousand|k|مليون|ألف)?(?=$|aed|dhs|درهم|[^\p{L}\d.,]|[.,](?!\d))`,
  'gi',
);
/** A number followed by these words is not money ("2 bedrooms", "6 months", "floor 12"...). */
const NOT_MONEY_AFTER = rx(
  r`^\s?(?:br|b\/r|bed|bhk|bdr|room|month|mo\b|year|yr|week|day|floor|stor|sq|ft|m2|sqm|%|percent|people|kids|children|غرف|غرفة|شهر|أشهر|شهور|سنة|سنوات|سنين|طابق|متر|يوم|أسبوع|أطفال)`,
);
const BUDGET_CONTEXT = rx(r`budget|afford|spend|price range|ميزانية|ميزانيتي|بحدود|سعر`);
const RANGE_GAP = rx(
  r`^\s?(?:-|to|and|or|till|until|up to|إلى|الى|ل|و|أو|حتى)\s?(?:aed|dhs|درهم)?\s?$`,
);
const UPPER_BEFORE = rx(
  r`(?:up ?to|under|below|max(?:imum)?|less than|not more than|no more than|within|not exceeding|حتى|أقل من|لا يتجاوز|لا يزيد عن|بحد أقصى|أقصى)\s?(?:aed|dhs|usd|\$|درهم)?\s?$`,
);
const LOWER_BEFORE = rx(
  r`(?:above|over|more than|at least|min(?:imum)?|starting (?:from|at)|from|أكثر من|فوق|على الأقل|لا يقل عن)\s?(?:aed|dhs|usd|\$|درهم)?\s?$`,
);
const LOWER_AFTER = rx(
  r`^\s?(?:\+|and above|or more|plus|or above|\+? ?(?:و ?أكثر|فما فوق|أو أكثر))`,
);
const APPROX_BEFORE = rx(
  r`(?:around|about|approx(?:imately)?|roughly|~|حوالي|تقريبا|بحدود|في حدود)\s?(?:aed|dhs|usd|\$|درهم)?\s?$`,
);
const USD = rx(r`\$|\busd\b|\bdollars?\b|دولار`);

interface Amount {
  raw: number;
  scale: number | undefined;
  start: number;
  end: number;
}

function parseNumber(raw: string): number {
  if (/,\d{3}(?!\d)/.test(raw)) return parseFloat(raw.replace(/,/g, '')); // 1,500,000
  if ((raw.match(/\./g) ?? []).length > 1) return parseFloat(raw.replace(/\./g, '')); // 1.500.000
  return parseFloat(raw.replace(',', '.')); // 2,5 → 2.5
}

const plausible = (v: number) => v >= MIN_BUDGET_AED && v <= MAX_BUDGET_AED;

export interface Budget {
  budgetMinAed?: number;
  budgetMaxAed?: number;
}

/**
 * Budget in AED from free text: "2.5m", "1,500,000", "AED 900k", "1.5-2m", "between 800k and 1.2m",
 * "up to 3 million", "5M+", "$500k", "١٫٥ مليون", "مليون ونص", "من مليون إلى مليونين", "أكثر من ٥ مليون".
 */
export function extractBudget(t: string): Budget {
  const s = digitizeWords(t);
  const fx = USD.test(s) ? AED_PER_USD : 1;
  const bareMeansMillions = BUDGET_CONTEXT.test(s);

  const amounts: Amount[] = [];
  for (const m of s.matchAll(AMOUNT)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (m[1] || /\+[\d\s-]*$/.test(s.slice(0, start))) continue; // "+971 50 123 4567": phone, not money
    if (/^0\d/.test(m[2]!)) continue; // "050…": phone / ids, not money
    if (!m[3] && NOT_MONEY_AFTER.test(s.slice(end))) continue;
    amounts.push({ raw: parseNumber(m[2]!), scale: m[3] ? SCALES[m[3]] : undefined, start, end });
  }
  const value = (a: Amount, scale = a.scale) =>
    Math.round(a.raw * (scale ?? (bareMeansMillions && a.raw <= 50 ? 1e6 : 1)) * fx);

  // 1) Explicit ranges: two amounts joined by "-", "to", "and", "إلى", "و"…; a missing unit is borrowed from the other side.
  for (let i = 0; i + 1 < amounts.length; i++) {
    const a = amounts[i]!;
    const b = amounts[i + 1]!;
    if (!RANGE_GAP.test(s.slice(a.end, b.start))) continue;
    let lo = value(a);
    let hi = value(b);
    if (a.scale === undefined && b.scale !== undefined) {
      lo =
        [value(a, b.scale), value(a, 1e3), value(a, 1)].find((v) => plausible(v) && v <= hi) ?? lo;
    } else if (b.scale === undefined && a.scale !== undefined) {
      hi =
        [value(b, a.scale), value(b, 1e3), value(b, 1)].find((v) => plausible(v) && v >= lo) ?? hi;
    }
    if (lo > hi) [lo, hi] = [hi, lo];
    if (plausible(hi) && (plausible(lo) || lo === 0)) return { budgetMinAed: lo, budgetMaxAed: hi };
  }

  // 2) Single amount: keep the largest plausible one, interpreting "up to" / "5M+" / "around".
  const singles = amounts.map((a) => ({ a, v: value(a) })).filter((x) => plausible(x.v));
  if (!singles.length) return {};
  const { a, v } = singles.reduce((best, x) => (x.v > best.v ? x : best));
  const before = s.slice(Math.max(0, a.start - 24), a.start);
  const after = s.slice(a.end, a.end + 16);
  if (UPPER_BEFORE.test(before)) return { budgetMinAed: 0, budgetMaxAed: v };
  if (LOWER_BEFORE.test(before) || LOWER_AFTER.test(after))
    return { budgetMinAed: v, budgetMaxAed: Math.max(v, OPEN_BUDGET_CEILING_AED) };
  if (APPROX_BEFORE.test(before))
    return { budgetMinAed: Math.round(v * 0.9), budgetMaxAed: Math.round(v * 1.1) };
  return { budgetMinAed: Math.round(v * 0.7), budgetMaxAed: v };
}

// ---------------------------------------------------------------- all slots
export interface ExtractedSlots extends Budget {
  timeline?: Timeline;
  unitType?: UnitType;
  purpose?: Purpose;
}

/** Normalises once, then runs every extractor. Missing slots are simply absent. */
export function extractSlots(text: string): ExtractedSlots {
  const t = normalize(text);
  const out: ExtractedSlots = { ...extractBudget(t) };
  const unitType = extractUnitType(t);
  const purpose = extractPurpose(t);
  const timeline = extractTimeline(t);
  if (unitType) out.unitType = unitType;
  if (purpose) out.purpose = purpose;
  if (timeline) out.timeline = timeline;
  return out;
}
