import type { OutboundMessage } from '@gsc/messaging';
import type { JobHandler } from './job-scheduler';

/**
 * Follow-up scheduler port used by the lead service. Implemented by `JobScheduler`
 * (Postgres or in-memory job store; replaces the BullMQ plan, see docs/adr/0002).
 */
export interface FollowUpScheduler {
  /** (Re)starts the reminder sequence for a lead, cancelling reminders still pending. */
  scheduleSequence(leadId: string): Promise<void>;
  /** Stop-on-reply / handoff / opt-out: cancels pending reminders. */
  cancel(leadId: string): Promise<void>;
  /** Queues a re-send of an outbound message that failed (instant-reply retry). */
  retrySend(leadId: string, message: OutboundMessage): Promise<void>;
  setHandler(handler: JobHandler): void;
  start(): void;
  stop(): Promise<void>;
}

/** Does nothing: for tests that don't care about follow-ups. */
export class NoopScheduler implements FollowUpScheduler {
  async scheduleSequence() {}
  async cancel() {}
  async retrySend() {}
  setHandler() {}
  start() {}
  async stop() {}
}

export { JobScheduler, type JobHandler, type SchedulerOptions } from './job-scheduler';
export { MemoryJobStore, type Job, type JobStore, type JobPayload } from './jobs';
export { PostgresJobStore } from './postgres-jobs';
export { isQuietHour, nextAllowedTime, parseDurations, parseQuietHours } from './time';
