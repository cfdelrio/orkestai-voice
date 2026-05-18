import { listCampaigns, type Campaign } from '@/lib/api';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600',
  running:   'bg-blue-100 text-blue-700',
  active:    'bg-blue-100 text-blue-700',
  paused:    'bg-amber-100 text-amber-700',
  scheduled: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
};

function countByStatus(campaigns: Campaign[]): Record<string, number> {
  return campaigns.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
}

export default async function AnalyticsPage() {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';

  const { getToken } = await auth();
  const token = (await getToken()) ?? undefined;

  let campaigns: Campaign[] = [];
  let error: string | null = null;

  try {
    const data = await listCampaigns(tenantId, token);
    campaigns = data.campaigns;
  } catch (e) {
    error = (e as Error).message;
  }

  const statusCounts = countByStatus(campaigns);
  const totalFlowSteps = campaigns.reduce((acc, c) => acc + (c.flow?.steps?.length ?? 0), 0);
  const completedCount = statusCounts['completed'] ?? 0;
  const runningCount = (statusCounts['running'] ?? 0) + (statusCounts['active'] ?? 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">Visión general de todas las campañas</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
          Error: {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total campañas</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">{campaigns.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Completadas</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{completedCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">En ejecución</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{runningCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pasos de flow</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">{totalFlowSteps}</p>
        </div>
      </div>

      {/* Status breakdown */}
      {campaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Campañas por estado</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div
                key={status}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}
              >
                <span>{status}</span>
                <span className="font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaign list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Todas las campañas</h2>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">
            No hay campañas todavía
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase">Campaña</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase">Pasos</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase">Creada</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{c.name}</div>
                    {c.description && (
                      <div className="text-xs text-slate-500 truncate max-w-xs">{c.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.flow?.steps?.length ?? 0}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(c.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
