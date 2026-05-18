'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { listContacts, addRecipients, type Contact } from '@/lib/api';

export function AddRecipientsModal({ campaignId, tenantId }: { campaignId: string; tenantId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || contacts.length > 0) return;
    setLoadingContacts(true);
    getToken().then((token) =>
      listContacts(tenantId, token ?? undefined)
        .then((res) => setContacts(res.contacts))
        .catch(() => setError('No se pudieron cargar los contactos'))
        .finally(() => setLoadingContacts(false))
    );
  }, [open, tenantId, getToken, contacts.length]);

  async function handleAdd() {
    if (selectedIds.size === 0) return;
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await addRecipients(campaignId, Array.from(selectedIds), token);
      setOpen(false);
      setSelectedIds(new Set());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
      >
        + Agregar contactos
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Agregar contactos a la campaña</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {loadingContacts ? (
              <div className="py-12 text-center text-slate-400 text-sm">Cargando contactos…</div>
            ) : contacts.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-sm">
                <p className="text-2xl mb-2">👥</p>
                <p>No hay contactos disponibles.</p>
                <a href="/contacts" className="text-indigo-600 hover:underline text-xs mt-1 inline-block">Ir a Contactos →</a>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-xs text-slate-500 mb-2">
                  <span>{selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedIds(new Set(contacts.map((c) => c.id)))} className="text-indigo-600 hover:text-indigo-800 font-medium">Todos</button>
                    <span className="text-slate-300">|</span>
                    <button onClick={() => setSelectedIds(new Set())} className="text-slate-500 hover:text-slate-700">Ninguno</button>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {contacts.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={(e) => toggle(c.id, e.target.checked)}
                        className="accent-indigo-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{c.firstName} {c.lastName ?? ''}</p>
                        <p className="text-xs text-slate-400 font-mono">{c.phone}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

            <div className="flex gap-3 mt-5">
              <button onClick={() => setOpen(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleAdd}
                disabled={loading || selectedIds.size === 0}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Agregando…' : `Agregar ${selectedIds.size > 0 ? selectedIds.size : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
