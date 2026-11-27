# @gsc/contracts — JOINT OWNED (Dev A + Dev B)

The single source of truth between the Experience lane (Dev A) and the Engine lane (Dev B).

- `src/entities.ts` — Project, Unit, PaymentPlan, Lead, Conversation, Message, Viewing, Salesperson
- `src/stages.ts` — lead stages + allowed transitions + funnel buckets
- `src/api.ts` — every endpoint: method, path, request and response schemas
- `src/events.ts` — domain event names + payloads
- `src/client.ts` — typed fetch client used by `apps/web` and `apps/dashboard`
- `openapi.json` — generated with `pnpm openapi`; feeds the Prism mock (`pnpm mock:prism`)

## Rules

1. Any change here needs approval from BOTH developers (CODEOWNERS enforces it).
2. After Phase 0: additive changes only (new optional fields, new endpoints). Breaking change = ADR in `docs/adr`.
3. No runtime logic except validation and the HTTP client. Never import another `@gsc/*` package from here.
