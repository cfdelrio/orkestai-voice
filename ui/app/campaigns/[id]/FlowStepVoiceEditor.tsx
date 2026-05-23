'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { setFlow, type FlowStep } from '@/lib/api';
import { VoicePreviewPlayer } from '@/components/VoicePreviewPlayer';
import { ElevenLabsVoicePicker } from '@/components/ElevenLabsVoicePicker';

const VOICE_OPTIONS = [
  { value: 'nova',    label: 'Nova',    desc: 'Femenina · cálida' },
  { value: 'shimmer', label: 'Shimmer', desc: 'Femenina · suave' },
  { value: 'alloy',   label: 'Alloy',   desc: 'Neutral' },
  { value: 'echo',    label: 'Echo',    desc: 'Masculina · natural' },
  { value: 'onyx',    label: 'Onyx',    desc: 'Masculina · profunda' },
  { value: 'fable',   label: 'Fable',   desc: 'Masculina · narrativa' },
];

const STEP_TYPE_LABEL: Record<string, string> = {
  say: 'Decir',
  dtmf_question: 'Pregunta DTMF',
  speech_question: 'Pregunta de voz',
  goodbye: 'Despedida',
};

interface Props {
  campaignId: string;
  initialSteps: FlowStep[];
  ttsProvider: string;
}

function StepRow({
  step,
  ttsProvider,
  onChange,
}: {
  step: FlowStep;
  ttsProvider: string;
  onChange: (patch: Partial<FlowStep>) => void;
}) {
  const [open, setOpen] = useState(!!(step.voice || step.elevenLabsVoiceId || step.voiceInstructions));
  const hasOverride = !!(step.voice || step.elevenLabsVoiceId || step.voiceInstructions);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50">
        <span className="text-xs font-medium text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded">
          {STEP_TYPE_LABEL[step.type] ?? step.type}
        </span>
        <p className="text-sm text-slate-700 flex-1 truncate">{step.text || <span className="italic text-slate-400">sin texto</span>}</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ${
            hasOverride
              ? 'border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
              : 'border-slate-200 text-slate-500 hover:border-slate-300'
          }`}
        >
          {open ? '↑ Cerrar' : hasOverride ? '✓ Voz propia' : '+ Personalizar voz'}
        </button>
      </div>

      {open && (
        <div className="px-4 py-4 space-y-3 border-t border-slate-100">
          {ttsProvider === 'openai' ? (
            <>
              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Voz para este step</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({ voice: undefined })}
                    className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors text-xs ${
                      !step.voice
                        ? 'border-slate-400 bg-slate-100 text-slate-700'
                        : 'border-slate-200 hover:border-slate-300 text-slate-500'
                    }`}
                  >
                    <span className="font-medium">Heredar</span>
                    <span className="text-slate-400">voz de campaña</span>
                  </button>
                  {VOICE_OPTIONS.map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => onChange({ voice: v.value })}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors text-xs ${
                        step.voice === v.value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <span className="font-medium">{v.label}</span>
                      <span className="text-slate-400">{v.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-1">Instrucciones de pronunciación</p>
                <textarea
                  value={step.voiceInstructions ?? ''}
                  onChange={(e) => onChange({ voiceInstructions: e.target.value || undefined })}
                  rows={2}
                  placeholder="Ej: Pronunciá 'García' con acento en la a. Hablá despacio en este paso."
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none font-mono"
                />
              </div>

              {step.text && (
                <VoicePreviewPlayer
                  voiceInstructions={step.voiceInstructions}
                  voice={step.voice}
                  ttsProvider="openai"
                  defaultText={step.text}
                />
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Voz ElevenLabs para este step</p>
                <p className="text-xs text-slate-400 mb-2">Dejá vacío para usar la voz de campaña</p>
                <ElevenLabsVoicePicker
                  value={step.elevenLabsVoiceId ?? ''}
                  onChange={(id) => onChange({ elevenLabsVoiceId: id || undefined })}
                />
              </div>
              {step.text && (
                <VoicePreviewPlayer
                  ttsProvider="elevenlabs"
                  elevenLabsVoiceId={step.elevenLabsVoiceId}
                  defaultText={step.text}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function FlowStepVoiceEditor({ campaignId, initialSteps, ttsProvider }: Props) {
  const { getToken } = useAuth();
  const [steps, setSteps] = useState<FlowStep[]>(initialSteps);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  function updateStep(index: number, patch: Partial<FlowStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const token = (await getToken()) ?? undefined;
      await setFlow(campaignId, steps, token);
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveError((e as Error).message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const stepsWithOverride = steps.filter((s) => s.voice || s.elevenLabsVoiceId || s.voiceInstructions).length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-700">Voz por step</h2>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-600">Guardado</span>}
          {stepsWithOverride > 0 && !open && (
            <span className="text-xs text-indigo-600">{stepsWithOverride} step{stepsWithOverride !== 1 ? 's' : ''} con voz propia</span>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {open ? 'Cancelar' : 'Editar'}
          </button>
        </div>
      </div>

      {!open && (
        <p className="text-xs text-slate-400 mt-1">
          Asigná una voz o instrucciones de pronunciación distintas a cada paso del flow.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-2">
          {steps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              ttsProvider={ttsProvider}
              onChange={(patch) => updateStep(i, patch)}
            />
          ))}

          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{saveError}</p>
          )}
          <div className="flex justify-end pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 text-white text-xs font-medium px-4 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar y limpiar caché'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
