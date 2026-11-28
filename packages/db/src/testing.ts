import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import type { Db, DbHandle } from './client';
import { migrationsFolder } from './migrate';
import * as schema from './schema';

/**
 * Real Postgres (WASM, in-process) with every migration applied. For tests only:
 * lets CI exercise PostgresStore + migrations without Docker.
 */
export async function createTestDb(): Promise<DbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Empties the tables the app writes to (leads & co.), keeping the seed. Cheap reset between tests. */
export async function resetLeadData(db: Db): Promise<void> {
  await db.execute(
    sql`truncate table viewings, messages, conversations, leads restart identity cascade`,
  );
}
