import { and, asc, eq, inArray, lte, or, schema, sql, type Db } from '@gsc/db';
import type { Job, JobKind, JobPayload, JobStore, NewJob } from './jobs';

type Row = typeof schema.jobs.$inferSelect;
const t = schema.jobs;

function rowToJob(r: Row): Job {
  const j: Job = {
    id: r.id,
    leadId: r.leadId,
    kind: r.kind as JobKind,
    status: r.status as Job['status'],
    runAt: r.runAt,
    attempts: r.attempts,
    payload: r.payload as JobPayload,
  };
  if (r.lastError !== null) j.lastError = r.lastError;
  if (r.lockedAt !== null) j.lockedAt = r.lockedAt;
  return j;
}

/**
 * Postgres job queue (DATA_DRIVER=postgres, e.g. Supabase). Claiming uses
 * `FOR UPDATE SKIP LOCKED`, so several API instances can run workers without double-sending.
 */
export class PostgresJobStore implements JobStore {
  constructor(private db: Db) {}

  async insert(jobs: NewJob[]) {
    if (!jobs.length) return;
    await this.db
      .insert(t)
      .values(
        jobs.map((j) => ({
          id: j.id,
          leadId: j.leadId,
          kind: j.payload.kind,
          runAt: j.runAt,
          payload: j.payload,
        })),
      );
  }

  async claimDue(now: Date, limit: number, staleMs: number) {
    const staleBefore = new Date(now.getTime() - staleMs);
    const due = this.db
      .select({ id: t.id })
      .from(t)
      .where(
        or(
          and(eq(t.status, 'pending'), lte(t.runAt, now)),
          and(eq(t.status, 'running'), lte(t.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(t.runAt), asc(t.id))
      .limit(limit)
      .for('update', { skipLocked: true });
    const rows = await this.db
      .update(t)
      .set({ status: 'running', lockedAt: now, updatedAt: now })
      .where(inArray(t.id, due))
      .returning();
    return rows
      .map(rowToJob)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id));
  }

  async complete(id: string, now: Date) {
    await this.db
      .update(t)
      .set({ status: 'done', lockedAt: null, updatedAt: now })
      .where(eq(t.id, id));
  }

  async retry(id: string, attempts: number, runAt: Date, error: string, now: Date) {
    await this.db
      .update(t)
      .set({
        status: 'pending',
        attempts,
        runAt,
        lastError: error.slice(0, 1000),
        lockedAt: null,
        updatedAt: now,
      })
      .where(eq(t.id, id));
  }

  async release(id: string, runAt: Date, now: Date) {
    await this.db
      .update(t)
      .set({ status: 'pending', runAt, lockedAt: null, updatedAt: now })
      .where(eq(t.id, id));
  }

  async fail(id: string, attempts: number, error: string, now: Date) {
    await this.db
      .update(t)
      .set({
        status: 'failed',
        attempts,
        lastError: error.slice(0, 1000),
        lockedAt: null,
        updatedAt: now,
      })
      .where(eq(t.id, id));
  }

  async cancelPending(leadId: string, kinds: JobKind[], now: Date) {
    if (!kinds.length) return 0;
    const rows = await this.db
      .update(t)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(t.leadId, leadId), eq(t.status, 'pending'), inArray(t.kind, kinds)))
      .returning({ id: t.id });
    return rows.length;
  }

  async listForLead(leadId: string) {
    const rows = await this.db
      .select()
      .from(t)
      .where(eq(t.leadId, leadId))
      .orderBy(asc(t.runAt), asc(t.id));
    return rows.map(rowToJob);
  }

  /** For /health: pending work and failures at a glance. */
  async counts(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: t.status, n: sql<number>`count(*)::int` })
      .from(t)
      .groupBy(t.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
}
