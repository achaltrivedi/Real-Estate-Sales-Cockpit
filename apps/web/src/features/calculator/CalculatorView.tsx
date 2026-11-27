'use client';

import type { Unit } from '@gsc/contracts';
import { Card, formatAed, formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useChat } from '@/features/chat-widget';
import { useInventory } from '@/lib/use-inventory';
import { buildSchedule, type PhaseKey } from './schedule';

const PHASES: PhaseKey[] = ['on_booking', 'construction', 'on_handover', 'post_handover'];
const PHASE_COLORS: Record<PhaseKey, string> = {
  on_booking: '#0E7C86',
  construction: '#5FB3BA',
  on_handover: '#C8A55A',
  post_handover: '#0F1B2D',
};

export function CalculatorView({ initialUnitId }: { initialUnitId?: string }) {
  const t = useTranslations('calculator');
  const tu = useTranslations('units');
  const locale = useLocale();
  const chat = useChat();
  const inv = useInventory();
  const [unitId, setUnitId] = useState<string | undefined>(initialUnitId);
  const [planId, setPlanId] = useState<string | undefined>();
  const bookingDate = useMemo(() => new Date(), []);

  const units = inv.status === 'ready' ? inv.data.units : [];
  const options = useMemo(
    () => units.filter((u) => u.availability === 'available' || u.id === initialUnitId).sort((a, b) => a.priceAed - b.priceAed),
    [units, initialUnitId],
  );
  const unit: Unit | undefined = units.find((u) => u.id === unitId) ?? options[0];
  const plans = inv.status === 'ready' && unit ? inv.data.paymentPlans.filter((p) => unit.paymentPlanIds.includes(p.id)) : [];
  const plan = plans.find((p) => p.id === planId) ?? plans[0];

  // When the unit changes, fall back to its first plan if the current one does not apply.
  useEffect(() => {
    if (plan && planId && plan.id !== planId) setPlanId(plan.id);
  }, [plan, planId]);

  const breakdown = useMemo(() => (unit && plan ? buildSchedule(unit.priceAed, plan, bookingDate) : null), [unit, plan, bookingDate]);
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', { month: 'short', year: 'numeric' }), [locale]);

  if (inv.status === 'loading') return <p className="mx-auto max-w-6xl p-8">{t('loading')}</p>;
  if (inv.status === 'error') return <p className="mx-auto max-w-6xl p-8">{t('error')}</p>;
  if (!unit || !plan || !breakdown) return <p className="mx-auto max-w-6xl p-8">{t('noUnits')}</p>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 pb-16 pt-4">
      <div>
        <h1 className="font-display text-3xl md:text-4xl">{t('title')}</h1>
        <p className="text-sm text-ink-muted">{t('subtitle')}</p>
      </div>

      <Card className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <label className="text-xs text-ink-muted">
          {t('unit')}
          <select
            className="mt-1 block w-full rounded-lg border border-ink/15 bg-white px-2 py-2 text-sm text-ink"
            value={unit.id}
            onChange={(e) => setUnitId(e.target.value)}
          >
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} · {tu(`type.${u.type}`)} · {tu(`view.${u.view}`)} · {formatAed(u.priceAed, locale)}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="text-xs text-ink-muted">{t('plan')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === plan.id}
                onClick={() => setPlanId(p.id)}
                className={`rounded-pill border px-3 py-1.5 text-xs font-medium ${p.id === plan.id ? 'border-brand bg-brand text-white' : 'border-ink/15 bg-white'}`}
              >
                {locale === 'ar' ? p.nameAr : p.name}
              </button>
            ))}
          </div>
        </fieldset>
      </Card>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {PHASES.filter((k) => breakdown.phases[k].count > 0).map((k) => (
          <Card key={k} className="p-4">
            <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: PHASE_COLORS[k] }} />
              {t(`phase.${k}`)}
            </p>
            <p className="mt-2 text-lg font-semibold">{formatAed(breakdown.phases[k].amountAed, locale)}</p>
            <p className="text-xs text-ink-muted">
              {formatNumber(breakdown.phases[k].percent, locale)}% · {t('payments', { count: breakdown.phases[k].count })}
            </p>
          </Card>
        ))}
      </section>

      <div className="flex h-3 overflow-hidden rounded-pill" aria-hidden>
        {PHASES.map((k) => (
          <div key={k} style={{ width: `${breakdown.phases[k].percent}%`, background: PHASE_COLORS[k] }} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-sand/60 text-start text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3 text-start">#</th>
                <th className="py-3 text-start">{t('milestone')}</th>
                <th className="py-3 text-start">{t('due')}</th>
                <th className="py-3 text-end">%</th>
                <th className="px-4 py-3 text-end">{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((r) => (
                <tr key={r.index} className="border-t border-ink/5">
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">{formatNumber(r.index, locale)}</td>
                  <td className="py-2.5">
                    <span className="me-2 inline-block h-2 w-2 rounded-full" style={{ background: PHASE_COLORS[r.trigger] }} />
                    {locale === 'ar' ? r.labelAr : r.label}
                  </td>
                  <td className="py-2.5 text-ink-soft">{monthFmt.format(r.due)}</td>
                  <td className="py-2.5 text-end tabular-nums">{formatNumber(r.percent, locale)}%</td>
                  <td className="px-4 py-2.5 text-end font-medium tabular-nums">{formatAed(r.amountAed, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="space-y-3 self-start">
          <Row label={t('price')} value={formatAed(breakdown.priceAed, locale)} />
          <Row label={t('dld', { pct: formatNumber(plan.dldFeePercent, locale) })} value={formatAed(breakdown.dldFeeAed, locale)} />
          <div className="border-t border-ink/10 pt-3">
            <Row label={t('total')} value={formatAed(breakdown.totalAed, locale)} strong />
          </div>
          <p className="text-xs text-ink-muted">{t('lastPayment', { date: monthFmt.format(breakdown.lastPaymentDue) })}</p>
          <button
            type="button"
            onClick={() => chat.open({ unitId: unit.id, unitCode: unit.code })}
            className="w-full rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            {t('enquire')}
          </button>
          <p className="text-[11px] text-ink-muted">{t('disclaimer')}</p>
        </Card>
      </div>
    </main>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className={strong ? 'text-lg font-semibold' : 'font-medium'}>{value}</span>
    </div>
  );
}
