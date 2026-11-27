import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  transpilePackages: ['@gsc/contracts', '@gsc/ui', '@gsc/3d'],
};
export default withNextIntl(config);
