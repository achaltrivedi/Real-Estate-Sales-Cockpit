'use client';

import type { PaymentPlan, Project, Unit } from '@gsc/contracts';
import { Pill, formatAed, formatNumber, tokens } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      className="fixed inset-x-0 bottom-0 z-30 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-[400px] md:rounded-none"
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
        {/* TODO(Dev A, Phase 2): open the chat widget with this unit pre-selected (createLead.unitId). */}
        <button type="button" disabled={!canEnquire} className="rounded-pill border border-ink/15 px-5 py-2.5 text-sm disabled:opacity-50" title={t('enquireSoon')}>
          {canEnquire ? t('enquire') : tu(`availability.${unit.availability}`)}
        </button>
      </div>
      <p className="mt-6 text-[11px] text-ink-muted">{project.disclaimer}</p>
    </aside>
  );
}
