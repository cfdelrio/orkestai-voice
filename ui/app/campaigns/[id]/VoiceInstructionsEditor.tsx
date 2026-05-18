'use client';

import { useState } from 'react';
import { updateCampaign } from '@/lib/api';

interface Props {
  campaignId: string;
  initialInstructions: string;
  token?: string;
}

export function VoiceInstructionsEditor({ campaignId, initialInstructions, token }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialInstructions);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateCampaign(campaignId, { voiceInstructions: value }, token);
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert('Error al guardar las instrucciones de voz');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-700">Instrucciones de voz</h2>
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
        <div className="mt-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none font-mono"
            placeholder="Ej: Hablá con acento rioplatense, tono cálido y profesional..."
          />
          <div className="flex justify-end gap-2 mt-2">
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
        <p className="text-xs text-slate-500 mt-1 font-mono leading-relaxed">
          {value || <span className="italic text-slate-400">Sin instrucciones configuradas</span>}
        </p>
      )}
    </div>
  );
}
