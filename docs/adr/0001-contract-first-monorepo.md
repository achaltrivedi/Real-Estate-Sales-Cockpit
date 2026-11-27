# ADR 0001: Contract-first monorepo with ports and mocks

- Status: accepted (Phase 0)
- Date: 2026-11-27

## Decision

- pnpm workspaces + Turborepo; TypeScript everywhere.
- Internal packages are source-only (`exports` → `src/*.ts`), no build step; Next apps use `transpilePackages`, the API runs on `tsx`.
- `packages/contracts` holds Zod schemas and an **endpoint registry**. The same registry drives the typed client, the Fastify routes (`apps/api/src/http/route.ts`) and the generated `openapi.json`, so client and server cannot drift.
- All external dependencies sit behind ports with a mock default, so the demo runs fully offline.
- The API defaults to an in-memory store seeded from `assets/seed/project.json`; Postgres via Drizzle is opt-in (`DATA_DRIVER=postgres`).
- Seed data is a fictional project generated deterministically by `scripts/generate-seed.mjs`.

## Consequences

- Dev A can build against the real API in mock mode from day 1 (or Prism on `openapi.json`).
- Changing `contracts` is the only cross-lane coordination point; it requires both approvals.
