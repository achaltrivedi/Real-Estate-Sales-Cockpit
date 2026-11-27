'use client';

import type { Project, UnitType, UnitView } from '@gsc/contracts';
import { formatAed } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { EMPTY_FILTERS, isFiltered, toggle, type InventoryStats, type UnitFilters } from './filters';

interface Props {
  value: UnitFilters;
  onChange: (f: UnitFilters) => void;
  stats: InventoryStats;
  project: Project;
}

const chip = (active: boolean) =>
  `rounded-pill border px-3 py-1 text-xs font-medium transition ${
    active ? 'border-brand bg-brand text-white' : 'border-ink/15 bg-white text-ink hover:border-brand'
  }`;

export function FilterBar({ value, onChange, stats, project }: Props) {
  const t = useTranslations('explorer.filters');
  const tu = useTranslations('units');
  const locale = useLocale();
  const set = (patch: Partial<UnitFilters>) => onChange({ ...value, ...patch });
  const maxPrice = value.maxPrice ?? stats.priceRange[1];
  const minFloor = value.minFloor ?? stats.floorRange[0];

  return (
    <section aria-label={t('label')} className="space-y-3 rounded-card bg-white p-4 ring-1 ring-ink/5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-xs uppercase text-ink-muted">{t('type')}</span>
        {stats.types.map((ty: UnitType) => (
          <button key={ty} type="button" aria-pressed={value.types.includes(ty)} className={chip(value.types.includes(ty))} onClick={() => set({ types: toggle(value.types, ty) })}>
            {tu(`type.${ty}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-xs uppercase text-ink-muted">{t('view')}</span>
        {stats.views.map((v: UnitView) => (
          <button key={v} type="button" aria-pressed={value.views.includes(v)} className={chip(value.views.includes(v))} onClick={() => set({ views: toggle(value.views, v) })}>
            {tu(`view.${v}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-ink-muted">
          {t('building')}
          <select className="mt-1 block w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink" value={value.building} onChange={(e) => set({ building: e.target.value })}>
            <option value="all">{t('allBuildings')}</option>
            {project.buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          {t('maxPrice')}: <span className="font-semibold text-ink">{formatAed(maxPrice, locale)}</span>
          <input
            type="range"
            className="mt-2 block w-full accent-brand"
            min={stats.priceRange[0]}
            max={stats.priceRange[1]}
            step={50_000}
            value={maxPrice}
            onChange={(e) => set({ maxPrice: Number(e.target.value) >= stats.priceRange[1] ? null : Number(e.target.value) })}
          />
        </label>
        <label className="text-xs text-ink-muted">
          {t('minFloor')}: <span className="font-semibold text-ink">{minFloor}</span>
          <input
            type="range"
            className="mt-2 block w-full accent-brand"
            min={stats.floorRange[0]}
            max={stats.floorRange[1]}
            value={minFloor}
            onChange={(e) => set({ minFloor: Number(e.target.value) <= stats.floorRange[0] ? null : Number(e.target.value) })}
          />
        </label>
        <div className="flex items-end justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-brand" checked={value.availableOnly} onChange={(e) => set({ availableOnly: e.target.checked })} />
            {t('availableOnly')}
          </label>
          {isFiltered(value) && (
            <button type="button" className="text-xs text-brand underline" onClick={() => onChange(EMPTY_FILTERS)}>
              {t('reset')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
