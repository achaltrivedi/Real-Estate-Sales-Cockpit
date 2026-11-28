'use client';

import { canRender3d, isNarrowScreen, prefersReducedMotion } from '@gsc/3d/capability';
import type { PanoHotspot } from '@gsc/3d/pano';
import { formatNumber } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FloorPlan } from './FloorPlan';
import { type ResolvedPlan, planFor } from './floorplans';
import { useEscapeLayer, useScrollLock } from './layers';
import { AMENITY_TOURS, RESIDENCE_TOURS, TOUR_TYPE, type TourRequest, type TourStop, bearing, panoUrl } from './tour';

const PanoViewer = dynamic(() => import('@gsc/3d/pano').then((m) => m.PanoViewer), { ssr: false });

const AMENITY_LABELS = new Set(['arrival', 'lounge', 'bar', 'pool', 'relax', 'studio', 'deck', 'boardwalk']);

interface Resolved {
  group: string;
  stops: TourStop[];
  /** Residence plan for the mini map (stops are scaled onto it), or an amenity footprint. */
  plan: ResolvedPlan | null;
  size: [number, number];
  scale: number;
  eyebrow: string;
  disclaimer: string;
}

/** First panorama of a tour, for warming the cache while the camera flies in. */
export function firstPano(request: TourRequest): string {
  const big = typeof window !== 'undefined' && !isNarrowScreen();
  if (request.kind === 'residence') {
    const t = TOUR_TYPE[request.type];
    return panoUrl(t, RESIDENCE_TOURS[t][0]!.id, big ? 4096 : 2048);
  }
  return panoUrl(request.key, AMENITY_TOURS[request.key].stops[0]!.id, big ? 4096 : 2048);
}

/** Full-screen 360° tour of a residence type or an amenity: drag to look, hotspots and chips to move. */
export function TourOverlay({ request, onClose }: { request: TourRequest; onClose: () => void }) {
  const t = useTranslations('residence');
  const tu = useTranslations('units');
  const locale = useLocale();
  const [webgl, setWebgl] = useState(true);
  const [big, setBig] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setWebgl(canRender3d());
    setBig(!isNarrowScreen());
    setReduced(prefersReducedMotion());
    setMapOpen(!isNarrowScreen());
    closeRef.current?.focus();
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEscapeLayer(true, onClose);
  useScrollLock(true);

  const r = useMemo<Resolved>(() => {
    if (request.kind === 'residence') {
      const tt = TOUR_TYPE[request.type];
      const u = request.unit;
      const plan = planFor(request.type, u ? { bathrooms: u.bathrooms, areaSqft: u.areaSqft } : {});
      return {
        group: tt,
        stops: RESIDENCE_TOURS[tt],
        plan,
        size: [plan.width, plan.depth + plan.outdoor.depth],
        scale: plan.scale,
        eyebrow: u ? `${tu(`type.${request.type}`)} · ${u.code}` : tu(`type.${request.type}`),
        disclaimer: t('tour.disclaimer'),
      };
    }
    const a = AMENITY_TOURS[request.key];
    return { group: request.key, stops: a.stops, plan: null, size: a.size, scale: 1, eyebrow: t(`amenity.${request.key}.title`), disclaimer: t('tour.amenityDisclaimer') };
  }, [request, t, tu]);

  const [stopId, setStopId] = useState(r.stops[0]!.id);
  const stop = r.stops.find((s) => s.id === stopId) ?? r.stops[0]!;
  const [yaw, setYaw] = useState(stop.yaw ?? 0);
  const [view, setView] = useState({ yaw: stop.yaw ?? 0, hfov: 90 });

  const label = useCallback(
    (s: TourStop) => {
      const base = AMENITY_LABELS.has(s.label) ? t(`tour.stop.${s.label}`) : t(`room.${s.label}`);
      return s.n ? `${base} ${formatNumber(s.n, locale)}` : base;
    },
    [t, locale],
  );

  /** Walk to a stop: from a hotspot, keep facing the way you walked; from the chips or the map, its preset view. */
  const go = useCallback(
    (id: string, walk: boolean) => {
      const to = r.stops.find((s) => s.id === id);
      if (!to || to.id === stop.id) return;
      setYaw(walk ? bearing(stop.at, to.at) : (to.yaw ?? bearing(stop.at, to.at)));
      setStopId(to.id);
      setInteracted(true);
    },
    [r.stops, stop],
  );

  const size = big ? 4096 : 2048;
  const src = panoUrl(r.group, stop.id, size);
  const others = r.stops.filter((s) => s.id !== stop.id);
  const hotspots = useMemo<PanoHotspot[]>(
    () => others.map((s) => ({ id: s.id, bearing: bearing(stop.at, s.at), distance: Math.hypot(s.at[0] - stop.at[0], s.at[1] - stop.at[1]), label: label(s) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stop.id, r.group, label],
  );
  const preload = useMemo(() => others.map((s) => panoUrl(r.group, s.id, size)), [stop.id, r.group, size]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${r.eyebrow} · ${t('tour.title')}`}
      className={`fixed inset-0 z-[90] bg-night text-ivory transition-opacity duration-700 ease-luxe ${shown ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* The panorama */}
      <div className="absolute inset-0" onPointerDown={() => setInteracted(true)}>
        {webgl ? (
          <PanoViewer
            src={src}
            yaw={yaw}
            hotspots={hotspots}
            onHotspot={(id) => go(id, true)}
            onView={(y, h) => setView({ yaw: y, hfov: h })}
            onReady={() => setReady(true)}
            onError={() => setFailed(true)}
            preload={preload}
            reducedMotion={reduced}
            className="absolute inset-0"
          />
        ) : (
          <img src={panoUrl(r.group, stop.id, 2048)} alt="" onLoad={() => setReady(true)} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className={`pointer-events-none absolute inset-0 grid place-items-center bg-night transition-opacity duration-1000 ease-luxe ${ready ? 'opacity-0' : 'opacity-100'}`}>
          <p className={`eyebrow text-champagne ${failed ? '' : 'animate-pulse'}`}>{failed ? t('tour.unavailable') : t('tour.loading')}</p>
        </div>
      </div>

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-night/75 to-transparent px-5 pb-14 pt-[max(16px,env(safe-area-inset-top))] md:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow truncate text-champagne">
              {r.eyebrow} · {t('tour.title')}
            </p>
            <p className="mt-1 truncate font-display text-2xl font-light md:text-4xl" aria-live="polite">
              {label(stop)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="pointer-events-auto shrink-0 whitespace-nowrap rounded-pill bg-night/60 px-4 py-2 text-[11px] uppercase tracking-[0.18em] backdrop-blur-md hover:bg-night rtl:tracking-normal"
          >
            <span className="hidden sm:inline">{t('close')} </span>✕
          </button>
        </div>
      </div>

      {/* Hint */}
      {webgl && ready && (
        <p
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-night/55 px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] backdrop-blur-md transition-opacity duration-700 rtl:tracking-normal ${interacted ? 'opacity-0' : 'opacity-100'}`}
        >
          ⟲ {t('tour.hint')}
        </p>
      )}

      {/* Bottom: mini map + stops */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/80 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-16 md:px-6">
        <div className="flex items-end gap-4">
          <div className="pointer-events-auto hidden shrink-0 md:block">
            <MiniMap r={r} stop={stop} yaw={view.yaw} hfov={view.hfov} onPick={(id) => go(id, false)} label={label} open={mapOpen} onToggle={() => setMapOpen((o) => !o)} viewLabel={t('tour.view')} toggleLabel={t('floorPlan')} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="pointer-events-auto mb-2 md:hidden">
              <MiniMap r={r} stop={stop} yaw={view.yaw} hfov={view.hfov} onPick={(id) => go(id, false)} label={label} open={mapOpen} onToggle={() => setMapOpen((o) => !o)} viewLabel={t('tour.view')} toggleLabel={t('floorPlan')} />
            </div>
            <ul className="pointer-events-auto flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t('tour.rooms')}>
              {r.stops.map((s) => (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(s.id, false)}
                    aria-current={s.id === stop.id || undefined}
                    className={`whitespace-nowrap rounded-pill px-4 py-2 text-[11px] uppercase tracking-[0.16em] backdrop-blur-md transition rtl:tracking-normal ${
                      s.id === stop.id ? 'bg-ivory text-night' : 'bg-night/55 text-ivory/85 hover:bg-night/80'
                    }`}
                  >
                    {label(s)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-snug text-ivory/45">{r.disclaimer}</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface MiniMapProps {
  r: Resolved;
  stop: TourStop;
  yaw: number;
  hfov: number;
  onPick: (id: string) => void;
  label: (s: TourStop) => string;
  open: boolean;
  onToggle: () => void;
  viewLabel: string;
  toggleLabel: string;
}

/** Plan with every stop, the current one marked with the direction you are looking. */
function MiniMap({ r, stop, yaw, hfov, onPick, label, open, onToggle, viewLabel, toggleLabel }: MiniMapProps) {
  const [w, h] = r.size;
  const g = Math.max(0.8, Math.max(w, h) / 11);
  const grad = `cone-${useId().replace(/:/g, '')}`;
  const k = r.scale;
  const half = (Math.min(hfov, 120) / 2) * (Math.PI / 180);
  const at = (p: [number, number]): [number, number] => [p[0] * k, p[1] * k];
  const [cx, cy] = at(stop.at);
  const rad = 2.4 * g;
  const yr = (yaw * Math.PI) / 180;
  const pt = (b: number) => `${(cx + rad * Math.sin(b)).toFixed(3)} ${(cy + rad * Math.cos(b)).toFixed(3)}`;
  const cone = `M ${cx} ${cy} L ${pt(yr + half)} A ${rad} ${rad} 0 0 1 ${pt(yr - half)} Z`;

  const overlay = (
    <g>
      <defs>
        <radialGradient id={grad}>
          <stop offset="0" stopColor="#C8A55A" stopOpacity="0.75" />
          <stop offset="1" stopColor="#C8A55A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={cone} fill={`url(#${grad})`} />
      {r.stops.map((s) => {
        const [x, y] = at(s.at);
        const cur = s.id === stop.id;
        return (
          <g key={s.id} onClick={() => onPick(s.id)} style={{ cursor: cur ? 'default' : 'pointer' }} role="button" aria-label={label(s)}>
            <circle cx={x} cy={y} r={0.55 * g} fill="transparent" />
            <circle cx={x} cy={y} r={(cur ? 0.26 : 0.2) * g} fill={cur ? '#C8A55A' : '#0B1622'} stroke="#F7F3EC" strokeWidth={0.07 * g} />
          </g>
        );
      })}
    </g>
  );

  return (
    <div className="w-[min(100%,260px)] overflow-hidden rounded-[16px] bg-ivory/95 text-night shadow-2xl backdrop-blur-md md:w-[260px]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted rtl:tracking-normal">
        {toggleLabel}
        <span className={`transition ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {r.plan ? (
            <FloorPlan plan={r.plan} compact className="h-auto max-h-[200px] w-full">
              {overlay}
            </FloorPlan>
          ) : (
            <svg viewBox={`${-0.6 * g} ${-0.6 * g} ${w + 1.2 * g} ${h + 2 * g}`} className="h-auto max-h-[200px] w-full" style={{ direction: 'ltr' }}>
              <rect x={0} y={0} width={w} height={h} rx={0.4 * g} fill="#EFE9DF" stroke="#2A2A2A" strokeWidth={0.12 * g} />
              <path d={`M 0 ${h + 0.5 * g} Q ${w / 4} ${h + 0.2 * g} ${w / 2} ${h + 0.5 * g} T ${w} ${h + 0.5 * g}`} fill="none" stroke="#5E8E96" strokeWidth={0.1 * g} />
              <text x={w / 2} y={h + 1.25 * g} textAnchor="middle" fontSize={0.5 * g} fill="#8E7049" fontWeight={500} letterSpacing={0.04 * g}>
                {viewLabel}
              </text>
              {overlay}
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
