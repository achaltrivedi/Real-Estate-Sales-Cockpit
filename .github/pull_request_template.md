## What

<!-- One line. Branch must be a/... (Experience) or b/... (Engine). -->

## Lane

- [ ] Dev A — Experience
- [ ] Dev B — Engine
- [ ] Joint — touches `packages/contracts`, `assets/seed`, `docs`, `.github` (needs BOTH approvals)

## Definition of done (plan §7)

- [ ] Works in English **and** Arabic (RTL checked)
- [ ] Works on mobile
- [ ] Has a mock path (runs offline with `LLM_PROVIDER=mock`, `MESSAGING_CHANNEL=mock`, `CRM_ADAPTER=mock`)
- [ ] Covered by at least one end-to-end test
- [ ] Sample data clearly labelled on any new screen
- [ ] No secrets committed; new env vars added to `.env.example`

## Contract changes

<!-- If packages/contracts changed: additive only? `pnpm openapi` re-run? Other lane notified? -->
