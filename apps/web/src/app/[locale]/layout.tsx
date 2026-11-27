import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChatProvider } from '@/features/chat-widget';
import { SiteFooter, SiteHeader } from '@/features/site';
import { routing } from '@/i18n/routing';
import { arabic, display, sans } from '../fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Azure Crest Residences — Sample Project',
  description: 'Waterfront residences above the shoreline. Genesis Studio sales cockpit demo (fictional project).',
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
  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${display.variable} ${sans.variable} ${arabic.variable}`}>
      <body className="min-h-screen">
        <NextIntlClientProvider messages={messages}>
          <SiteHeader />
          <ChatProvider>{children}</ChatProvider>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
