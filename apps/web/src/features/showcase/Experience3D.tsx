'use client';

import type { Unit } from '@gsc/contracts';
import { canRender3d } from '@gsc/3d/capability';
import { formatAed } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/routing';

const TowerScene = dynamic(() => import('@gsc/3d').then((m) => m.TowerScene), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-night-soft" />,
});

type Mode = 'architectural' | 'availability';
const LEGEND: Unit['availability'][] = ['available', 'reserved', 'sold', 'hold'];
const DOT: Record<Unit['availability'], string> = {
  available: 'bg-avail-available',
  reserved: 'bg-avail-reserved',
  sold: 'bg-avail-sold',
  hold: 'bg-avail-hold',
};

/**
 * The real-time model: an inline stage on the page and a full-screen mode.
 * The same TowerScene element stays mounted when toggling, so the camera and selection carry over.
 * three.js is only downloaded once this section approaches the viewport.
 */
export function Experience3D({ units }: { units: Unit[] }) {
  const t = useTranslations('experience');
  const tu = useTranslations('units');
  const locale = useLocale();
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [supported, setSupported] = useState(true);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState<Mode>('architectural');
  const [selected, setSelected] = useState<Unit | null>(null);

  useEffect(() => {
    setSupported(canRender3d());
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const close = useCallback(() => {
    setFull(false);
    setSelected(null);
  }, []);

  useEffect(() => {
    if (!full) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [full, close]);

  const onSelect = (u: Unit) => {
    setSelected(u);
    if (!full) setFull(true);
    setMode('availability');
  };

  const toggle = (m: Mode) =>
    `rounded-pill px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${mode === m ? 'bg-ivory text-night' : 'text-ivory/70 hover:text-ivory'}`;

  return (
    <section id="experience" ref={section} className="bg-night py-24 text-ivory md:py-32">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="reveal grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
          <div>
            <p className="eyebrow text-champagne">{t('eyebrow')}</p>
            <h2 className="mt-4 font-display text-[clamp(2.4rem,5vw,4.2rem)] font-light leading-[1.02]">{t('title')}</h2>
          </div>
          <p className="max-w-md text-ivory/65 md:justify-self-end">{t('body')}</p>
        </div>

        <div
          className={
            full
              ? 'fixed inset-0 z-[70] bg-night'
              : 'reveal relative mt-12 aspect-[4/5] overflow-hidden rounded-[22px] ring-1 ring-white/10 sm:aspect-[16/9]'
          }
          role={full ? 'dialog' : undefined}
          aria-modal={full || undefined}
          aria-label={full ? t('title') : undefined}
        >
          {supported && near ? (
            <TowerScene
              units={units}
              colorMode={mode}
              autoRotate={!full && !selected}
              selectedUnitId={selected?.id}
              onSelect={onSelect}
              className="absolute inset-0"
            />
          ) : (
            <img src="/cinematic/landscape/A-bg.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
          )}

          {/* Controls */}
          <div className={`absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 ${full ? 'pt-[max(16px,env(safe-area-inset-top))] md:p-6' : ''}`}>
            <div className="flex rounded-pill bg-night/70 p-1 backdrop-blur-md">
              <button type="button" className={toggle('architectural')} onClick={() => setMode('architectural')} aria-pressed={mode === 'architectural'}>
                {t('modeArchitecture')}
              </button>
              <button type="button" className={toggle('availability')} onClick={() => setMode('availability')} aria-pressed={mode === 'availability'}>
                {t('modeAvailability')}
              </button>
            </div>
            {full ? (
              <button type="button" onClick={close} className="rounded-pill bg-night/70 px-5 py-2 text-[11px] uppercase tracking-[0.18em] backdrop-blur-md hover:bg-night">
                {t('close')} ✕
              </button>
            ) : (
              supported && (
                <button type="button" onClick={() => setFull(true)} className="rounded-pill bg-ivory px-5 py-2 text-[11px] uppercase tracking-[0.18em] text-night hover:bg-champagne-light">
                  {t('fullscreen')} ⤢
                </button>
              )
            )}
          </div>

          {mode === 'availability' && (
            <ul className="absolute bottom-4 start-4 flex flex-wrap gap-x-4 gap-y-1 rounded-pill bg-night/70 px-4 py-2 text-[11px] text-ivory/80 backdrop-blur-md">
              {LEGEND.map((a) => (
                <li key={a} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${DOT[a]}`} />
                  {tu(`availability.${a}`)}
                </li>
              ))}
            </ul>
          )}

          {!supported && <p className="absolute inset-x-0 bottom-6 text-center text-sm text-ivory/70">{t('unsupported')}</p>}

          {full && selected && (
            <div className="absolute bottom-16 end-4 w-[min(340px,calc(100vw-32px))] rounded-[18px] bg-ivory p-5 text-night shadow-2xl md:bottom-6 md:end-6">
              <p className="eyebrow text-champagne-dark">{tu(`type.${selected.type}`)}</p>
              <p className="mt-1 font-display text-3xl">{selected.code}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {tu('floor')} {selected.floor} · {tu(`view.${selected.view}`)} · {selected.areaSqft.toLocaleString(locale)} {tu('sqft')}
              </p>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-lg font-medium">{formatAed(selected.priceAed, locale)}</span>
                <span className="text-xs text-ink-muted">{tu(`availability.${selected.availability}`)}</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Link href={`/explorer?unit=${selected.id}`} className="flex-1 rounded-pill bg-night py-2.5 text-center text-[11px] uppercase tracking-[0.16em] text-ivory">
                  {t('details')}
                </Link>
                <Link href={`/calculator?unit=${selected.id}`} className="flex-1 rounded-pill border border-night/20 py-2.5 text-center text-[11px] uppercase tracking-[0.16em]">
                  {t('plan')}
                </Link>
              </div>
            </div>
          )}
        </div>
        {!full && <p className="mt-4 text-center text-xs text-ivory/45">{t('hint')}</p>}
      </div>
    </section>
  );
}
