'use client';

import { canRender3d, prefersReducedMotion } from '@gsc/3d/capability';
import { formatAed, formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useInventory } from '@/lib/use-inventory';
import { inventoryStats } from '@/features/explorer';

const TowerScene = dynamic(() => import('@gsc/3d').then((m) => m.TowerScene), { ssr: false });

/** Landing hero: project story on the start side, auto-orbiting 3D tower on the other. */
export function ShowcaseHero() {
  const t = useTranslations('home');
  const tu = useTranslations('units');
  const locale = useLocale();
  const inv = useInventory();
  const [show3d, setShow3d] = useState(false);
  const [motion, setMotion] = useState(true);
  useEffect(() => {
    setShow3d(canRender3d());
    setMotion(!prefersReducedMotion());
  }, []);

  const units = inv.status === 'ready' ? inv.data.units : [];
  const stats = useMemo(() => inventoryStats(units), [units]);

  if (inv.status === 'error') return <p className="mx-auto max-w-7xl px-4 py-12">{t('apiDown')}</p>;

  const project = inv.status === 'ready' ? inv.data.project : null;

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-8 lg:grid-cols-[1fr_1.2fr] lg:py-12">
      <div>
        <p className="text-sm uppercase tracking-widest text-brand">{t('eyebrow')}</p>
        <h1 className="mt-2 font-display text-4xl leading-tight md:text-6xl">
          {project ? (locale === 'ar' ? project.nameAr : project.name) : ' '}
        </h1>
        {project && (
          <p className="mt-3 text-ink-soft">
            {project.location} · {t('handover', { date: project.handoverDate })}
          </p>
        )}

        <dl className="mt-8 grid grid-cols-3 gap-4">
          <Stat label={t('from')} value={stats.fromPriceAed ? formatAed(stats.fromPriceAed, locale) : '—'} />
          <Stat label={t('available')} value={`${formatNumber(stats.available, locale)} / ${formatNumber(stats.total, locale)}`} />
          <Stat label={t('types')} value={stats.types.map((ty) => tu(`typeShort.${ty}`)).join(' · ') || '—'} />
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/explorer" className="rounded-pill bg-brand px-6 py-3 text-sm font-medium text-white hover:bg-brand-dark">
            {t('cta')}
          </Link>
          <Link href="/calculator" className="rounded-pill border border-ink/15 bg-white px-6 py-3 text-sm">
            {t('calculator')}
          </Link>
        </div>
        {project && <p className="mt-8 max-w-md text-[11px] text-ink-muted">{project.disclaimer}</p>}
      </div>

      <div className="relative h-[380px] overflow-hidden rounded-card ring-1 ring-ink/5 md:h-[520px]">
        {show3d && units.length > 0 ? (
          <TowerScene units={units} autoRotate={motion} className="h-full" />
        ) : (
          <div className="flex h-full items-end bg-gradient-to-t from-brand/30 to-sand p-6">
            <p className="text-sm text-ink-soft">{t('heroFallback')}</p>
          </div>
        )}
        <Link href="/explorer" className="absolute bottom-4 start-4 rounded-pill bg-white/90 px-4 py-2 text-xs font-medium shadow-sm backdrop-blur">
          {t('tapToExplore')}
        </Link>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold md:text-base">{value}</dd>
    </div>
  );
}
