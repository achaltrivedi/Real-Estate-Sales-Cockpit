'use client';

import type { Project, Unit } from '@gsc/contracts';
import { tokens } from '@gsc/ui';

interface Props {
  units: Unit[];
  buildings: Project['buildings'];
  highlightIds?: Set<string>;
  selectedUnitId?: string;
  onSelect: (u: Unit) => void;
  className?: string;
}

/**
 * 2D stacking plan: floors × units, coloured by availability.
 * Default view on phones and the automatic fallback when WebGL is unavailable.
 */
export function StackingPlan({ units, buildings, highlightIds, selectedUnitId, onSelect, className }: Props) {
  return (
    <div className={`flex gap-6 overflow-auto rounded-card bg-white p-4 ring-1 ring-ink/5 ${className ?? ''}`}>
      {buildings.map((b) => {
        const mine = units.filter((u) => u.building === b.id);
        const floors = [...new Set(mine.map((u) => u.floor))].sort((x, y) => y - x);
        return (
          <div key={b.id} className="min-w-[150px] flex-1">
            <p className="mb-2 text-center text-xs font-semibold text-ink-soft">{b.name}</p>
            <div className="space-y-1">
              {floors.map((f) => (
                <div key={f} className="flex items-center gap-1">
                  <span className="w-6 shrink-0 text-end text-[10px] tabular-nums text-ink-muted">{f}</span>
                  {mine
                    .filter((u) => u.floor === f)
                    .sort((x, y) => x.code.localeCompare(y.code))
                    .map((u) => {
                      const dim = highlightIds && !highlightIds.has(u.id);
                      const sel = u.id === selectedUnitId;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          aria-label={`${u.code} ${u.type} ${u.availability}`}
                          aria-pressed={sel}
                          onClick={() => onSelect(u)}
                          className={`h-5 flex-1 rounded-sm transition ${sel ? 'ring-2 ring-gold ring-offset-1' : ''}`}
                          style={{ background: sel ? tokens.colors.gold.DEFAULT : tokens.colors.availability[u.availability], opacity: dim ? 0.15 : 1 }}
                        />
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
