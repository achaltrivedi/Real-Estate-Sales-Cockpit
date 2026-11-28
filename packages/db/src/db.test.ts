import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { DbHandle } from './client';
import * as schema from './schema';
import { loadSeed } from './seed-loader';
import { seedDatabase } from './seed-runner';
import { createTestDb } from './testing';

describe('@gsc/db', () => {
  let h: DbHandle;
  beforeEach(async () => {
    h = await createTestDb();
  });
  afterEach(async () => {
    await h.close();
  });

  it('loads and validates the seed file', () => {
    const seed = loadSeed();
    expect(seed.project.sample).toBe(true);
    expect(seed.units.length).toBeGreaterThan(0);
  });

  it('applies every migration to a fresh Postgres', async () => {
    const r = await h.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const rows = (
      Array.isArray(r) ? r : (r as unknown as { rows: { table_name: string }[] }).rows
    ).map((x) => x.table_name);
    for (const t of [
      'conversations',
      'leads',
      'messages',
      'payment_plans',
      'projects',
      'salespeople',
      'units',
      'viewings',
    ]) {
      expect(rows).toContain(t);
    }
  });

  it('seeds idempotently and re-seeding applies edits to project.json', async () => {
    const seed = loadSeed();
    await seedDatabase(h.db, seed);
    await seedDatabase(h.db, seed); // second run must not throw or duplicate

    const units = await h.db.select().from(schema.units);
    expect(units).toHaveLength(seed.units.length);
    expect(await h.db.select().from(schema.salespeople)).toHaveLength(seed.salespeople.length);

    const first = seed.units[0]!;
    const edited = {
      ...seed,
      units: [
        { ...first, priceAed: first.priceAed + 1000, availability: 'sold' as const },
        ...seed.units.slice(1),
      ],
    };
    await seedDatabase(h.db, edited);
    const [row] = await h.db.select().from(schema.units).where(eq(schema.units.id, first.id));
    expect(row).toMatchObject({ priceAed: first.priceAed + 1000, availability: 'sold' });
  });
});
