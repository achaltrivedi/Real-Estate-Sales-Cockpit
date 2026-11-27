// Deterministic generator for assets/seed/project.json (JOINT-owned output).
// FICTIONAL project. Never replace with a real developer's project, name or prices.
// Usage: node scripts/generate-seed.mjs
import { writeFileSync } from 'node:fs';

const projectId = 'prj_azure_crest';

const project = {
  id: projectId,
  name: 'Azure Crest Residences',
  nameAr: 'مساكن أزور كرست',
  developer: 'Genesis Sample Developments (fictional)',
  location: 'Sample Waterfront District, Dubai',
  handoverDate: '2029-06',
  currency: 'AED',
  sample: true,
  disclaimer:
    'SAMPLE DATA. Fictional project for demonstration only. Not an offer; no real units, prices or permits.',
  buildings: [
    { id: 'T1', name: 'Tower 1 — Crest', floors: 24 },
    { id: 'T2', name: 'Tower 2 — Shore', floors: 18 },
  ],
  modelUrl: '/models/azure-crest.glb',
};

const paymentPlans = [
  {
    id: 'pp_60_40',
    projectId,
    name: '60/40 Construction-linked',
    nameAr: '٦٠/٤٠ مرتبطة بالإنشاء',
    dldFeePercent: 4,
    milestones: [
      { label: 'Booking', labelAr: 'الحجز', percent: 10, trigger: 'on_booking', monthOffset: 0 },
      ...[1, 2, 3, 4, 5].map((i) => ({
        label: `Construction instalment ${i}`,
        labelAr: `دفعة إنشاء ${i}`,
        percent: 10,
        trigger: 'construction',
        monthOffset: i * 6,
      })),
      { label: 'Handover', labelAr: 'التسليم', percent: 40, trigger: 'on_handover', monthOffset: 36 },
    ],
  },
  {
    id: 'pp_post_handover',
    projectId,
    name: '50/50 with 2-year post-handover',
    nameAr: '٥٠/٥٠ مع سنتين بعد التسليم',
    dldFeePercent: 4,
    milestones: [
      { label: 'Booking', labelAr: 'الحجز', percent: 20, trigger: 'on_booking', monthOffset: 0 },
      { label: 'Construction 50%', labelAr: 'إنجاز ٥٠٪', percent: 15, trigger: 'construction', monthOffset: 18 },
      { label: 'Handover', labelAr: 'التسليم', percent: 15, trigger: 'on_handover', monthOffset: 36 },
      ...[1, 2, 3, 4].map((i) => ({
        label: `Post-handover ${i}`,
        labelAr: `بعد التسليم ${i}`,
        percent: 12.5,
        trigger: 'post_handover',
        monthOffset: 36 + i * 6,
      })),
    ],
  },
];

// Stack layout per floor: unit position -> type, view, area
const stacks = {
  T1: [
    { pos: '01', type: '1br', bed: 1, bath: 2, area: 820, view: 'sea' },
    { pos: '02', type: '2br', bed: 2, bath: 3, area: 1240, view: 'sea' },
    { pos: '03', type: 'studio', bed: 0, bath: 1, area: 460, view: 'city' },
    { pos: '04', type: '3br', bed: 3, bath: 4, area: 1780, view: 'marina' },
  ],
  T2: [
    { pos: '01', type: '1br', bed: 1, bath: 1, area: 760, view: 'park' },
    { pos: '02', type: '2br', bed: 2, bath: 2, area: 1150, view: 'pool' },
    { pos: '03', type: '2br', bed: 2, bath: 3, area: 1190, view: 'city' },
    { pos: '04', type: '3br', bed: 3, bath: 3, area: 1650, view: 'park' },
  ],
};
const psf = { sea: 2450, marina: 2350, city: 2050, park: 2150, pool: 2100 };

// Small deterministic PRNG so the file never changes between runs.
let s = 42;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

const units = [];
for (const b of project.buildings) {
  for (let floor = 3; floor <= b.floors; floor++) {
    const isTop = floor === b.floors;
    for (const st of stacks[b.id]) {
      const type = isTop && st.pos === '04' ? 'penthouse' : st.type;
      const area = type === 'penthouse' ? 3200 : st.area;
      const price = Math.round((area * psf[st.view] * (1 + floor * 0.008)) / 1000) * 1000;
      const r = rnd();
      const availability = r < 0.62 ? 'available' : r < 0.78 ? 'reserved' : r < 0.95 ? 'sold' : 'hold';
      const code = `${b.id}-${String(floor).padStart(2, '0')}${st.pos}`;
      units.push({
        id: `unit_${code.toLowerCase().replace('-', '_')}`,
        projectId,
        code,
        building: b.id,
        floor,
        type,
        view: st.view,
        areaSqft: area,
        bedrooms: type === 'penthouse' ? 4 : st.bed,
        bathrooms: type === 'penthouse' ? 5 : st.bath,
        priceAed: price,
        availability,
        paymentPlanIds: floor > 15 ? ['pp_60_40', 'pp_post_handover'] : ['pp_60_40'],
        meshId: `${b.id}_F${floor}_U${st.pos}`,
      });
    }
  }
}

const salespeople = [
  { id: 'sp_layla', name: 'Layla (sample agent)', languages: ['ar', 'en'], unitTypes: ['2br', '3br', 'penthouse'], available: true },
  { id: 'sp_omar', name: 'Omar (sample agent)', languages: ['ar'], unitTypes: ['studio', '1br', '2br'], available: true },
  { id: 'sp_james', name: 'James (sample agent)', languages: ['en'], unitTypes: ['studio', '1br', '2br', '3br'], available: true },
  { id: 'sp_priya', name: 'Priya (sample agent)', languages: ['en'], unitTypes: ['penthouse', '3br', '4br', 'townhouse'], available: false },
];

const out = new URL('../assets/seed/project.json', import.meta.url);
writeFileSync(out, JSON.stringify({ project, paymentPlans, units, salespeople }, null, 2) + '\n');
console.log(`Wrote ${units.length} units to assets/seed/project.json`);
