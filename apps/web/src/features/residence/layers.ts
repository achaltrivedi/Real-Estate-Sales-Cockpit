'use client';

import { useEffect, useRef } from 'react';

/**
 * Stacked full-screen layers (3D full screen → residence sheet → 360° tour): Escape closes only the top one.
 * Listens in the capture phase and stops the event there, so nothing underneath sees it.
 */
const stack: symbol[] = [];

export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const token = Symbol('layer');
    stack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== token) return;
      e.stopImmediatePropagation();
      cb.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

/** Lock page scroll while a full-screen layer is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
    };
  }, [active]);
}
