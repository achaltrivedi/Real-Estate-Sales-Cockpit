import { setRequestLocale } from 'next-intl/server';
import { ExplorerView } from '@/features/explorer';

export default async function ExplorerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ExplorerView />;
}
