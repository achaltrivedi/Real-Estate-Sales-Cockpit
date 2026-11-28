import type { Lead } from '@gsc/contracts';
import { loadSeed, seedDatabase, type DbHandle } from '@gsc/db';
import { createTestDb, resetLeadData } from '@gsc/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../store/postgres';
import { JobScheduler } from './job-scheduler';
import { describeJobStoreContract } from './jobs.contract';
import { MemoryJobStore, type Job } from './jobs';
import { PostgresJobStore } from './postgres-jobs';

// ---------- JobStore contract on both drivers ----------
describeJobStoreContract('MemoryJobStore', async () => ({
  jobs: new MemoryJobStore(),
  leadIds: ['lead_a', 'lead_b'],
}));

let pg: DbHandle | undefined;
afterAll(() => pg?.close());
const pgLead = (id: string): Lead => ({
  id,
  projectId: 'prj_azure_crest',
  locale: 'en',
  source: 'web_widget',
  stage: 'contacted',
  consent: { given: true, at: '2026-01-01T00:00:00.000Z', text: 'ok' },
  optedOut: false,
  interestedUnitIds: [],
  qualification: { score: 0, isQualified: false, missing: [] },
  conversationId: `conv_${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
describeJobStoreContract('PostgresJobStore', async () => {
  if (!pg) {
    pg = await createTestDb();
    await seedDatabase(pg.db, loadSeed());
  }
  await resetLeadData(pg.db);
  const store = new PostgresStore(pg.db);
  await store.insertLead(pgLead('lead_a'));
  await store.insertLead(pgLead('lead_b'));
  return { jobs: new PostgresJobStore(pg.db), leadIds: ['lead_a', 'lead_b'] };
});

// ---------- JobScheduler behaviour (fake clock) ----------
const H = 3_600_000;
function setup(start = '2026-03-10T10:00:00+04:00') {
  let t = new Date(start).getTime();
  const store = new MemoryJobStore();
  const log = { warn: vi.fn(), error: vi.fn() };
  const s = new JobScheduler(store, {
    followUpDelaysMs: [1 * H, 24 * H, 72 * H],
    quietHours: '22:00-08:00',
    timeZone: 'Asia/Dubai',
    now: () => new Date(t),
    log,
  });
  const ran: Job[] = [];
  s.setHandler(async (j) => {
    ran.push(j);
  });
  return { s, store, ran, log, advance: (ms: number) => (t += ms), at: () => new Date(t) };
}

describe('JobScheduler', () => {
  it('schedules a 3-step reminder sequence and runs each step when due', async () => {
    const { s, store, ran, advance } = setup();
    await s.scheduleSequence('lead_1');
    expect((await store.listForLead('lead_1')).map((j) => j.payload)).toEqual([
      { kind: 'follow_up', step: 1 },
      { kind: 'follow_up', step: 2 },
      { kind: 'follow_up', step: 3 },
    ]);
    expect(await s.runDue()).toBe(0);
    advance(1 * H);
    expect(await s.runDue()).toBe(1);
    expect(ran[0]!.payload).toEqual({ kind: 'follow_up', step: 1 });
    advance(23 * H);
    await s.runDue();
    expect(ran.map((j) => (j.payload as { step: number }).step)).toEqual([1, 2]);
  });

  it('re-scheduling replaces pending reminders (no duplicates) and cancel stops them (stop-on-reply)', async () => {
    const { s, store, ran, advance } = setup();
    await s.scheduleSequence('lead_1');
    await s.scheduleSequence('lead_1');
    expect((await store.listForLead('lead_1')).filter((j) => j.status === 'pending')).toHaveLength(
      3,
    );
    await s.cancel('lead_1');
    advance(100 * H);
    expect(await s.runDue()).toBe(0);
    expect(ran).toEqual([]);
  });

  it('defers reminders that fall due in quiet hours to 08:00 Dubai', async () => {
    const { s, store, ran, advance } = setup('2026-03-10T21:30:00+04:00');
    await s.scheduleSequence('lead_1'); // step 1 due 22:30 → quiet
    advance(1 * H);
    expect(await s.runDue()).toBe(0);
    const step1 = (await store.listForLead('lead_1')).find(
      (j) => (j.payload as { step: number }).step === 1,
    )!;
    expect(step1.status).toBe('pending');
    expect(step1.runAt.toISOString()).toBe(new Date('2026-03-11T08:00:00+04:00').toISOString());
    expect(step1.attempts).toBe(0);
    advance(10 * H); // 08:30 next day
    await s.runDue();
    expect(ran).toHaveLength(1);
  });

  it('send retries ignore quiet hours (they answer a buyer who just wrote)', async () => {
    const { s, ran, advance } = setup('2026-03-10T23:00:00+04:00');
    await s.retrySend('lead_1', { to: '+971500000001', text: 'hi' });
    advance(30_000);
    expect(await s.runDue()).toBe(1);
    expect(ran[0]!.kind).toBe('send_retry');
  });

  it('retries failed send jobs with backoff, then marks them failed', async () => {
    const { s, store, log, advance } = setup();
    s.setHandler(async () => {
      throw new Error('WhatsApp 503');
    });
    await s.retrySend('lead_1', { to: '+971500000001', text: 'hi' });
    advance(30_000);
    await s.runDue(); // 1st retry fails → +2m
    advance(120_000);
    await s.runDue(); // 2nd fails → +10m
    advance(600_000);
    await s.runDue(); // 3rd fails → give up
    const [job] = await store.listForLead('lead_1');
    expect(job).toMatchObject({ status: 'failed', attempts: 3, lastError: 'WhatsApp 503' });
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('a successful retry completes the job', async () => {
    const { s, store, advance } = setup();
    let calls = 0;
    s.setHandler(async () => {
      if (++calls === 1) throw new Error('flaky');
    });
    await s.retrySend('lead_1', { to: '+971500000001', text: 'hi' });
    advance(30_000);
    await s.runDue();
    advance(120_000);
    await s.runDue();
    expect((await store.listForLead('lead_1'))[0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('start/stop polls and never overlaps ticks', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryJobStore();
      const s = new JobScheduler(store, {
        followUpDelaysMs: [],
        quietHours: '00:00-00:00',
        timeZone: 'UTC',
        pollMs: 1000,
      });
      const spy = vi.spyOn(s, 'runDue');
      s.setHandler(async () => {});
      s.start();
      s.start(); // idempotent
      await vi.advanceTimersByTimeAsync(3500);
      expect(spy).toHaveBeenCalledTimes(3);
      await s.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
