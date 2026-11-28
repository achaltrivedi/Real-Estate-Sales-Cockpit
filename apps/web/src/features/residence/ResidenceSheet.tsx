'use client';

import type { Unit, UnitType } from '@gsc/contracts';
import { formatAed, formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@/i18n/routing';
import { FloorPlan } from './FloorPlan';
import { planFor } from './floorplans';
import { useEscapeLayer, useScrollLock } from './layers';
import { INTERIORS, type Photo, src, srcSet } from './media';
import { useTour } from './useTour';

export interface ResidenceSheetProps {
  type: UnitType;
  /** A specific residence; otherwise the type's largest unit (or the template) is shown. */
  unit?: Unit | null;
  /** Units of the type, for the representative plan and the facts row. */
  units?: Unit[];
  initialTab?: 'interiors' | 'plan';
  onClose: () => void;
}

/** Full-screen residence view: interior gallery and the floor plan, side by side on desktop. Esc closes. */
export function ResidenceSheet({ type, unit, units = [], initialTab = 'interiors', onClose }: ResidenceSheetProps) {
  const t = useTranslations('residence');
  const tu = useTranslations('units');
  const locale = useLocale();
  const photos = INTERIORS[type];
  const [index, setIndex] = useState(0);
  const [tab, setTab] = useState(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tour = useTour();
  const startTour = () => {
    // The 3D model flies in over everything: step out of the sheet first.
    if (tour.open({ kind: 'residence', type, unit })) onClose();
  };
  useEscapeLayer(true, onClose);
  useScrollLock(true);

  const rep = unit ?? representative(units, type);
  const plan = useMemo(() => planFor(type, rep ? { bathrooms: rep.bathrooms, areaSqft: rep.areaSqft } : {}), [type, rep]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    if (tour.overlay) return; // the tour has the arrow keys
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const step = (e.key === 'ArrowRight') === (document.dir !== 'rtl') ? 1 : -1;
        setIndex((i) => (i + step + photos.length) % photos.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length, tour.overlay]);

  const photo = photos[index]!;
  const facts: [string, string][] = rep
    ? [
        [t('area'), `${formatNumber(rep.areaSqft, locale)} ${tu('sqft')}`],
        [t('beds'), rep.bedrooms ? formatNumber(rep.bedrooms, locale) : tu('type.studio')],
        [t('baths'), formatNumber(rep.bathrooms, locale)],
        [t('view'), tu(`view.${rep.view}`)],
      ]
    : [];

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={tu(`type.${type}`)} className="fixed inset-0 z-[80] flex flex-col bg-night text-ivory">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 pb-3 pt-[max(16px,env(safe-area-inset-top))] md:px-8">
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate text-champagne">{unit ? `${tu(`type.${type}`)} · ${unit.code}` : t('eyebrow')}</p>
          <p className="truncate font-display text-2xl font-light md:text-3xl">{unit ? `${tu('floor')} ${formatNumber(unit.floor, locale)} · ${tu(`view.${unit.view}`)}` : tu(`type.${type}`)}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="shrink-0 whitespace-nowrap rounded-pill bg-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.18em] hover:bg-white/20 rtl:tracking-normal"
        >
          <span className="hidden sm:inline">{t('close')} </span>✕
        </button>
        <div className="flex w-full rounded-pill bg-white/10 p-1 sm:w-auto lg:hidden">
          {(['interiors', 'plan'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={`flex-1 whitespace-nowrap rounded-pill px-4 py-1.5 text-[11px] uppercase tracking-[0.16em] transition rtl:tracking-normal ${tab === k ? 'bg-ivory text-night' : 'text-ivory/70'}`}
            >
              {t(k === 'plan' ? 'floorPlan' : 'interiors')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 px-3 pb-3 md:px-6 md:pb-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* Gallery */}
        <figure className={`relative min-h-0 overflow-hidden rounded-[18px] bg-night-soft ${tab === 'interiors' ? 'flex' : 'hidden'} flex-col lg:flex`}>
          <div className="relative min-h-0 flex-1">
            {photos.map((p, i) => (
              <img
                key={p.base}
                src={src(p)}
                srcSet={srcSet(p)}
                sizes="(min-width: 1024px) 60vw, 100vw"
                alt={t(`photo.${p.key}`)}
                loading={i === 0 ? 'eager' : 'lazy'}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-luxe ${i === index ? 'opacity-100' : 'opacity-0'}`}
              />
            ))}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-night/80 to-transparent" />
            <button
              type="button"
              onClick={startTour}
              className="absolute start-4 top-4 rounded-pill bg-ivory px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-night shadow-lg transition hover:bg-champagne-light rtl:tracking-normal"
            >
              {t('tour.open')} →
            </button>
            <figcaption className="absolute bottom-4 start-5 end-28 text-sm text-ivory/90">{t(`photo.${photo.key}`)}</figcaption>
            <div className="absolute bottom-3 end-3 flex gap-2">
              <ArrowButton label={t('prev')} dir={-1} onClick={() => setIndex((index - 1 + photos.length) % photos.length)} />
              <ArrowButton label={t('next')} dir={1} onClick={() => setIndex((index + 1) % photos.length)} />
            </div>
          </div>
          <Thumbs photos={photos} index={index} onPick={setIndex} label={(p) => t(`photo.${p.key}`)} />
        </figure>

        {/* Plan + facts */}
        <section className={`min-h-0 flex-col overflow-y-auto rounded-[18px] bg-ivory text-night ${tab === 'plan' ? 'flex' : 'hidden'} lg:flex`}>
          <div className="flex items-baseline justify-between px-6 pt-5">
            <p className="eyebrow text-champagne-dark">{t('floorPlan')}</p>
            <p className="text-xs text-ink-muted" dir="ltr">
              {formatNumber(Math.round(plan.areaM2 * 10) / 10, locale)} m²
            </p>
          </div>
          <div className="flex min-h-[260px] flex-1 items-center justify-center px-3 py-2">
            <FloorPlan plan={plan} viewLabel={rep ? t('viewSide', { view: tu(`view.${rep.view}`) }) : undefined} className="h-full max-h-[62vh] w-full" />
          </div>
          {facts.length > 0 && (
            <dl className="grid grid-cols-4 gap-2 border-t border-night/10 px-6 py-4">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">{k}</dt>
                  <dd className="mt-1 font-display text-lg">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-night/10 px-6 py-4">
            {unit ? (
              <>
                <span className="me-auto text-lg font-medium">{formatAed(unit.priceAed, locale)}</span>
                <Link href={`/calculator?unit=${unit.id}`} className="btn-luxe !px-5 !py-2.5">
                  {t('plan')}
                </Link>
              </>
            ) : (
              <>
                <button type="button" onClick={startTour} className="btn-luxe !px-5 !py-2.5">
                  {t('tour.open')}
                </button>
                <Link href={`/explorer?type=${type}`} className="btn-ghost-dark !px-5 !py-2.5">
                  {t('explore')}
                </Link>
              </>
            )}
          </div>
          <p className="px-6 pb-5 text-[11px] text-ink-muted">{t('disclaimer')}</p>
        </section>
      </div>
      {tour.overlay}
    </div>,
    document.body,
  );
}

/** The type's largest unit, preferring available ones (the plan and facts shown for a type). */
export function representative(units: Unit[], type: UnitType): Unit | undefined {
  const all = units.filter((u) => u.type === type);
  const pool = all.some((u) => u.availability === 'available') ? all.filter((u) => u.availability === 'available') : all;
  return [...pool].sort((a, b) => b.areaSqft - a.areaSqft)[0];
}

function ArrowButton({ label, dir, onClick }: { label: string; dir: 1 | -1; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-10 w-10 place-items-center rounded-full bg-night/60 text-lg text-ivory backdrop-blur-md transition hover:bg-night"
    >
      <span className={dir === 1 ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0'}>→</span>
    </button>
  );
}

export function Thumbs({ photos, index, onPick, label, dark = true }: { photos: Photo[]; index: number; onPick: (i: number) => void; label: (p: Photo) => string; dark?: boolean }) {
  return (
    <div className="flex gap-2 overflow-x-auto p-2">
      {photos.map((p, i) => (
        <button
          key={p.base}
          type="button"
          onClick={() => onPick(i)}
          aria-label={label(p)}
          aria-current={i === index || undefined}
          className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-[10px] ring-2 transition md:h-16 md:w-24 ${i === index ? 'ring-champagne' : dark ? 'ring-transparent opacity-60 hover:opacity-100' : 'ring-transparent opacity-70 hover:opacity-100'}`}
        >
          <img src={src(p, 800)} alt="" loading="lazy" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
