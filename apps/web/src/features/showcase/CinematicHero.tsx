'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/routing';
import manifest from '../../../public/cinematic/manifest.json';
import { diveState, layerCss, type Box, type LayerT, type Rect4 } from './dive';

/**
 * Full-screen scroll-dive hero built from photoreal Cycles renders (assets/models/source/cinematic.py).
 * A pinned stage plays one continuous camera move driven only by scroll; it reverses exactly on scroll-up.
 * Landscape and portrait render sets are picked by the same media query in CSS (<picture>) and JS.
 */

const BASE = '/cinematic';
const PORTRAIT_MQ = '(max-aspect-ratio: 1/1)';
type Orient = 'landscape' | 'portrait';
const CROWN: Record<Orient, Rect4> = {
  landscape: manifest.orientations.landscape.crown as Rect4,
  portrait: manifest.orientations.portrait.crown as Rect4,
};

function Layer({ file, priority, className, layerRef }: { file: string; priority?: boolean; className?: string; layerRef?: (el: HTMLElement | null) => void }) {
  return (
    <picture ref={layerRef} className={`dive-layer ${className ?? ''}`}>
      <source media={PORTRAIT_MQ} srcSet={`${BASE}/portrait/${file}`} />
      <img
        src={`${BASE}/landscape/${file}`}
        alt=""
        decoding="async"
        draggable={false}
        fetchPriority={priority ? 'high' : 'auto'}
        className="h-full w-full select-none"
      />
    </picture>
  );
}

export function CinematicHero({ eyebrow }: { eyebrow?: string }) {
  const t = useTranslations('hero');
  const track = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const els = useRef<Record<string, HTMLElement | null>>({});
  const intro = useRef<HTMLDivElement>(null);
  const outro = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setStill(reduce);
    const portraitMq = window.matchMedia(PORTRAIT_MQ);
    let box: Box = { vw: 1, vh: 1, fw: 1, fh: 1 };
    let orient: Orient = 'landscape';
    let shown = -1;
    let target = 0;
    let current = 0;
    let raf = 0;
    let last = performance.now();

    const measure = () => {
      orient = portraitMq.matches ? 'portrait' : 'landscape';
      const r = frame.current?.getBoundingClientRect();
      box = { vw: window.innerWidth, vh: window.innerHeight, fw: r?.width ?? 1, fh: r?.height ?? 1 };
      shown = -1;
    };
    const readScroll = () => {
      const el = track.current;
      if (!el) return 0;
      const span = el.offsetHeight - window.innerHeight;
      const p = span > 0 ? (window.scrollY - el.offsetTop) / span : 0;
      return Math.min(1, Math.max(0, (p - 0.02) / 0.96));
    };

    const apply = (u: number) => {
      const s = diveState(u, CROWN[orient], box);
      const origin = `${(s.origin[0] * 100).toFixed(2)}% ${(s.origin[1] * 100).toFixed(2)}%`;
      const set = (key: string, l: LayerT, o = origin) => {
        const el = els.current[key];
        if (!el) return;
        el.style.transformOrigin = o;
        el.style.transform = layerCss(l);
        el.style.opacity = l.o.toFixed(3);
      };
      set('bg', s.bg);
      set('towers', s.towers);
      set('mid', s.mid);
      set('fgL', s.fgLeft, '25% 100%');
      set('fgR', s.fgRight, '75% 100%');
      set('view', s.view, '50% 45%');
      set('terrace', s.terrace, '50% 100%');
      const p = portal.current;
      if (p) {
        const q = s.portal;
        p.style.clipPath = `inset(${q.top.toFixed(1)}px ${q.right.toFixed(1)}px ${q.bottom.toFixed(1)}px ${q.left.toFixed(1)}px round ${q.radius.toFixed(1)}px)`;
        p.style.opacity = q.o.toFixed(3);
        p.style.visibility = q.o > 0 ? 'visible' : 'hidden';
      }
      if (intro.current) {
        intro.current.style.opacity = s.intro.toFixed(3);
        intro.current.style.transform = `translate3d(0, ${(-40 * (1 - s.intro)).toFixed(1)}px, 0)`;
      }
      if (outro.current) {
        outro.current.style.opacity = s.outro.toFixed(3);
        outro.current.style.transform = `translate3d(0, ${(24 * (1 - s.outro)).toFixed(1)}px, 0)`;
        outro.current.style.pointerEvents = s.outro > 0.6 ? 'auto' : 'none';
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      target = readScroll();
      current += (target - current) * (1 - Math.exp(-dt * 7.5)); // inertial smoothing, no scroll hijack
      if (Math.abs(target - current) < 0.0002) current = target;
      if (Math.abs(current - shown) > 0.00001) {
        apply(current);
        shown = current;
      }
      raf = requestAnimationFrame(tick);
    };

    measure();
    const onResize = () => {
      measure();
      apply(reduce ? 0 : current);
    };
    window.addEventListener('resize', onResize);
    portraitMq.addEventListener('change', onResize);
    if (reduce) {
      apply(0);
    } else {
      current = target = readScroll();
      apply(current);
      raf = requestAnimationFrame(tick);
    }

    // Reveal as soon as the sky + towers have decoded (5 s failsafe); the rest stream in behind.
    const imgs = Array.from(frame.current?.querySelectorAll<HTMLImageElement>('img[fetchpriority="high"]') ?? []);
    const done = () => setReady(true);
    const failsafe = window.setTimeout(done, 5000);
    Promise.allSettled(imgs.map((i) => i.decode())).then(() => {
      window.clearTimeout(failsafe);
      done();
    });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(failsafe);
      window.removeEventListener('resize', onResize);
      portraitMq.removeEventListener('change', onResize);
    };
  }, []);

  const ref = (key: string) => (el: HTMLElement | null) => {
    els.current[key] = el;
  };

  return (
    <section ref={track} className="dive-track relative bg-night" style={{ height: still ? '100svh' : '420svh' }} aria-label={t('aria')}>
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div className={`absolute inset-0 transition-opacity duration-[1200ms] ease-luxe ${ready ? 'opacity-100' : 'opacity-0'}`}>
          {/* Shot A: across the lagoon */}
          <div ref={frame} className="dive-frame">
            <Layer file="A-bg.webp" priority layerRef={ref('bg')} />
            <Layer file="A-towers.webp" priority layerRef={ref('towers')} />
            <Layer file="A-mid.webp" layerRef={ref('mid')} />
            <Layer file="A-fg.webp" layerRef={ref('fgL')} className="[clip-path:inset(0_50%_0_0)]" />
            <Layer file="A-fg.webp" layerRef={ref('fgR')} className="[clip-path:inset(0_0_0_50%)]" />
          </div>
          {/* Shot C: the sky terrace, revealed through the crown */}
          <div ref={portal} className="absolute inset-0 invisible" style={{ willChange: 'clip-path, opacity' }}>
            <div className="dive-frame">
              <Layer file="C-view.webp" layerRef={ref('view')} />
              <Layer file="C-terrace.webp" layerRef={ref('terrace')} />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-night/70 via-night/10 to-transparent" />
          </div>
        </div>

        {/* Opening title */}
        <div ref={intro} className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/55 via-night/15 to-transparent px-5 pb-[max(28px,6vh)] pt-40 text-white md:px-12">
          <div className="mx-auto max-w-7xl">
            <p className={`eyebrow text-champagne-light transition-all delay-300 duration-[1400ms] ease-luxe ${ready ? 'opacity-100' : 'translate-y-3 opacity-0'}`}>
              {eyebrow ?? t('eyebrow')}
            </p>
            <h1 className={`mt-4 font-display text-[clamp(3.2rem,9vw,8.5rem)] font-light leading-[0.92] tracking-tight transition-all delay-500 duration-[1600ms] ease-luxe ${ready ? 'opacity-100' : 'translate-y-6 opacity-0'}`}>
              {t('title')}
              <span className="block ps-[0.6em] text-[0.42em] italic text-white/85">{t('subtitle')}</span>
            </h1>
            <div className={`mt-10 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-white/70 transition-opacity delay-1000 duration-1000 ${ready ? 'opacity-100' : 'opacity-0'}`}>
              <span className="relative block h-9 w-px overflow-hidden bg-white/25">
                <span className="absolute inset-x-0 top-0 h-3 animate-[cue_2.2s_ease-in-out_infinite] bg-white" />
              </span>
              {t('scroll')}
            </div>
          </div>
        </div>

        {/* Closing line, over the terrace */}
        <div ref={outro} className="absolute inset-x-0 bottom-0 px-5 pb-[max(40px,9vh)] text-center text-white opacity-0 md:px-12" style={{ pointerEvents: 'none' }}>
          <p className="eyebrow text-champagne-light">{t('outroEyebrow')}</p>
          <p className="mx-auto mt-4 max-w-3xl font-display text-[clamp(2.2rem,5vw,4.4rem)] font-light leading-[1.05]">{t('outro')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/explorer" className="btn-luxe">
              {t('ctaExplore')}
            </Link>
            <a href="#experience" className="btn-ghost-light">
              {t('cta3d')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
