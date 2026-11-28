'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { AMENITIES, src, srcSet } from './media';
import { AMENITY_TOURS, type AmenityKey } from './tour';
import { useTour } from './useTour';

/** Home "Amenities": a horizontal, snap-scrolling gallery on deep night. */
export function AmenitiesSection() {
  const t = useTranslations('residence');
  const th = useTranslations('home');
  const track = useRef<HTMLUListElement>(null);
  const tour = useTour();

  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section id="amenities" className="overflow-hidden bg-night py-24 text-ivory md:py-32">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="reveal grid gap-6 md:grid-cols-[1fr_1fr] md:items-end">
          <div>
            <p className="eyebrow text-champagne">{th('amenitiesEyebrow')}</p>
            <h2 className="mt-4 font-display text-[clamp(2.4rem,5vw,4.2rem)] font-light leading-[1.02]">{th('amenitiesTitle')}</h2>
          </div>
          <div className="flex items-end justify-between gap-6 md:justify-self-end">
            <p className="max-w-md text-ivory/65">{th('amenitiesBody')}</p>
            <div className="hidden shrink-0 gap-2 md:flex">
              {([-1, 1] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => scroll(d)}
                  aria-label={t(d === 1 ? 'next' : 'prev')}
                  className="grid h-11 w-11 place-items-center rounded-full border border-white/25 text-lg transition hover:border-champagne hover:text-champagne"
                >
                  <span className={d === 1 ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0'}>→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ul
        ref={track}
        className="reveal mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto track-gutter scroll-smooth pb-4 [scrollbar-width:none] md:gap-6 [&::-webkit-scrollbar]:hidden"
      >
        {AMENITIES.map((p, i) => {
          const key = p.key in AMENITY_TOURS ? (p.key as AmenityKey) : null;
          return (
          <li key={p.key} className="w-[78vw] shrink-0 snap-start sm:w-[46vw] lg:w-[30vw] xl:w-[25rem]">
            <figure className="group">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[20px] bg-night-soft">
                <img
                  src={src(p, 800)}
                  srcSet={srcSet(p)}
                  sizes="(min-width: 1280px) 400px, (min-width: 1024px) 30vw, (min-width: 640px) 46vw, 78vw"
                  alt={t(`photo.${p.key}`)}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-[1400ms] ease-luxe group-hover:scale-[1.04]"
                />
                {key && (
                  <button
                    type="button"
                    onClick={() => tour.open({ kind: 'amenity', key })}
                    className="absolute inset-x-4 bottom-4 flex items-center justify-between rounded-pill bg-ivory/90 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] text-night backdrop-blur-md transition hover:bg-ivory rtl:tracking-normal"
                  >
                    {t('tour.open')}
                    <span aria-hidden className="rtl:rotate-180">→</span>
                  </button>
                )}
              </div>
              <figcaption className="mt-5">
                <p className="flex items-baseline gap-3">
                  <span className="text-[11px] tabular-nums text-champagne">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-display text-2xl font-light">{t(`amenity.${p.key}.title`)}</span>
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ivory/60">{t(`amenity.${p.key}.body`)}</p>
              </figcaption>
            </figure>
          </li>
          );
        })}
      </ul>
      {tour.overlay}
    </section>
  );
}
