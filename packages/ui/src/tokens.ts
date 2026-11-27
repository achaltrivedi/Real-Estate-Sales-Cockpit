/** Design tokens: single source for web + dashboard (consumed via the Tailwind preset). */
export const tokens = {
  colors: {
    ink: { DEFAULT: '#0F1B2D', soft: '#3A4A63', muted: '#6B7A90' },
    sand: { DEFAULT: '#F6F1E8', deep: '#E9DFCC' },
    brand: { DEFAULT: '#0E7C86', dark: '#095961', light: '#D6F0F2' },
    gold: { DEFAULT: '#C8A55A' },
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
  font: {
    sans: ['Inter', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
    display: ['"Playfair Display"', 'Georgia', 'serif'],
  },
} as const;
