import { getCampaignResults, type CampaignResults, type FlowStep } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const STATUS_COLORS: Record<string, string> = {
  initiated:  'bg-slate-100 text-slate-600',
  ringing:    'bg-amber-100 text-amber-700',
  answered:   'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
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

function StepResult({ step, answers }: { step: FlowStep; answers: Record<string, number> }) {
  const total = Object.values(answers).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Paso: {step.id}</p>
      <p className="text-sm font-medium text-slate-700 mb-4">{step.text}</p>
      <div className="space-y-2">
        {Object.entries(answers).map(([value, count]) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const label = step.options
            ? Object.entries(step.options).find(([, v]) => v === value)?.[0]
            : null;
          return (
            <div key={value}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-700">
                  {label ? `${label} — ` : ''}<span className="font-medium">{value}</span>
                </span>
                <span className="text-slate-500">{count} ({pct}%)</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function CampaignResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: CampaignResults;

  try {
    data = await getCampaignResults(id);
  } catch {
    notFound();
  }

  const { campaign, flow, stats } = data;
  const totalCalls = Object.values(stats.callsByStatus).reduce((a, b) => a + b, 0);
  const completedCalls = stats.callsByStatus['completed'] ?? 0;
  const completionRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

  const dtmfSteps = flow?.steps.filter((s) => s.type === 'dtmf_question') ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/" className="hover:text-slate-700">Campañas</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">{campaign.name}</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{campaign.name}</h1>
          {campaign.description && (
            <p className="text-slate-500 mt-1">{campaign.description}</p>
          )}
        </div>
        <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${
          STATUS_COLORS[campaign.status] ?? 'bg-slate-100 text-slate-600'
        }`}>
          {campaign.status}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Destinatarios" value={stats.totalRecipients} />
        <StatCard label="Llamadas totales" value={totalCalls} />
        <StatCard label="Completadas" value={completedCalls} sub={`${completionRate}% de tasa`} />
        <StatCard label="Fallidas" value={stats.callsByStatus['failed'] ?? 0} />
      </div>

      {/* Calls by status */}
      {totalCalls > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Llamadas por estado</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.callsByStatus).map(([status, count]) => (
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

      {/* DTMF Responses */}
      {dtmfSteps.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Respuestas DTMF</h2>
          {Object.keys(stats.responsesByStep).length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              Aún no hay respuestas registradas
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dtmfSteps.map((step) => {
                const answers = stats.responsesByStep[step.id];
                if (!answers) return null;
                return <StepResult key={step.id} step={step} answers={answers} />;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
