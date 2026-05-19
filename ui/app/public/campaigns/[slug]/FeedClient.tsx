'use client';

import { useEffect, useRef, useState } from 'react';

const API_URL = typeof window === 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? '');

const OPTION_COLORS = [
  { bar: 'from-indigo-500 to-blue-400', text: 'text-indigo-400' },
  { bar: 'from-purple-500 to-fuchsia-400', text: 'text-purple-400' },
  { bar: 'from-cyan-500 to-teal-400', text: 'text-cyan-400' },
  { bar: 'from-emerald-500 to-green-400', text: 'text-emerald-400' },
  { bar: 'from-amber-500 to-yellow-400', text: 'text-amber-400' },
  { bar: 'from-rose-500 to-red-400', text: 'text-rose-400' },
];

interface FeedResult { value: string; label: string; votes: number; percentage: number }
interface FeedQuestion { id: string; title: string; results: FeedResult[] }
interface ActivityItem { firstName: string; city: string | null; response: string; createdAt: string }
interface FeedData {
  config: { refreshIntervalSeconds: number; showRecentActivity: boolean };
  campaign: { name: string; description: string | null; status: string; updatedAt: string };
  stats?: { totalCalls: number; answered: number; responseRate?: number };
  questions: FeedQuestion[];
  recentActivity: ActivityItem[];
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `hace ${diff}s`;
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  return `hace ${Math.floor(diff / 3600)}h`;
}

function Shimmer() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="h-6 w-2/3 bg-slate-800 rounded" />
      <div className="h-4 w-1/2 bg-slate-800 rounded" />
      <div className="grid grid-cols-3 gap-3 my-4">
        {[0,1,2].map(i => <div key={i} className="h-14 bg-slate-800 rounded" />)}
      </div>
      {[0,1].map(i => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-3/4 bg-slate-800 rounded" />
          <div className="h-3 bg-slate-800 rounded" />
          <div className="h-3 w-2/3 bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  );
}

export function FeedClient({ slug, initialData }: { slug: string; initialData: FeedData }) {
  const [data, setData] = useState<FeedData>(initialData);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [ticker, setTicker] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling
  useEffect(() => {
    const refresh = () => {
      fetch(`${API_URL}/api/public/campaigns/${slug}/feed`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d) { setData(d); setLastUpdate(Date.now()); } })
        .catch(() => {});
    };

    const ms = (data.config.refreshIntervalSeconds ?? 10) * 1000;
    intervalRef.current = setInterval(refresh, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [slug, data.config.refreshIntervalSeconds]);

  // Relative timestamp ticker (updates every second)
  useEffect(() => {
    const t = setInterval(() => setTicker((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const isLive = data.campaign.status === 'running';
  const isEnded = data.campaign.status === 'completed';
  const secAgo = Math.floor((Date.now() - lastUpdate) / 1000);
  void ticker; // consumed to trigger re-render

  return (
    <div className="min-h-screen bg-slate-950 flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-lg">

        {/* Hero */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden mb-4">
          <div className="px-6 pt-6 pb-5 border-b border-slate-800">
            <div className="flex items-center gap-3 mb-3">
              {isLive && (
                <span className="flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-md">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  EN VIVO
                </span>
              )}
              {isEnded && (
                <span className="flex items-center gap-1.5 bg-slate-700 text-slate-300 text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-md">
                  FINALIZADA
                </span>
              )}
              <span className="text-lg">⚽</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight leading-tight">
              {data.campaign.name}
            </h1>
            {data.campaign.description && (
              <p className="mt-1.5 text-sm text-slate-400">{data.campaign.description}</p>
            )}
          </div>

          {/* KPIs */}
          {data.stats && (
            <div className="grid grid-cols-3 divide-x divide-slate-800">
              {data.stats.totalCalls !== undefined && (
                <div className="px-4 py-4 text-center">
                  <div className="text-2xl font-black text-white">{data.stats.totalCalls.toLocaleString('es-AR')}</div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Llamadas</div>
                </div>
              )}
              {data.stats.answered !== undefined && (
                <div className="px-4 py-4 text-center">
                  <div className="text-2xl font-black text-white">{data.stats.answered.toLocaleString('es-AR')}</div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Respuestas</div>
                </div>
              )}
              {data.stats.responseRate !== undefined && (
                <div className="px-4 py-4 text-center">
                  <div className="text-2xl font-black text-indigo-400">{data.stats.responseRate}%</div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Participación</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Questions */}
        {data.questions.map((q) => {
          const total = q.results.reduce((a, r) => a + r.votes, 0);
          return (
            <div key={q.id} className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden mb-4 p-6">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">{q.title}</p>
              <div className="space-y-4">
                {q.results.map((r, i) => {
                  const colors = OPTION_COLORS[i % OPTION_COLORS.length];
                  const pct = total > 0 ? Math.round((r.votes / total) * 100) : 0;
                  return (
                    <div key={r.value}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-base font-bold text-slate-100">{r.label}</span>
                        <span className={`text-xl font-black ${colors.text}`}>{pct}%</span>
                      </div>
                      <div className="relative h-2.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`absolute inset-y-0 left-0 bg-gradient-to-r ${colors.bar} rounded-full transition-all duration-1000 ease-out`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-600 mt-1.5">{r.votes.toLocaleString('es-AR')} votos</p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Recent activity */}
        {data.config.showRecentActivity && data.recentActivity.length > 0 && (
          <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden mb-4">
            <div className="px-6 py-4 border-b border-slate-800">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Actividad reciente</p>
            </div>
            <div className="divide-y divide-slate-800/60">
              {data.recentActivity.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-3.5">
                  <span className="text-xl flex-shrink-0">⚽</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-400">
                      {item.firstName}{item.city ? ` desde ${item.city}` : ''} ·{' '}
                    </span>
                    <span className="text-sm font-semibold text-white">{item.response}</span>
                  </div>
                  <span className="text-xs text-slate-600 flex-shrink-0 tabular-nums">
                    {timeAgo(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-1 text-xs text-slate-600">
          <span>
            {secAgo < 5 ? 'Actualizado ahora' : `Actualizado hace ${secAgo}s`}
          </span>
          <a
            href="https://voice.orkestai.com.ar"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-400 transition-colors"
          >
            Orkestai Voice
          </a>
        </div>
      </div>
    </div>
  );
}
