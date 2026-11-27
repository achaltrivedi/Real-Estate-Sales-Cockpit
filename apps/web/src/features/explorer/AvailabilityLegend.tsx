'use client';

import type { Availability } from '@gsc/contracts';
import { formatNumber, tokens } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';

export function AvailabilityLegend({ counts }: { counts: Record<Availability, number> }) {
  const t = useTranslations('units.availability');
  const locale = useLocale();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
      {(Object.keys(counts) as Availability[]).map((a) => (
        <li key={a} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: tokens.colors.availability[a] }} />
          {t(a)} · {formatNumber(counts[a], locale)}
        </li>
      ))}
    </ul>
  );
}
