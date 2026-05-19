'use client';

import { useEffect, useRef, useState } from 'react';
import { previewAudio } from '@/lib/api';

interface Props {
  voiceInstructions?: string;
  voice?: string;
  defaultText?: string;
  ttsProvider?: string;
  elevenLabsVoiceId?: string;
}

export function VoicePreviewPlayer({ voiceInstructions, voice, defaultText = 'Hola María, gracias por atender.', ttsProvider, elevenLabsVoiceId }: Props) {
  const [text, setText] = useState(defaultText);

  // Keep in sync when the parent step text changes
  useEffect(() => { setText(defaultText); }, [defaultText]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const prevBlobUrl = useRef('');

  // Auto-play when a new URL is ready
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
    }
  }, [audioUrl]);

  // Revoke blob URLs on unmount to free memory
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    };
  }, []);

  async function handleGenerate() {
    if (!text.trim()) return;
    setLoading(true);
    setError('');
    try {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
      const url = await previewAudio(text.trim(), voiceInstructions || undefined, voice || undefined, ttsProvider || undefined, elevenLabsVoiceId || undefined);
      prevBlobUrl.current = url;
      setAudioUrl(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al generar audio';
      setError(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
      <p className="text-xs font-medium text-slate-500">Probar voz</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
          placeholder="Escribí un texto de prueba..."
          className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !text.trim()}
          className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-medium px-3 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generando…
            </>
          ) : (
            <>▶ Escuchar</>
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          controls
          className="w-full h-8"
          style={{ height: '32px' }}
        />
      )}
    </div>
  );
}
