'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

const PROVIDERS = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'infobip', label: 'Infobip' },
];

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

export default function SettingsClient({ tenantId }: { tenantId: string }) {
  const { getToken } = useAuth();
  const [provider, setProvider] = useState('twilio');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    getToken()
      .then((tok) => fetch(`/api/tenants/${tenantId}/provider-configs`, {
        headers: { Authorization: `Bearer ${tok}` },
      }))
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.providerConfig) {
          setHasConfig(true);
          setProvider(data.providerConfig.provider ?? 'twilio');
          setAccountSid(data.providerConfig.apiKey ?? '');
          setFromNumber(data.providerConfig.fromNumber ?? '');
        }
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [tenantId, getToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const tok = await getToken();
      const body: Record<string, unknown> = {
        provider,
        apiKey: accountSid.trim(),
        baseUrl: 'https://api.twilio.com',
        fromNumber: fromNumber.trim(),
        metadata: provider === 'twilio' ? { authToken: authToken.trim() } : {},
      };

      const res = await fetch(`/api/tenants/${tenantId}/provider-configs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      setHasConfig(true);
      setAuthToken('');
      setToast({ message: 'Configuración guardada', type: 'success' });
    } catch (err) {
      setToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return <div className="py-20 text-center text-slate-400 text-sm">Cargando configuración…</div>;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Configuración</h1>
        <p className="text-sm text-slate-500 mt-1">Proveedor de llamadas de voz</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
        {hasConfig && (
          <div className="mb-5 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Proveedor configurado. Podés actualizar los datos abajo.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Proveedor</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {provider === 'twilio' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Account SID</label>
                <input type="text" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} required
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Auth Token {hasConfig && <span className="text-slate-400 font-normal">(dejá vacío para no cambiar)</span>}
                </label>
                <input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)}
                  required={!hasConfig}
                  placeholder={hasConfig ? '••••••••' : 'tu auth token de Twilio'}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Número de origen <span className="text-slate-400 font-normal">(E.164)</span>
                </label>
                <input type="text" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} required
                  placeholder="+15551234567"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </>
          )}

          {provider === 'infobip' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                <input type="password" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Base URL</label>
                <input type="text" value={authToken} onChange={(e) => setAuthToken(e.target.value)} required
                  placeholder="https://xxxxxx.api.infobip.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Número de origen</label>
                <input type="text" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {loading && <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
            {loading ? 'Guardando…' : hasConfig ? 'Actualizar configuración' : 'Guardar configuración'}
          </button>
        </form>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDone={clearToast} />}
    </>
  );
}
