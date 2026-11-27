import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function CalculatorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('calculator');
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">{t('title')}</h1>
      {/* TODO(Dev A, Phase 2): features/calculator — down payment, instalments, handover, post-handover, DLD fee.
          Data: api('getProject') → paymentPlans (milestones sum to 100%, enforced by the contract). */}
    </main>
  );
}
