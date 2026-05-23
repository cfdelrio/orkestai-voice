'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { VoicePreviewPlayer } from '@/components/VoicePreviewPlayer';
import { ElevenLabsVoicePicker } from '@/components/ElevenLabsVoicePicker';
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

const VOICE_OPTIONS = [
  { value: 'nova',    label: 'Nova',    desc: 'Femenina · cálida' },
  { value: 'shimmer', label: 'Shimmer', desc: 'Femenina · suave' },
  { value: 'alloy',   label: 'Alloy',   desc: 'Neutral' },
  { value: 'echo',    label: 'Echo',    desc: 'Masculina · natural' },
  { value: 'onyx',    label: 'Onyx',    desc: 'Masculina · profunda' },
  { value: 'fable',   label: 'Fable',   desc: 'Masculina · narrativa' },
];

function StepVoicePanel({
  step, index, ttsProvider, voiceOptions, onUpdate,
}: {
  step: FlowStep;
  index: number;
  ttsProvider: string;
  voiceOptions: { value: string; label: string; desc: string }[];
  onUpdate: (i: number, patch: Partial<FlowStep>) => void;
}) {
  const [open, setOpen] = useState(!!(step.voice || step.voiceInstructions));
  const hasOverride = !!(step.voice || step.voiceInstructions);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ${
          hasOverride
            ? 'border-indigo-300 text-indigo-600 bg-indigo-50'
            : 'border-slate-200 text-slate-400 hover:border-slate-300'
        }`}
      >
        {hasOverride ? '✓ Voz propia' : '+ Personalizar voz de este paso'}
      </button>
      {open && ttsProvider === 'openai' && (
        <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            <button type="button" onClick={() => onUpdate(index, { voice: undefined })}
              className={`px-2 py-1.5 rounded border text-xs transition-colors ${!step.voice ? 'border-slate-400 bg-white font-medium' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              Heredar
            </button>
            {voiceOptions.map((v) => (
              <button key={v.value} type="button" onClick={() => onUpdate(index, { voice: v.value })}
                className={`px-2 py-1.5 rounded border text-xs transition-colors ${step.voice === v.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <textarea
            value={step.voiceInstructions ?? ''}
            onChange={(e) => onUpdate(index, { voiceInstructions: e.target.value || undefined })}
            rows={2}
            placeholder="Instrucciones de pronunciación para este paso…"
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none font-mono"
          />
        </div>
      )}
      {open && ttsProvider !== 'openai' && (
        <p className="mt-1 text-xs text-slate-400">Voz ElevenLabs por step disponible en la edición de la campaña.</p>
      )}
    </div>
  );
}

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
  const [variables, setVariables] = useState<{ key: string; value: string }[]>([
    { key: 'brandName', value: '' },
  ]);
  const [voiceInstructions, setVoiceInstructions] = useState(
    'Hablá con acento rioplatense, tono cálido y profesional. Ritmo natural, sin apuro. Cuando saludes usá "Hola" y tuteo.'
  );
  const [voice, setVoice] = useState('nova');
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'elevenlabs'>('openai');
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('ByVRQtaK1WDOvTmP1PKO');

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

  function updateVariable(index: number, field: 'key' | 'value', val: string) {
    setVariables((prev) => prev.map((v, i) => i === index ? { ...v, [field]: val } : v));
  }

  function addVariable() {
    setVariables((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeVariable(index: number) {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  }

  function buildVariablesMap(): Record<string, string> {
    return Object.fromEntries(
      variables.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value])
    );
  }

  async function handleCreateCampaign() {
    if (!name.trim()) { setError('El nombre es requerido'); return; }
    setLoading(true); setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      const res = await createCampaign(tenantId, {
        name: name.trim(),
        description: description.trim() || undefined,
        variables: buildVariablesMap(),
        voiceInstructions: ttsProvider === 'openai' ? voiceInstructions.trim() || undefined : undefined,
        voice: ttsProvider === 'openai' ? voice : undefined,
        ttsProvider,
        elevenLabsVoiceId: ttsProvider === 'elevenlabs' ? elevenLabsVoiceId : undefined,
      }, token);
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
        delete updated.maxLength;
      }
      if (update.type === 'speech_question') {
        updated.maxLength = updated.maxLength ?? 30;
        updated.timeout = updated.timeout ?? 5;
        delete updated.options;
        delete updated.maxDigits;
      }
      if (update.type && update.type !== 'dtmf_question' && update.type !== 'speech_question') {
        delete updated.options;
        delete updated.maxDigits;
        delete updated.maxLength;
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

            {/* TTS provider toggle */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Motor de voz</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTtsProvider('openai')}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    ttsProvider === 'openai'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-slate-300 text-slate-600 hover:border-indigo-300'
                  }`}
                >
                  OpenAI TTS
                </button>
                <button
                  type="button"
                  onClick={() => setTtsProvider('elevenlabs')}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    ttsProvider === 'elevenlabs'
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'border-slate-300 text-slate-600 hover:border-purple-300'
                  }`}
                >
                  ElevenLabs
                </button>
              </div>
            </div>

            {ttsProvider === 'openai' ? (
              <>
                {/* OpenAI voice selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Voz</label>
                  <div className="grid grid-cols-3 gap-2">
                    {VOICE_OPTIONS.map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => setVoice(v.value)}
                        className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${
                          voice === v.value
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <span className="text-sm font-medium">{v.label}</span>
                        <span className="text-xs text-slate-400">{v.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice instructions */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Instrucciones de voz
                    <span className="text-slate-400 font-normal ml-1">(cómo debe hablar el asistente)</span>
                  </label>
                  <textarea
                    value={voiceInstructions}
                    onChange={(e) => setVoiceInstructions(e.target.value)}
                    rows={3}
                    placeholder="Ej: Hablá con acento rioplatense, tono cálido y profesional..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Podés pedir acento, tono, velocidad, estilo. Se pasan directamente al motor de voz IA.
                  </p>
                  <VoicePreviewPlayer voiceInstructions={voiceInstructions} voice={voice} ttsProvider="openai" />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Voz ElevenLabs</label>
                <ElevenLabsVoicePicker value={elevenLabsVoiceId} onChange={setElevenLabsVoiceId} />
                <VoicePreviewPlayer ttsProvider="elevenlabs" elevenLabsVoiceId={elevenLabsVoiceId} />
              </div>
            )}

            {/* Campaign variables */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Variables de la campaña</label>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Usá <code className="bg-slate-100 px-1 rounded">{'{{nombre}}'}</code> en los textos del flujo para insertar estos valores.
                    Los datos del contacto (<code className="bg-slate-100 px-1 rounded">{'{{firstName}}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{{lastName}}'}</code>, <code className="bg-slate-100 px-1 rounded">{'{{phone}}'}</code>) siempre están disponibles.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {variables.map((v, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={v.key}
                      onChange={(e) => updateVariable(i, 'key', e.target.value)}
                      placeholder="nombre de variable"
                      className="w-36 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <span className="text-slate-400 text-sm shrink-0">=</span>
                    <input
                      type="text"
                      value={v.value}
                      onChange={(e) => updateVariable(i, 'value', e.target.value)}
                      placeholder="valor"
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeVariable(i)}
                      className="text-slate-400 hover:text-red-500 transition-colors shrink-0 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addVariable}
                  className="w-full border border-dashed border-slate-300 text-slate-500 text-xs rounded-lg py-1.5 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                >
                  + Agregar variable
                </button>
              </div>
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
          <h2 className="font-semibold text-slate-800 mb-5">Flujo de voz</h2>

          {/* Available variables reference */}
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800 mb-1.5">Variables disponibles en los textos</p>
            <div className="flex flex-wrap gap-1.5">
              {['firstName', 'lastName', 'phone'].map((v) => (
                <span key={v} className="inline-flex items-center gap-1 bg-white border border-amber-200 text-amber-700 text-xs font-mono px-2 py-0.5 rounded">
                  {`{{${v}}}`}
                  <span className="text-amber-400 font-sans">contacto</span>
                </span>
              ))}
              {variables.filter((v) => v.key.trim()).map((v) => (
                <span key={v.key} className="inline-flex items-center gap-1 bg-white border border-indigo-200 text-indigo-700 text-xs font-mono px-2 py-0.5 rounded">
                  {`{{${v.key}}}`}
                  {v.value && <span className="text-indigo-400 font-sans truncate max-w-[80px]">{v.value}</span>}
                </span>
              ))}
              {variables.filter((v) => v.key.trim()).length === 0 && (
                <span className="text-xs text-amber-600 italic">No hay variables de campaña definidas</span>
              )}
            </div>
          </div>

          <p className="text-sm font-medium text-slate-700 mb-3">Pasos del flujo</p>
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
                    <option value="speech_question">Pregunta de voz</option>
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
                {s.text.trim() && s.type !== 'speech_question' && (
                  <VoicePreviewPlayer
                    voiceInstructions={ttsProvider === 'openai' ? (s.voiceInstructions ?? voiceInstructions) : undefined}
                    voice={ttsProvider === 'openai' ? (s.voice ?? voice) : undefined}
                    ttsProvider={ttsProvider}
                    elevenLabsVoiceId={ttsProvider === 'elevenlabs' ? (s.elevenLabsVoiceId ?? elevenLabsVoiceId) : undefined}
                    defaultText={s.text}
                  />
                )}
                {/* Per-step voice override */}
                <StepVoicePanel
                  step={s}
                  index={i}
                  ttsProvider={ttsProvider}
                  voiceOptions={VOICE_OPTIONS}
                  onUpdate={updateFlowStep}
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
                {s.type === 'speech_question' && (
                  <div className="mt-2 flex gap-3 text-xs text-slate-500">
                    <label className="flex items-center gap-1">
                      Duración máx (s):
                      <input
                        type="number" min={5} max={120} value={s.maxLength ?? 30}
                        onChange={(e) => updateFlowStep(i, { maxLength: Number(e.target.value) })}
                        className="w-14 border border-slate-200 rounded px-1 py-0.5 ml-1"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      Silencio (s):
                      <input
                        type="number" min={2} max={15} value={s.timeout ?? 5}
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
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-slate-800">Seleccioná los contactos</h2>
              <p className="text-sm text-slate-500 mt-0.5">{selectedIds.size} de {contacts.length} seleccionado{selectedIds.size !== 1 ? 's' : ''}</p>
            </div>
            {contacts.length > 0 && (
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelectedIds(new Set(contacts.map((c) => c.id)))}
                  className="text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Todos
                </button>
                <span className="text-slate-300">|</span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-slate-500 hover:text-slate-700"
                >
                  Ninguno
                </button>
              </div>
            )}
          </div>

          {contacts.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <p className="text-3xl mb-3">👥</p>
              <p className="font-medium text-slate-600 text-sm">No tenés contactos todavía</p>
              <p className="text-xs mt-1 mb-4">Agregá contactos desde la sección Contactos antes de crear una campaña</p>
              <a
                href="/contacts"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm bg-indigo-600 text-white font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Ir a Contactos →
              </a>
            </div>
          ) : (
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
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleAddRecipients}
              disabled={loading || selectedIds.size === 0}
              className="bg-indigo-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Agregando...' : `Continuar con ${selectedIds.size > 0 ? selectedIds.size : ''} contacto${selectedIds.size !== 1 ? 's' : ''} →`}
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
