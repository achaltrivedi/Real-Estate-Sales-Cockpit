import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Any Postgres-flavoured Drizzle database bound to our schema: postgres-js in the app,
 * PGlite in tests (see `@gsc/db/testing`). The API's PostgresStore takes this type.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export const DEFAULT_DATABASE_URL = 'postgres://gsc:gsc@localhost:5432/gsc';

/**
 * Supabase's transaction pooler (port 6543) cannot use prepared statements; the session pooler
 * (5432) and direct connections can. Detected from the URL so the same code runs everywhere.
 */
export function usesTransactionPooler(url: string): boolean {
  try {
    return new URL(url).port === '6543';
  } catch {
    return false;
  }
}

/**
 * Connection pool for the API / scripts. Lazy: no socket is opened until the first query.
 * TLS follows `sslmode` in the URL (Supabase: append `?sslmode=require`).
 */
export function createDb(url = DEFAULT_DATABASE_URL, opts: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    prepare: !usesTransactionPooler(url),
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end({ timeout: 5 }) };
}
