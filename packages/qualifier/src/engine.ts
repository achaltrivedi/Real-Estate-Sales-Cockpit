import {
  Purpose,
  Timeline,
  UnitType,
  type Locale,
  type Qualification,
  type QualificationField,
  type QuickReply,
} from '@gsc/contracts';
import type { LlmProvider, Slots } from './llm';
import { BOOK_VIEWING_REPLIES, COPY, QUESTIONS } from './prompts';
import { score } from './scoring';
import { normalize, rx } from './text';

export interface Reply {
  text: string;
  quickReplies?: QuickReply[];
}

export interface TurnResult {
  qualification: Qualification;
  replies: Reply[];
  /** true → engine should hand the conversation to a human. */
  escalate: boolean;
  /** true → buyer asked to book a viewing. */
  wantsViewing: boolean;
}

/** Buyer asks for a person. Runs on normalised text (see text.ts). */
export const ESCALATE_RE = rx(
  String.raw`\b(?:human|agent|real person|live person|representative|salesperson|call me|call back|phone call)\b|\b(?:speak|talk|chat)(?: to| with) (?:a |an |the |your |some )?(?:person|someone|somebody|advisor|adviser|consultant|sales)|مستشار|موظف|شخص حقيقي|إنسان|اتصل|كلمني|أكلم|أتكلم مع|تكلم مع|مندوب|خدمة العملاء`,
);
const ASK_ORDER: QualificationField[] = ['purpose', 'unitType', 'budget', 'timeline'];
/** Cap so a bogus quick reply can't push an absurd number into the contract. */
const MAX_QUICK_REPLY_BUDGET = 1_000_000_000;

/**
 * Quick-reply ids encode `<slot>:<value>`. Values are validated against the contract enums;
 * anything unknown returns null so the caller falls back to reading the free text.
 */
export function slotsFromQuickReply(id: string | undefined): Slots | null {
  if (!id) return null;
  const [slot, value] = id.split(':');
  if (!value) return null;
  switch (slot) {
    case 'purpose': {
      const p = Purpose.safeParse(value);
      return p.success ? { purpose: p.data } : null;
    }
    case 'unitType': {
      const u = UnitType.safeParse(value);
      return u.success ? { unitType: u.data } : null;
    }
    case 'timeline': {
      const t = Timeline.safeParse(value);
      return t.success ? { timeline: t.data } : null;
    }
    case 'budget': {
      const m = /^(\d+)-(\d+)$/.exec(value);
      if (!m) return null;
      const [min, max] = [Number(m[1]), Number(m[2])];
      if (min > MAX_QUICK_REPLY_BUDGET || max > MAX_QUICK_REPLY_BUDGET) return null;
      return { budgetMinAed: Math.min(min, max), budgetMaxAed: Math.max(min, max) };
    }
    default:
      return null;
  }
}

function toSlots(q: Qualification): Slots {
  const { budgetMinAed, budgetMaxAed, timeline, unitType, purpose } = q;
  return { budgetMinAed, budgetMaxAed, timeline, unitType, purpose };
}

export function nextQuestion(missing: QualificationField[], locale: Locale): Reply | null {
  const field = ASK_ORDER.find((f) => missing.includes(f));
  if (!field) return null;
  const q = QUESTIONS[field];
  return { text: q.text[locale], quickReplies: q.quickReplies[locale] };
}

export function initialQualification(): Qualification {
  return score({});
}

/** Greeting + first question: the instant reply sent the moment a lead is created. */
export function openingReplies(locale: Locale): Reply[] {
  const first = nextQuestion(initialQualification().missing, locale);
  return [{ text: COPY.greeting[locale] }, ...(first ? [first] : [])];
}

/** The conversation state machine: one buyer turn in, replies + updated qualification out. */
export function createQualifier(deps: { llm: LlmProvider }) {
  return {
    async handleTurn(input: {
      text: string;
      quickReplyId?: string;
      locale: Locale;
      current: Qualification;
    }): Promise<TurnResult> {
      const { text, quickReplyId, locale, current } = input;

      if (quickReplyId === 'action:handoff' || ESCALATE_RE.test(normalize(text))) {
        return {
          qualification: current,
          replies: [{ text: COPY.handoff[locale] }],
          escalate: true,
          wantsViewing: false,
        };
      }
      if (quickReplyId === 'action:book_viewing') {
        return { qualification: current, replies: [], escalate: false, wantsViewing: true };
      }

      const extracted =
        slotsFromQuickReply(quickReplyId) ?? (await deps.llm.extractSlots({ text, locale }));
      const learned = stripUndefined(extracted);
      const qualification = score({ ...toSlots(current), ...learned });

      const replies: Reply[] = [];
      const next = nextQuestion(qualification.missing, locale);
      if (next) {
        // Nothing understood and nothing changed: say so instead of silently repeating the question.
        const understood = Object.keys(learned).length > 0;
        replies.push(
          understood ? next : { ...next, text: `${COPY.didntCatch[locale]} ${next.text}` },
        );
      } else {
        replies.push({ text: COPY.qualified[locale], quickReplies: BOOK_VIEWING_REPLIES[locale] });
      }

      return { qualification, replies, escalate: false, wantsViewing: false };
    },
  };
}
export type Qualifier = ReturnType<typeof createQualifier>;

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
