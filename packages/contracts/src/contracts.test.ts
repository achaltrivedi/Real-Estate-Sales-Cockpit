import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PaymentPlan, SeedFile, canTransition, endpoints } from './index';

describe('contracts', () => {
  it('rejects payment plans that do not sum to 100%', () => {
    const r = PaymentPlan.safeParse({
      id: 'p',
      projectId: 'x',
      name: 'n',
      nameAr: 'n',
      dldFeePercent: 4,
      milestones: [{ label: 'a', labelAr: 'a', percent: 50, trigger: 'on_booking', monthOffset: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('enforces stage transitions', () => {
    expect(canTransition('new', 'qualified')).toBe(true);
    expect(canTransition('new', 'reserved')).toBe(false);
  });

  it('covers the minimum endpoints from the plan', () => {
    const paths = Object.values(endpoints).map((e) => `${e.method} ${e.path}`);
    for (const p of [
      'POST /leads',
      'POST /conversations/:id/messages',
      'GET /projects/:id/units',
      'GET /leads',
      'PATCH /leads/:id',
      'POST /viewings',
      'POST /webhooks/whatsapp',
    ]) {
      expect(paths).toContain(p);
    }
  });

  it('assets/seed/project.json matches the contract', () => {
    const raw = readFileSync(new URL('../../../assets/seed/project.json', import.meta.url), 'utf8');
    const parsed = SeedFile.safeParse(JSON.parse(raw));
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });
});
