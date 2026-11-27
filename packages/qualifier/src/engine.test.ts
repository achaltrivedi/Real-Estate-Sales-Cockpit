import { describe, expect, it } from 'vitest';
import { MockLlm, createQualifier, initialQualification } from './index';

describe('qualifier', () => {
  const q = createQualifier({ llm: new MockLlm() });

  it('qualifies a buyer through quick replies', async () => {
    let qual = initialQualification();
    for (const id of ['purpose:investor', 'unitType:2br', 'budget:1000000-2500000', 'timeline:now']) {
      const r = await q.handleTurn({ text: id, quickReplyId: id, locale: 'en', current: qual });
      qual = r.qualification;
    }
    expect(qual.isQualified).toBe(true);
    expect(qual.missing).toEqual([]);
  });

  it('extracts slots from free text with the mock LLM', async () => {
    const r = await q.handleTurn({
      text: 'Looking for a 2br to invest, budget 2.5 million, buying now',
      locale: 'en',
      current: initialQualification(),
    });
    expect(r.qualification).toMatchObject({ unitType: '2br', purpose: 'investor', timeline: 'now', budgetMaxAed: 2_500_000 });
  });

  it('escalates when the buyer asks for a human', async () => {
    const r = await q.handleTurn({ text: 'can I speak to a real person', locale: 'en', current: initialQualification() });
    expect(r.escalate).toBe(true);
  });
});
