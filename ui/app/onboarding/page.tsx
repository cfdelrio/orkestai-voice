'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createTenantOnboarding } from '@/lib/api';

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN ?? 'voice.orkestai.com.ar';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 32);
}

export default function OnboardingPage() {
  const { getToken } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(toSlug(value));
  }

  function handleSlugChange(value: string) {
    setSlugEdited(true);
    setSlug(toSlug(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No autenticado');
      await createTenantOnboarding(name.trim(), slug, token);
      window.location.href = `https://${slug}.${BASE_DOMAIN}`;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <span className="text-indigo-600 text-2xl">◈</span>
          <h1 className="text-xl font-bold text-slate-800">Configurá tu organización</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Nombre de la organización
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="ej: Prode Caballito"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              URL de tu dashboard
            </label>
            <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
              <input
                type="text"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="miorganizacion"
                className="flex-1 px-3 py-2 text-sm focus:outline-none min-w-0"
                required
              />
              <span className="bg-slate-50 border-l border-slate-300 px-3 py-2 text-sm text-slate-500 shrink-0">
                .{BASE_DOMAIN}
              </span>
            </div>
            {slug && (
              <p className="text-xs text-slate-500 mt-1.5">
                Tu dashboard: <span className="font-medium text-indigo-600">{slug}.{BASE_DOMAIN}</span>
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !slug || !name.trim()}
            className="w-full bg-indigo-600 text-white font-medium py-2.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creando...' : 'Crear organización'}
          </button>
        </form>
      </div>
    </div>
  );
}
