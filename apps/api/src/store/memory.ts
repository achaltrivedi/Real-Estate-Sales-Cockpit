import type { Conversation, Lead, SeedFile, Viewing } from '@gsc/contracts';
import type { Store } from './store';

export class MemoryStore implements Store {
  private leads = new Map<string, Lead>();
  private conversations = new Map<string, Conversation>();
  private viewings = new Map<string, Viewing>();

  constructor(private seed: SeedFile) {}

  async getProject(id: string) {
    if (this.seed.project.id !== id) return null;
    return { project: this.seed.project, paymentPlans: this.seed.paymentPlans };
  }

  async listUnits(projectId: string, q: Parameters<Store['listUnits']>[1]) {
    return this.seed.units.filter(
      (u) =>
        u.projectId === projectId &&
        (!q.type || u.type === q.type) &&
        (!q.view || u.view === q.view) &&
        (!q.availability || u.availability === q.availability) &&
        (q.minPrice === undefined || u.priceAed >= q.minPrice) &&
        (q.maxPrice === undefined || u.priceAed <= q.maxPrice) &&
        (q.minFloor === undefined || u.floor >= q.minFloor) &&
        (q.maxFloor === undefined || u.floor <= q.maxFloor),
    );
  }

  async listSalespeople() {
    return this.seed.salespeople;
  }

  async insertLead(lead: Lead) {
    this.leads.set(lead.id, lead);
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    const cur = this.leads.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.leads.set(id, next);
    return next;
  }
  async getLead(id: string) {
    return this.leads.get(id) ?? null;
  }
  async listLeads(f: { stage?: Lead['stage']; projectId?: string }) {
    return [...this.leads.values()]
      .filter((l) => (!f.stage || l.stage === f.stage) && (!f.projectId || l.projectId === f.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async insertConversation(c: Conversation) {
    this.conversations.set(c.id, c);
  }
  async getConversation(id: string) {
    return this.conversations.get(id) ?? null;
  }
  async appendMessages(id: string, msgs: Conversation['messages']) {
    this.conversations.get(id)?.messages.push(...msgs);
  }
  async setConversationStatus(id: string, status: Conversation['status']) {
    const c = this.conversations.get(id);
    if (c) c.status = status;
  }

  async insertViewing(v: Viewing) {
    this.viewings.set(v.id, v);
  }
}
