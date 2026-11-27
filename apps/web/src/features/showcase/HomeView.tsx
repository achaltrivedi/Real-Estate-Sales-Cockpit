'use client';

import { formatAed, formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Link } from '@/i18n/routing';
import { inventoryStats } from '@/features/explorer';
import { useReveal } from '@/features/site';
import { useInventory } from '@/lib/use-inventory';
import { CinematicHero } from './CinematicHero';
import { Experience3D } from './Experience3D';
import { planSplit, residenceSummary } from './residences';

/** Home: cinematic arrival → the address → the model in 3D → residences → payment plans. */
export function HomeView() {
  const t = useTranslations('home');
  const tu = useTranslations('units');
  const locale = useLocale();
  const inv = useInventory();
  const units = inv.status === 'ready' ? inv.data.units : [];
  const stats = useMemo(() => inventoryStats(units), [units]);
  const residences = useMemo(() => residenceSummary(units), [units]);
  useReveal([inv.status]);

  const project = inv.status === 'ready' ? inv.data.project : null;
  const plans = inv.status === 'ready' ? inv.data.paymentPlans : [];

  return (
    <main>
      <CinematicHero eyebrow={locale === 'en' ? project?.location : undefined} />

      {/* The address */}
      <section className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-36">
        <p className="reveal eyebrow text-champagne-dark">{t('introEyebrow')}</p>
        <p className="reveal mt-6 max-w-5xl font-display text-[clamp(2rem,4.4vw,3.9rem)] font-light leading-[1.12] text-night">
          {t('introStatement')}
        </p>
        <dl className="reveal mt-16 grid grid-cols-2 gap-y-10 border-t border-night/10 pt-10 md:grid-cols-4">
          <Stat label={t('from')} value={stats.fromPriceAed ? formatAed(stats.fromPriceAed, locale) : '—'} />
          <Stat label={t('available')} value={inv.status === 'ready' ? `${formatNumber(stats.available, locale)} / ${formatNumber(stats.total, locale)}` : '—'} />
          <Stat label={t('handoverLabel')} value={project?.handoverDate ?? '—'} />
          <Stat label={t('types')} value={stats.types.length ? `${tu('typeShort.studio')} – ${tu('typeShort.penthouse')}` : '—'} />
        </dl>
        {inv.status === 'error' && <p className="mt-8 text-sm text-ink-muted">{t('apiDown')}</p>}
      </section>

      <Experience3D units={units} />

      {/* Residences */}
      <section className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="reveal flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-champagne-dark">{t('residencesEyebrow')}</p>
            <h2 className="mt-4 font-display text-[clamp(2.4rem,5vw,4.2rem)] font-light leading-[1.02] text-night">{t('residencesTitle')}</h2>
          </div>
          <Link href="/explorer" className="btn-ghost-dark">
            {t('cta')}
          </Link>
        </div>
        <ul className="mt-14 divide-y divide-night/10 border-y border-night/10">
          {residences.map((r, i) => (
            <li key={r.type} className="reveal" style={{ transitionDelay: `${i * 70}ms` }}>
              <Link
                href={`/explorer?type=${r.type}`}
                className="group grid grid-cols-[1fr_auto] items-center gap-4 py-7 transition-colors duration-500 hover:bg-ivory-deep/60 md:grid-cols-[1.3fr_1fr_1fr_1fr_auto] md:px-4"
              >
                <span>
                  <span className="block font-display text-3xl font-light text-night md:text-4xl">{tu(`type.${r.type}`)}</span>
                  <span className="mt-1 block text-xs text-ink-muted md:hidden">
                    {t('from')} {formatAed(r.fromPriceAed, locale)} · {t('availableCount', { count: r.available })}
                  </span>
                </span>
                <span className="hidden text-sm text-ink-muted md:block">
                  {formatNumber(r.areaSqft[0], locale)}–{formatNumber(r.areaSqft[1], locale)} {tu('sqft')}
                </span>
                <span className="hidden text-sm text-ink-muted md:block">{t('availableCount', { count: r.available })}</span>
                <span className="hidden text-sm md:block">
                  <span className="text-ink-muted">{t('from')} </span>
                  {formatAed(r.fromPriceAed, locale)}
                </span>
                <span className="text-xl text-champagne transition-transform duration-500 ease-luxe group-hover:translate-x-1.5 rtl:rotate-180 rtl:group-hover:-translate-x-1.5">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Payment plans */}
      <section className="bg-ivory-deep">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 md:grid-cols-[1fr_1.2fr] md:px-8 md:py-32">
          <div className="reveal">
            <p className="eyebrow text-champagne-dark">{t('plansEyebrow')}</p>
            <h2 className="mt-4 font-display text-[clamp(2.4rem,5vw,4.2rem)] font-light leading-[1.02] text-night">{t('plansTitle')}</h2>
            <p className="mt-6 max-w-md text-ink-soft">{t('plansBody')}</p>
            <Link href="/calculator" className="btn-luxe mt-10">
              {t('calculator')}
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((p, i) => {
              const [pre, post] = planSplit(p);
              return (
                <div key={p.id} className="reveal rounded-[20px] bg-ivory p-8 ring-1 ring-night/5" style={{ transitionDelay: `${i * 90}ms` }}>
                  <p className="font-display text-6xl font-light text-night">
                    {pre}
                    <span className="text-champagne">/</span>
                    {post}
                  </p>
                  <p className="mt-4 text-sm text-ink-soft">{locale === 'ar' ? p.nameAr : p.name}</p>
                  <p className="mt-1 text-xs text-ink-muted">{t('planMilestones', { count: p.milestones.length })}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow text-ink-muted">{label}</dt>
      <dd className="mt-3 font-display text-2xl text-night md:text-3xl">{value}</dd>
    </div>
  );
}
