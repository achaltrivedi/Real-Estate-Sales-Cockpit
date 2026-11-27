/** Locale-aware formatting. 'ar' uses Arabic-Indic digits via ar-AE. */
const tag = (locale: string) => (locale === 'ar' ? 'ar-AE' : 'en-AE');

export const formatAed = (amount: number, locale: string) =>
  new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(amount);

export const formatNumber = (n: number, locale: string) => new Intl.NumberFormat(tag(locale)).format(n);

export const formatDuration = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`);
