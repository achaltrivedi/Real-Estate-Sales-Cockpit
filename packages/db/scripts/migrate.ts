// pnpm --filter @gsc/db migrate   (needs `pnpm db:up` + DATABASE_URL)
import { createDb, DEFAULT_DATABASE_URL } from '../src/client';
import { migrateDb } from '../src/migrate';

const handle = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, { max: 1 });
try {
  await migrateDb(handle);
  console.log('✓ migrations applied');
} finally {
  await handle.close();
}
