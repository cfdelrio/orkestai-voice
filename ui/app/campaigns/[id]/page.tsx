import { getCampaignResults, type CampaignResults } from '@/lib/api';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CampaignActions } from './CampaignActions';
import { CampaignCharts } from './CampaignCharts';
import { AddRecipientsModal } from './AddRecipientsModal';

const STATUS_COLORS: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-600',
  running:    'bg-blue-100 text-blue-700',
  active:     'bg-blue-100 text-blue-700',
  paused:     'bg-amber-100 text-amber-700',
  scheduled:  'bg-purple-100 text-purple-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
  initiated:  'bg-slate-100 text-slate-600',
  ringing:    'bg-amber-100 text-amber-700',
  answered:   'bg-blue-100 text-blue-700',
  no_answer:  'bg-orange-100 text-orange-700',
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-slate-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

export default async function CampaignResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';

  const { getToken } = await auth();
  const token = (await getToken()) ?? undefined;

  let data: CampaignResults;
  try {
    data = await getCampaignResults(id, token);
  } catch {
    notFound();
  }

  const { campaign, flow, stats } = data;
  const totalCalls = Object.values(stats.callsByStatus).reduce((a, b) => a + b, 0);
  const answeredCalls = (stats.callsByStatus['answered'] ?? 0) + (stats.callsByStatus['completed'] ?? 0);
  const completedCalls = stats.callsByStatus['completed'] ?? 0;
  const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

  // Build step text labels for chart display
  const stepLabels: Record<string, string> = {};
  for (const step of flow?.steps ?? []) {
    stepLabels[step.id] = step.text;
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/" className="hover:text-slate-700">Campañas</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">{campaign.name}</span>
      </div>

      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{campaign.name}</h1>
          {campaign.description && (
            <p className="text-slate-500 mt-1">{campaign.description}</p>
          )}
          {campaign.startedAt && (
            <p className="text-xs text-slate-400 mt-1">
              Iniciada: {new Date(campaign.startedAt).toLocaleString('es-AR')}
            </p>
          )}
          {campaign.completedAt && (
            <p className="text-xs text-slate-400">
              Completada: {new Date(campaign.completedAt).toLocaleString('es-AR')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${STATUS_COLORS[campaign.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {campaign.status}
          </span>
          <AddRecipientsModal campaignId={campaign.id} tenantId={tenantId} />
          <CampaignActions campaignId={campaign.id} status={campaign.status} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Destinatarios" value={stats.totalRecipients} />
        <StatCard label="Llamadas totales" value={totalCalls} />
        <StatCard label="Completadas" value={completedCalls} sub={`${answerRate}% atendidas`} />
        <StatCard label="Fallidas" value={stats.callsByStatus['failed'] ?? 0} />
      </div>

      {/* Charts */}
      {(totalCalls > 0 || Object.keys(stats.responsesByStep).length > 0) && (
        <CampaignCharts
          callsByStatus={stats.callsByStatus}
          responsesByStep={stats.responsesByStep}
          stepLabels={stepLabels}
        />
      )}

      {totalCalls === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Aún no hay llamadas registradas para esta campaña
        </div>
      )}
    </div>
  );
}
