'use client';

import type { Unit } from '@gsc/contracts';
import { formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useInventory } from '@/lib/use-inventory';
import { AvailabilityLegend } from './AvailabilityLegend';
import { FilterBar } from './FilterBar';
import { EMPTY_FILTERS, filterUnits, inventoryStats, isFiltered, type UnitFilters } from './filters';
import { UnitDrawer } from './UnitDrawer';
import { UnitList } from './UnitList';
import { UnitViewer } from './UnitViewer';

export function ExplorerView() {
  const t = useTranslations('explorer');
  const locale = useLocale();
  const inv = useInventory();
  const [filters, setFilters] = useState<UnitFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Unit | null>(null);
  const close = useCallback(() => setSelected(null), []);

  const units = inv.status === 'ready' ? inv.data.units : [];
  const stats = useMemo(() => inventoryStats(units), [units]);
  const results = useMemo(() => filterUnits(units, filters), [units, filters]);
  const highlightIds = useMemo(() => (isFiltered(filters) ? new Set(results.map((u) => u.id)) : undefined), [filters, results]);

  if (inv.status === 'loading') return <p className="mx-auto max-w-7xl p-8">{t('loading')}</p>;
  if (inv.status === 'error') return <p className="mx-auto max-w-7xl p-8">{t('error')}</p>;
  const { project, paymentPlans } = inv.data;

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 pb-16 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">{t('title')}</h1>
          <p className="text-sm text-ink-muted">
            {t('results', { count: formatNumber(results.length, locale), total: formatNumber(stats.total, locale) })}
          </p>
        </div>
        <AvailabilityLegend counts={stats.byAvailability} />
      </div>

      <FilterBar value={filters} onChange={setFilters} stats={stats} project={project} />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <UnitViewer units={units} buildings={project.buildings} highlightIds={highlightIds} selectedUnitId={selected?.id} onSelect={setSelected} />
        <div className="lg:max-h-[560px] lg:overflow-y-auto lg:pe-1">
          <UnitList units={results} selectedUnitId={selected?.id} onSelect={setSelected} />
        </div>
      </div>

      {selected && <UnitDrawer unit={selected} project={project} paymentPlans={paymentPlans} onClose={close} />}
    </main>
  );
}
