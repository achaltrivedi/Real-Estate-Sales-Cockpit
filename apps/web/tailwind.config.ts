import type { Config } from 'tailwindcss';
import uiPreset from '@gsc/ui/tailwind-preset';

export default {
  presets: [uiPreset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
