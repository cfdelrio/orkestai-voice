'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { pauseCampaign, resumeCampaign, startCampaign } from '@/lib/api';

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-[100] flex items-center gap-2 ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
      {type === 'success'
        ? <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      }
      {message}
    </div>
  );
}

function ConfirmModal({ title, description, confirmLabel, confirmClass, onConfirm, onCancel, loading }: {
  title: string; description: string; confirmLabel: string; confirmClass: string;
  onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 text-base mb-2">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2 ${confirmClass}`}>
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>}
            {loading ? 'Espera…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CampaignActions({ campaignId, status }: { campaignId: string; status: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<'start' | 'pause' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  async function run(action: () => Promise<unknown>, successMsg: string) {
    setLoading(true);
    try {
      await action();
      setModal(null);
      setToast({ message: successMsg, type: 'success' });
      router.refresh();
    } catch (e) {
      setModal(null);
      setToast({ message: (e as Error).message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {status === 'draft' && (
          <button onClick={() => setModal('start')} disabled={loading}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            📞 Lanzar campaña
          </button>
        )}
        {status === 'running' && (
          <button onClick={() => setModal('pause')} disabled={loading}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors">
            ⏸ Pausar
          </button>
        )}
        {status === 'paused' && (
          <button onClick={() => run(async () => { const t = (await getToken()) ?? undefined; await resumeCampaign(campaignId, t); }, 'Campaña reanudada')} disabled={loading}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {loading ? 'Reanudando…' : '▶ Reanudar'}
          </button>
        )}
      </div>

      {modal === 'start' && (
        <ConfirmModal
          title="Lanzar campaña"
          description="Se iniciarán las llamadas a todos los destinatarios. Una vez lanzada podés pausarla pero no deshacerla."
          confirmLabel="📞 Sí, lanzar"
          confirmClass="bg-indigo-600 text-white hover:bg-indigo-700"
          onConfirm={() => run(async () => { const t = (await getToken()) ?? undefined; await startCampaign(campaignId, t); }, 'Campaña lanzada')}
          onCancel={() => !loading && setModal(null)}
          loading={loading}
        />
      )}
      {modal === 'pause' && (
        <ConfirmModal
          title="Pausar campaña"
          description="Se detendrán las llamadas pendientes. Podés reanudarla cuando quieras."
          confirmLabel="⏸ Pausar"
          confirmClass="bg-amber-500 text-white hover:bg-amber-600"
          onConfirm={() => run(async () => { const t = (await getToken()) ?? undefined; await pauseCampaign(campaignId, t); }, 'Campaña pausada')}
          onCancel={() => !loading && setModal(null)}
          loading={loading}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={clearToast} />}
    </>
  );
}
