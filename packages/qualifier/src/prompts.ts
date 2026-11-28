import type { Locale, QualificationField, QuickReply } from '@gsc/contracts';

interface Prompt {
  text: Record<Locale, string>;
  quickReplies: Record<Locale, QuickReply[]>;
}

/**
 * Question per missing slot. Quick-reply ids encode the slot value
 * (`<slot>:<value>`) so the engine can fill slots without the LLM.
 */
export const QUESTIONS: Record<QualificationField, Prompt> = {
  purpose: {
    text: { en: 'Is this for investment or to live in?', ar: 'هل الشراء بغرض الاستثمار أم للسكن؟' },
    quickReplies: {
      en: [
        { id: 'purpose:investor', label: 'Investment' },
        { id: 'purpose:end_user', label: 'To live in' },
      ],
      ar: [
        { id: 'purpose:investor', label: 'استثمار' },
        { id: 'purpose:end_user', label: 'للسكن' },
      ],
    },
  },
  unitType: {
    text: { en: 'Which unit type are you interested in?', ar: 'ما نوع الوحدة التي تهمك؟' },
    quickReplies: {
      en: [
        { id: 'unitType:studio', label: 'Studio' },
        { id: 'unitType:1br', label: '1 Bedroom' },
        { id: 'unitType:2br', label: '2 Bedrooms' },
        { id: 'unitType:3br', label: '3 Bedrooms' },
        { id: 'unitType:penthouse', label: 'Penthouse' },
      ],
      ar: [
        { id: 'unitType:studio', label: 'استوديو' },
        { id: 'unitType:1br', label: 'غرفة نوم' },
        { id: 'unitType:2br', label: 'غرفتا نوم' },
        { id: 'unitType:3br', label: '٣ غرف نوم' },
        { id: 'unitType:penthouse', label: 'بنتهاوس' },
      ],
    },
  },
  budget: {
    text: {
      en: 'What budget range do you have in mind (AED)?',
      ar: 'ما هي ميزانيتك التقريبية (درهم)؟',
    },
    quickReplies: {
      en: [
        { id: 'budget:0-1000000', label: 'Up to 1M' },
        { id: 'budget:1000000-2500000', label: '1M – 2.5M' },
        { id: 'budget:2500000-5000000', label: '2.5M – 5M' },
        { id: 'budget:5000000-20000000', label: '5M+' },
      ],
      ar: [
        { id: 'budget:0-1000000', label: 'حتى ١ مليون' },
        { id: 'budget:1000000-2500000', label: '١ – ٢.٥ مليون' },
        { id: 'budget:2500000-5000000', label: '٢.٥ – ٥ مليون' },
        { id: 'budget:5000000-20000000', label: 'أكثر من ٥ مليون' },
      ],
    },
  },
  timeline: {
    text: { en: 'When are you planning to buy?', ar: 'متى تخطط للشراء؟' },
    quickReplies: {
      en: [
        { id: 'timeline:now', label: 'Right now' },
        { id: 'timeline:0_3_months', label: 'Within 3 months' },
        { id: 'timeline:6_12_months', label: 'This year' },
        { id: 'timeline:exploring', label: 'Just exploring' },
      ],
      ar: [
        { id: 'timeline:now', label: 'الآن' },
        { id: 'timeline:0_3_months', label: 'خلال ٣ أشهر' },
        { id: 'timeline:6_12_months', label: 'هذا العام' },
        { id: 'timeline:exploring', label: 'أتصفح فقط' },
      ],
    },
  },
};

export const COPY = {
  greeting: {
    en: 'Hi! 👋 Thanks for your interest in Azure Crest Residences (sample project). A couple of quick questions so we can help.',
    ar: 'مرحباً! 👋 شكراً لاهتمامك بمساكن أزور كرست (مشروع تجريبي). بعض الأسئلة السريعة لمساعدتك.',
  },
  qualified: {
    en: 'Great, you are a strong match. Would you like to book a viewing with one of our advisors?',
    ar: 'رائع، لديك تطابق ممتاز. هل تود حجز معاينة مع أحد مستشارينا؟',
  },
  handoff: {
    en: 'Connecting you with a human advisor now. They will reply here shortly.',
    ar: 'نقوم الآن بتحويلك إلى مستشار. سيرد عليك هنا قريباً.',
  },
  viewingRequested: {
    en: 'Great! An advisor will message you here shortly to confirm a viewing time.',
    ar: 'رائع! سيتواصل معك أحد مستشارينا هنا قريباً لتأكيد موعد المعاينة.',
  },
  didntCatch: {
    en: 'Sorry, I did not catch that.',
    ar: 'عذراً، لم أفهم ذلك.',
  },
  optedOut: {
    en: 'You have been unsubscribed. Reply START to resume.',
    ar: 'تم إلغاء اشتراكك. أرسل START للاستئناف.',
  },
} satisfies Record<string, Record<Locale, string>>;

export const BOOK_VIEWING_REPLIES: Record<Locale, QuickReply[]> = {
  en: [
    { id: 'action:book_viewing', label: 'Book a viewing' },
    { id: 'action:handoff', label: 'Talk to a human' },
  ],
  ar: [
    { id: 'action:book_viewing', label: 'احجز معاينة' },
    { id: 'action:handoff', label: 'تحدث مع مستشار' },
  ],
};

/** System prompt for LLM slot extraction (OpenAiLlm). Output shape is enforced by a JSON schema. */
export const SLOT_EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from a property buyer's chat message for a real-estate sales assistant in Dubai.
The message may be English, Arabic (any dialect, Arabic-Indic digits) or a mix.
Return ONLY what the buyer actually states; use null for anything not stated. Never guess.
- budgetMinAed / budgetMaxAed: integer AED. Convert words and units ("2.5m", "مليون ونص", "900k"). Convert USD at 3.6725.
  One figure X: min = round(0.7 * X), max = X. "Up to X": min = 0, max = X. "X+" / "more than X": min = X, max = max(X, 20000000).
  Ignore phone numbers, bedroom counts, floors, years and months.
- timeline: now (ready now / this month), 0_3_months, 3_6_months, 6_12_months (this year / within a year), exploring (just looking / no rush).
- unitType: studio, 1br, 2br, 3br, 4br, penthouse, townhouse.
- purpose: investor (investment, rental yield, rent out) or end_user (to live in, family home).`;
