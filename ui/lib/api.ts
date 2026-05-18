const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_BASE_URL ?? 'http://localhost:3000')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000');

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

export interface VoiceFlow {
  id: string;
  campaignId: string;
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

export const createCampaign = (tenantId: string, data: { name: string; description?: string }, token?: string) =>
  apiFetch<{ campaign: Campaign }>(`/api/tenants/${tenantId}/campaigns`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);

export const setFlow = (campaignId: string, steps: FlowStep[], token?: string) =>
  apiFetch<{ flow: VoiceFlow }>(`/api/campaigns/${campaignId}/flow`, {
    method: 'POST',
    body: JSON.stringify({ steps }),
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

export const createTenantOnboarding = (name: string, slug: string, token: string) =>
  apiFetch<{ tenant: { id: string; name: string; slug: string }; user: { id: string }; created: boolean }>('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ name, slug }),
  }, token);
