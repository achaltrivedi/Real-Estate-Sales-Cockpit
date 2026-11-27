import type { Locale, Qualification, QualificationField, QuickReply } from '@gsc/contracts';
import type { LlmProvider, Slots } from './llm';
import { BOOK_VIEWING_REPLIES, COPY, QUESTIONS } from './prompts';
import { score } from './scoring';

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

const ESCALATE_RE = /human|agent|call me|speak to|real person|مستشار|اتصل/i;
const ASK_ORDER: QualificationField[] = ['purpose', 'unitType', 'budget', 'timeline'];

function slotsFromQuickReply(id: string | undefined): Slots {
  if (!id) return {};
  const [slot, value] = id.split(':');
  if (!value) return {};
  switch (slot) {
    case 'purpose':
      return { purpose: value as Slots['purpose'] };
    case 'unitType':
      return { unitType: value as Slots['unitType'] };
    case 'timeline':
      return { timeline: value as Slots['timeline'] };
    case 'budget': {
      const [min, max] = value.split('-').map(Number);
      return { budgetMinAed: min, budgetMaxAed: max };
    }
    default:
      return {};
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

      if (quickReplyId === 'action:handoff' || ESCALATE_RE.test(text)) {
        return { qualification: current, replies: [{ text: COPY.handoff[locale] }], escalate: true, wantsViewing: false };
      }
      if (quickReplyId === 'action:book_viewing') {
        return { qualification: current, replies: [], escalate: false, wantsViewing: true };
      }

      const extracted = quickReplyId ? slotsFromQuickReply(quickReplyId) : await deps.llm.extractSlots({ text, locale });
      const merged: Slots = { ...toSlots(current), ...stripUndefined(extracted) };
      const qualification = score(merged);

      const replies: Reply[] = [];
      const next = nextQuestion(qualification.missing, locale);
      if (next) replies.push(next);
      else replies.push({ text: COPY.qualified[locale], quickReplies: BOOK_VIEWING_REPLIES[locale] });

      return { qualification, replies, escalate: false, wantsViewing: false };
    },
  };
}
export type Qualifier = ReturnType<typeof createQualifier>;

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
