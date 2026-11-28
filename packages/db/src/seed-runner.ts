import type { SeedFile } from '@gsc/contracts';
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './client';
import * as schema from './schema';

/** `SET col = excluded.col` for every non-key column, so re-seeding picks up edits to project.json. */
function updateFromExcluded<T extends PgTable>(table: T): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (col.primary) continue;
    set[key] = sql.raw(`excluded."${col.name}"`);
  }
  return set;
}

/** Idempotent upsert of the fictional seed (project, payment plans, units, salespeople). Never touches leads. */
export async function seedDatabase(
  db: Db,
  seed: SeedFile,
): Promise<{ units: number; salespeople: number }> {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.projects)
      .values({ id: seed.project.id, data: seed.project })
      .onConflictDoUpdate({ target: schema.projects.id, set: updateFromExcluded(schema.projects) });
    if (seed.paymentPlans.length)
      await tx
        .insert(schema.paymentPlans)
        .values(seed.paymentPlans.map((p) => ({ id: p.id, projectId: p.projectId, data: p })))
        .onConflictDoUpdate({
          target: schema.paymentPlans.id,
          set: updateFromExcluded(schema.paymentPlans),
        });
    if (seed.salespeople.length)
      await tx
        .insert(schema.salespeople)
        .values(seed.salespeople)
        .onConflictDoUpdate({
          target: schema.salespeople.id,
          set: updateFromExcluded(schema.salespeople),
        });
    if (seed.units.length)
      await tx
        .insert(schema.units)
        .values(
          seed.units.map((u) => ({
            id: u.id,
            projectId: u.projectId,
            code: u.code,
            building: u.building,
            floor: u.floor,
            type: u.type,
            view: u.view,
            areaSqft: u.areaSqft,
            bedrooms: u.bedrooms,
            bathrooms: u.bathrooms,
            priceAed: u.priceAed,
            availability: u.availability,
            paymentPlanIds: u.paymentPlanIds,
            meshId: u.meshId ?? null,
            floorplanUrl: u.floorplanUrl ?? null,
          })),
        )
        .onConflictDoUpdate({ target: schema.units.id, set: updateFromExcluded(schema.units) });
  });
  return { units: seed.units.length, salespeople: seed.salespeople.length };
}
