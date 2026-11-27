import { Card } from '@gsc/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { PROJECT_ID, api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const data = await api('getProject', { params: { id: PROJECT_ID } }).catch(() => null);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <p className="text-sm uppercase tracking-widest text-brand">{t('eyebrow')}</p>
      {data ? (
        <>
          <h1 className="mt-2 font-display text-5xl">{locale === 'ar' ? data.project.nameAr : data.project.name}</h1>
          <p className="mt-3 text-ink-soft">
            {data.project.location} · Handover {data.project.handoverDate}
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/explorer" className="rounded-pill bg-brand px-5 py-2.5 text-sm text-white">
              {t('cta')}
            </Link>
            <Link href="/calculator" className="rounded-pill border border-ink/15 px-5 py-2.5 text-sm">
              {t('calculator')}
            </Link>
          </div>
          <p className="mt-10 max-w-xl text-xs text-ink-muted">{data.project.disclaimer}</p>
        </>
      ) : (
        <Card className="mt-6">{t('apiDown')}</Card>
      )}
      {/* TODO(Dev A, Phase 1): features/showcase hero with the 3D masterplan + camera paths */}
    </main>
  );
}
