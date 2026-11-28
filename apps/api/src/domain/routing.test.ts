import type { Lead, Salesperson } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { activeLoad, routeLead } from './routing';

const sp = (
  id: string,
  languages: Salesperson['languages'],
  unitTypes: Salesperson['unitTypes'],
  available = true,
): Salesperson => ({
  id,
  name: id,
  languages,
  unitTypes,
  available,
});
const lead = (
  over: Partial<Lead> & { unitType?: Lead['qualification']['unitType'] } = {},
): Lead => {
  const { unitType, ...rest } = over;
  return {
    id: 'lead_x',
    projectId: 'p',
    locale: 'en',
    source: 'web_widget',
    stage: 'contacted',
    consent: { given: true, at: '2026-01-01T00:00:00.000Z', text: 'ok' },
    optedOut: false,
    interestedUnitIds: [],
    qualification: { score: 0, isQualified: false, missing: [], unitType },
    conversationId: 'c',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  };
};

// Mirrors assets/seed: Layla ar+en (2br/3br/PH), Omar ar (studio/1br/2br), James en (studio–3br), Priya en (PH/3br/4br/TH, unavailable)
const team = [
  sp('sp_layla', ['ar', 'en'], ['2br', '3br', 'penthouse']),
  sp('sp_omar', ['ar'], ['studio', '1br', '2br']),
  sp('sp_james', ['en'], ['studio', '1br', '2br', '3br']),
  sp('sp_priya', ['en'], ['penthouse', '3br', '4br', 'townhouse'], false),
];

describe('routeLead', () => {
  it('prefers language, then unit type', () => {
    expect(
      routeLead(lead({ locale: 'ar', unitType: 'studio' }), team, new Map())?.salesperson.id,
    ).toBe('sp_omar');
    expect(
      routeLead(lead({ locale: 'en', unitType: 'penthouse' }), team, new Map())?.salesperson.id,
    ).toBe('sp_layla');
  });

  it('never routes to an unavailable salesperson, even the only specialist', () => {
    const r = routeLead(lead({ locale: 'en', unitType: 'townhouse' }), team, new Map());
    expect(r?.salesperson.id).not.toBe('sp_priya');
    expect(r?.reasons).toContain('no townhouse specialist available');
  });

  it('balances load among equally good matches, ties broken by id', () => {
    const l = lead({ locale: 'en', unitType: '2br' }); // Layla and James both match
    expect(routeLead(l, team, new Map())?.salesperson.id).toBe('sp_james');
    expect(
      routeLead(
        l,
        team,
        new Map([
          ['sp_james', 2],
          ['sp_layla', 1],
        ]),
      )?.salesperson.id,
    ).toBe('sp_layla');
  });

  it('language outranks load', () => {
    expect(
      routeLead(lead({ locale: 'ar', unitType: '3br' }), team, new Map([['sp_layla', 9]]))
        ?.salesperson.id,
    ).toBe('sp_layla');
  });

  it('explains the decision', () => {
    expect(
      routeLead(lead({ locale: 'ar', unitType: '2br' }), team, new Map([['sp_layla', 1]]))?.reasons,
    ).toEqual(['speaks ar', 'handles 2br', '0 active leads']);
  });

  it('returns null when nobody is available', () => {
    expect(
      routeLead(
        lead(),
        team.map((s) => ({ ...s, available: false })),
        new Map(),
      ),
    ).toBeNull();
  });
});

describe('activeLoad', () => {
  it('counts only active leads and skips the lead being routed', () => {
    const leads = [
      lead({ id: 'a', assignedToId: 'sp_james', stage: 'qualified' }),
      lead({ id: 'b', assignedToId: 'sp_james', stage: 'lost' }),
      lead({ id: 'c', assignedToId: 'sp_james', stage: 'reserved' }),
      lead({ id: 'd', assignedToId: 'sp_layla', stage: 'viewing_booked' }),
      lead({ id: 'e', assignedToId: 'sp_layla', stage: 'contacted' }),
    ];
    expect(activeLoad(leads, 'e')).toEqual(
      new Map([
        ['sp_james', 1],
        ['sp_layla', 1],
      ]),
    );
  });
});
