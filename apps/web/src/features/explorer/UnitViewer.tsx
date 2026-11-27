'use client';

import type { Project, Unit } from '@gsc/contracts';
import { canRender3d, isNarrowScreen } from '@gsc/3d/capability';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { StackingPlan } from './StackingPlan';

const TowerScene = dynamic(() => import('@gsc/3d').then((m) => m.TowerScene), {
  ssr: false,
  loading: () => <div className="h-full min-h-[360px] animate-pulse rounded-card bg-white/60" />,
});

type Mode = '3d' | 'plan';

interface Props {
  units: Unit[];
  buildings: Project['buildings'];
  highlightIds?: Set<string>;
  selectedUnitId?: string;
  onSelect: (u: Unit) => void;
}

/** 3D tower with a 2D stacking-plan fallback (default on phones, forced when WebGL is unavailable). */
export function UnitViewer(props: Props) {
  const t = useTranslations('explorer');
  const [supports3d, setSupports3d] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('3d');

  useEffect(() => {
    const ok = canRender3d();
    setSupports3d(ok);
    setMode(ok && !isNarrowScreen() ? '3d' : 'plan');
  }, []);

  const tab = (m: Mode) =>
    `rounded-pill px-3 py-1 text-xs font-medium ${mode === m ? 'bg-ink text-white' : 'text-ink-soft hover:bg-ink/5'}`;

  return (
    <div className="relative">
      <div className="absolute end-3 top-3 z-10 flex gap-1 rounded-pill bg-white/90 p-1 shadow-sm backdrop-blur">
        <button type="button" className={tab('3d')} disabled={!supports3d} onClick={() => setMode('3d')} aria-pressed={mode === '3d'}>
          {t('view3d')}
        </button>
        <button type="button" className={tab('plan')} onClick={() => setMode('plan')} aria-pressed={mode === 'plan'}>
          {t('viewPlan')}
        </button>
      </div>
      {supports3d === null ? (
        <div className="h-[420px] animate-pulse rounded-card bg-white/60 md:h-[560px]" />
      ) : mode === '3d' ? (
        <TowerScene {...props} className="h-[420px] overflow-hidden rounded-card ring-1 ring-ink/5 md:h-[560px]" />
      ) : (
        <StackingPlan {...props} className="max-h-[560px] pt-14" />
      )}
      {supports3d === false && <p className="mt-2 text-xs text-ink-muted">{t('no3d')}</p>}
    </div>
  );
}
