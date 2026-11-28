import { randomUUID } from 'node:crypto';
import type { OutboundMessage } from '@gsc/messaging';
import type { Job, JobStore } from './jobs';
import { isQuietHour, nextAllowedTime } from './time';

export interface SchedulerOptions {
  /** Delay of each reminder after the buyer's last message, e.g. [1h, 24h, 72h]. */
  followUpDelaysMs: number[];
  quietHours: string;
  timeZone: string;
  pollMs?: number;
  /** Delays between attempts when sending fails; length = max retries. */
  sendRetryBackoffMs?: number[];
  followUpRetryBackoffMs?: number[];
  batchSize?: number;
  /** A running job older than this is assumed orphaned (worker died) and reclaimed. */
  staleMs?: number;
  now?: () => Date;
  log?: { warn(obj: object, msg?: string): void; error(obj: object, msg?: string): void };
}

/** Executes one job. Throw to retry with backoff. */
export type JobHandler = (job: Job) => Promise<void>;

/**
 * Follow-up scheduler + worker on top of a `JobStore` (memory or Postgres). Replaces BullMQ (ADR 0002).
 * - reminder sequence: `scheduleSequence` (re)starts it; any earlier pending reminders are cancelled
 * - stop-on-reply: `cancel`
 * - quiet hours: a reminder that falls due in quiet hours is moved to the end of the window
 * - instant-reply retry: `retrySend` re-sends an outbound message that failed, with backoff
 */
export class JobScheduler {
  private handler: JobHandler | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<number> | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly jobs: JobStore,
    private readonly opts: SchedulerOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  get store(): JobStore {
    return this.jobs;
  }

  setHandler(handler: JobHandler) {
    this.handler = handler;
  }

  async scheduleSequence(leadId: string): Promise<void> {
    const now = this.now();
    await this.jobs.cancelPending(leadId, ['follow_up'], now);
    await this.jobs.insert(
      this.opts.followUpDelaysMs.map((delay, i) => ({
        id: `job_${randomUUID()}`,
        leadId,
        runAt: new Date(now.getTime() + delay),
        payload: { kind: 'follow_up' as const, step: i + 1 },
      })),
    );
  }

  async cancel(leadId: string): Promise<void> {
    await this.jobs.cancelPending(leadId, ['follow_up'], this.now());
  }

  async retrySend(leadId: string, message: OutboundMessage): Promise<void> {
    const delay = this.sendBackoff[0] ?? 30_000;
    await this.jobs.insert([
      {
        id: `job_${randomUUID()}`,
        leadId,
        runAt: new Date(this.now().getTime() + delay),
        payload: { kind: 'send_retry', message },
      },
    ]);
  }

  private get sendBackoff() {
    return this.opts.sendRetryBackoffMs ?? [30_000, 120_000, 600_000];
  }
  private get followUpBackoff() {
    return this.opts.followUpRetryBackoffMs ?? [300_000, 1_800_000];
  }

  /** Runs every due job once. Returns how many were executed (not counting quiet-hour deferrals). */
  async runDue(): Promise<number> {
    if (!this.handler) return 0;
    const now = this.now();
    const due = await this.jobs.claimDue(
      now,
      this.opts.batchSize ?? 20,
      this.opts.staleMs ?? 5 * 60_000,
    );
    let ran = 0;
    for (const job of due) {
      if (job.kind === 'follow_up' && isQuietHour(now, this.opts.quietHours, this.opts.timeZone)) {
        await this.jobs.release(
          job.id,
          nextAllowedTime(now, this.opts.quietHours, this.opts.timeZone),
          now,
        );
        continue;
      }
      ran++;
      try {
        await this.handler(job);
        await this.jobs.complete(job.id, this.now());
      } catch (err) {
        const attempts = job.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        // send_retry: the first attempt was the original send, so its backoff list starts one step in.
        const backoff =
          job.kind === 'send_retry' ? this.sendBackoff.slice(1) : this.followUpBackoff;
        const delay = backoff[attempts - 1];
        if (delay === undefined) {
          await this.jobs.fail(job.id, attempts, message, this.now());
          this.opts.log?.error(
            { jobId: job.id, leadId: job.leadId, kind: job.kind, err: message },
            'job failed permanently',
          );
        } else {
          await this.jobs.retry(
            job.id,
            attempts,
            new Date(this.now().getTime() + delay),
            message,
            this.now(),
          );
          this.opts.log?.warn(
            { jobId: job.id, leadId: job.leadId, kind: job.kind, attempts, err: message },
            'job failed, will retry',
          );
        }
      }
    }
    return ran;
  }

  /** Starts the polling worker (idempotent). Ticks never overlap. */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = this.runDue()
        .catch((err: unknown) => {
          this.opts.log?.error({ err }, 'scheduler tick failed');
          return 0;
        })
        .finally(() => {
          this.ticking = undefined;
        });
    }, this.opts.pollMs ?? 15_000);
    this.timer.unref?.();
  }

  /** Stops polling and waits for an in-flight tick. */
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
  }
}
