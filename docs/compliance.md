# Compliance sheet (JOINT, Dev B drafts in Phase 5)

> Check with a UAE lawyer before connecting real buyer data or WhatsApp messaging to a live client launch.

| Topic | Demo behaviour | Before real launch |
|---|---|---|
| Hosting / data residency | Vercel + small container host, sample data only | Confirm UAE residency needs |
| Consent records | `Lead.consent` stores `given`, timestamp and exact text; API rejects leads without consent | Legal review of consent text (en/ar) |
| Opt-out | `STOP` / `إيقاف` sets `optedOut`, halts follow-ups | WhatsApp opt-in policy, template approval |
| Human handoff | `POST /conversations/:id/handoff`, button in widget | Staffed response SLA |
| Sample data | Fictional project, labelled on every screen | n/a |
