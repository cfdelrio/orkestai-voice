'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getFeedConfig, upsertFeedConfig, deleteFeedConfig, type FlowStep, type PublicFeedConfig, type PublicQuestion } from '@/lib/api';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_DOMAIN
  ? `https://voice.${process.env.NEXT_PUBLIC_BASE_DOMAIN}`
  : (process.env.NEXT_PUBLIC_API_URL ?? '');

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

interface Props {
  campaignId: string;
  campaignName: string;
  flowSteps: FlowStep[];
}

export function FeedConfigEditor({ campaignId, campaignName, flowSteps }: Props) {
  const { getToken } = useAuth();
  const [config, setConfig] = useState<PublicFeedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Form state
  const [enabled, setEnabled] = useState(true);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showRecentActivity, setShowRecentActivity] = useState(true);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(10);
  const [publicQuestions, setPublicQuestions] = useState<PublicQuestion[]>([]);

  const dtmfSteps = flowSteps.filter((s) => s.type === 'dtmf_question');

  useEffect(() => {
    (async () => {
      try {
        const token = (await getToken()) ?? undefined;
        const res = await getFeedConfig(campaignId, token);
        setConfig(res.feedConfig);
        if (res.feedConfig) {
          setEnabled(res.feedConfig.enabled);
          setSlug(res.feedConfig.slug);
          setTitle(res.feedConfig.title);
          setDescription(res.feedConfig.description ?? '');
          setShowRecentActivity(res.feedConfig.showRecentActivity);
          setRefreshIntervalSeconds(res.feedConfig.refreshIntervalSeconds);
          setPublicQuestions(res.feedConfig.publicQuestions ?? []);
        } else {
          setSlug(slugify(campaignName));
          setTitle(campaignName);
          // Pre-populate questions from dtmf steps
          setPublicQuestions(dtmfSteps.map((s) => ({
            stepId: s.id,
            title: s.text.slice(0, 80),
            optionLabels: Object.fromEntries(Object.entries(s.options ?? {}).map(([k, v]) => [v, v])),
          })));
        }
      } catch {
        // ignore load error
      } finally {
        setLoading(false);
      }
    })();
  }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleStep(step: FlowStep, checked: boolean) {
    if (checked) {
      setPublicQuestions((prev) => [
        ...prev,
        {
          stepId: step.id,
          title: step.text.slice(0, 80),
          optionLabels: Object.fromEntries(Object.entries(step.options ?? {}).map(([k, v]) => [v, v])),
        },
      ]);
    } else {
      setPublicQuestions((prev) => prev.filter((q) => q.stepId !== step.id));
    }
  }

  function updateQuestion(stepId: string, field: 'title', value: string): void;
  function updateQuestion(stepId: string, field: 'optionLabel', key: string, value: string): void;
  function updateQuestion(stepId: string, field: string, keyOrValue: string, value?: string) {
    setPublicQuestions((prev) => prev.map((q) => {
      if (q.stepId !== stepId) return q;
      if (field === 'title') return { ...q, title: keyOrValue };
      if (field === 'optionLabel') return { ...q, optionLabels: { ...q.optionLabels, [keyOrValue]: value ?? '' } };
      return q;
    }));
  }

  async function handleSave() {
    if (!slug.trim() || !title.trim()) { setError('El slug y el título son requeridos'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { setError('El slug solo puede tener letras minúsculas, números y guiones'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      const token = (await getToken()) ?? undefined;
      const res = await upsertFeedConfig(campaignId, {
        enabled, slug, title, description: description || null,
        showTotalCalls: true, showResponseRate: true,
        showRecentActivity, showPercentages: true,
        refreshIntervalSeconds,
        publicQuestions,
      }, token);
      setConfig(res.feedConfig);
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar el feed público? Esta acción no se puede deshacer.')) return;
    const token = (await getToken()) ?? undefined;
    await deleteFeedConfig(campaignId, token);
    setConfig(null);
    setSlug(slugify(campaignName));
    setTitle(campaignName);
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const feedUrl = config ? `${BASE_URL}/public/campaigns/${config.slug}` : null;
  const embedCode = config
    ? `<script src="${BASE_URL}/api/public/widget.js"></script>\n<div data-campaign="${config.slug}"></div>`
    : null;

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Feed público</h2>
          {config?.enabled && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />EN VIVO
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-600">¡Guardado!</span>}
          {config && !open && (
            <button onClick={handleDelete} className="text-xs text-red-400 hover:text-red-600">Eliminar</button>
          )}
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-indigo-600 hover:text-indigo-800">
            {open ? 'Cancelar' : config ? 'Editar' : 'Activar feed'}
          </button>
        </div>
      </div>

      {/* Collapsed summary */}
      {!open && config && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono text-slate-700">{feedUrl}</span>
            <button onClick={() => handleCopy(feedUrl!)} className="text-indigo-500 hover:text-indigo-700 text-[10px]">
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <details className="text-xs">
            <summary className="text-slate-400 cursor-pointer hover:text-slate-600">Código embed</summary>
            <pre className="mt-2 bg-slate-50 border border-slate-200 rounded-md p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all">
              {embedCode}
            </pre>
          </details>
        </div>
      )}

      {!open && !config && (
        <p className="text-xs text-slate-400 mt-1">Publicá los resultados de esta campaña en tiempo real.</p>
      )}

      {/* Editor */}
      {open && (
        <div className="mt-4 space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </div>
            <span className="text-sm font-medium text-slate-700">Feed habilitado</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Slug (URL) *</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="worldcup-2026"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Refresh (segundos)</label>
              <input
                type="number" min={5} max={60} value={refreshIntervalSeconds}
                onChange={(e) => setRefreshIntervalSeconds(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Título público *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="¿Quién gana el Mundial?"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Descripción (opcional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="La voz de la hinchada de Caballito"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showRecentActivity} onChange={(e) => setShowRecentActivity(e.target.checked)} className="accent-indigo-600" />
            Mostrar actividad reciente
          </label>

          {/* DTMF steps */}
          {dtmfSteps.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-600 mb-3">Preguntas a mostrar en el feed</p>
              <div className="space-y-4">
                {dtmfSteps.map((step) => {
                  const included = publicQuestions.find((q) => q.stepId === step.id);
                  return (
                    <div key={step.id} className="space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!included}
                          onChange={(e) => toggleStep(step, e.target.checked)}
                          className="accent-indigo-600 mt-0.5"
                        />
                        <span className="text-xs text-slate-600 font-mono">{step.id}: {step.text.slice(0, 60)}</span>
                      </label>
                      {included && (
                        <div className="ml-5 space-y-2 pl-3 border-l border-slate-200">
                          <input
                            value={included.title}
                            onChange={(e) => updateQuestion(step.id, 'title', e.target.value)}
                            className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            placeholder="Título público de la pregunta"
                          />
                          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Labels por opción (valor → etiqueta pública)</p>
                          {Object.entries(step.options ?? {}).map(([digit, val]) => (
                            <div key={digit} className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-slate-400 w-20 shrink-0">{digit} → {val}</span>
                              <input
                                value={included.optionLabels[val] ?? val}
                                onChange={(e) => updateQuestion(step.id, 'optionLabel', val, e.target.value)}
                                className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                placeholder={`Label para "${val}"`}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 text-white text-xs font-medium px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar feed público'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
