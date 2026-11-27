import type { Conversation, ConversationStatus, Lead, Message, Qualification, SendMessageResponse, Viewing } from '@gsc/contracts';

export interface UnitContext {
  unitId: string;
  unitCode: string;
}

export interface ChatState {
  open: boolean;
  phase: 'intro' | 'starting' | 'chatting';
  lead?: Lead;
  conversationId?: string;
  status: ConversationStatus;
  messages: Message[];
  qualification?: Qualification;
  sending: boolean;
  error?: 'start' | 'send' | 'viewing';
  unit?: UnitContext;
  showViewingPicker: boolean;
  viewing?: Viewing;
}

export const initialChatState: ChatState = {
  open: false,
  phase: 'intro',
  status: 'bot',
  messages: [],
  sending: false,
  showViewingPicker: false,
};

export type ChatAction =
  | { type: 'open'; unit?: UnitContext }
  | { type: 'close' }
  | { type: 'start' }
  | { type: 'started'; lead: Lead; conversation: Conversation }
  | { type: 'send'; message: Message }
  | { type: 'received'; tempId: string; response: SendMessageResponse }
  | { type: 'handoff'; conversation: Conversation }
  | { type: 'showViewingPicker'; show: boolean }
  | { type: 'viewingBooked'; viewing: Viewing; confirmation: Message }
  | { type: 'failed'; error: NonNullable<ChatState['error']>; tempId?: string };

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case 'open':
      // Keep an existing conversation; only adopt the unit context before the chat starts.
      return { ...s, open: true, unit: s.phase === 'intro' ? (a.unit ?? s.unit) : s.unit };
    case 'close':
      return { ...s, open: false };
    case 'start':
      return { ...s, phase: 'starting', error: undefined };
    case 'started':
      return {
        ...s,
        phase: 'chatting',
        lead: a.lead,
        conversationId: a.conversation.id,
        status: a.conversation.status,
        messages: a.conversation.messages,
        qualification: a.lead.qualification,
      };
    case 'send':
      return { ...s, sending: true, error: undefined, showViewingPicker: false, messages: [...s.messages, a.message] };
    case 'received':
      return {
        ...s,
        sending: false,
        status: a.response.status,
        qualification: a.response.qualification,
        // Replace the optimistic buyer message with the server's copy + replies.
        messages: [...s.messages.filter((m) => m.id !== a.tempId), ...a.response.messages],
      };
    case 'handoff':
      return { ...s, status: a.conversation.status, messages: a.conversation.messages, showViewingPicker: false };
    case 'showViewingPicker':
      return { ...s, showViewingPicker: a.show };
    case 'viewingBooked':
      return { ...s, viewing: a.viewing, showViewingPicker: false, messages: [...s.messages, a.confirmation] };
    case 'failed':
      return {
        ...s,
        sending: false,
        error: a.error,
        phase: a.error === 'start' ? 'intro' : s.phase,
        messages: a.tempId ? s.messages.filter((m) => m.id !== a.tempId) : s.messages,
      };
  }
}

/** Quick replies are only offered on the latest assistant message while the bot is in charge. */
export function activeQuickReplies(s: ChatState) {
  const last = s.messages[s.messages.length - 1];
  if (!last || last.role !== 'assistant' || s.status !== 'bot' || s.sending) return [];
  return last.quickReplies ?? [];
}

/** Next three days, two slots each, in Dubai time (+04:00). */
export function viewingSlots(from: Date): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 3; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    out.push(`${ymd}T11:00:00+04:00`, `${ymd}T17:00:00+04:00`);
  }
  return out;
}
