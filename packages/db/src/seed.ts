// pnpm --filter @gsc/db seed   (needs `pnpm db:up` + DATABASE_URL)
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadSeed } from './seed-loader';

const url = process.env.DATABASE_URL ?? 'postgres://gsc:gsc@localhost:5432/gsc';
const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema });
const seed = loadSeed();

await db.insert(schema.projects).values({ id: seed.project.id, data: seed.project }).onConflictDoNothing();
await db
  .insert(schema.paymentPlans)
  .values(seed.paymentPlans.map((p) => ({ id: p.id, projectId: p.projectId, data: p })))
  .onConflictDoNothing();
await db.insert(schema.units).values(seed.units).onConflictDoNothing();
await db.insert(schema.salespeople).values(seed.salespeople).onConflictDoNothing();
console.log(`Seeded ${seed.units.length} units`);
await sql.end();
