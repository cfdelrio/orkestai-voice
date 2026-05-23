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
  type: 'say' | 'dtmf_question' | 'speech_question' | 'goodbye';
  text: string;
  options?: Record<string, string>;
  maxDigits?: number;
  maxLength?: number;
  timeout?: number;
  voice?: string;
  elevenLabsVoiceId?: string;
  voiceInstructions?: string;
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

export interface CampaignRecipient {
  id: string;
  status: string;
  contact: { id: string; firstName: string; lastName: string | null; phone: string };
  lastCall: {
    id: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    duration: number | null;
    responses: { stepId: string; input: string; value: string | null }[];
  } | null;
}

export interface CampaignResults {
  campaign: Campaign;
  flow: VoiceFlow | null;
  recipients: CampaignRecipient[];
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
  data: { name: string; description?: string; variables?: Record<string, string>; voiceInstructions?: string; voice?: string; ttsProvider?: string; elevenLabsVoiceId?: string },
  token?: string,
) =>
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

export const startCampaign = (campaignId: string, token?: string, options?: { sandbox?: boolean; limit?: number }) =>
  apiFetch(`/api/campaigns/${campaignId}/start`, {
    method: 'POST',
    body: options ? JSON.stringify(options) : undefined,
  }, token);

export const updateCampaign = (
  campaignId: string,
  data: { voiceInstructions?: string; voice?: string; ttsProvider?: string; elevenLabsVoiceId?: string; variables?: Record<string, string> },
  token?: string,
) =>
  apiFetch<{ campaign: Campaign }>(`/api/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, token);

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

/**
 * Generates a TTS preview and returns a blob URL suitable for <audio src>.
 * The caller is responsible for calling URL.revokeObjectURL() when done.
 */
export async function getElevenLabsVoices(): Promise<{ voiceId: string; name: string; category: string; previewUrl: string | null }[]> {
  const url = `${typeof window === 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? '')}/api/audio/elevenlabs-voices`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch ElevenLabs voices');
  const data = await res.json();
  return data.voices;
}

export async function previewAudio(
  text: string,
  voiceInstructions?: string,
  voice?: string,
  ttsProvider?: string,
  elevenLabsVoiceId?: string,
): Promise<string> {
  const url = `${typeof window === 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL ?? '')}/api/audio/preview`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceInstructions, voice, ttsProvider, elevenLabsVoiceId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Preview failed');
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const createTenantOnboarding = (name: string, slug: string, token: string) =>
  apiFetch<{ tenant: { id: string; name: string; slug: string }; user: { id: string }; created: boolean }>('/api/onboarding', {
    method: 'POST',
    body: JSON.stringify({ name, slug }),
  }, token);

export interface PublicQuestion {
  stepId: string;
  title: string;
  optionLabels: Record<string, string>;
}

export interface PublicFeedConfig {
  id: string;
  campaignId: string;
  enabled: boolean;
  slug: string;
  title: string;
  description: string | null;
  showTotalCalls: boolean;
  showResponseRate: boolean;
  showRecentActivity: boolean;
  showPercentages: boolean;
  refreshIntervalSeconds: number;
  publicQuestions: PublicQuestion[];
  createdAt: string;
  updatedAt: string;
}

export const getFeedConfig = (campaignId: string, token?: string) =>
  apiFetch<{ feedConfig: PublicFeedConfig | null }>(`/api/campaigns/${campaignId}/feed-config`, undefined, token);

export const upsertFeedConfig = (
  campaignId: string,
  data: Partial<Omit<PublicFeedConfig, 'id' | 'campaignId' | 'createdAt' | 'updatedAt'>>,
  token?: string,
) =>
  apiFetch<{ feedConfig: PublicFeedConfig }>(`/api/campaigns/${campaignId}/feed-config`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);

export const deleteFeedConfig = (campaignId: string, token?: string) =>
  apiFetch<{ deleted: boolean }>(`/api/campaigns/${campaignId}/feed-config`, { method: 'DELETE' }, token);

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const listApiKeys = (tenantId: string, token: string) =>
  apiFetch<{ apiKeys: ApiKey[]; count: number }>(`/api/tenants/${tenantId}/api-keys`, undefined, token);

export const createApiKey = (tenantId: string, name: string, token: string) =>
  apiFetch<{ apiKey: ApiKey; key: string }>(`/api/tenants/${tenantId}/api-keys`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }, token);

export const deleteApiKey = (tenantId: string, keyId: string, token: string) =>
  apiFetch<{ deleted: boolean }>(`/api/tenants/${tenantId}/api-keys/${keyId}`, { method: 'DELETE' }, token);

// ─── Webhook Endpoints ────────────────────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const listWebhookEndpoints = (tenantId: string, token: string) =>
  apiFetch<{ endpoints: WebhookEndpoint[]; validEvents: string[]; count: number }>(
    `/api/tenants/${tenantId}/webhook-endpoints`, undefined, token,
  );

export const createWebhookEndpoint = (tenantId: string, data: { url: string; events: string[]; enabled?: boolean }, token: string) =>
  apiFetch<{ endpoint: WebhookEndpoint & { secret: string } }>(`/api/tenants/${tenantId}/webhook-endpoints`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);

export const updateWebhookEndpoint = (tenantId: string, endpointId: string, data: Partial<Pick<WebhookEndpoint, 'url' | 'events' | 'enabled'>>, token: string) =>
  apiFetch<{ endpoint: WebhookEndpoint }>(`/api/tenants/${tenantId}/webhook-endpoints/${endpointId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }, token);

export const deleteWebhookEndpoint = (tenantId: string, endpointId: string, token: string) =>
  apiFetch<{ deleted: boolean }>(`/api/tenants/${tenantId}/webhook-endpoints/${endpointId}`, { method: 'DELETE' }, token);
