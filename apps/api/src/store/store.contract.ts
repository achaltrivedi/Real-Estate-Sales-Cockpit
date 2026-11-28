import type { Conversation, Lead, Message } from '@gsc/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from './store';

/**
 * Behaviour every `Store` must have. Run against each implementation
 * (memory.test.ts, postgres.test.ts) so switching DATA_DRIVER never changes behaviour.
 */
export function describeStoreContract(
  name: string,
  makeStore: () => Promise<{ store: Store; cleanup?: () => Promise<void> }>,
) {
  describe(`Store contract: ${name}`, () => {
    let store: Store;
    let cleanup: (() => Promise<void>) | undefined;
    beforeEach(async () => {
      ({ store, cleanup } = await makeStore());
    });
    afterEach(async () => {
      await cleanup?.();
    });

    const PROJECT = 'prj_azure_crest';
    let n = 0;
    const lead = (over: Partial<Lead> = {}): Lead => {
      const i = ++n;
      return {
        id: `lead_t${i}`,
        projectId: PROJECT,
        locale: 'en',
        source: 'web_widget',
        stage: 'new',
        consent: { given: true, at: '2026-01-01T10:00:00.000Z', text: 'I agree' },
        optedOut: false,
        interestedUnitIds: [],
        qualification: {
          score: 0,
          isQualified: false,
          missing: ['budget', 'timeline', 'unitType', 'purpose'],
        },
        conversationId: `conv_t${i}`,
        createdAt: `2026-01-01T10:00:0${i % 10}.000Z`,
        updatedAt: `2026-01-01T10:00:0${i % 10}.000Z`,
        ...over,
      };
    };
    const msg = (conversationId: string, text: string, over: Partial<Message> = {}): Message => ({
      id: `msg_${text}_${++n}`,
      conversationId,
      role: 'assistant',
      channel: 'web',
      text,
      createdAt: '2026-01-01T10:00:00.000Z', // same millisecond on purpose: order must still hold
      ...over,
    });
    const withConversation = async (l: Lead, messages: Message[] = []) => {
      await store.insertLead(l);
      const c: Conversation = { id: l.conversationId, leadId: l.id, status: 'bot', messages };
      await store.insertConversation(c);
      return c;
    };

    it('reads the seeded project with its payment plans', async () => {
      const p = await store.getProject(PROJECT);
      expect(p?.project.id).toBe(PROJECT);
      expect(p?.project.sample).toBe(true);
      expect(p?.paymentPlans.length).toBeGreaterThan(0);
      expect(await store.getProject('prj_nope')).toBeNull();
    });

    it('filters units and orders them by id', async () => {
      const all = await store.listUnits(PROJECT, {});
      expect(all.length).toBeGreaterThan(0);
      expect(all.map((u) => u.id)).toEqual([...all.map((u) => u.id)].sort());
      const f = await store.listUnits(PROJECT, {
        type: '2br',
        minPrice: 1_000_000,
        maxPrice: 3_000_000,
        minFloor: 5,
        maxFloor: 30,
      });
      expect(f.length).toBeGreaterThan(0);
      for (const u of f) {
        expect(u).toMatchObject({ type: '2br' });
        expect(u.priceAed).toBeGreaterThanOrEqual(1_000_000);
        expect(u.priceAed).toBeLessThanOrEqual(3_000_000);
        expect(u.floor).toBeGreaterThanOrEqual(5);
        expect(u.floor).toBeLessThanOrEqual(30);
      }
      expect(await store.listUnits('prj_nope', {})).toEqual([]);
    });

    it('gets a unit by id, with optional fields only when set', async () => {
      const [first] = await store.listUnits(PROJECT, {});
      const u = await store.getUnit(first!.id);
      expect(u).toEqual(first);
      expect(u && 'floorplanUrl' in u).toBe(false);
      expect(await store.getUnit('unit_nope')).toBeNull();
    });

    it('lists salespeople ordered by id', async () => {
      const team = await store.listSalespeople();
      expect(team.length).toBeGreaterThan(0);
      expect(team.map((s) => s.id)).toEqual([...team.map((s) => s.id)].sort());
    });

    it('round-trips a lead exactly (no nulls for absent optional fields)', async () => {
      const bare = lead();
      const full = lead({
        name: 'Sara',
        phone: '+971500000001',
        email: 'sara@example.test',
        assignedToId: 'sp_layla',
        firstResponseMs: 3,
        interestedUnitIds: ['unit_t1_0301'],
      });
      await store.insertLead(bare);
      await store.insertLead(full);
      expect(await store.getLead(bare.id)).toEqual(bare);
      expect(await store.getLead(full.id)).toEqual(full);
      expect(await store.getLead('lead_nope')).toBeNull();
    });

    it('updates a lead: merges, ignores undefined, bumps updatedAt, keeps id/createdAt', async () => {
      const l = lead({ name: 'Omar' });
      await store.insertLead(l);
      const q = { ...l.qualification, unitType: '2br' as const, score: 20 };
      const u = await store.updateLead(l.id, {
        stage: 'contacted',
        name: undefined,
        qualification: q,
        assignedToId: 'sp_james',
      });
      expect(u).toMatchObject({
        id: l.id,
        stage: 'contacted',
        name: 'Omar',
        qualification: q,
        assignedToId: 'sp_james',
        createdAt: l.createdAt,
      });
      expect(Date.parse(u!.updatedAt)).toBeGreaterThan(Date.parse(l.updatedAt));
      expect(await store.getLead(l.id)).toEqual(u);
      expect(await store.updateLead('lead_nope', { stage: 'lost' })).toBeNull();
    });

    it('finds the most recent lead by phone', async () => {
      const old = lead({ phone: '+971500000009', createdAt: '2026-01-01T09:00:00.000Z' });
      const recent = lead({ phone: '+971500000009', createdAt: '2026-01-05T09:00:00.000Z' });
      await store.insertLead(old);
      await store.insertLead(recent);
      await store.insertLead(lead({ phone: '+971500000010' }));
      expect((await store.findLeadByPhone('+971500000009'))?.id).toBe(recent.id);
      expect(await store.findLeadByPhone('+15550000000')).toBeNull();
    });

    it('lists leads newest first and filters by stage / project', async () => {
      const a = lead({ createdAt: '2026-01-01T09:00:00.000Z' });
      const b = lead({ createdAt: '2026-01-02T09:00:00.000Z', stage: 'qualified' });
      const c = lead({ createdAt: '2026-01-03T09:00:00.000Z' });
      for (const l of [a, b, c]) await store.insertLead(l);
      expect((await store.listLeads({})).map((l) => l.id)).toEqual([c.id, b.id, a.id]);
      expect((await store.listLeads({ stage: 'qualified' })).map((l) => l.id)).toEqual([b.id]);
      expect(await store.listLeads({ projectId: 'prj_nope' })).toEqual([]);
    });

    it('keeps conversation messages in insertion order, with quick replies', async () => {
      const l = lead();
      const first = msg(l.conversationId, 'a', {
        quickReplies: [{ id: 'purpose:investor', label: 'Investment' }],
      });
      await withConversation(l, [first, msg(l.conversationId, 'b')]);
      await store.appendMessages(
        l.conversationId,
        ['c', 'd', 'e'].map((t) => msg(l.conversationId, t, { role: 'buyer' })),
      );
      await store.appendMessages(l.conversationId, []);
      const c = await store.getConversation(l.conversationId);
      expect(c?.messages.map((m) => m.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(c?.messages[0]).toEqual(first);
      expect(c?.messages[1] && 'quickReplies' in c.messages[1]).toBe(false);
      expect(await store.getConversation('conv_nope')).toBeNull();
    });

    it('changes conversation status', async () => {
      const l = lead();
      await withConversation(l);
      await store.setConversationStatus(l.conversationId, 'human');
      expect((await store.getConversation(l.conversationId))?.status).toBe('human');
    });

    it('returns copies: mutating a result never changes stored state', async () => {
      const l = lead();
      await withConversation(l, [msg(l.conversationId, 'hi')]);
      const got = (await store.getLead(l.id))!;
      got.stage = 'lost';
      got.qualification.score = 99;
      const conv = (await store.getConversation(l.conversationId))!;
      conv.messages.push(msg(l.conversationId, 'ghost'));
      expect((await store.getLead(l.id))?.stage).toBe('new');
      expect((await store.getLead(l.id))?.qualification.score).toBe(0);
      expect((await store.getConversation(l.conversationId))?.messages).toHaveLength(1);
      const team = await store.listSalespeople();
      team[0]!.available = !team[0]!.available;
      expect((await store.listSalespeople())[0]!.available).toBe(!team[0]!.available);
    });

    it('stores viewings and answers ping', async () => {
      const l = lead();
      await store.insertLead(l);
      const [unit] = await store.listUnits(PROJECT, {});
      await expect(
        store.insertViewing({
          id: 'view_t1',
          leadId: l.id,
          unitId: unit!.id,
          salespersonId: 'sp_layla',
          startsAt: '2026-02-01T10:00:00+04:00',
          mode: 'in_person',
          status: 'booked',
        }),
      ).resolves.toBeUndefined();
      await expect(store.ping()).resolves.toBeUndefined();
    });
  });
}
