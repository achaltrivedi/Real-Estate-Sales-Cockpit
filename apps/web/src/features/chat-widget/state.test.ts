import type { Conversation, Lead, Message } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { activeQuickReplies, chatReducer, initialChatState, viewingSlots } from './state';

const msg = (over: Partial<Message>): Message => ({
  id: 'm',
  conversationId: 'c',
  role: 'assistant',
  channel: 'web',
  text: 'hi',
  createdAt: '2026-11-27T10:00:00Z',
  ...over,
});
const qualification = { score: 0, isQualified: false, missing: [] as never[] };
const lead = { id: 'l', qualification } as unknown as Lead;
const conversation: Conversation = {
  id: 'c',
  leadId: 'l',
  status: 'bot',
  messages: [msg({ id: 'g', quickReplies: [{ id: 'purpose:investor', label: 'Investment' }] })],
};

describe('chat state', () => {
  it('keeps unit context from the enquiry that opened it, until the chat starts', () => {
    const s = chatReducer(initialChatState, { type: 'open', unit: { unitId: 'u1', unitCode: 'T1-0301' } });
    expect(s.unit?.unitCode).toBe('T1-0301');
    const started = chatReducer(chatReducer(s, { type: 'start' }), { type: 'started', lead, conversation });
    const reopened = chatReducer(started, { type: 'open', unit: { unitId: 'u2', unitCode: 'T2-0501' } });
    expect(reopened.unit?.unitId).toBe('u1');
  });

  it('shows the instant reply and its quick replies after start', () => {
    const s = chatReducer(initialChatState, { type: 'started', lead, conversation });
    expect(s.phase).toBe('chatting');
    expect(activeQuickReplies(s).map((q) => q.id)).toEqual(['purpose:investor']);
  });

  it('replaces the optimistic message with the server response', () => {
    let s = chatReducer(initialChatState, { type: 'started', lead, conversation });
    s = chatReducer(s, { type: 'send', message: msg({ id: 'tmp', role: 'buyer', text: 'Investment' }) });
    expect(activeQuickReplies(s)).toEqual([]);
    s = chatReducer(s, {
      type: 'received',
      tempId: 'tmp',
      response: { messages: [msg({ id: 'b', role: 'buyer' }), msg({ id: 'r' })], qualification, status: 'bot' },
    });
    expect(s.messages.map((m) => m.id)).toEqual(['g', 'b', 'r']);
    expect(s.sending).toBe(false);
  });

  it('rolls back the optimistic message when sending fails', () => {
    let s = chatReducer(initialChatState, { type: 'started', lead, conversation });
    s = chatReducer(s, { type: 'send', message: msg({ id: 'tmp', role: 'buyer' }) });
    s = chatReducer(s, { type: 'failed', error: 'send', tempId: 'tmp' });
    expect(s.messages.map((m) => m.id)).toEqual(['g']);
    expect(s.error).toBe('send');
  });

  it('hides quick replies once a human has taken over', () => {
    const s = chatReducer(chatReducer(initialChatState, { type: 'started', lead, conversation }), {
      type: 'handoff',
      conversation: { ...conversation, status: 'human' },
    });
    expect(activeQuickReplies(s)).toEqual([]);
  });

  it('offers six Dubai-time viewing slots over the next three days', () => {
    const slots = viewingSlots(new Date(2026, 10, 27));
    expect(slots).toHaveLength(6);
    expect(slots[0]).toBe('2026-11-28T11:00:00+04:00');
  });
});
