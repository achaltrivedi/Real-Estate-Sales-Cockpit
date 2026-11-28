// pnpm --filter @gsc/db seed   (needs `pnpm db:up`, then `pnpm --filter @gsc/db migrate`)
import { createDb, DEFAULT_DATABASE_URL } from '../src/client';
import { seedDatabase } from '../src/seed-runner';
import { loadSeed } from '../src/seed-loader';

const handle = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, { max: 1 });
try {
  const r = await seedDatabase(handle.db, loadSeed());
  console.log(`✓ seeded ${r.units} units, ${r.salespeople} salespeople`);
} finally {
  await handle.close();
}
