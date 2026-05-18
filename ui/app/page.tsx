import { listCampaigns, linkUser, type Campaign } from '@/lib/api';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { DeleteCampaignButton } from '@/app/campaigns/DeleteCampaignButton';

const STATUS_COLORS: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600',
  running:   'bg-blue-100 text-blue-700',
  active:    'bg-blue-100 text-blue-700',
  paused:    'bg-amber-100 text-amber-700',
  scheduled: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
};

function CampaignCard({ campaign, token }: { campaign: Campaign; token: string }) {
  const color = STATUS_COLORS[campaign.status] ?? 'bg-slate-100 text-slate-600';
  const stepCount = campaign.flow?.steps?.length ?? 0;

  return (
    <div className="relative bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all">
      <Link href={`/campaigns/${campaign.id}`} className="block p-5">
        <div className="flex items-start justify-between gap-3 pr-6">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-800 truncate">{campaign.name}</h3>
            {campaign.description && (
              <p className="text-sm text-slate-500 mt-0.5 truncate">{campaign.description}</p>
            )}
          </div>
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${color}`}>
            {campaign.status}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
          <span>{stepCount} {stepCount === 1 ? 'paso' : 'pasos'}</span>
          <span>·</span>
          <span>{new Date(campaign.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>
      </Link>
      <DeleteCampaignButton campaignId={campaign.id} token={token} status={campaign.status} campaignName={campaign.name} />
    </div>
  );
}

export default async function CampaignsPage() {
  const headersList = await headers();
  const tenantId = headersList.get('x-tenant-id') ?? process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';

  const { getToken } = await auth();
  const token = (await getToken()) ?? undefined;

  // Vincular usuario al tenant en el primer acceso (idempotente)
  if (tenantId && token) {
    try { await linkUser(tenantId, 'owner', token); } catch { /* ya vinculado o sin tenant */ }
  }

  let campaigns: Campaign[] = [];
  let error: string | null = null;

  try {
    const data = await listCampaigns(tenantId, token);
    campaigns = data.campaigns;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Campañas</h1>
          <p className="text-sm text-slate-500 mt-1">{campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/campaigns/new"
          className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Nueva campaña
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
          Error conectando con la API: {error}
        </div>
      )}

      {campaigns.length === 0 && !error ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-4xl mb-3">📣</p>
          <p className="font-medium text-slate-600">No hay campañas todavía</p>
          <p className="text-sm mt-1">Creá tu primera campaña para empezar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c) => <CampaignCard key={c.id} campaign={c} token={token ?? ''} />)}
        </div>
      )}
    </div>
  );
}
