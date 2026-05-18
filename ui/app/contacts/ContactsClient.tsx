'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createContact, deleteContact, type Contact } from '@/lib/api';

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useState(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); });
  return (
    <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-[100] flex items-center gap-2 ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
      {type === 'success'
        ? <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      }
      {message}
    </div>
  );
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

interface ParsedRow { firstName: string; lastName?: string; phone: string; email?: string; }

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const separator = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(separator).map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));

  const colIndex = (names: string[]) => {
    for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i; }
    return -1;
  };

  const fnIdx = colIndex(['firstname', 'nombre', 'name', 'nombres']);
  const lnIdx = colIndex(['lastname', 'apellido', 'apellidos', 'surname']);
  const phoneIdx = colIndex(['phone', 'telefono', 'tel', 'celular', 'movil', 'mobile']);
  const emailIdx = colIndex(['email', 'correo', 'mail']);

  if (phoneIdx === -1) return [];

  const dataLines = fnIdx === -1 ? lines : lines.slice(1);

  return dataLines.map((line) => {
    const cols = line.split(separator).map((c) => c.trim().replace(/^["']|["']$/g, ''));
    const phone = normalizePhone(cols[phoneIdx] ?? '');
    const firstName = fnIdx !== -1 ? (cols[fnIdx] ?? '').trim() : (cols[0] ?? '').trim();
    return {
      firstName: firstName || 'Sin nombre',
      lastName: lnIdx !== -1 ? (cols[lnIdx] ?? '').trim() || undefined : undefined,
      phone,
      email: emailIdx !== -1 ? (cols[emailIdx] ?? '').trim() || undefined : undefined,
    };
  }).filter((r) => r.phone);
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return '+' + digits;
  // Argentina: 10 digits starting with 11 → +5491...
  if (digits.length === 10) return '+549' + digits;
  // Argentina: 11 digits starting with 011 → strip 0, add +549
  if (digits.length === 11 && digits.startsWith('0')) return '+54' + digits.slice(1);
  if (digits.length >= 7) return '+' + digits;
  return raw;
}

// ─── Add contact form ─────────────────────────────────────────────────────────

function AddContactForm({ tenantId, token, onAdded }: { tenantId: string; token: string; onAdded: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await createContact(tenantId, {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: normalizePhone(phone.trim()),
        email: email.trim() || undefined,
      }, token);
      setFirstName(''); setLastName(''); setPhone(''); setEmail('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Juan" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Apellido</label>
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Pérez" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono * <span className="text-slate-400 font-normal">(ej: 1122334455)</span></label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="+5491122334455" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="juan@ejemplo.com" />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={loading}
        className="w-full bg-indigo-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
        {loading ? 'Guardando…' : 'Agregar contacto'}
      </button>
    </form>
  );
}

// ─── CSV import modal ─────────────────────────────────────────────────────────

function CsvModal({ tenantId, token, onClose, onImported }: { tenantId: string; token: string; onClose: () => void; onImported: (n: number) => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleCsvChange(text: string) {
    setCsv(text);
    setPreview(parseCSV(text).slice(0, 5));
    setErrors([]);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleCsvChange(ev.target?.result as string ?? '');
    reader.readAsText(file);
  }

  async function handleImport() {
    const rows = parseCSV(csv);
    if (rows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: rows.length });
    const errs: string[] = [];
    let done = 0;
    for (const row of rows) {
      try {
        await createContact(tenantId, row, token);
      } catch (err) {
        errs.push(`${row.firstName} ${row.lastName ?? ''} (${row.phone}): ${(err as Error).message}`);
      }
      done++;
      setProgress({ done, total: rows.length });
    }
    setErrors(errs);
    setImporting(false);
    onImported(rows.length - errs.length);
    if (errs.length === 0) onClose();
  }

  const rows = parseCSV(csv);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 text-base mb-1">Importar contactos desde CSV</h3>
        <p className="text-xs text-slate-500 mb-4">
          Columnas soportadas: <span className="font-mono">nombre, apellido, telefono, email</span>. El teléfono puede ser local (1122334455) o E.164 (+5491122334455).
        </p>

        <div className="mb-3 flex items-center gap-3">
          <button onClick={() => fileRef.current?.click()}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors">
            Cargar archivo .csv
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          <span className="text-xs text-slate-400">o pegá el contenido abajo</span>
        </div>

        <textarea
          value={csv}
          onChange={(e) => handleCsvChange(e.target.value)}
          rows={6}
          placeholder={"nombre,apellido,telefono,email\nJuan,Pérez,1122334455,juan@ejemplo.com\nMaría,García,1133445566,"}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
        />

        {preview.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600 mb-1">{rows.length} contacto{rows.length !== 1 ? 's' : ''} detectado{rows.length !== 1 ? 's' : ''} — vista previa:</p>
            <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
              {preview.map((r, i) => (
                <div key={i} className="flex gap-4 px-3 py-1.5 border-b border-slate-100 last:border-0">
                  <span className="font-medium text-slate-700 w-28 truncate">{r.firstName} {r.lastName ?? ''}</span>
                  <span className="text-slate-500 font-mono">{r.phone}</span>
                  {r.email && <span className="text-slate-400 truncate">{r.email}</span>}
                </div>
              ))}
              {rows.length > 5 && <div className="px-3 py-1.5 text-slate-400">… y {rows.length - 5} más</div>}
            </div>
          </div>
        )}

        {progress && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Importando…</span>
              <span>{progress.done}/{progress.total}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
            {errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} disabled={importing}
            className="flex-1 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleImport} disabled={importing || rows.length === 0}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {importing ? `Importando… ${progress?.done ?? 0}/${progress?.total ?? 0}` : `Importar ${rows.length > 0 ? rows.length : ''} contacto${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

export default function ContactsClient({ tenantId, token, initialContacts }: {
  tenantId: string;
  token: string;
  initialContacts: Contact[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [search, setSearch] = useState('');
  const clearToast = useCallback(() => setToast(null), []);

  function refresh() { router.refresh(); }

  function onAdded() {
    setShowForm(false);
    setToast({ message: 'Contacto agregado', type: 'success' });
    refresh();
  }

  function onImported(n: number) {
    setToast({ message: `${n} contacto${n !== 1 ? 's' : ''} importado${n !== 1 ? 's' : ''}`, type: 'success' });
    refresh();
  }

  async function handleDelete(contact: Contact) {
    if (!confirm(`¿Borrar a ${contact.firstName} ${contact.lastName ?? ''}?`)) return;
    try {
      await deleteContact(tenantId, contact.id, token);
      setToast({ message: 'Contacto borrado', type: 'success' });
      refresh();
    } catch (err) {
      setToast({ message: (err as Error).message, type: 'error' });
    }
  }

  const filtered = initialContacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.firstName.toLowerCase().includes(q) ||
      (c.lastName ?? '').toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Contactos</h1>
          <p className="text-sm text-slate-500 mt-1">{initialContacts.length} contacto{initialContacts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowCsv(true); setShowForm(false); }}
            className="text-sm border border-slate-300 text-slate-700 font-medium px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Importar CSV
          </button>
          <button onClick={() => { setShowForm((v) => !v); setShowCsv(false); }}
            className="text-sm bg-indigo-600 text-white font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            + Agregar contacto
          </button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="font-medium text-slate-800 mb-4">Nuevo contacto</h2>
          <AddContactForm tenantId={tenantId} token={token} onAdded={onAdded} />
        </div>
      )}

      {/* Search */}
      {initialContacts.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o email…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      )}

      {/* Contact list */}
      {initialContacts.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-4xl mb-3">👥</p>
          <p className="font-medium text-slate-600">No hay contactos todavía</p>
          <p className="text-sm mt-1">Agregá uno manualmente o importá desde un CSV</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-12 text-slate-400 text-sm">Sin resultados para &ldquo;{search}&rdquo;</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Teléfono</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-700">{c.firstName} {c.lastName ?? ''}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{c.phone}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs hidden sm:table-cell">{c.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(c)} title="Borrar"
                      className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCsv && (
        <CsvModal tenantId={tenantId} token={token} onClose={() => setShowCsv(false)} onImported={onImported} />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={clearToast} />}
    </>
  );
}
