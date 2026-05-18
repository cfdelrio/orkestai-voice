const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_BASE_URL ?? 'http://localhost:3000')
    : (process.env.NEXT_PUBLIC_API_URL ?? '');

async function apiFetch<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) authHeaders['Authorization'] = `Bearer ${token}`;

  const { headers: extraHeaders, ...restOptions } = options ?? {};

  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    ...restOptions,
    headers: {
      ...authHeaders,
      ...((extraHeaders as Record<string, string>) ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface FlowStep {
  id: string;
  type: 'say' | 'dtmf_question' | 'goodbye';
  text: string;
  options?: Record<string, string>;
  maxDigits?: number;
  timeout?: number;
}

export type VoiceOption =
  | 'Polly.Mia-Neural'
  | 'Polly.Lupe-Neural'
  | 'Polly.Andres-Neural'
  | 'Polly.Miguel-Neural'
  | 'es-MX'
  | 'es-ES';

export const VOICE_OPTIONS: { value: VoiceOption; label: string; description: string }[] = [
  { value: 'Polly.Mia-Neural',    label: 'Mía Neural (mujer, Latam)',   description: 'Amazon Polly · español México · neural' },
  { value: 'Polly.Lupe-Neural',   label: 'Lupe Neural (mujer, Latam)',  description: 'Amazon Polly · español EEUU · neural' },
  { value: 'Polly.Andres-Neural', label: 'Andrés Neural (hombre, Latam)', description: 'Amazon Polly · español México · neural' },
  { value: 'Polly.Miguel-Neural', label: 'Miguel Neural (hombre, Latam)', description: 'Amazon Polly · español EEUU · neural' },
  { value: 'es-MX',              label: 'Básica Latam (mujer)',         description: 'Twilio integrado · sin costo adicional' },
  { value: 'es-ES',              label: 'Básica España (mujer)',        description: 'Twilio integrado · acento español' },
];

export interface VoiceFlow {
  id: string;
  campaignId: string;
  voice: VoiceOption;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  variables: Record<string, string>;
  metadata: Record<string, unknown>;
  flow?: VoiceFlow | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
}

export interface CampaignResults {
  campaign: Campaign;
  flow: VoiceFlow | null;
  stats: {
    totalRecipients: number;
    recipientsByStatus: Record<string, number>;
    callsByStatus: Record<string, number>;
    responsesByStep: Record<string, Record<string, number>>;
  };
}

export const listCampaigns = (tenantId: string, token?: string) =>
  apiFetch<{ campaigns: Campaign[]; count: number }>(`/api/tenants/${tenantId}/campaigns`, undefined, token);

export const getCampaignResults = (campaignId: string, token?: string) =>
  apiFetch<CampaignResults>(`/api/campaigns/${campaignId}/results`, undefined, token);

export const listContacts = (tenantId: string, token?: string) =>
  apiFetch<{ contacts: Contact[]; count: number }>(`/api/tenants/${tenantId}/contacts`, undefined, token);

export const createCampaign = (
  tenantId: string,
  data: { name: string; description?: string; variables?: Record<string, string> },
  token?: string,
) =>
  apiFetch<{ campaign: Campaign }>(`/api/tenants/${tenantId}/campaigns`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);

export const setFlow = (campaignId: string, steps: FlowStep[], token?: string, voice?: VoiceOption) =>
  apiFetch<{ flow: VoiceFlow }>(`/api/campaigns/${campaignId}/flow`, {
    method: 'POST',
    body: JSON.stringify({ steps, voice }),
  }, token);

export const addRecipients = (campaignId: string, contactIds: string[], token?: string) =>
  apiFetch(`/api/campaigns/${campaignId}/recipients`, {
    method: 'POST',
    body: JSON.stringify({ contactIds }),
  }, token);

export const startCampaign = (campaignId: string, token?: string) =>
  apiFetch(`/api/campaigns/${campaignId}/start`, { method: 'POST' }, token);

export const pauseCampaign = (campaignId: string, token?: string) =>
  apiFetch(`/api/campaigns/${campaignId}/pause`, { method: 'PATCH' }, token);

export const resumeCampaign = (campaignId: string, token?: string) =>
  apiFetch(`/api/campaigns/${campaignId}/resume`, { method: 'PATCH' }, token);

export const linkUser = (tenantId: string, role: string | undefined, token: string) =>
  apiFetch<{ user: { id: string; clerkUserId: string; tenantId: string; role: string }; linked: boolean }>('/api/users/link', {
    method: 'POST',
    body: JSON.stringify({ tenantId, role }),
  }, token);

export const deleteCampaign = (campaignId: string, token?: string) =>
  apiFetch<{ deleted: boolean; campaignId: string }>(`/api/campaigns/${campaignId}`, { method: 'DELETE' }, token);

export const createContact = (tenantId: string, data: { firstName: string; lastName?: string; phone: string; email?: string }, token?: string) =>
  apiFetch<{ contact: Contact }>(`/api/tenants/${tenantId}/contacts`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);

export const deleteContact = (tenantId: string, contactId: string, token?: string) =>
  apiFetch<{ deleted: boolean }>(`/api/tenants/${tenantId}/contacts/${contactId}`, { method: 'DELETE' }, token);

export const createTenantOnboarding = (name: string, slug: string, token: string) =>
  apiFetch<{ tenant: { id: string; name: string; slug: string }; user: { id: string }; created: boolean }>('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ name, slug }),
  }, token);
