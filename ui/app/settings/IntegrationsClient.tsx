'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  listApiKeys, createApiKey, deleteApiKey,
  listWebhookEndpoints, createWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint,
  type ApiKey, type WebhookEndpoint,
} from '@/lib/api';

const VALID_EVENTS = ['call.answered', 'call.completed', 'call.failed', 'call.no_answer', 'campaign.completed'];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');

function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} type="button"
      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 shrink-0">
      {copied
        ? <><svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-green-600">Copiado</span></>
        : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>{label}</>
      }
    </button>
  );
}

function SecretBanner({ value, label }: { value: string; label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
      <p className="text-xs font-medium text-amber-800 mb-2">{label} — guardalo ahora, no se vuelve a mostrar</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs font-mono bg-white border border-amber-200 rounded px-2 py-1.5 text-slate-700 break-all">
          {visible ? value : '•'.repeat(Math.min(value.length, 40))}
        </code>
        <button type="button" onClick={() => setVisible((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700 shrink-0">
          {visible ? 'Ocultar' : 'Ver'}
        </button>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function EnvSnippet({ tenantId, apiKey, webhookSecret }: { tenantId: string; apiKey: string; webhookSecret: string }) {
  const snippet = [
    `ORKESTAI_VOICE_API_URL=${API_URL}`,
    `ORKESTAI_VOICE_TENANT_ID=${tenantId}`,
    apiKey ? `ORKESTAI_VOICE_API_KEY=${apiKey}` : `ORKESTAI_VOICE_API_KEY=  # crear una API key abajo`,
    webhookSecret ? `ORKESTAI_VOICE_WEBHOOK_SECRET=${webhookSecret}` : `ORKESTAI_VOICE_WEBHOOK_SECRET=  # crear un webhook endpoint abajo`,
  ].join('\n');

  return (
    <div className="bg-slate-900 rounded-xl p-4 relative">
      <div className="absolute top-3 right-3">
        <CopyButton value={snippet} label="Copiar todo" />
      </div>
      <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap pr-20">{snippet}</pre>
    </div>
  );
}

export default function IntegrationsClient({ tenantId }: { tenantId: string }) {
  const { getToken } = useAuth();

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);

  // newly created values shown once
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // env snippet: last created key/secret this session
  const [envKey, setEnvKey] = useState('');
  const [envSecret, setEnvSecret] = useState('');

  // create api key form
  const [keyName, setKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);

  // create webhook form
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['call.completed', 'campaign.completed']);
  const [creatingWebhook, setCreatingWebhook] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const tok = await getToken();
      if (!tok) return;
      const [keysRes, endpointsRes] = await Promise.all([
        listApiKeys(tenantId, tok),
        listWebhookEndpoints(tenantId, tok),
      ]);
      setApiKeys(keysRes.apiKeys);
      setEndpoints(endpointsRes.endpoints);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [tenantId, getToken]);

  useEffect(() => { load(); }, [load]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreatingKey(true);
    setError(null);
    try {
      const tok = await getToken();
      const res = await createApiKey(tenantId, keyName.trim(), tok!);
      setNewKey(res.key);
      setEnvKey(res.key);
      setKeyName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleDeleteKey(keyId: string) {
    if (!confirm('¿Revocar esta API key? Los sistemas que la usen dejarán de funcionar.')) return;
    try {
      const tok = await getToken();
      await deleteApiKey(tenantId, keyId, tok!);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim() || webhookEvents.length === 0) return;
    setCreatingWebhook(true);
    setError(null);
    try {
      const tok = await getToken();
      const res = await createWebhookEndpoint(tenantId, { url: webhookUrl.trim(), events: webhookEvents }, tok!);
      setNewSecret(res.endpoint.secret);
      setEnvSecret(res.endpoint.secret);
      setWebhookUrl('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function handleToggleEndpoint(ep: WebhookEndpoint) {
    try {
      const tok = await getToken();
      await updateWebhookEndpoint(tenantId, ep.id, { enabled: !ep.enabled }, tok!);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteEndpoint(endpointId: string) {
    if (!confirm('¿Eliminar este webhook endpoint?')) return;
    try {
      const tok = await getToken();
      await deleteWebhookEndpoint(tenantId, endpointId, tok!);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function toggleEvent(ev: string) {
    setWebhookEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  if (loading) return <div className="py-10 text-center text-slate-400 text-sm">Cargando…</div>;

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div>
        <h2 className="text-xl font-bold text-slate-800">Integraciones API</h2>
        <p className="text-sm text-slate-500 mt-1">
          Credenciales para conectar sistemas externos (ENGAGE, scripts, etc.) con Orkestai Voice.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {error}
        </div>
      )}

      {/* ── Tenant Info ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Datos del tenant</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2">
            <div>
              <p className="text-xs text-slate-500">API URL</p>
              <code className="text-xs font-mono text-slate-700">{API_URL}</code>
            </div>
            <CopyButton value={API_URL} />
          </div>
          <div className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2">
            <div>
              <p className="text-xs text-slate-500">Tenant ID</p>
              <code className="text-xs font-mono text-slate-700">{tenantId}</code>
            </div>
            <CopyButton value={tenantId} />
          </div>
        </div>
      </section>

      {/* ── API Keys ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">API Keys</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Usá estas keys en el header <code className="bg-slate-100 px-1 rounded">Authorization: Bearer ok_…</code> para auth server-to-server.
          </p>
        </div>

        {newKey && (
          <SecretBanner value={newKey} label="API Key creada" />
        )}

        {apiKeys.length > 0 && (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-700">{k.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Creada {new Date(k.createdAt).toLocaleDateString('es-AR')}
                    {k.lastUsedAt && <> · Último uso {new Date(k.lastUsedAt).toLocaleDateString('es-AR')}</>}
                  </p>
                </div>
                <button onClick={() => handleDeleteKey(k.id)} type="button"
                  className="text-xs text-red-500 hover:text-red-700 font-medium">
                  Revocar
                </button>
              </div>
            ))}
          </div>
        )}

        {apiKeys.length === 0 && !newKey && (
          <p className="text-sm text-slate-400 italic">No hay API keys creadas.</p>
        )}

        <form onSubmit={handleCreateKey} className="flex gap-2">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Nombre (ej: ENGAGE Production)"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button type="submit" disabled={creatingKey || !keyName.trim()}
            className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center gap-1.5">
            {creatingKey && <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
            Crear key
          </button>
        </form>
      </section>

      {/* ── Webhook Endpoints ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Webhook Endpoints</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Orkestai Voice envía eventos firmados con HMAC-SHA256 al header{' '}
            <code className="bg-slate-100 px-1 rounded">X-Orkestai-Signature</code>.
          </p>
        </div>

        {newSecret && (
          <SecretBanner value={newSecret} label="Webhook secret" />
        )}

        {endpoints.length > 0 && (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {endpoints.map((ep) => (
              <div key={ep.id} className="px-4 py-3 bg-white hover:bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-slate-700 truncate">{ep.url}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(ep.events as string[]).map((ev) => (
                        <span key={ev} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button type="button" onClick={() => handleToggleEndpoint(ep)}
                      className={`text-xs font-medium px-2 py-1 rounded-full transition-colors ${ep.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {ep.enabled ? 'Activo' : 'Inactivo'}
                    </button>
                    <button type="button" onClick={() => handleDeleteEndpoint(ep.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium">
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {endpoints.length === 0 && !newSecret && (
          <p className="text-sm text-slate-400 italic">No hay webhook endpoints configurados.</p>
        )}

        <form onSubmit={handleCreateWebhook} className="space-y-3">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://engage.orkestai.ar/webhooks/voice"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <div className="flex flex-wrap gap-2">
            {VALID_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={webhookEvents.includes(ev)} onChange={() => toggleEvent(ev)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                <span className="text-xs font-mono text-slate-600">{ev}</span>
              </label>
            ))}
          </div>
          <button type="submit" disabled={creatingWebhook || !webhookUrl.trim() || webhookEvents.length === 0}
            className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            {creatingWebhook && <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
            Agregar endpoint
          </button>
        </form>
      </section>

      {/* ── Env Snippet ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Variables de entorno</h3>
          <p className="text-xs text-slate-500 mt-0.5">Copiá esto en tu archivo <code className="bg-slate-100 px-1 rounded">.env</code> de ENGAGE.</p>
        </div>
        <EnvSnippet tenantId={tenantId} apiKey={envKey} webhookSecret={envSecret} />
        {(!envKey || !envSecret) && (
          <p className="text-xs text-slate-400">
            {!envKey && !envSecret
              ? 'Creá una API key y un webhook endpoint arriba para completar el snippet.'
              : !envKey
              ? 'Creá una API key arriba para completar el snippet.'
              : 'Creá un webhook endpoint arriba para completar el snippet.'}
          </p>
        )}
      </section>

    </div>
  );
}
