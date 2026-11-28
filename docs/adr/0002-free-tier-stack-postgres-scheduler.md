# ADR 0002: Free-tier stack — Postgres-backed scheduler instead of BullMQ, OpenAI as the real LLM

- Status: accepted (Phase 2)
- Date: 2026-11-28
- Lane: Dev B (engine). No contract change.

## Context

The demo must run on free tiers only. The plan named BullMQ (Redis) for follow-ups and left the LLM vendor open.
Free Redis tiers cap commands, and BullMQ polls Redis continuously even when idle, so it can exhaust a free quota
without doing any work. The database is already Supabase Postgres (free tier).

## Decision

1. **Scheduler on Postgres.** `FollowUpScheduler` is implemented by `JobScheduler` (`apps/api/src/scheduler/`)
   over a `JobStore` port:
   - `PostgresJobStore`: `jobs` table (migration `0001_scheduler_jobs`), claimed with `FOR UPDATE SKIP LOCKED`,
     so several API instances can poll without double-sending; stuck `running` jobs are reclaimed after 5 min.
   - `MemoryJobStore`: same behaviour in-process for the offline demo (default).
   - Covers instant-reply retry (`send_retry`, backoff 30 s / 2 min / 10 min), the reminder sequence
     (`FOLLOW_UP_DELAYS`, default `1h,24h,72h`), stop-on-reply (any buyer message cancels and restarts the clock),
     and quiet hours (a reminder due in `QUIET_HOURS` moves to the end of the window).
   - The worker polls every `SCHEDULER_POLL_SECONDS` (default 15) inside the API process.
2. **LLM = OpenAI** (`LLM_PROVIDER=openai`, default model `gpt-4o-mini`) behind `LlmProvider`, using structured
   outputs (strict JSON schema) for slot extraction only. The rule-based extractor fills slots the model leaves null
   and is the full fallback on any error or timeout. Mock stays the default.

## Consequences

- No Redis in any environment; `REDIS_URL` and the compose `redis` service are unused (kept for now, harmless).
- Reminder precision is the poll interval (seconds), which is fine for nudges measured in hours.
- On free hosts that sleep (e.g. Render free), the worker only runs while the API is awake; overdue reminders are sent
  on the next wake-up. Acceptable for a demo; a paid always-on instance or an external cron ping fixes it.
- Cost of the LLM: one short request per free-text buyer message (quick replies never call it), max 1000 input chars,
  120 output tokens.
