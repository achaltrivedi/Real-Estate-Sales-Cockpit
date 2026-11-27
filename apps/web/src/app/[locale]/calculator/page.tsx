import { setRequestLocale } from 'next-intl/server';
import { CalculatorView } from '@/features/calculator';

export default async function CalculatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ unit?: string }>;
}) {
  const [{ locale }, { unit }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  return <CalculatorView initialUnitId={unit} />;
}
