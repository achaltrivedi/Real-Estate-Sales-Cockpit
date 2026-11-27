# Dev B — Engine lane ("what happens behind the scenes")

**Mission:** every lead gets an instant reply, is qualified, routed to the right salesperson and followed up, and the founder watches it all live in the dashboard. Always works offline on mocks.

**Branch prefix:** `b/…` (short-lived, one per task, squash-merged daily). Start branch: `b/phase-1-api-qualifier`.

## You own (sole write access via CODEOWNERS)

| Folder | What lives there |
|---|---|
| `apps/api/` | Fastify API. `server.ts` = composition root (`buildDeps`), `http/route.ts` binds routes to the contract, `domain/` (lead-service, routing, metrics, events), `store/` (Memory, later Postgres), `scheduler/` |
| `apps/dashboard/` | Sales dashboard: lead list, funnel, response-time metric, conversation view |
| `packages/qualifier/` | `LlmProvider` port + `MockLlm`, scoring rules, prompts (en/ar), conversation state machine |
| `packages/messaging/` | `MessagingChannel` port, `MockChannel`, `WhatsAppChannel`, opt-in/opt-out, templates |
| `packages/crm/` | `CrmAdapter` port, `MockCrm`, `WebhookCrm` |
| `packages/db/` | Drizzle schema, migrations, seed loader |
| CI / deploy | `.github/workflows` (joint file, you drive it), preview deploys, environments |

## You never touch

`apps/web`, `packages/ui`, `packages/3d`, `assets/models`. The dashboard may *use* `@gsc/ui` components; ask Dev A for new ones.

## Your only interface to Dev A

The contract in `packages/contracts`: entities, `endpoints` registry, events. Routes are registered from that registry (`route(app, 'createLead', …)`), so if it compiles it matches what the web client sends. Keep `openapi.json` fresh (`pnpm openapi`; CI checks it). Additive changes only; breaking ones need an ADR + Dev A's approval.

## Work plan

| Phase | Deliverables | Done when |
|---|---|---|
| 0 Setup (done) | Docker compose, DB schema, contracts, API on memory store with all endpoints, mock LLM / channel / CRM, e2e test | `pnpm dev` runs everything ✅ |
| 1 Core flow | Harden API (error shapes, CORS, request logging), `PostgresStore` implementing `Store` (`DATA_DRIVER=postgres`), migrations + `pnpm --filter @gsc/db seed`, qualifier edge cases (Arabic free text, ranges), unit tests per package | A lead can be created from the widget |
| 2 Conversation | Real LLM provider behind `LlmProvider` (structured output; mock stays default), WhatsApp inbound: `/webhooks/whatsapp` → map phone → lead → `sendMessage`. **Scheduler**: BullMQ implementation of `FollowUpScheduler` (instant-reply retry, reminder sequence, stop-on-reply, quiet hours via `isQuietHour`). **Routing** rules tuned (unit type, language, availability, load) | A fake buyer is qualified and routed |
| 3 Sales view | Dashboard: lead list with filters + stage change (`patchLead`), funnel chart (lead → qualified → viewing → reservation), median first-response metric, conversation view with human takeover, auto-refresh / SSE | The founder can watch the demo in the dashboard |
| 4 Integration (with Dev A) | WhatsApp Cloud API sandbox, deploy API (container) + dashboard, env separation, Playwright e2e with Dev A | Scripted 5-min demo runs cleanly |
| 5 Sales assets | Leak-calculator logic (propose `POST /tools/leak-calculator` in contracts), compliance sheet (`docs/compliance.md`) | Ready for outbound |

## Rules of thumb

- Concrete adapters are chosen **only** in `apps/api/src/server.ts#buildDeps` from env vars. Mock is always the default.
- Engine packages depend only on `contracts`, never on each other (CI-enforced).
- Domain logic stays out of route handlers: handlers call `lead-service`.
- Every new external integration = port + mock + real adapter.
- Definition of done: en + ar replies, mock path, one e2e test (`apps/api/src/lead-flow.test.ts` shows the pattern).
