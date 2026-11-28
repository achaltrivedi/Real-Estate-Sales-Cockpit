'use client';

import type { PaymentPlan, Project, Unit } from '@gsc/contracts';
import { Pill, formatAed, formatNumber, tokens } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useChat } from '@/features/chat-widget';
import { FloorPlan, INTERIORS, ResidenceSheet, planFor, src, useEscapeLayer, useTour } from '@/features/residence';
import { Link } from '@/i18n/routing';
import { pricePerSqft } from './filters';

interface Props {
  unit: Unit;
  project: Project;
  paymentPlans: PaymentPlan[];
  onClose: () => void;
}

/** Side panel on desktop, bottom sheet on mobile. Esc closes. */
export function UnitDrawer({ unit, project, paymentPlans, onClose }: Props) {
  const t = useTranslations('explorer.detail');
  const tu = useTranslations('units');
  const locale = useLocale();
  const plans = paymentPlans.filter((p) => unit.paymentPlanIds.includes(p.id));
  const building = project.buildings.find((b) => b.id === unit.building)?.name ?? unit.building;
  const canEnquire = unit.availability === 'available';
  const chat = useChat();
  const tr = useTranslations('residence');
  const [sheet, setSheet] = useState<'interiors' | 'plan' | null>(null);
  const plan = useMemo(() => planFor(unit.type, { bathrooms: unit.bathrooms, areaSqft: unit.areaSqft }), [unit]);
  const photos = INTERIORS[unit.type];

  const tour = useTour();
  useEscapeLayer(true, onClose);

  const rows: [string, string][] = [
    [t('building'), building],
    [tu('floor'), formatNumber(unit.floor, locale)],
    [t('view'), tu(`view.${unit.view}`)],
    [t('area'), `${formatNumber(unit.areaSqft, locale)} ${tu('sqft')}`],
    [t('bedsBaths'), `${formatNumber(unit.bedrooms, locale)} / ${formatNumber(unit.bathrooms, locale)}`],
    [t('perSqft'), formatAed(pricePerSqft(unit), locale)],
  ];

  return (
    <aside
      role="dialog"
      aria-label={unit.code}
      className="fixed inset-x-0 bottom-0 z-[60] max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-[400px] md:rounded-none"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-muted">{t('unit')}</p>
          <h2 className="font-display text-3xl">{unit.code}</h2>
          <p className="text-sm text-ink-soft">{tu(`type.${unit.type}`)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('close')} className="rounded-full p-2 text-xl leading-none hover:bg-ink/5">
          ×
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-2xl font-semibold">{formatAed(unit.priceAed, locale)}</p>
        <Pill color={tokens.colors.availability[unit.availability]}>{tu(`availability.${unit.availability}`)}</Pill>
      </div>

      <div className="mt-6">
        <div className="flex gap-1.5">
          {photos.slice(0, 3).map((p, i) => (
            <button key={p.base} type="button" onClick={() => setSheet('interiors')} className="relative h-20 flex-1 overflow-hidden rounded-[10px]" aria-label={tr(`photo.${p.key}`)}>
              <img src={src(p, 800)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 hover:scale-105" />
              {i === 2 && photos.length > 3 && <span className="absolute inset-0 grid place-items-center bg-night/45 text-sm text-ivory">+{photos.length - 3}</span>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setSheet('plan')} className="mt-2 block w-full rounded-[12px] bg-ivory p-2 ring-1 ring-night/5 transition hover:ring-champagne/60" aria-label={tr('openPlan')}>
          <FloorPlan plan={plan} compact viewLabel={tr('viewSide', { view: tu(`view.${unit.view}`) })} className="max-h-[240px] w-full" />
        </button>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => tour.open({ kind: 'residence', type: unit.type, unit })} className="rounded-pill bg-night px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-ivory transition hover:bg-night-soft rtl:tracking-normal">
            {tr('tour.open')} →
          </button>
          <button type="button" onClick={() => setSheet('plan')} className="text-xs font-medium text-champagne-dark hover:underline">
            {tr('openPlan')} →
          </button>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <p className="text-xs uppercase text-ink-muted">{t('plans')}</p>
        <ul className="mt-2 space-y-1 text-sm">
          {plans.map((p) => (
            <li key={p.id}>• {locale === 'ar' ? p.nameAr : p.name}</li>
          ))}
        </ul>
      </div>

      <div className="mt-8 grid gap-2">
        <Link href={{ pathname: '/calculator', query: { unit: unit.id } }} className="rounded-pill bg-brand px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-dark">
          {t('calculate')}
        </Link>
        <button
          type="button"
          disabled={!canEnquire}
          onClick={() => {
            chat.open({ unitId: unit.id, unitCode: unit.code });
            onClose();
          }}
          className="rounded-pill border border-ink/15 px-5 py-2.5 text-sm hover:border-brand disabled:opacity-50"
        >
          {canEnquire ? t('enquire') : tu(`availability.${unit.availability}`)}
        </button>
      </div>
      <p className="mt-6 text-[11px] text-ink-muted">{project.disclaimer}</p>
      {sheet && <ResidenceSheet type={unit.type} unit={unit} initialTab={sheet} onClose={() => setSheet(null)} />}
      {tour.overlay}
    </aside>
  );
}
