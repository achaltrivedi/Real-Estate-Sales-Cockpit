import type { FunnelResponse, Lead, LeadStage } from '@gsc/contracts';

const REACHED: Record<'qualified' | 'viewing' | 'reservation', LeadStage[]> = {
  qualified: ['qualified', 'viewing_booked', 'viewed', 'reserved'],
  viewing: ['viewing_booked', 'viewed', 'reserved'],
  reservation: ['reserved'],
};

export function funnel(leads: Lead[]): FunnelResponse {
  const times = leads.map((l) => l.firstResponseMs).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)]! : null;
  return {
    buckets: [
      { bucket: 'lead', count: leads.length },
      { bucket: 'qualified', count: leads.filter((l) => REACHED.qualified.includes(l.stage)).length },
      { bucket: 'viewing', count: leads.filter((l) => REACHED.viewing.includes(l.stage)).length },
      { bucket: 'reservation', count: leads.filter((l) => REACHED.reservation.includes(l.stage)).length },
    ],
    medianFirstResponseMs: median,
  };
}
