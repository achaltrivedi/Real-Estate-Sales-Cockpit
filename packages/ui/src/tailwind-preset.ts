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
        avail: tokens.colors.availability,
        stage: tokens.colors.stage,
      },
      borderRadius: tokens.radius,
      fontFamily: { sans: [...tokens.font.sans], display: [...tokens.font.display] },
    },
  },
};
export default uiPreset;
