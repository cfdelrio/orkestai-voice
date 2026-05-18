'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  initiated:  '#94a3b8',
  ringing:    '#fbbf24',
  answered:   '#60a5fa',
  completed:  '#34d399',
  failed:     '#f87171',
  no_answer:  '#fb923c',
};

interface Props {
  callsByStatus: Record<string, number>;
  responsesByStep: Record<string, Record<string, number>>;
  stepLabels: Record<string, string>;
}

export function CampaignCharts({ callsByStatus, responsesByStep, stepLabels }: Props) {
  const callsData = Object.entries(callsByStatus).map(([status, count]) => ({ status, count }));

  return (
    <div className="space-y-6">
      {/* Calls by status bar chart */}
      {callsData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Distribución de llamadas</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={callsData} margin={{ left: -20 }}>
              <XAxis dataKey="status" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [value, 'llamadas']}
                labelFormatter={(l) => `Estado: ${l}`}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {callsData.map((entry) => (
                  <Cell
                    key={entry.status}
                    fill={STATUS_COLORS[entry.status] ?? '#a5b4fc'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* DTMF responses per step */}
      {Object.entries(responsesByStep).map(([stepId, answers]) => {
        const data = Object.entries(answers).map(([value, count]) => ({ value, count }));
        const label = stepLabels[stepId] ?? stepId;

        return (
          <div key={stepId} className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Paso: {stepId}</h2>
            <p className="text-xs text-slate-500 mb-4 truncate">{label}</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={data} margin={{ left: -20 }}>
                <XAxis dataKey="value" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(v) => [v, 'respuestas']} />
                <Bar dataKey="count" fill="#818cf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
