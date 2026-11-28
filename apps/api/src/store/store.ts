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

export interface LeadFilter {
  stage?: Lead['stage'];
  projectId?: string;
}

/**
 * Persistence port. `MemoryStore` (default, offline demo) and `PostgresStore` (DATA_DRIVER=postgres)
 * implement it; nothing else touches storage. Both must pass `store.contract.ts`.
 *
 * Semantics every implementation guarantees:
 * - reads return copies (mutating a returned object never changes stored state)
 * - `updateLead` bumps `updatedAt`, ignores `undefined` values, returns null for an unknown id
 * - `listLeads` is newest first; `listUnits` / `listSalespeople` are ordered by id
 * - conversation messages come back in insertion order
 */
export interface Store {
  readonly name: 'memory' | 'postgres';

  getProject(id: string): Promise<{ project: Project; paymentPlans: PaymentPlan[] } | null>;
  listUnits(projectId: string, q: UnitsQuery): Promise<Unit[]>;
  getUnit(id: string): Promise<Unit | null>;
  listSalespeople(): Promise<Salesperson[]>;

  insertLead(lead: Lead): Promise<void>;
  updateLead(id: string, patch: Partial<Lead>): Promise<Lead | null>;
  getLead(id: string): Promise<Lead | null>;
  listLeads(filter: LeadFilter): Promise<Lead[]>;

  insertConversation(c: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;
  appendMessages(conversationId: string, msgs: Message[]): Promise<void>;
  setConversationStatus(id: string, status: Conversation['status']): Promise<void>;

  insertViewing(v: Viewing): Promise<void>;

  /** Throws if the backing store is unreachable (used by /health and at startup). */
  ping(): Promise<void>;
  close(): Promise<void>;
}
