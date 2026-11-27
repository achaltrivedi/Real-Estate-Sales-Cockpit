import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@gsc/contracts', '@gsc/ui'],
};
export default config;
