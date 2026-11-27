import { SampleDataBanner } from '@gsc/ui';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Link, routing } from '@/i18n/routing';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Azure Crest Residences — Sample Project',
  description: 'Genesis Studio real estate sales cockpit demo (fictional project).',
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();
  setRequestLocale(locale);
  const [messages, t] = await Promise.all([getMessages(), getTranslations('common')]);
  const other = locale === 'ar' ? 'en' : 'ar';

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className="min-h-screen">
        <NextIntlClientProvider messages={messages}>
          <SampleDataBanner text={t('sample')} />
          <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="font-display text-xl">
              Azure Crest
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/explorer" className="hover:text-brand">
                {t('nav.explorer')}
              </Link>
              <Link href="/calculator" className="hover:text-brand">
                {t('nav.calculator')}
              </Link>
              <Link href="/" locale={other} className="rounded-pill border border-ink/15 px-3 py-1 text-ink-soft">
                {t('switchLocale')}
              </Link>
            </nav>
          </header>
          {children}
          {/* TODO(Dev A, Phase 2): <ChatWidget /> from features/chat-widget mounts here */}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
