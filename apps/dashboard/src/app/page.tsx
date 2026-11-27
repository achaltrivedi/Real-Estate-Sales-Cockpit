import { Card, Pill, formatDuration, tokens } from '@gsc/ui';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Phase 0 skeleton. TODO(Dev B, Phase 3): funnel chart, live updates, conversation view, filters. */
export default async function DashboardHome() {
  const [leads, funnel] = await Promise.all([
    api('listLeads').catch(() => null),
    api('getFunnel').catch(() => null),
  ]);

  if (!leads || !funnel) {
    return <main className="p-8">API not reachable on NEXT_PUBLIC_API_URL. Run `pnpm dev` from the repo root.</main>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="font-display text-3xl">Sales cockpit</h1>
      <div className="grid gap-4 md:grid-cols-5">
        {funnel.buckets.map((b) => (
          <Card key={b.bucket}>
            <p className="text-xs uppercase text-ink-muted">{b.bucket}</p>
            <p className="text-3xl font-semibold">{b.count}</p>
          </Card>
        ))}
        <Card>
          <p className="text-xs uppercase text-ink-muted">Median first response</p>
          <p className="text-3xl font-semibold">
            {funnel.medianFirstResponseMs === null ? '—' : formatDuration(funnel.medianFirstResponseMs)}
          </p>
        </Card>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-2">Lead</th>
              <th>Stage</th>
              <th>Score</th>
              <th>Assigned</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {leads.leads.map((l) => (
              <tr key={l.id} className="border-t border-ink/5">
                <td className="py-2">{l.name ?? l.id}</td>
                <td>
                  <Pill color={tokens.colors.stage[l.stage]}>{l.stage}</Pill>
                </td>
                <td>{l.qualification.score}</td>
                <td>{l.assignedToId ?? '—'}</td>
                <td>{new Date(l.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {leads.leads.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-ink-muted">
                  No leads yet. Create one from the web chat widget.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
