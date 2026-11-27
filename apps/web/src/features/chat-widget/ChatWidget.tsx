'use client';

import type { Message } from '@gsc/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatActions } from './ChatProvider';
import { activeQuickReplies, viewingSlots, type ChatState } from './state';

export function ChatWidget({ state, actions }: { state: ChatState; actions: ChatActions }) {
  const t = useTranslations('chat');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages.length, state.showViewingPicker, state.sending]);

  if (!state.open) {
    return (
      <button
        type="button"
        onClick={() => actions.open()}
        className="fixed bottom-5 end-5 z-40 flex items-center gap-2 rounded-pill bg-ink px-5 py-3 text-sm font-medium text-white shadow-xl hover:bg-ink-soft"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-avail-available" />
        {t('launcher')}
      </button>
    );
  }

  const human = state.status === 'human';

  return (
    <section
      role="dialog"
      aria-label={t('title')}
      className="fixed inset-x-2 bottom-2 z-40 flex max-h-[85vh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-ink/10 sm:inset-x-auto sm:bottom-5 sm:end-5 sm:h-[620px] sm:w-[380px]"
    >
      <header className="flex items-start justify-between gap-2 bg-ink px-4 py-3 text-white">
        <div>
          <p className="text-sm font-semibold">{t('title')}</p>
          <p className="text-[11px] text-white/70">{human ? t('statusHuman') : t('statusBot')}</p>
        </div>
        <div className="flex items-center gap-1">
          {state.phase === 'chatting' && !human && (
            <button type="button" onClick={actions.handoff} className="rounded-pill bg-white/10 px-3 py-1 text-[11px] hover:bg-white/20">
              {t('handoff')}
            </button>
          )}
          <button type="button" onClick={actions.close} aria-label={t('close')} className="rounded-full px-2 text-lg leading-none hover:bg-white/10">
            ×
          </button>
        </div>
      </header>

      {state.phase === 'chatting' && state.qualification && <ProfileMeter score={state.qualification.score} />}

      <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto bg-sand/40 px-3 py-4">
        {state.phase !== 'chatting' ? (
          <IntroForm state={state} onStart={actions.start} />
        ) : (
          <>
            {state.messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            {state.sending && <Typing />}
            {state.showViewingPicker && <ViewingPicker onBook={actions.bookViewing} onCancel={() => actions.showViewingPicker(false)} />}
            {activeQuickReplies(state).length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5 pt-1">
                {activeQuickReplies(state).map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => actions.send(q.label, q.id)}
                    className="rounded-pill border border-brand bg-white px-3 py-1 text-xs font-medium text-brand hover:bg-brand hover:text-white"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {state.error && <p className="text-center text-xs text-stage-lost">{t(`error.${state.error}`)}</p>}
      </div>

      {state.phase === 'chatting' && <Composer disabled={state.sending} onSend={(text) => actions.send(text)} />}
    </section>
  );
}

function IntroForm({ state, onStart }: { state: ChatState; onStart: ChatActions['start'] }) {
  const t = useTranslations('chat');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const starting = state.phase === 'starting';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (consent && !starting) void onStart({ name, phone });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-ink/5">
      <p className="text-sm">{t('intro')}</p>
      {state.unit && <p className="rounded-lg bg-brand-light px-3 py-1.5 text-xs text-brand-dark">{t('aboutUnit', { code: state.unit.unitCode })}</p>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('name')} className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm" autoComplete="name" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('phone')} inputMode="tel" dir="ltr" className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm" autoComplete="tel" />
      <label className="flex items-start gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-brand" required />
        <span>{t('consent')}</span>
      </label>
      <button type="submit" disabled={!consent || starting} className="w-full rounded-pill bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">
        {starting ? t('starting') : t('start')}
      </button>
      <p className="text-[11px] text-ink-muted">{t('optOutHint')}</p>
    </form>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === 'system') {
    return <p className="mx-auto max-w-[90%] rounded-lg bg-white/80 px-3 py-1.5 text-center text-[11px] text-ink-soft">{message.text}</p>;
  }
  const mine = message.role === 'buyer';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <p
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          mine ? 'rounded-ee-sm bg-brand text-white' : 'rounded-es-sm bg-white text-ink ring-1 ring-ink/5'
        }`}
      >
        {message.text}
      </p>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex gap-1 px-2 py-1" aria-label="…">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

function ProfileMeter({ score }: { score: number }) {
  const t = useTranslations('chat');
  return (
    <div className="flex items-center gap-2 border-b border-ink/5 bg-white px-4 py-2 text-[11px] text-ink-muted">
      <span>{t('profile')}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-ink/10">
        <span className="block h-full rounded-pill bg-brand transition-all duration-500" style={{ width: `${score}%` }} />
      </span>
      <span className="tabular-nums">{score}%</span>
    </div>
  );
}

function ViewingPicker({ onBook, onCancel }: { onBook: ChatActions['bookViewing']; onCancel: () => void }) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [slot, setSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<'in_person' | 'video_call'>('in_person');
  const [busy, setBusy] = useState(false);
  const slots = viewingSlots(new Date());
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', { weekday: 'short', day: 'numeric', hour: 'numeric', timeZone: 'Asia/Dubai' });

  return (
    <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-brand/30">
      <p className="text-sm font-medium">{t('pickSlot')}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {slots.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={slot === s}
            onClick={() => setSlot(s)}
            className={`rounded-lg border px-2 py-1.5 text-xs ${slot === s ? 'border-brand bg-brand text-white' : 'border-ink/15'}`}
          >
            {fmt.format(new Date(s))}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 text-xs">
        {(['in_person', 'video_call'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-pill border px-2 py-1 ${mode === m ? 'border-ink bg-ink text-white' : 'border-ink/15'}`}>
            {t(`mode.${m}`)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-pill border border-ink/15 py-1.5 text-xs">
          {t('cancel')}
        </button>
        <button
          type="button"
          disabled={!slot || busy}
          onClick={async () => {
            if (!slot) return;
            setBusy(true);
            await onBook(slot, mode);
            setBusy(false);
          }}
          className="flex-1 rounded-pill bg-brand py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {t('confirmViewing')}
        </button>
      </div>
    </div>
  );
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const t = useTranslations('chat');
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = text.trim();
        if (!v || disabled) return;
        onSend(v);
        setText('');
      }}
      className="border-t border-ink/5 bg-white p-2"
    >
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('placeholder')} className="flex-1 rounded-pill border border-ink/15 px-4 py-2 text-sm" maxLength={2000} />
        <button type="submit" disabled={disabled || !text.trim()} className="rounded-pill bg-brand px-4 text-sm font-medium text-white disabled:opacity-40">
          {t('send')}
        </button>
      </div>
      <p className="mt-1 px-2 text-[10px] text-ink-muted">{t('optOutHint')}</p>
    </form>
  );
}
