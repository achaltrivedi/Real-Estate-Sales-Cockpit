'use client';

import type { Unit } from '@gsc/contracts';
import { canRender3d, prefersReducedMotion } from '@gsc/3d/capability';
import { type Dive, unitDive } from '@gsc/3d/layout';
import { formatAed } from '@gsc/ui';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AMENITY_TOURS,
  INTERIORS,
  ResidenceSheet,
  TourOverlay,
  type TourRequest,
  firstPano,
  onTourRequest,
  src,
  useEscapeLayer,
  useScrollLock,
  viewpointCode,
} from '@/features/residence';
import { Link } from '@/i18n/routing';

const TowerScene = dynamic(() => import('@gsc/3d').then((m) => m.TowerScene), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-night-soft" />,
});

type Mode = 'architectural' | 'availability';
const LEGEND: Unit['availability'][] = ['available', 'reserved', 'sold', 'hold'];
const DOT: Record<Unit['availability'], string> = {
  available: 'bg-avail-available',
  reserved: 'bg-avail-reserved',
  sold: 'bg-avail-sold',
  hold: 'bg-avail-hold',
};

/**
 * The real-time model: an inline stage on the page and a full-screen mode.
 * The same TowerScene element stays mounted when toggling, so the camera and selection carry over.
 * three.js is only downloaded once this section approaches the viewport.
 */
export function Experience3D({ units }: { units: Unit[] }) {
  const t = useTranslations('experience');
  const tu = useTranslations('units');
  const locale = useLocale();
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [supported, setSupported] = useState(true);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState<Mode>('architectural');
  const [selected, setSelected] = useState<Unit | null>(null);
  const [inside, setInside] = useState(false);
  const tr = useTranslations('residence');
  /** The camera flying into a residence / amenity, then its 360° tour. `external`: asked for from elsewhere on the page. */
  const [dive, setDive] = useState<{ request: TourRequest; to: Dive; external: boolean } | null>(null);
  const [tour, setTour] = useState<{ request: TourRequest; external: boolean } | null>(null);

  useEffect(() => {
    setSupported(canRender3d());
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const close = useCallback(() => {
    setFull(false);
    setSelected(null);
    setDive(null);
  }, []);
  useEscapeLayer(full, close);
  useScrollLock(full);

  /** Fly into a residence or amenity, then open its tour (straight away with reduced motion). */
  const startTour = useCallback(
    (request: TourRequest, external: boolean) => {
      let to: Dive;
      if (request.kind === 'residence') {
        const unit = request.unit ?? units.find((u) => u.code === viewpointCode(request.type));
        if (!unit) return false;
        to = unitDive(unit);
      } else {
        to = AMENITY_TOURS[request.key].fly;
      }
      new Image().src = firstPano(request); // warm the cache during the flight
      if (prefersReducedMotion()) {
        setTour({ request, external });
        return true;
      }
      setNear(true);
      setFull(true);
      setInside(false);
      setDive({ request, to, external });
      return true;
    },
    [units],
  );

  useEffect(() => (supported ? onTourRequest((req) => startTour(req, true)) : undefined), [supported, startTour]);

  const diveRef = useRef(dive);
  diveRef.current = dive;
  const arrive = useCallback(() => {
    const d = diveRef.current;
    if (d) setTour((cur) => cur ?? { request: d.request, external: d.external });
  }, []);
  // Never strand the visitor mid-flight (slow model download, background tab).
  useEffect(() => {
    if (!dive || tour) return;
    const id = setTimeout(arrive, 4500);
    return () => clearTimeout(id);
  }, [dive, tour, arrive]);

  const endTour = useCallback(() => {
    const external = tour?.external;
    setTour(null);
    setDive(null);
    if (external) {
      setFull(false);
      setSelected(null);
    }
  }, [tour]);

  const onSelect = (u: Unit) => {
    setSelected(u);
    if (!full) setFull(true);
    setMode('availability');
  };

  const toggle = (m: Mode) =>
    `rounded-pill px-4 py-1.5 text-[11px] uppercase tracking-[0.18em] transition ${mode === m ? 'bg-ivory text-night' : 'text-ivory/70 hover:text-ivory'}`;

  return (
    <section id="experience" ref={section} className="bg-night py-24 text-ivory md:py-32">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="reveal grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
          <div>
            <p className="eyebrow text-champagne">{t('eyebrow')}</p>
            <h2 className="mt-4 font-display text-[clamp(2.4rem,5vw,4.2rem)] font-light leading-[1.02]">{t('title')}</h2>
          </div>
          <p className="max-w-md text-ivory/65 md:justify-self-end">{t('body')}</p>
        </div>

        {/* The reveal animation lives on a wrapper whose class never changes: the stage's own class flips for
            full screen, and React rewriting it would drop the `is-in` that useReveal added (stage stuck at opacity 0). */}
        <div className="reveal mt-12">
        <div
          className={
            full
              ? 'fixed inset-0 z-[70] bg-night'
              : 'relative aspect-[4/5] overflow-hidden rounded-[22px] ring-1 ring-white/10 sm:aspect-[16/9]'
          }
          role={full ? 'dialog' : undefined}
          aria-modal={full || undefined}
          aria-label={full ? t('title') : undefined}
        >
          {supported && near ? (
            <TowerScene
              units={units}
              colorMode={mode}
              autoRotate={!full && !selected}
              selectedUnitId={selected?.id}
              onSelect={onSelect}
              dive={dive?.to ?? null}
              onDiveEnd={arrive}
              paused={!!tour}
              className="absolute inset-0"
            />
          ) : (
            <img src="/cinematic/landscape/A-bg.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
          )}

          {/* Controls */}
          <div className={`absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 ${full ? 'pt-[max(16px,env(safe-area-inset-top))] md:p-6' : ''}`}>
            <div className="flex rounded-pill bg-night/70 p-1 backdrop-blur-md">
              <button type="button" className={toggle('architectural')} onClick={() => setMode('architectural')} aria-pressed={mode === 'architectural'}>
                {t('modeArchitecture')}
              </button>
              <button type="button" className={toggle('availability')} onClick={() => setMode('availability')} aria-pressed={mode === 'availability'}>
                {t('modeAvailability')}
              </button>
            </div>
            {full ? (
              <button type="button" onClick={close} className="rounded-pill bg-night/70 px-5 py-2 text-[11px] uppercase tracking-[0.18em] backdrop-blur-md hover:bg-night">
                {t('close')} ✕
              </button>
            ) : (
              supported && (
                <button type="button" onClick={() => setFull(true)} className="rounded-pill bg-ivory px-5 py-2 text-[11px] uppercase tracking-[0.18em] text-night hover:bg-champagne-light">
                  {t('fullscreen')} ⤢
                </button>
              )
            )}
          </div>

          {mode === 'availability' && (
            <ul className="absolute bottom-4 start-4 flex flex-wrap gap-x-4 gap-y-1 rounded-pill bg-night/70 px-4 py-2 text-[11px] text-ivory/80 backdrop-blur-md">
              {LEGEND.map((a) => (
                <li key={a} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${DOT[a]}`} />
                  {tu(`availability.${a}`)}
                </li>
              ))}
            </ul>
          )}

          {!supported && <p className="absolute inset-x-0 bottom-6 text-center text-sm text-ivory/70">{t('unsupported')}</p>}

          {full && selected && !dive && (
            <div className="absolute bottom-16 end-4 w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-[18px] bg-ivory text-night shadow-2xl md:bottom-6 md:end-6">
              <button
                type="button"
                onClick={() => startTour({ kind: 'residence', type: selected.type, unit: selected }, false)}
                className="group relative block h-32 w-full overflow-hidden"
                aria-label={tr('stepInside')}
              >
                <img src={src(INTERIORS[selected.type][0]!, 800)} alt="" className="h-full w-full object-cover transition duration-1000 ease-luxe group-hover:scale-105" />
                <span className="absolute inset-0 bg-gradient-to-t from-night/60 to-transparent" />
                <span className="absolute bottom-3 start-4 rounded-pill bg-ivory/90 px-3.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-night rtl:tracking-normal">
                  {tr('stepInside')} · 360° →
                </span>
              </button>
              <div className="p-5">
              <p className="eyebrow text-champagne-dark">{tu(`type.${selected.type}`)}</p>
              <p className="mt-1 font-display text-3xl">{selected.code}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {tu('floor')} {selected.floor} · {tu(`view.${selected.view}`)} · {selected.areaSqft.toLocaleString(locale)} {tu('sqft')}
              </p>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-lg font-medium">{formatAed(selected.priceAed, locale)}</span>
                <span className="text-xs text-ink-muted">{tu(`availability.${selected.availability}`)}</span>
              </div>
              <button type="button" onClick={() => setInside(true)} className="mt-3 text-xs text-champagne-dark underline-offset-4 hover:underline">
                {tr('tour.planGallery')}
              </button>
              <div className="mt-4 flex gap-2">
                <Link href={`/explorer?unit=${selected.id}`} className="flex-1 rounded-pill bg-night py-2.5 text-center text-[11px] uppercase tracking-[0.16em] text-ivory">
                  {t('details')}
                </Link>
                <Link href={`/calculator?unit=${selected.id}`} className="flex-1 rounded-pill border border-night/20 py-2.5 text-center text-[11px] uppercase tracking-[0.16em]">
                  {t('plan')}
                </Link>
              </div>
              </div>
            </div>
          )}
          {full && selected && inside && <ResidenceSheet type={selected.type} unit={selected} onClose={() => setInside(false)} />}
          {/* The flight ends at the glass: dim the model as the interior comes up. */}
          <div className={`pointer-events-none absolute inset-0 bg-night transition-opacity duration-700 ease-luxe ${tour ? 'opacity-100' : 'opacity-0'}`} />
        </div>
        </div>
        {!full && <p className="mt-4 text-center text-xs text-ivory/45">{t('hint')}</p>}
        {tour && <TourOverlay request={tour.request} onClose={endTour} />}
      </div>
    </section>
  );
}
