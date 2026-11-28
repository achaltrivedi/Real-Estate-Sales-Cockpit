import { loadSeed, seedDatabase, type DbHandle } from '@gsc/db';
import { createTestDb, resetLeadData } from '@gsc/db/testing';
import { afterAll } from 'vitest';
import { PostgresStore } from './postgres';
import { describeStoreContract } from './store.contract';

// Real Postgres (PGlite, in-process) with the committed migrations applied: no Docker needed in CI.
// One database per file (boot + migrate + seed is the slow part); lead tables are emptied before each test.
let h: DbHandle | undefined;
afterAll(() => h?.close());

describeStoreContract('PostgresStore', async () => {
  if (!h) {
    h = await createTestDb();
    await seedDatabase(h.db, loadSeed());
  }
  await resetLeadData(h.db);
  return { store: new PostgresStore(h.db) };
});
