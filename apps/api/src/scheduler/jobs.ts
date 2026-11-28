import type { OutboundMessage } from '@gsc/messaging';

export type JobKind = 'follow_up' | 'send_retry';
export type JobStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed';

export type JobPayload =
  | { kind: 'follow_up'; step: number }
  | { kind: 'send_retry'; message: OutboundMessage };

export interface Job {
  id: string;
  leadId: string;
  kind: JobKind;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  payload: JobPayload;
  lastError?: string;
  /** When a worker claimed it (running jobs only). */
  lockedAt?: Date;
}

export interface NewJob {
  id: string;
  leadId: string;
  runAt: Date;
  payload: JobPayload;
}

/**
 * Persistence for scheduled work. `MemoryJobStore` (default, offline) and `PostgresJobStore`
 * (DATA_DRIVER=postgres) both pass `jobs.contract.ts`.
 */
export interface JobStore {
  insert(jobs: NewJob[]): Promise<void>;
  /**
   * Atomically marks up to `limit` due jobs as running and returns them. Also reclaims jobs stuck in
   * `running` for longer than `staleMs` (worker crashed mid-job). Safe with concurrent workers.
   */
  claimDue(now: Date, limit: number, staleMs: number): Promise<Job[]>;
  complete(id: string, now: Date): Promise<void>;
  /** Back to pending at `runAt` after a failure (attempts already incremented by the caller). */
  retry(id: string, attempts: number, runAt: Date, error: string, now: Date): Promise<void>;
  /** Back to pending at `runAt` without counting an attempt (e.g. quiet hours). */
  release(id: string, runAt: Date, now: Date): Promise<void>;
  fail(id: string, attempts: number, error: string, now: Date): Promise<void>;
  /** Cancels pending jobs of the given kinds for a lead; returns how many. */
  cancelPending(leadId: string, kinds: JobKind[], now: Date): Promise<number>;
  listForLead(leadId: string): Promise<Job[]>;
}

/** In-process job store: the offline demo's scheduler needs no database. */
export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();

  async insert(jobs: NewJob[]) {
    for (const j of jobs) {
      this.jobs.set(j.id, {
        ...j,
        kind: j.payload.kind,
        status: 'pending',
        attempts: 0,
        runAt: new Date(j.runAt),
      });
    }
  }

  async claimDue(now: Date, limit: number, staleMs: number) {
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          (j.status === 'pending' && j.runAt <= now) ||
          (j.status === 'running' && (j.lockedAt?.getTime() ?? 0) + staleMs < now.getTime()),
      )
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit);
    for (const j of due) {
      j.status = 'running';
      j.lockedAt = new Date(now);
    }
    return due.map((j) => structuredClone(j));
  }

  private patch(id: string, p: Partial<Job>) {
    const j = this.jobs.get(id);
    if (j) Object.assign(j, p);
  }
  async complete(id: string) {
    this.patch(id, { status: 'done', lockedAt: undefined });
  }
  async retry(id: string, attempts: number, runAt: Date, error: string) {
    this.patch(id, {
      status: 'pending',
      attempts,
      runAt: new Date(runAt),
      lastError: error,
      lockedAt: undefined,
    });
  }
  async release(id: string, runAt: Date) {
    this.patch(id, { status: 'pending', runAt: new Date(runAt), lockedAt: undefined });
  }
  async fail(id: string, attempts: number, error: string) {
    this.patch(id, { status: 'failed', attempts, lastError: error, lockedAt: undefined });
  }
  async cancelPending(leadId: string, kinds: JobKind[]) {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.leadId === leadId && j.status === 'pending' && kinds.includes(j.kind)) {
        j.status = 'cancelled';
        n++;
      }
    }
    return n;
  }
  async listForLead(leadId: string) {
    return [...this.jobs.values()]
      .filter((j) => j.leadId === leadId)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id))
      .map((j) => structuredClone(j));
  }
}
