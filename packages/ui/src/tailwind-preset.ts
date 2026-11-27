import { tokens } from './tokens';

/** Shared Tailwind preset: `presets: [uiPreset]` in each app's tailwind.config.ts. */
const uiPreset = {
  theme: {
    extend: {
      colors: {
        ink: tokens.colors.ink,
        sand: tokens.colors.sand,
        brand: tokens.colors.brand,
        gold: tokens.colors.gold,
        night: tokens.colors.night,
        ivory: tokens.colors.ivory,
        champagne: tokens.colors.champagne,
        avail: tokens.colors.availability,
        stage: tokens.colors.stage,
      },
      borderRadius: tokens.radius,
      fontFamily: { sans: [...tokens.font.sans], display: [...tokens.font.display] },
      transitionTimingFunction: { luxe: tokens.ease.luxe },
      letterSpacing: { luxe: '0.32em' },
    },
  },
};
export default uiPreset;
