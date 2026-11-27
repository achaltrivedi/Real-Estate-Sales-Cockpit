import type {
  Conversation,
  Lead,
  Message,
  PaymentPlan,
  Project,
  Salesperson,
  Unit,
  UnitsQuery,
  Viewing,
} from '@gsc/contracts';

/**
 * Persistence port. `MemoryStore` (default, offline demo) and a future
 * `PostgresStore` (packages/db) implement it; nothing else touches storage.
 */
export interface Store {
  getProject(id: string): Promise<{ project: Project; paymentPlans: PaymentPlan[] } | null>;
  listUnits(projectId: string, q: UnitsQuery): Promise<Unit[]>;
  listSalespeople(): Promise<Salesperson[]>;

  insertLead(lead: Lead): Promise<void>;
  updateLead(id: string, patch: Partial<Lead>): Promise<Lead | null>;
  getLead(id: string): Promise<Lead | null>;
  listLeads(filter: { stage?: Lead['stage']; projectId?: string }): Promise<Lead[]>;

  insertConversation(c: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;
  appendMessages(conversationId: string, msgs: Message[]): Promise<void>;
  setConversationStatus(id: string, status: Conversation['status']): Promise<void>;

  insertViewing(v: Viewing): Promise<void>;
}
