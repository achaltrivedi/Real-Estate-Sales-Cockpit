# @gsc/db (Dev B)

Drizzle schema, SQL migrations and the seed loader. The API's `PostgresStore` (`apps/api/src/store/postgres.ts`) is the only runtime consumer.

| Command | What |
|---|---|
| `pnpm --filter @gsc/db generate` | After editing `src/schema.ts`: writes a new SQL migration to `migrations/`. Commit it (CI fails if schema and migrations drift). |
| `pnpm --filter @gsc/db migrate` | Applies pending migrations to `DATABASE_URL` (runtime migrator, no drizzle-kit needed in deploys). |
| `pnpm --filter @gsc/db seed` | Upserts `assets/seed/project.json` (project, payment plans, units, salespeople). Idempotent; never touches leads. |

Exports:

- `createDb(url)` → `{ db, close }` (postgres-js pool), `migrateDb(handle)`, `seedDatabase(db, seed)`, `loadSeed()`, `schema`, query helpers (`eq`, `and`, …).
- `@gsc/db/testing` → `createTestDb()` (in-process Postgres via PGlite, migrations applied) and `resetLeadData(db)`. Tests only.

Notes:

- `messages.seq` (serial) is the message order; several messages share a millisecond, so `created_at` alone is not enough.
- jsonb columns hold contract-shaped payloads (`Project`, `PaymentPlan`, `Qualification`, `consent`, `quickReplies`).
