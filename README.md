# Genesis Sales Cockpit (demo)

End-to-end real-estate sales cockpit for a **fictional** project (Azure Crest Residences): 3D showcase, unit explorer, payment-plan calculator, qualifying chat with instant replies, lead routing, follow-ups and a sales dashboard. English + Arabic.

## Quick start

```bash
corepack enable            # once; gives you the pinned pnpm
pnpm install
cp .env.example .env
pnpm dev                   # web :3000 · dashboard :3001 · api :4000
```

No Docker needed: the API defaults to an in-memory store seeded from `assets/seed/project.json` and mock LLM / WhatsApp / CRM.
Optional infra: `pnpm db:up` (Postgres + Redis).

### Postgres mode (optional)

```bash
pnpm db:up                          # Postgres + Redis (docker compose)
pnpm --filter @gsc/db migrate       # apply packages/db/migrations
pnpm --filter @gsc/db seed          # upsert the fictional project (safe to re-run)
# then in .env: DATA_DRIVER=postgres
```

Postgres tests run in-process on PGlite, so `pnpm test` never needs Docker.

### Supabase (free tier)

1. Create a project at supabase.com → **Project Settings → Database → Connection string → Session pooler**.
2. In `.env`: `DATA_DRIVER=postgres` and `DATABASE_URL=<that string>?sslmode=require` (the transaction pooler on port 6543 also works; prepared statements are switched off for it automatically).
3. `pnpm --filter @gsc/db migrate && pnpm --filter @gsc/db seed`, then `pnpm dev:b`.

Follow-up reminders use the same database (ADR 0002), so no Redis is needed anywhere.

### Real AI and WhatsApp (optional)

- `LLM_PROVIDER=openai`, `LLM_API_KEY=sk-…` (default model `gpt-4o-mini`; only free-text messages call it, quick replies don't). Set a spending limit in the OpenAI dashboard.
- Try the WhatsApp flow locally without Meta: POST a Cloud-API-shaped body to `/webhooks/whatsapp` (see `apps/api/src/whatsapp-flow.test.ts`); replies land in the mock outbox and the conversation.
- `FOLLOW_UP_DELAYS=1m,3m` makes reminders visible during a live demo.

| Command | What |
|---|---|
| `pnpm dev:a` | web + api (Dev A loop) |
| `pnpm dev:b` | api + dashboard (Dev B loop) |
| `pnpm test` / `pnpm typecheck` / `pnpm build` | all workspaces via Turborepo |
| `pnpm check:boundaries` | fails if a workspace imports across lanes |
| `pnpm openapi` | regenerate `packages/contracts/openapi.json` |
| `pnpm mock:prism` | pure OpenAPI mock on :4010 |
| `node scripts/generate-seed.mjs` | regenerate fictional seed data |

## Layout & ownership

```
apps/web            Dev A   showcase, explorer, calculator, chat widget, marketing (en/ar)
apps/dashboard      Dev B   leads, funnel, response time, conversations
apps/api            Dev B   REST API, webhooks, workers
packages/contracts  JOINT   Zod schemas, endpoint registry, events, OpenAPI, typed client
packages/ui         Dev A   design tokens, Tailwind preset, components
packages/3d         Dev A   tower scene, unit highlight
packages/qualifier  Dev B   LLM port, scoring, prompts, state machine
packages/messaging  Dev B   channel port, WhatsApp + mock adapters, opt-out
packages/crm        Dev B   CRM port, mock + webhook adapters
packages/db         Dev B   Drizzle schema, migrations, seed
packages/config     JOINT   tsconfig
assets/seed         JOINT   fictional project JSON
assets/models       Dev A   glTF
docs                JOINT   architecture, ADRs, demo script, compliance
```

- Lane briefs: [`docs/handover/DEV_A.md`](docs/handover/DEV_A.md), [`docs/handover/DEV_B.md`](docs/handover/DEV_B.md)
- How it fits together: [`docs/architecture.md`](docs/architecture.md)

## Working rules

- `main` is always deployable. Branches `a/<task>` / `b/<task>`, small PRs daily, squash merge.
- `contracts` or `seed` change → both approvals. Everything else → one (CODEOWNERS).
- `.env.example` committed, real secrets never.
- 15-minute daily sync; Friday demo of the working flow.
- Done = works in en + ar, on mobile, has a mock path, has one e2e test.
