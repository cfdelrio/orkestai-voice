// Server components use the internal URL; browser uses the public URL.
const API_URL =
  typeof window === 'undefined'
    ? (process.env.API_BASE_URL ?? 'http://localhost:3000')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000');

export const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ?? '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options,
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

export const listCampaigns = (tenantId: string) =>
  apiFetch<{ campaigns: Campaign[]; count: number }>(`/api/tenants/${tenantId}/campaigns`);

export const getCampaignResults = (campaignId: string) =>
  apiFetch<CampaignResults>(`/api/campaigns/${campaignId}/results`);

export const listContacts = (tenantId: string) =>
  apiFetch<{ contacts: Contact[]; count: number }>(`/api/tenants/${tenantId}/contacts`);

export const createCampaign = (tenantId: string, data: { name: string; description?: string }) =>
  apiFetch<{ campaign: Campaign }>(`/api/tenants/${tenantId}/campaigns`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const setFlow = (campaignId: string, steps: FlowStep[]) =>
  apiFetch<{ flow: VoiceFlow }>(`/api/campaigns/${campaignId}/flow`, {
    method: 'POST',
    body: JSON.stringify({ steps }),
  });

export const addRecipients = (campaignId: string, contactIds: string[]) =>
  apiFetch(`/api/campaigns/${campaignId}/recipients`, {
    method: 'POST',
    body: JSON.stringify({ contactIds }),
  });

export const startCampaign = (campaignId: string) =>
  apiFetch(`/api/campaigns/${campaignId}/start`, { method: 'POST' });
