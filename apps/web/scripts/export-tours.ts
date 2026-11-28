/**
 * Writes the tour stops and floor plans to assets/models/source/tours.json for the Blender renderer.
 *   pnpm --filter @gsc/web tours:export
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tourExport } from '../src/features/residence/tour';
import { wallSegments } from '../src/features/residence/floorplans';

const data = tourExport();
const residences = Object.fromEntries(
  Object.entries(data.residences).map(([type, r]) => [type, { ...r, walls: wallSegments(r.plan) }]),
);
const out = resolve(__dirname, '../../../assets/models/source/tours.json');
writeFileSync(out, JSON.stringify({ ...data, residences }, null, 1) + '\n');
console.log('wrote', out);
