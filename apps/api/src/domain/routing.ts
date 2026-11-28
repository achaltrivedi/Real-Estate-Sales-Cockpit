import type { Lead, LeadStage, Salesperson } from '@gsc/contracts';

/** Stages that still need a salesperson's time; closed leads don't count towards load. */
export const ACTIVE_STAGES: readonly LeadStage[] = [
  'new',
  'contacted',
  'qualified',
  'viewing_booked',
  'viewed',
];

export interface RoutingDecision {
  salesperson: Salesperson;
  /** Why this person: shown to managers later ("speaks ar · handles 2br · 1 active lead"). */
  reasons: string[];
}

/** Active leads per salesperson (excluding `exceptLeadId`, the lead being routed). */
export function activeLoad(leads: Lead[], exceptLeadId?: string): Map<string, number> {
  const load = new Map<string, number>();
  for (const l of leads) {
    if (!l.assignedToId || l.id === exceptLeadId || !ACTIVE_STAGES.includes(l.stage)) continue;
    load.set(l.assignedToId, (load.get(l.assignedToId) ?? 0) + 1);
  }
  return load;
}

/**
 * Lead routing rules, in priority order:
 * 1. available (hard rule: an unavailable salesperson never gets new leads)
 * 2. speaks the lead's language
 * 3. handles the unit type the buyer wants (when known)
 * 4. fewest active leads
 * 5. id (deterministic, independent of store row order)
 * Returns null when nobody is available: the lead stays unassigned and visible to the manager.
 */
export function routeLead(
  lead: Lead,
  team: Salesperson[],
  load: Map<string, number>,
): RoutingDecision | null {
  const unit = lead.qualification.unitType;
  const ranked = team
    .filter((s) => s.available)
    .map((s) => ({
      s,
      lang: s.languages.includes(lead.locale),
      unit: !unit || s.unitTypes.includes(unit),
      load: load.get(s.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        Number(b.lang) - Number(a.lang) ||
        Number(b.unit) - Number(a.unit) ||
        a.load - b.load ||
        a.s.id.localeCompare(b.s.id),
    );
  const best = ranked[0];
  if (!best) return null;
  const reasons = [
    best.lang ? `speaks ${lead.locale}` : `no ${lead.locale} speaker available`,
    ...(unit ? [best.unit ? `handles ${unit}` : `no ${unit} specialist available`] : []),
    `${best.load} active lead${best.load === 1 ? '' : 's'}`,
  ];
  return { salesperson: best.s, reasons };
}

/** Back-compat helper: the chosen salesperson only. */
export function pickSalesperson(
  lead: Lead,
  team: Salesperson[],
  load: Map<string, number>,
): Salesperson | null {
  return routeLead(lead, team, load)?.salesperson ?? null;
}
