/** Design tokens: single source for web + dashboard (consumed via the Tailwind preset). */
export const tokens = {
  colors: {
    ink: { DEFAULT: '#0F1B2D', soft: '#3A4A63', muted: '#6B7A90' },
    sand: { DEFAULT: '#F6F1E8', deep: '#E9DFCC' },
    brand: { DEFAULT: '#0E7C86', dark: '#095961', light: '#D6F0F2' },
    gold: { DEFAULT: '#C8A55A' },
    /** Luxury layer (marketing surfaces): deep night, warm ivory, champagne metal. */
    night: { DEFAULT: '#0B1520', soft: '#14212E', line: '#24323F' },
    ivory: { DEFAULT: '#F8F5EF', deep: '#EFE8DC' },
    champagne: { DEFAULT: '#B8976A', light: '#D9C3A0', dark: '#8E7049' },
    availability: {
      available: '#1F9D55',
      reserved: '#D97706',
      sold: '#9CA3AF',
      hold: '#6366F1',
    },
    stage: {
      new: '#64748B',
      contacted: '#0EA5E9',
      qualified: '#0E7C86',
      viewing_booked: '#7C3AED',
      viewed: '#A855F7',
      reserved: '#16A34A',
      lost: '#DC2626',
    },
  },
  radius: { card: '16px', pill: '999px' },
  /** Families come from CSS variables set by each app's font loader (next/font). Each var() carries its own fallback because
   *  an undefined var() invalidates the whole font-family list (e.g. the dashboard loads no fonts). */
  font: {
    sans: ['var(--font-sans, system-ui)', 'var(--font-arabic, system-ui)', 'system-ui', 'sans-serif'],
    display: ['var(--font-display, Georgia)', 'var(--font-arabic, Georgia)', 'Georgia', 'serif'],
  },
  ease: { luxe: 'cubic-bezier(0.22, 1, 0.36, 1)' },
} as const;
