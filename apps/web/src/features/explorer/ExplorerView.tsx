'use client';

import type { Unit } from '@gsc/contracts';
import { formatAed } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PROJECT_ID, api } from '@/lib/api';

const TowerScene = dynamic(() => import('@gsc/3d').then((m) => m.TowerScene), { ssr: false });

/** Phase 0 skeleton. TODO(Dev A, Phase 1): filters (type/price/floor/view), unit detail drawer, mobile fallback. */
export function ExplorerView() {
  const t = useTranslations('explorer');
  const locale = useLocale();
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [selected, setSelected] = useState<Unit | null>(null);

  useEffect(() => {
    api('listUnits', { params: { id: PROJECT_ID } }).then((r) => setUnits(r.units));
  }, []);

  if (!units) return <p className="p-8">{t('loading')}</p>;

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-[2fr_1fr]">
      <TowerScene units={units} selectedUnitId={selected?.id} onSelect={setSelected} className="h-[520px] rounded-card bg-white" />
      <aside>
        <h1 className="font-display text-3xl">{t('title')}</h1>
        <p className="text-sm text-ink-muted">
          {units.length} {t('units')}
        </p>
        {selected && (
          <div className="mt-6 rounded-card bg-white p-5">
            <p className="text-lg font-semibold">{selected.code}</p>
            <p className="text-sm text-ink-soft">
              {selected.type} · {selected.view} · {selected.areaSqft} sqft
            </p>
            <p className="mt-2 text-xl">{formatAed(selected.priceAed, locale)}</p>
            <p className="text-xs uppercase text-ink-muted">{selected.availability}</p>
          </div>
        )}
      </aside>
    </main>
  );
}
