'use client';

import { useCallback, useState } from 'react';
import { type TourRequest, requestTourDive } from './tour';
import { TourOverlay } from './TourOverlay';

/**
 * Open a 360° tour from anywhere: the page's live 3D model flies in first when there is one,
 * otherwise the tour opens straight away. Render `overlay` somewhere in the component.
 */
export function useTour() {
  const [request, setRequest] = useState<TourRequest | null>(null);
  /** Returns true when the page's 3D model took over (fly-in first), false when the tour opened here. */
  const open = useCallback((req: TourRequest, opts: { dive?: boolean } = {}) => {
    if (opts.dive !== false && requestTourDive(req)) return true;
    setRequest(req);
    return false;
  }, []);
  const overlay = request ? <TourOverlay request={request} onClose={() => setRequest(null)} /> : null;
  return { open, overlay };
}
