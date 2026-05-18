'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import {
  createCampaign,
  setFlow,
  addRecipients,
  startCampaign,
  listContacts,
  type FlowStep,
  type Contact,
} from '@/lib/api';
import { useTenant } from '@/app/providers';
import Link from 'next/link';

type Step = 'info' | 'flow' | 'contacts' | 'start';

const STEPS: { key: Step; label: string }[] = [
  { key: 'info', label: '1. Info' },
  { key: 'flow', label: '2. Flow' },
  { key: 'contacts', label: '3. Contactos' },
  { key: 'start', label: '4. Lanzar' },
];

const EMPTY_FLOW_STEP = (): FlowStep => ({
  id: `step-${Date.now()}`,
  type: 'say',
  text: '',
});

export default function NewCampaignPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { tenantId } = useTenant();

  const [step, setStep] = useState<Step>('info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // Step 2
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>([
    { id: 'intro', type: 'say', text: 'Hola {{firstName}}, te llama {{brandName}}.' },
    { id: 'q1', type: 'dtmf_question', text: 'Presioná 1 para Sí, 2 para No.', maxDigits: 1, timeout: 8, options: { '1': 'yes', '2': 'no' } },
    { id: 'fin', type: 'goodbye', text: 'Gracias. ¡Hasta pronto!' },
  ]);

  // Step 3
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contactsLoaded, setContactsLoaded] = useState(false);

  // ─── Step handlers ──────────────────────────────────────────────────────────

  async function handleCreateCampaign() {
    if (!name.trim()) { setError('El nombre es requerido'); return; }
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      const res = await createCampaign(tenantId, { name: name.trim(), description: description.trim() || undefined }, token);
      setCampaignId(res.campaign.id);
      setStep('flow');
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function handleSetFlow() {
    if (!campaignId) return;
    const invalid = flowSteps.find((s) => !s.text.trim());
    if (invalid) { setError('Todos los pasos necesitan texto'); return; }
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await setFlow(campaignId, flowSteps, token);
      if (!contactsLoaded) {
        const res = await listContacts(tenantId, token);
        setContacts(res.contacts);
        setContactsLoaded(true);
      }
      setStep('contacts');
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function handleAddRecipients() {
    if (!campaignId) return;
    if (selectedIds.size === 0) { setError('Seleccioná al menos un contacto'); return; }
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await addRecipients(campaignId, Array.from(selectedIds), token);
      setStep('start');
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function handleStart() {
    if (!campaignId) return;
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      await startCampaign(campaignId, token);
      router.push(`/campaigns/${campaignId}`);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  // ─── Flow step editors ──────────────────────────────────────────────────────

  function updateFlowStep(index: number, update: Partial<FlowStep>) {
    setFlowSteps((prev) => prev.map((s, i) => {
      if (i !== index) return s;
      const updated = { ...s, ...update };
      if (update.type === 'dtmf_question' && !updated.options) {
        updated.options = { '1': 'yes', '2': 'no' };
        updated.maxDigits = updated.maxDigits ?? 1;
        updated.timeout = updated.timeout ?? 8;
      }
      if (update.type && update.type !== 'dtmf_question') {
        delete updated.options;
        delete updated.maxDigits;
        delete updated.timeout;
      }
      return updated;
    }));
  }

  function addFlowStep() {
    setFlowSteps((prev) => [...prev, EMPTY_FLOW_STEP()]);
  }

  function removeFlowStep(index: number) {
    setFlowSteps((prev) => prev.filter((_, i) => i !== index));
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <Link href="/" className="hover:text-slate-700">Campañas</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Nueva campaña</span>
      </div>

      {/* Progress */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((s) => (
          <div
            key={s.key}
            className={`flex-1 h-1.5 rounded-full transition-colors ${
              step === s.key ? 'bg-indigo-500' :
              STEPS.findIndex(x => x.key === step) > STEPS.findIndex(x => x.key === s.key)
                ? 'bg-indigo-200' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-5">
          {error}
        </div>
      )}

      {/* Step 1: Info */}
      {step === 'info' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-5">Información de la campaña</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Encuesta Mayo 2026"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Descripción (opcional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleCreateCampaign}
              disabled={loading}
              className="bg-indigo-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creando...' : 'Continuar →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Flow */}
      {step === 'flow' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-5">Pasos del flujo de voz</h2>
          <div className="space-y-3">
            {flowSteps.map((s, i) => (
              <div key={s.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <select
                    value={s.type}
                    onChange={(e) => updateFlowStep(i, { type: e.target.value as FlowStep['type'] })}
                    className="border border-slate-300 rounded-md px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="say">Decir</option>
                    <option value="dtmf_question">Pregunta DTMF</option>
                    <option value="goodbye">Despedida</option>
                  </select>
                  <span className="text-xs text-slate-400 font-mono flex-1">id: {s.id}</span>
                  {flowSteps.length > 1 && (
                    <button onClick={() => removeFlowStep(i)} className="text-xs text-red-400 hover:text-red-600">
                      Eliminar
                    </button>
                  )}
                </div>
                <textarea
                  value={s.text}
                  onChange={(e) => updateFlowStep(i, { text: e.target.value })}
                  placeholder="Texto a reproducir..."
                  rows={2}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
                {s.type === 'dtmf_question' && (
                  <div className="mt-2 flex gap-3 text-xs text-slate-500">
                    <label className="flex items-center gap-1">
                      Dígitos:
                      <input
                        type="number" min={1} max={9} value={s.maxDigits ?? 1}
                        onChange={(e) => updateFlowStep(i, { maxDigits: Number(e.target.value) })}
                        className="w-12 border border-slate-200 rounded px-1 py-0.5 ml-1"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      Timeout (s):
                      <input
                        type="number" min={3} max={30} value={s.timeout ?? 8}
                        onChange={(e) => updateFlowStep(i, { timeout: Number(e.target.value) })}
                        className="w-12 border border-slate-200 rounded px-1 py-0.5 ml-1"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addFlowStep}
            className="mt-3 w-full border border-dashed border-slate-300 text-slate-500 text-sm rounded-lg py-2 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          >
            + Agregar paso
          </button>
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSetFlow}
              disabled={loading}
              className="bg-indigo-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Guardando...' : 'Continuar →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Contacts */}
      {step === 'contacts' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-1">Seleccioná los contactos</h2>
          <p className="text-sm text-slate-500 mb-5">{selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}</p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={(e) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(c.id) : next.delete(c.id);
                      return next;
                    });
                  }}
                  className="accent-indigo-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700">{c.firstName} {c.lastName ?? ''}</p>
                  <p className="text-xs text-slate-500">{c.phone}</p>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleAddRecipients}
              disabled={loading || selectedIds.size === 0}
              className="bg-indigo-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Agregando...' : 'Continuar →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Start */}
      {step === 'start' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
          <div className="text-5xl mb-4">🚀</div>
          <h2 className="font-semibold text-slate-800 text-lg mb-2">Todo listo</h2>
          <p className="text-sm text-slate-500 mb-6">
            La campaña <strong>{name}</strong> está configurada con {selectedIds.size} destinatario{selectedIds.size !== 1 ? 's' : ''} y {flowSteps.length} pasos de voz.
          </p>
          <button
            onClick={handleStart}
            disabled={loading}
            className="bg-indigo-600 text-white font-medium px-8 py-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Lanzando...' : '📞 Lanzar campaña'}
          </button>
        </div>
      )}
    </div>
  );
}
