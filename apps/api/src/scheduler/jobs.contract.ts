import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobStore, NewJob } from './jobs';

/** Behaviour every JobStore must have (memory + Postgres), incl. the claim/lock semantics the worker relies on. */
export function describeJobStoreContract(
  name: string,
  make: () => Promise<{ jobs: JobStore; leadIds: [string, string]; cleanup?: () => Promise<void> }>,
) {
  describe(`JobStore contract: ${name}`, () => {
    let jobs: JobStore;
    let leadA: string;
    let leadB: string;
    let cleanup: (() => Promise<void>) | undefined;
    beforeEach(async () => {
      const r = await make();
      jobs = r.jobs;
      [leadA, leadB] = r.leadIds;
      cleanup = r.cleanup;
    });
    afterEach(async () => cleanup?.());

    const T0 = new Date('2026-03-10T08:00:00.000Z');
    const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
    let n = 0;
    const job = (leadId: string, minutes: number, step = 1): NewJob => ({
      id: `job_c${++n}`,
      leadId,
      runAt: at(minutes),
      payload: { kind: 'follow_up', step },
    });

    it('claims only due pending jobs, oldest first, and marks them running', async () => {
      await jobs.insert([job(leadA, 10), job(leadA, 0), job(leadB, 60)]);
      const claimed = await jobs.claimDue(at(15), 10, 300_000);
      expect(claimed.map((j) => j.runAt.toISOString())).toEqual([
        at(0).toISOString(),
        at(10).toISOString(),
      ]);
      expect(claimed.every((j) => j.status === 'running')).toBe(true);
      expect(await jobs.claimDue(at(15), 10, 300_000)).toEqual([]); // already claimed
    });

    it('respects the batch limit', async () => {
      await jobs.insert([job(leadA, 0), job(leadA, 1), job(leadA, 2)]);
      expect(await jobs.claimDue(at(5), 2, 300_000)).toHaveLength(2);
    });

    it('reclaims jobs stuck in running past the stale timeout', async () => {
      await jobs.insert([job(leadA, 0)]);
      await jobs.claimDue(at(1), 10, 300_000);
      expect(await jobs.claimDue(at(3), 10, 300_000)).toEqual([]);
      expect(await jobs.claimDue(at(7), 10, 300_000)).toHaveLength(1);
    });

    it('complete / retry / release / fail', async () => {
      const [a, b, c, d] = [job(leadA, 0), job(leadA, 0), job(leadA, 0), job(leadA, 0)];
      await jobs.insert([a, b, c, d]);
      await jobs.claimDue(at(1), 10, 300_000);
      await jobs.complete(a.id, at(1));
      await jobs.retry(b.id, 1, at(30), 'boom', at(1));
      await jobs.release(c.id, at(45), at(1));
      await jobs.fail(d.id, 3, 'gave up', at(1));
      const byId = Object.fromEntries((await jobs.listForLead(leadA)).map((j) => [j.id, j]));
      expect(byId[a.id]).toMatchObject({ status: 'done' });
      expect(byId[b.id]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'boom' });
      expect(byId[b.id]!.runAt.toISOString()).toBe(at(30).toISOString());
      expect(byId[c.id]).toMatchObject({ status: 'pending', attempts: 0 });
      expect(byId[d.id]).toMatchObject({ status: 'failed', attempts: 3, lastError: 'gave up' });
      expect((await jobs.claimDue(at(31), 10, 300_000)).map((j) => j.id)).toEqual([b.id]);
    });

    it('cancels only pending jobs of the given kinds for that lead', async () => {
      const running = job(leadA, 0);
      await jobs.insert([running]);
      await jobs.claimDue(at(1), 10, 300_000);
      await jobs.insert([
        job(leadA, 60),
        job(leadA, 120),
        job(leadB, 60),
        {
          id: 'job_send',
          leadId: leadA,
          runAt: at(5),
          payload: { kind: 'send_retry', message: { to: '+971500000001', text: 'hi' } },
        },
      ]);
      expect(await jobs.cancelPending(leadA, ['follow_up'], at(2))).toBe(2);
      const a = await jobs.listForLead(leadA);
      expect(a.filter((j) => j.status === 'cancelled')).toHaveLength(2);
      expect(a.find((j) => j.id === running.id)?.status).toBe('running');
      expect(a.find((j) => j.id === 'job_send')).toMatchObject({
        status: 'pending',
        kind: 'send_retry',
      });
      expect((await jobs.listForLead(leadB))[0]?.status).toBe('pending');
    });

    it('round-trips payloads', async () => {
      const msg = {
        to: '+971500000001',
        text: 'مرحباً',
        quickReplies: [{ id: 'purpose:investor', label: 'استثمار' }],
        locale: 'ar' as const,
      };
      await jobs.insert([
        { id: 'job_p', leadId: leadA, runAt: at(0), payload: { kind: 'send_retry', message: msg } },
      ]);
      const [j] = await jobs.claimDue(at(1), 1, 300_000);
      expect(j?.payload).toEqual({ kind: 'send_retry', message: msg });
    });
  });
}
