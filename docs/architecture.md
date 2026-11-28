# Architecture

```
            Dev A — Experience                         Dev B — Engine
  ┌──────────────────────────────┐           ┌────────────────────────────────────────┐
  │ apps/web  (Next.js, en/ar)   │           │ apps/api  (Fastify)                     │
  │  features/showcase           │   HTTP    │  http/route.ts  ← contract registry     │
  │  features/explorer   ────────┼──────────►│  domain/lead-service (orchestration)    │
  │  features/calculator         │  typed    │  domain/routing, metrics, events        │
  │  features/chat-widget        │  client   │  store/  (Memory | Postgres)            │
  │  features/marketing          │           │  scheduler/ (Noop | BullMQ)             │
  │ packages/ui   packages/3d    │           │      │        │          │              │
  └──────────────────────────────┘           │ qualifier  messaging     crm     db     │
                                             │ (LLM port) (Channel port)(CRM port)     │
  ┌──────────────────────────────┐   HTTP    │                                          │
  │ apps/dashboard (Dev B)       ├──────────►│                                          │
  └──────────────────────────────┘           └────────────────────────────────────────┘
                     ▲                                       ▲
                     └──────── packages/contracts (JOINT) ───┘
                        Zod schemas · endpoint registry · events · OpenAPI
```

## Coupling rules (enforced by `scripts/check-boundaries.mjs` in CI)

| Workspace | May depend on |
|---|---|
| `contracts` | nothing (zod only) |
| `ui` | nothing |
| `3d` | contracts |
| `web` | contracts, ui, 3d |
| `qualifier`, `messaging`, `crm`, `db` | contracts |
| `api` | contracts, qualifier, messaging, crm, db |
| `dashboard` | contracts, ui |

- Front ends never import engine packages; they use `@gsc/contracts/client` over HTTP.
- Engine packages never import each other; `apps/api/src/server.ts` (`buildDeps`) is the only composition root.
- Every external system is a port with a mock: `LlmProvider`, `MessagingChannel`, `CrmAdapter`, `Store`, `FollowUpScheduler`.

## Request flow: widget lead → instant reply

1. Widget `POST /leads` (consent required by the contract).
2. `lead-service.createLead` creates lead + conversation, builds greeting + first question **synchronously** → `firstResponseMs`.
3. CRM upsert, follow-up sequence scheduled, `lead.created` emitted.
4. Each buyer turn: `POST /conversations/:id/messages` → qualifier → score → on qualify: stage `qualified`, routing assigns salesperson, `lead.qualified` emitted.
5. Dashboard reads `GET /leads` and `GET /metrics/funnel`.

## API conventions (apps/api)

- **Errors**: every non-2xx body is the contract's `ApiError`: `{ error, details? }`. 400 = validation (`details` = Zod issues) or malformed JSON, 404 = unknown resource/route, 409 = illegal stage move, 413 = body > 256 KB, 500 = `{ error: 'Internal server error', details: { requestId } }` (internals are only in the log).
- **Request ids**: each response carries `x-request-id` (an incoming sane value is reused, otherwise a UUID). It is on every log line for that request.
- **Logging**: one JSON line per request (method, url, status, ms). Request/response bodies are never logged (PII). `LOG_LEVEL` controls verbosity.
- **CORS**: `CORS_ORIGINS` allow-list (methods GET/POST/PATCH). Unset = open in development, closed in production.
- **Config**: env is validated once at startup (`apps/api/src/config.ts`); a bad value fails fast with a readable message.
- **Stores**: `DATA_DRIVER=memory|postgres`. Both implementations pass the same contract suite (`apps/api/src/store/store.contract.ts`).
- **Side integrations never lose a lead**: CRM sync is fire-and-forget and scheduler errors are logged, not thrown.
