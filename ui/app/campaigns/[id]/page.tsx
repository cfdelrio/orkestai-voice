import { getCampaignResults, type CampaignResults, type CampaignRecipient } from '@/lib/api';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CampaignActions } from './CampaignActions';
import { CampaignCharts } from './CampaignCharts';
import { AddRecipientsModal } from './AddRecipientsModal';
import { VoiceInstructionsEditor } from './VoiceInstructionsEditor';

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
  pending:    'bg-slate-100 text-slate-500',
  called:     'bg-green-100 text-green-700',
};

const CALL_STATUS_LABEL: Record<string, string> = {
  initiated:  'Iniciando',
  ringing:    'Timbrando',
  answered:   'Atendida',
  completed:  'Completada',
  failed:     'Fallida',
  no_answer:  'Sin respuesta',
};

function RecipientRow({ r, stepLabels }: { r: CampaignRecipient; stepLabels: Record<string, string> }) {
  const callStatus = r.lastCall?.status;
  const responses = r.lastCall?.responses ?? [];
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-slate-800">
        {r.contact.firstName} {r.contact.lastName ?? ''}
      </td>
      <td className="px-4 py-3 text-sm text-slate-500 font-mono">{r.contact.phone}</td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? 'bg-slate-100 text-slate-500'}`}>
          {r.status === 'pending' ? 'Pendiente' : r.status === 'called' ? 'Llamado' : 'Fallido'}
        </span>
      </td>
      <td className="px-4 py-3">
        {callStatus ? (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[callStatus] ?? 'bg-slate-100 text-slate-500'}`}>
            {CALL_STATUS_LABEL[callStatus] ?? callStatus}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {responses.length > 0
          ? responses.map((resp) => {
              const stepText = stepLabels[resp.stepId];
              return (
                <span key={resp.stepId} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded mr-1">
                  {stepText ? `${stepText.slice(0, 20)}…` : resp.stepId}:{' '}
                  {resp.value
                    ? <strong>&ldquo;{resp.value}&rdquo;</strong>
                    : resp.input?.startsWith('https://')
                      ? <em className="text-slate-400">transcribiendo…</em>
                      : <strong>{resp.input}</strong>
                  }
                </span>
              );
            })
          : <span className="text-slate-400">—</span>
        }
      </td>
    </tr>
  );
}

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

  const { campaign, flow, stats, recipients } = data;
  const totalCalls = Object.values(stats.callsByStatus).reduce((a, b) => a + b, 0);
  const answeredCalls = (stats.callsByStatus['answered'] ?? 0) + (stats.callsByStatus['completed'] ?? 0);
  const completedCalls = stats.callsByStatus['completed'] ?? 0;
  const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
  const pendingCount = stats.recipientsByStatus['pending'] ?? 0;

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
          <CampaignActions campaignId={campaign.id} status={campaign.status} pendingCount={pendingCount} />
        </div>
      </div>

      {/* Voice instructions editor */}
      <VoiceInstructionsEditor
        campaignId={campaign.id}
        initialInstructions={String(campaign.metadata?.voiceInstructions ?? '')}
        token={token}
      />

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

      {/* Recipients table */}
      {recipients.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Destinatarios ({recipients.length})</h2>
            <div className="flex gap-3 text-xs text-slate-500">
              <span>{stats.recipientsByStatus['pending'] ?? 0} pendientes</span>
              <span>{stats.recipientsByStatus['called'] ?? 0} llamados</span>
              {(stats.recipientsByStatus['failed'] ?? 0) > 0 && (
                <span className="text-red-500">{stats.recipientsByStatus['failed']} fallidos</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Nombre</th>
                  <th className="px-4 py-2">Teléfono</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Llamada</th>
                  <th className="px-4 py-2">Respuestas</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <RecipientRow key={r.id} r={r} stepLabels={stepLabels} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
