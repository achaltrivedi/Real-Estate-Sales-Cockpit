import type { Conversation, Lead, SeedFile, Viewing } from '@gsc/contracts';
import type { LeadFilter, Store } from './store';

const copy = <T>(v: T): T => structuredClone(v);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** In-memory store seeded from assets/seed. Default driver: the demo runs with no database. */
export class MemoryStore implements Store {
  readonly name = 'memory' as const;
  private leads = new Map<string, Lead>();
  private conversations = new Map<string, Conversation>();
  private viewings = new Map<string, Viewing>();

  constructor(private seed: SeedFile) {}

  async getProject(id: string) {
    if (this.seed.project.id !== id) return null;
    return copy({
      project: this.seed.project,
      paymentPlans: this.seed.paymentPlans.filter((p) => p.projectId === id).sort(byId),
    });
  }

  async listUnits(projectId: string, q: Parameters<Store['listUnits']>[1]) {
    return copy(
      this.seed.units
        .filter(
          (u) =>
            u.projectId === projectId &&
            (!q.type || u.type === q.type) &&
            (!q.view || u.view === q.view) &&
            (!q.availability || u.availability === q.availability) &&
            (q.minPrice === undefined || u.priceAed >= q.minPrice) &&
            (q.maxPrice === undefined || u.priceAed <= q.maxPrice) &&
            (q.minFloor === undefined || u.floor >= q.minFloor) &&
            (q.maxFloor === undefined || u.floor <= q.maxFloor),
        )
        .sort(byId),
    );
  }

  async getUnit(id: string) {
    const u = this.seed.units.find((x) => x.id === id);
    return u ? copy(u) : null;
  }

  async listSalespeople() {
    return copy([...this.seed.salespeople].sort(byId));
  }

  async insertLead(lead: Lead) {
    this.leads.set(lead.id, copy(lead));
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    const cur = this.leads.get(id);
    if (!cur) return null;
    const next: Lead = {
      ...cur,
      ...copy(defined(patch)),
      id: cur.id,
      createdAt: cur.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.leads.set(id, next);
    return copy(next);
  }
  async getLead(id: string) {
    const l = this.leads.get(id);
    return l ? copy(l) : null;
  }
  async findLeadByPhone(phone: string) {
    const l = [...this.leads.values()]
      .filter((x) => x.phone === phone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return l ? copy(l) : null;
  }
  async listLeads(f: LeadFilter) {
    return copy(
      [...this.leads.values()]
        .filter(
          (l) => (!f.stage || l.stage === f.stage) && (!f.projectId || l.projectId === f.projectId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : -1)),
    );
  }

  async insertConversation(c: Conversation) {
    this.conversations.set(c.id, copy(c));
  }
  async getConversation(id: string) {
    const c = this.conversations.get(id);
    return c ? copy(c) : null;
  }
  async appendMessages(id: string, msgs: Conversation['messages']) {
    this.conversations.get(id)?.messages.push(...copy(msgs));
  }
  async setConversationStatus(id: string, status: Conversation['status']) {
    const c = this.conversations.get(id);
    if (c) c.status = status;
  }

  async insertViewing(v: Viewing) {
    this.viewings.set(v.id, copy(v));
  }

  async ping() {}
  async close() {}
}
