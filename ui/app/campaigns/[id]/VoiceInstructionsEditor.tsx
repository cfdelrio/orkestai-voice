'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { updateCampaign } from '@/lib/api';
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

interface Props {
  campaignId: string;
  initialInstructions: string;
  initialVoice?: string;
  initialTtsProvider?: string;
  initialElevenLabsVoiceId?: string;
}

export function VoiceInstructionsEditor({
  campaignId,
  initialInstructions,
  initialVoice = 'nova',
  initialTtsProvider = 'openai',
  initialElevenLabsVoiceId = 'ByVRQtaK1WDOvTmP1PKO',
}: Props) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [voice, setVoice] = useState(initialVoice);
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'elevenlabs'>(
    initialTtsProvider === 'elevenlabs' ? 'elevenlabs' : 'openai'
  );
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(initialElevenLabsVoiceId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const token = (await getToken()) ?? undefined;
      await updateCampaign(campaignId, {
        voiceInstructions: ttsProvider === 'openai' ? instructions : undefined,
        voice: ttsProvider === 'openai' ? voice : undefined,
        ttsProvider,
        elevenLabsVoiceId: ttsProvider === 'elevenlabs' ? elevenLabsVoiceId : undefined,
      }, token);
      setSaved(true);
      setSaveError('');
      setOpen(false);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveError((e as Error).message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const currentVoiceLabel = ttsProvider === 'elevenlabs'
    ? `ElevenLabs · ${elevenLabsVoiceId.slice(0, 8)}…`
    : `OpenAI · ${VOICE_OPTIONS.find((v) => v.value === voice)?.label ?? voice}`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-700">Voz e instrucciones</h2>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-600">Guardado — audio regenerado en la próxima llamada</span>}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {open ? 'Cancelar' : 'Editar'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          {/* Provider toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTtsProvider('openai')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors ${
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
              className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                ttsProvider === 'elevenlabs'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'border-slate-300 text-slate-600 hover:border-purple-300'
              }`}
            >
              ElevenLabs
            </button>
          </div>

          {ttsProvider === 'openai' ? (
            <>
              {/* OpenAI voice picker */}
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

              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none font-mono"
                placeholder="Ej: Hablá con acento rioplatense, tono cálido y profesional..."
              />

              <VoicePreviewPlayer voiceInstructions={instructions} voice={voice} ttsProvider="openai" />
            </>
          ) : (
            <>
              {/* ElevenLabs voice picker */}
              <ElevenLabsVoicePicker value={elevenLabsVoiceId} onChange={setElevenLabsVoiceId} />

              <VoicePreviewPlayer ttsProvider="elevenlabs" elevenLabsVoiceId={elevenLabsVoiceId} />
            </>
          )}

          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{saveError}</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 text-white text-xs font-medium px-4 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar y limpiar caché'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{currentVoiceLabel}</span>
          {ttsProvider === 'openai' && (
            <>
              <span className="text-slate-300">·</span>
              <span className="font-mono leading-relaxed flex-1 truncate">
                {instructions || <span className="italic text-slate-400">Sin instrucciones</span>}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
