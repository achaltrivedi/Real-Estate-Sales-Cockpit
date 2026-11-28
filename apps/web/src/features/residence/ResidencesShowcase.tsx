'use client';

import type { Unit, UnitType } from '@gsc/contracts';
import { formatAed, formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Link } from '@/i18n/routing';
import { FloorPlan } from './FloorPlan';
import { planFor } from './floorplans';
import { INTERIORS, src, srcSet } from './media';
import { ResidenceSheet, Thumbs, representative } from './ResidenceSheet';
import { useTour } from './useTour';

export interface ResidenceLine {
  type: UnitType;
  available: number;
  fromPriceAed: number;
  areaSqft: [number, number];
}

/** Home "Residences": one tab per type with its interiors, floor plan and key facts. */
export function ResidencesShowcase({ residences, units }: { residences: ResidenceLine[]; units: Unit[] }) {
  const t = useTranslations('residence');
  const th = useTranslations('home');
  const tu = useTranslations('units');
  const locale = useLocale();
  const [active, setActive] = useState<UnitType | null>(null);
  const [photo, setPhoto] = useState(0);
  const [sheet, setSheet] = useState<'interiors' | 'plan' | null>(null);
  const tour = useTour();

  const line = residences.find((r) => r.type === active) ?? residences[0];
  const type = line?.type;
  const ofType = useMemo(() => units.filter((u) => u.type === type), [units, type]);
  const rep = type ? representative(units, type) : undefined;
  const plan = useMemo(() => (type ? planFor(type, rep ? { bathrooms: rep.bathrooms, areaSqft: rep.areaSqft } : {}) : null), [type, rep]);

  if (!line || !type || !plan) return null;
  const photos = INTERIORS[type];
  const current = photos[Math.min(photo, photos.length - 1)]!;
  const range = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return lo === hi ? formatNumber(lo, locale) : `${formatNumber(lo, locale)}–${formatNumber(hi, locale)}`;
  };

  const facts: [string, string][] = [
    [t('area'), `${range(line.areaSqft)} ${tu('sqft')}`],
    [t('beds'), type === 'studio' ? tu('type.studio') : range(ofType.map((u) => u.bedrooms))],
    [t('baths'), range(ofType.map((u) => u.bathrooms))],
    [th('from'), formatAed(line.fromPriceAed, locale)],
  ];

  return (
    <div className="mt-12">
      {/* Type tabs */}
      <div role="tablist" aria-label={th('residencesTitle')} className="reveal -mx-5 flex gap-1 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0">
        {residences.map((r) => (
          <button
            key={r.type}
            role="tab"
            type="button"
            aria-selected={r.type === type}
            onClick={() => {
              setActive(r.type);
              setPhoto(0);
            }}
            className={`shrink-0 rounded-pill px-5 py-2.5 text-[12px] uppercase tracking-[0.16em] transition duration-500 ease-luxe rtl:tracking-normal ${
              r.type === type ? 'bg-night text-ivory' : 'text-ink-soft hover:bg-night/5'
            }`}
          >
            {tu(`type.${r.type}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="reveal mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Interiors */}
        <figure className="relative overflow-hidden rounded-[22px] bg-ivory-deep">
          <button type="button" onClick={() => setSheet('interiors')} className="group relative block aspect-[4/3] w-full overflow-hidden" aria-label={t('openGallery')}>
            {photos.map((p, i) => (
              <img
                key={p.base}
                src={src(p)}
                srcSet={srcSet(p)}
                sizes="(min-width: 1024px) 56vw, 100vw"
                alt={t(`photo.${p.key}`)}
                loading="lazy"
                className={`absolute inset-0 h-full w-full object-cover transition duration-[1200ms] ease-luxe group-hover:scale-[1.025] ${p.base === current.base ? 'opacity-100' : 'opacity-0'}`}
              />
            ))}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-night/70 to-transparent" />
            <figcaption className="absolute bottom-4 start-5 end-5 flex items-end justify-between gap-4 text-start text-ivory">
              <span className="text-sm">{t(`photo.${current.key}`)}</span>
              <span className="shrink-0 rounded-pill bg-ivory/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] backdrop-blur-md rtl:tracking-normal">{t('openGallery')} ⤢</span>
            </figcaption>
          </button>
          <button
            type="button"
            onClick={() => tour.open({ kind: 'residence', type })}
            className="absolute start-4 top-4 rounded-pill bg-ivory px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-night shadow-lg transition hover:bg-champagne-light rtl:tracking-normal"
          >
            {t('tour.open')} →
          </button>
          <Thumbs photos={photos} index={photos.indexOf(current)} onPick={setPhoto} label={(p) => t(`photo.${p.key}`)} dark={false} />
        </figure>

        {/* Plan + facts */}
        <div className="flex flex-col rounded-[22px] bg-ivory-deep p-6 md:p-8">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-display text-3xl font-light text-night md:text-4xl">{tu(`type.${type}`)}</p>
            <p className="text-xs text-ink-muted">{th('availableCount', { count: line.available })}</p>
          </div>
          <button type="button" onClick={() => setSheet('plan')} className="group mt-4 flex flex-1 items-center justify-center rounded-[16px] bg-ivory p-3 ring-1 ring-night/5 transition hover:ring-champagne/60" aria-label={t('openPlan')}>
            <FloorPlan plan={plan} compact viewLabel={rep ? t('viewSide', { view: tu(`view.${rep.view}`) }) : undefined} className="max-h-[340px] w-full" />
          </button>
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-muted rtl:tracking-normal">{k}</dt>
                <dd className="mt-1 font-display text-lg text-night">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => tour.open({ kind: 'residence', type })} className="btn-luxe w-full justify-center sm:w-auto">
              {t('tour.open')}
            </button>
            <button type="button" onClick={() => setSheet('plan')} className="btn-ghost-dark w-full justify-center sm:w-auto">
              {t('openPlan')}
            </button>
            <Link href={`/explorer?type=${type}`} className="btn-ghost-dark w-full justify-center sm:w-auto">
              {t('explore')}
            </Link>
          </div>
        </div>
      </div>

      {sheet && <ResidenceSheet type={type} units={units} initialTab={sheet} onClose={() => setSheet(null)} />}
      {tour.overlay}
    </div>
  );
}
