import { Cormorant_Garamond, IBM_Plex_Sans_Arabic, Jost } from 'next/font/google';

/** Self-hosted at build time by next/font (no runtime request to Google). */
export const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});
export const sans = Jost({ subsets: ['latin'], weight: ['300', '400', '500'], variable: '--font-sans', display: 'swap' });
export const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['300', '400', '500'],
  variable: '--font-arabic',
  display: 'swap',
});
