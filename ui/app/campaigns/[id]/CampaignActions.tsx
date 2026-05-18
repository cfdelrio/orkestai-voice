'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { pauseCampaign, resumeCampaign, startCampaign } from '@/lib/api';

export function CampaignActions({ campaignId, status }: { campaignId: string; status: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePause() {
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await pauseCampaign(campaignId, token);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResume() {
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await resumeCampaign(campaignId, token);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    if (!confirm('¿Lanzar la campaña? Se iniciarán las llamadas a todos los destinatarios.')) return;
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await startCampaign(campaignId, token);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-red-600">{error}</span>}

      {status === 'draft' && (
        <button onClick={handleStart} disabled={loading}
          className="text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {loading ? 'Lanzando…' : '📞 Lanzar campaña'}
        </button>
      )}
      {status === 'running' && (
        <button onClick={handlePause} disabled={loading}
          className="text-sm font-medium px-4 py-2 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors">
          {loading ? 'Pausando…' : '⏸ Pausar'}
        </button>
      )}
      {status === 'paused' && (
        <button onClick={handleResume} disabled={loading}
          className="text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {loading ? 'Reanudando…' : '▶ Reanudar'}
        </button>
      )}
    </div>
  );
}
