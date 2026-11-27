import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export function SiteFooter() {
  const t = useTranslations('footer');
  return (
    <footer className="bg-night text-ivory/70">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[1.4fr_1fr_1fr] md:px-8">
        <div>
          <p className="font-display text-3xl font-light text-ivory">Azure Crest</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed">{t('tagline')}</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="eyebrow text-champagne">{t('explore')}</p>
          <Link href="/explorer" className="block hover:text-ivory">
            {t('residences')}
          </Link>
          <Link href="/calculator" className="block hover:text-ivory">
            {t('plans')}
          </Link>
        </div>
        <div className="space-y-2 text-sm">
          <p className="eyebrow text-champagne">{t('gallery')}</p>
          <p>{t('galleryHours')}</p>
        </div>
      </div>
      <div className="border-t border-night-line">
        <p className="mx-auto max-w-7xl px-5 py-6 text-[11px] leading-relaxed text-ivory/45 md:px-8">{t('disclaimer')}</p>
      </div>
    </footer>
  );
}
