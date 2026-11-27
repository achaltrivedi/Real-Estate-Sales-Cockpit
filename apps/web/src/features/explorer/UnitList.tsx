'use client';

import type { Unit } from '@gsc/contracts';
import { formatAed, formatNumber, tokens } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';

interface Props {
  units: Unit[];
  selectedUnitId?: string;
  onSelect: (u: Unit) => void;
}

export function UnitList({ units, selectedUnitId, onSelect }: Props) {
  const t = useTranslations('explorer');
  const tu = useTranslations('units');
  const locale = useLocale();

  if (units.length === 0) return <p className="rounded-card bg-white p-6 text-center text-sm text-ink-muted">{t('noResults')}</p>;

  return (
    <ul className="space-y-2">
      {units.map((u) => (
        <li key={u.id}>
          <button
            type="button"
            onClick={() => onSelect(u)}
            aria-pressed={u.id === selectedUnitId}
            className={`flex w-full items-center justify-between gap-3 rounded-xl bg-white p-3 text-start ring-1 transition hover:ring-brand ${
              u.id === selectedUnitId ? 'ring-2 ring-brand' : 'ring-ink/5'
            }`}
          >
            <span>
              <span className="block text-sm font-semibold">
                {u.code} · {tu(`type.${u.type}`)}
              </span>
              <span className="block text-xs text-ink-muted">
                {tu('floor')} {formatNumber(u.floor, locale)} · {tu(`view.${u.view}`)} · {formatNumber(u.areaSqft, locale)} {tu('sqft')}
              </span>
            </span>
            <span className="text-end">
              <span className="block text-sm font-semibold">{formatAed(u.priceAed, locale)}</span>
              <span className="text-[11px] font-medium" style={{ color: tokens.colors.availability[u.availability] }}>
                {tu(`availability.${u.availability}`)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
