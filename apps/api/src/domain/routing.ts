import type { Lead, Salesperson } from '@gsc/contracts';

/**
 * Lead routing rules: available → speaks the lead's language → handles the unit type.
 * Ties broken by current load (fewest assigned leads).
 */
export function pickSalesperson(lead: Lead, team: Salesperson[], load: Map<string, number>): Salesperson | null {
  const candidates = team
    .filter((s) => s.available)
    .filter((s) => s.languages.includes(lead.locale))
    .filter((s) => !lead.qualification.unitType || s.unitTypes.includes(lead.qualification.unitType));
  const pool = candidates.length ? candidates : team.filter((s) => s.available);
  return pool.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0] ?? null;
}
