/**
 * Decide whether to render real-time 3D. Fallback (2D stacking plan) when WebGL is missing,
 * the device reports low memory, or the user prefers reduced motion.
 */
export function canRender3d(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
  } catch {
    return false;
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem !== undefined && mem < 2) return false;
  return true;
}

export const isNarrowScreen = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
