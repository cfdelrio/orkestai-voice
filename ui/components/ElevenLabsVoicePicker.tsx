'use client';

import { useEffect, useState } from 'react';
import { getElevenLabsVoices } from '@/lib/api';

const PRESET_VOICE = { voiceId: 'ByVRQtaK1WDOvTmP1PKO', name: 'Voz personalizada', category: 'premade' };

interface Voice { voiceId: string; name: string; category: string }

interface Props {
  value: string;
  onChange: (voiceId: string) => void;
}

export function ElevenLabsVoicePicker({ value, onChange }: Props) {
  const [voices, setVoices] = useState<Voice[]>([PRESET_VOICE]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getElevenLabsVoices()
      .then((v) => {
        const merged = [
          PRESET_VOICE,
          ...v.filter((x) => x.voiceId !== PRESET_VOICE.voiceId),
        ];
        setVoices(merged);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <p className="text-xs text-red-500">Error al cargar voces: {error}</p>;

  return (
    <div className="space-y-1.5">
      {loading && <p className="text-xs text-slate-400">Cargando voces ElevenLabs…</p>}
      <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
        {voices.map((v) => (
          <button
            key={v.voiceId}
            type="button"
            onClick={() => onChange(v.voiceId)}
            className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors ${
              value === v.voiceId
                ? 'border-purple-500 bg-purple-50 text-purple-700'
                : 'border-slate-200 hover:border-slate-300 text-slate-600'
            }`}
          >
            <span className="text-sm font-medium truncate w-full">{v.name}</span>
            <span className="text-xs text-slate-400">{v.category}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
