import type { UnitType } from '@gsc/contracts';

/**
 * Interior and amenity photography (illustrative renders, prepared by assets/images/prepare_images.py).
 * Every image exists at 800 and 1600 px wide as WebP under /public/images.
 */

export interface Photo {
  /** Path without size suffix, e.g. /images/interiors/1br-living */
  base: string;
  /** Message key under `residence.photo`. */
  key: string;
}

const interior = (name: string): Photo => ({ base: `/images/interiors/${name}`, key: name });
const amenity = (name: string): Photo => ({ base: `/images/amenities/${name}`, key: name });

export const srcSet = (p: Photo) => `${p.base}-800.webp 800w, ${p.base}-1600.webp 1600w`;
export const src = (p: Photo, size: 800 | 1600 = 1600) => `${p.base}-${size}.webp`;

const BATH = interior('bathroom');

/** Interiors per residence type, hero image first. 4-bed and townhouse share the 3-bed finishes. */
export const INTERIORS: Record<UnitType, Photo[]> = {
  studio: [interior('studio-living'), BATH],
  '1br': [interior('1br-living'), interior('1br-bedroom'), BATH],
  '2br': [interior('2br-living-dining'), interior('2br-master'), BATH],
  '3br': [interior('3br-family-living'), interior('3br-kitchen'), interior('2br-master'), BATH],
  '4br': [interior('3br-family-living'), interior('3br-kitchen'), interior('2br-master'), BATH],
  penthouse: [interior('penthouse-living'), interior('penthouse-terrace'), interior('3br-kitchen'), BATH],
  townhouse: [interior('3br-family-living'), interior('3br-kitchen'), interior('2br-master'), BATH],
};

export const AMENITIES: Photo[] = ['lobby', 'podium-pool', 'sky-lounge', 'spa', 'gym', 'promenade', 'kids-club'].map(amenity);

export const ARRIVAL = amenity('ext-arrival');
export const FACADE = amenity('ext-facade-detail');
