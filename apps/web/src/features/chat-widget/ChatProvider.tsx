'use client';

import type { Locale, Message } from '@gsc/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { PROJECT_ID, api } from '@/lib/api';
import { ChatWidget } from './ChatWidget';
import { chatReducer, initialChatState, type UnitContext } from './state';

export interface ChatActions {
  start: (contact: { name?: string; phone?: string }) => Promise<void>;
  send: (text: string, quickReplyId?: string) => Promise<void>;
  handoff: () => Promise<void>;
  bookViewing: (startsAt: string, mode: 'in_person' | 'video_call') => Promise<void>;
  showViewingPicker: (show: boolean) => void;
  close: () => void;
  open: (unit?: UnitContext) => void;
}

const ChatContext = createContext<Pick<ChatActions, 'open'> | null>(null);

/** Other features open the chat through this (e.g. "Enquire about this unit"). */
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}

const local = (conversationId: string, text: string): Message => ({
  id: `local_${Date.now()}`,
  conversationId,
  role: 'system',
  channel: 'web',
  text,
  createdAt: new Date().toISOString(),
});

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const locale = useLocale() as Locale;
  const t = useTranslations('chat');

  const open = useCallback((unit?: UnitContext) => dispatch({ type: 'open', unit }), []);

  const actions: ChatActions = useMemo(
    () => ({
      open,
      close: () => dispatch({ type: 'close' }),
      showViewingPicker: (show) => dispatch({ type: 'showViewingPicker', show }),

      async start({ name, phone }) {
        dispatch({ type: 'start' });
        try {
          const r = await api('createLead', {
            body: {
              projectId: PROJECT_ID,
              locale,
              name: name?.trim() || undefined,
              phone: phone?.trim() || undefined,
              unitId: state.unit?.unitId,
              consent: true,
              consentText: t('consent'),
            },
          });
          dispatch({ type: 'started', lead: r.lead, conversation: r.conversation });
        } catch {
          dispatch({ type: 'failed', error: 'start' });
        }
      },

      async send(text, quickReplyId) {
        if (!state.conversationId) return;
        // Booking a viewing is a UI step: open the picker instead of messaging the bot.
        if (quickReplyId === 'action:book_viewing') {
          dispatch({ type: 'showViewingPicker', show: true });
          return;
        }
        const tempId = `tmp_${Date.now()}`;
        dispatch({
          type: 'send',
          message: { id: tempId, conversationId: state.conversationId, role: 'buyer', channel: 'web', text, createdAt: new Date().toISOString() },
        });
        try {
          const response = await api('sendMessage', { params: { id: state.conversationId }, body: { text, quickReplyId } });
          dispatch({ type: 'received', tempId, response });
        } catch {
          dispatch({ type: 'failed', error: 'send', tempId });
        }
      },

      async handoff() {
        if (!state.conversationId) return;
        try {
          const conversation = await api('requestHandoff', { params: { id: state.conversationId } });
          dispatch({ type: 'handoff', conversation });
        } catch {
          dispatch({ type: 'failed', error: 'send' });
        }
      },

      async bookViewing(startsAt, mode) {
        if (!state.lead || !state.conversationId) return;
        try {
          const viewing = await api('createViewing', {
            body: { leadId: state.lead.id, unitId: state.unit?.unitId, startsAt, mode },
          });
          const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'Asia/Dubai',
          }).format(new Date(startsAt));
          dispatch({ type: 'viewingBooked', viewing, confirmation: local(state.conversationId, t('viewingBooked', { when })) });
        } catch {
          dispatch({ type: 'failed', error: 'viewing' });
        }
      },
    }),
    [open, locale, t, state.unit, state.conversationId, state.lead],
  );

  const ctx = useMemo(() => ({ open }), [open]);

  return (
    <ChatContext.Provider value={ctx}>
      {children}
      <ChatWidget state={state} actions={actions} />
    </ChatContext.Provider>
  );
}
