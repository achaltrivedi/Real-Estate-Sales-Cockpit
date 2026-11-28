'use client';

import { formatAed, formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Link } from '@/i18n/routing';
import { inventoryStats } from '@/features/explorer';
import { AmenitiesSection, ARRIVAL, FACADE, type Photo, ResidencesShowcase, src, srcSet } from '@/features/residence';
import { useReveal } from '@/features/site';
import { useInventory } from '@/lib/use-inventory';
import { CinematicHero } from './CinematicHero';
import { Experience3D } from './Experience3D';
import { planSplit, residenceSummary } from './residences';

/** Home: cinematic arrival → the address → the model in 3D → residences → amenities → payment plans. */
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

        <div className="mt-20 grid gap-5 md:mt-28 md:grid-cols-[1.65fr_1fr] md:items-end">
          <Figure photo={ARRIVAL} caption={t('arrivalCaption')} className="aspect-[16/10]" sizes="(min-width: 768px) 60vw, 100vw" />
          <Figure photo={FACADE} caption={t('facadeCaption')} className="aspect-[4/5]" sizes="(min-width: 768px) 36vw, 100vw" delay={120} />
        </div>
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
        <ResidencesShowcase residences={residences} units={units} />
      </section>

      <AmenitiesSection />

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

function Figure({ photo, caption, className, sizes, delay = 0 }: { photo: Photo; caption: string; className: string; sizes: string; delay?: number }) {
  return (
    <figure className="reveal" style={{ transitionDelay: `${delay}ms` }}>
      <div className={`overflow-hidden rounded-[22px] bg-ivory-deep ${className}`}>
        <img src={src(photo)} srcSet={srcSet(photo)} sizes={sizes} alt={caption} loading="lazy" className="h-full w-full object-cover" />
      </div>
      <figcaption className="mt-4 text-sm text-ink-muted">{caption}</figcaption>
    </figure>
  );
}
