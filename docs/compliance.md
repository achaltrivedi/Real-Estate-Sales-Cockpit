# Compliance sheet (JOINT, Dev B drafts in Phase 5)

> Check with a UAE lawyer before connecting real buyer data or WhatsApp messaging to a live client launch.

| Topic | Demo behaviour | Before real launch |
|---|---|---|
| Hosting / data residency | Vercel + small container host, sample data only | Confirm UAE residency needs |
| Consent records | `Lead.consent` stores `given`, timestamp and exact text; API rejects leads without consent | Legal review of consent text (en/ar) |
| Opt-out | `STOP` / `إيقاف` (and variants) sets `optedOut`, cancels pending follow-ups; only the confirmation is sent | WhatsApp opt-in policy, template approval |
| WhatsApp-initiated leads | A buyer who messages first gets a lead with consent text "Buyer started the conversation on WhatsApp (inbound message)"; replies only, follow-ups stop on STOP | Confirm this basis for follow-ups with counsel; capture explicit marketing consent before promotional messages |
| Follow-ups | Max 3 reminders, never in quiet hours (22:00-08:00 Dubai), stop on any reply; outside WhatsApp's 24h window only approved templates | Approve `follow_up_1..3` templates (en + ar) in WhatsApp Manager |
| LLM processing | Off by default (`LLM_PROVIDER=mock`). With OpenAI, only the buyer's message text (max 1000 chars) is sent, no name/phone | DPA with the LLM vendor; disclose in the privacy notice |
| Human handoff | `POST /conversations/:id/handoff`, button in widget | Staffed response SLA |
| Sample data | Fictional project, labelled on every screen | n/a |
