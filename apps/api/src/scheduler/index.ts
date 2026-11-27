/**
 * Follow-up scheduler port. Phase 2 (Dev B): add a BullMQ implementation
 * (instant reply retry, reminder sequence, stop-on-reply, quiet hours) behind this interface.
 */
export interface FollowUpScheduler {
  scheduleSequence(leadId: string): Promise<void>;
  cancel(leadId: string): Promise<void>;
}

/** No-op scheduler so the demo runs without Redis. */
export class NoopScheduler implements FollowUpScheduler {
  readonly scheduled = new Set<string>();
  async scheduleSequence(leadId: string) {
    this.scheduled.add(leadId);
  }
  async cancel(leadId: string) {
    this.scheduled.delete(leadId);
  }
}

/** Quiet hours, e.g. "22:00-08:00" in Asia/Dubai. */
export function isQuietHour(now: Date, window = '22:00-08:00', timeZone = 'Asia/Dubai'): boolean {
  const [start, end] = window.split('-').map((t) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }) as [number, number];
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const mins = Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
  return start > end ? mins >= start || mins < end : mins >= start && mins < end;
}
