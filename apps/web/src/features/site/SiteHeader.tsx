'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { Monogram } from './Monogram';

/**
 * Fixed site chrome: sample-data notice (always visible, compliance) + navigation.
 * On the home page it floats transparent over the cinematic hero and turns solid once scrolled.
 */
export function SiteHeader() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const overHero = pathname === '/';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 3.2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overHero]);

  const solid = !overHero || scrolled;
  const link = `transition-colors duration-500 ${solid ? 'text-night/70 hover:text-night' : 'text-white/80 hover:text-white'}`;

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50">
        <div role="note" className="bg-night px-4 py-1.5 text-center text-[10px] tracking-[0.18em] text-champagne-light">
          {t('sample').toUpperCase()}
        </div>
        <header
          className={`transition-all duration-700 ease-luxe ${
            solid ? 'border-b border-night/5 bg-ivory/85 backdrop-blur-md' : 'bg-gradient-to-b from-night/45 to-transparent'
          }`}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
            <Link href="/" className={`flex items-center gap-3 ${solid ? 'text-night' : 'text-white'}`}>
              <Monogram className={`h-8 w-8 transition-colors duration-500 ${solid ? 'text-champagne-dark' : 'text-champagne-light'}`} />
              <span className="font-display text-2xl font-light tracking-wide">Azure Crest</span>
              <span className="eyebrow hidden opacity-70 sm:inline">{t('residences')}</span>
            </Link>
            <nav className="flex items-center gap-5 text-[12px] uppercase tracking-[0.2em] md:gap-8">
              <Link href="/explorer" className={`hidden sm:inline ${link}`}>
                {t('nav.explorer')}
              </Link>
              <Link href="/calculator" className={`hidden sm:inline ${link}`}>
                {t('nav.calculator')}
              </Link>
              <Link
                href={pathname}
                locale={locale === 'ar' ? 'en' : 'ar'}
                className={`rounded-pill border px-3 py-1 normal-case tracking-normal ${
                  solid ? 'border-night/15 text-night/70' : 'border-white/30 text-white/85'
                }`}
              >
                {t('switchLocale')}
              </Link>
            </nav>
          </div>
        </header>
      </div>
      {!overHero && <div aria-hidden className="h-[96px]" />}
    </>
  );
}
