'use client';

import type { PaymentPlan, Project, Unit } from '@gsc/contracts';
import { useEffect, useState } from 'react';
import { PROJECT_ID, api } from './api';

export interface Inventory {
  project: Project;
  paymentPlans: PaymentPlan[];
  units: Unit[];
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Inventory };

/** Loads project + full unit inventory once. Shared by showcase and explorer. */
export function useInventory(): State {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    Promise.all([api('getProject', { params: { id: PROJECT_ID } }), api('listUnits', { params: { id: PROJECT_ID } })])
      .then(([p, u]) => alive && setState({ status: 'ready', data: { ...p, units: u.units } }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
