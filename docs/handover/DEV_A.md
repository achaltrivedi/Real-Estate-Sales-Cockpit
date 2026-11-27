# Dev A — Experience lane ("what the buyer sees")

**Mission:** make a buyer fall in love with the project in 60 seconds: 3D tower, unit explorer, payment-plan calculator, chat widget, bilingual (en/ar, RTL), mobile-ready.

**Branch prefix:** `a/…` (short-lived, one per task, squash-merged daily). Start branch: `a/phase-1-showcase-explorer`.

## You own (sole write access via CODEOWNERS)

| Folder | What lives there |
|---|---|
| `apps/web/` | Next.js App Router site. One folder per feature under `src/features/` |
| `packages/ui/` | Design tokens, Tailwind preset, shared components (dashboard uses them read-only) |
| `packages/3d/` | `TowerScene`, layout/highlight logic, glTF loading, camera paths |
| `assets/models/` | `azure-crest.glb` (mesh names = `Unit.meshId`) |

## You never touch

`apps/api`, `apps/dashboard`, `packages/{qualifier,messaging,crm,db}`. If you need something from the engine, it goes through the **contract** (see below), never an import. CI fails if `web` imports an engine package.

## Your only interface to Dev B

- `apps/web/src/lib/api.ts` → `api('<endpointName>', { params, body, query })`, fully typed from `@gsc/contracts`.
- Endpoints you use: `getProject`, `listUnits`, `createLead`, `sendMessage`, `getConversation`, `requestHandoff`, `createViewing`.
- Backend for local dev: `pnpm dev:a` (real API in mock mode, no DB needed) or `pnpm mock:prism` (pure OpenAPI mock on :4010).
- Need a new field or endpoint? Open a PR to `packages/contracts` only (additive), tag Dev B, then build against it.

## Work plan

| Phase | Deliverables | Done when |
|---|---|---|
| 0 Setup (done) | Repo, CI, design tokens, web shell, en/ar routing, procedural 3D tower | `pnpm dev` runs everything ✅ |
| 1 Core flow | **Showcase**: hero with 3D tower + masterplan, camera paths, mobile fallback (static render < 768px or low-GPU). **Explorer**: filters type/price/floor/view (map to `UnitsQuery`), unit detail drawer, availability colours, highlight filtered units in 3D. Replace boxes with glTF when model is ready | Buyer filters → picks unit → sees detail on seed data |
| 2 Conversation | **Chat widget** (`features/chat-widget`): consent checkbox (blocks send), `createLead` → render instant reply, quick-reply buttons → `sendMessage({ text, quickReplyId })`, "Talk to a human" → `requestHandoff`, opt-out hint ("reply STOP"), book-viewing UI → `createViewing`. **Calculator** (`features/calculator`): plan picker, down payment, instalment schedule by `monthOffset`, handover + post-handover, DLD fee line | A fake buyer is qualified from the widget |
| 3 Sales view | Arabic copy everywhere, RTL layout pass (logical CSS: `ms-/me-/ps-/pe-`), `formatAed` / Arabic digits, mobile polish, a11y | Every screen works in ar + on a phone |
| 4 Integration (with Dev B) | Playwright e2e: widget → qualified → visible in dashboard. Co-write `docs/demo-script.md` | Scripted 5-min demo runs cleanly |
| 5 Sales assets | Landing page, case-study template, leak-calculator UI (logic from Dev B), booking link, 60-second video | Ready for outbound |

## Rules of thumb

- Feature folders are self-contained: each exports through its own `index.ts`; pages only compose features.
- All UI strings in `apps/web/messages/{en,ar}.json`, never hard-coded.
- Every new screen shows `<SampleDataBanner>` (already in the layout).
- Definition of done: en + ar, mobile, mock path, one e2e test.
