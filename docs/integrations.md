# OrkestAI Voice — Integration Guide

## Overview

OrkestAI Voice exposes two authentication mechanisms:

| Method | Use case |
|--------|----------|
| Clerk JWT | Human operators using the dashboard |
| API Key (`ok_` prefix) | Machine-to-machine (M2M) integrations |

All API endpoints are under `https://voice.orkestai.com.ar`.

---

## Authentication

### API Keys

API keys have the format `ok_<64 hex chars>`. Pass them as a Bearer token:

```http
Authorization: Bearer ok_f0dca1a95134df77...
```

Keys are scoped to a tenant. The raw key is returned **once** at creation — store it securely. Only a SHA-256 hash is kept in the database.

Keys can be managed via the **Settings → Integrations** section in the dashboard, or programmatically:

```http
POST   /api/tenants/:tenantId/api-keys       # create
GET    /api/tenants/:tenantId/api-keys       # list (no raw keys)
DELETE /api/tenants/:tenantId/api-keys/:id   # revoke
```

---

## Outgoing Webhooks

Voice fires signed HTTP POST requests to your configured endpoints when call/campaign events occur.

### Events

| Event | When |
|-------|------|
| `call.answered` | Recipient picked up |
| `call.completed` | Call ended, responses collected |
| `call.failed` | Call errored |
| `call.no_answer` | No answer / voicemail |
| `campaign.completed` | All calls in a campaign finished |

### Payload

```json
{
  "event": "call.completed",
  "timestamp": "2026-05-23T14:00:00.000Z",
  "tenantId": "2159c657-...",
  "data": {
    "callId": "...",
    "campaignId": "...",
    "status": "completed",
    "responses": [
      { "stepId": "q1", "value": "argentina", "input": "1" }
    ]
  }
}
```

### Signature verification

Every request includes:

```
X-Orkestai-Signature: sha256=<hmac-sha256 hex>
X-Orkestai-Timestamp: <unix seconds>
X-Orkestai-Event: call.completed
```

Verify in your receiver:

```javascript
const crypto = require('crypto');

function verifySignature(rawBody, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

`rawBody` must be the raw request body string (before JSON parsing).

### Managing endpoints

```http
POST   /api/tenants/:tenantId/webhook-endpoints       # create
GET    /api/tenants/:tenantId/webhook-endpoints       # list
PUT    /api/tenants/:tenantId/webhook-endpoints/:id   # update
DELETE /api/tenants/:tenantId/webhook-endpoints/:id   # delete
```

Create body:
```json
{
  "url": "https://yourservice.com/webhooks/voice",
  "events": ["call.completed", "campaign.completed"],
  "enabled": true
}
```

The `secret` is returned once at creation. It is not retrievable afterwards — if lost, delete and recreate the endpoint.

---

## Service Account Auto-Registration (ENGAGE)

Internal services can self-provision credentials without manual dashboard steps.

### Endpoint

```
POST /internal/service-accounts/register
```

**Auth:** `X-Shared-Secret` header must match `ENGAGE_SHARED_SECRET` on the Voice server (timing-safe compare).

### Request

```json
{
  "serviceName": "ENGAGE",
  "tenantId": "2159c657-8c87-4303-b6af-ce363669d831",
  "webhookUrl": "https://yourservice.com/webhooks/voice",
  "webhookEvents": ["call.completed", "campaign.completed"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `serviceName` | yes | Label for the generated API key (e.g. `"ENGAGE"`) |
| `tenantId` | yes | Voice tenant UUID |
| `webhookUrl` | yes | HTTPS URL to receive webhook events |
| `webhookEvents` | no | Defaults to `["call.completed", "campaign.completed"]` |

### Response

```json
{
  "apiKey": "ok_f0dca1a95134df77...",
  "webhookSecret": "231dec520cc28ee6...",
  "tenantId": "2159c657-..."
}
```

### Behavior

- **Idempotent:** calling it again rotates the API key (old key revoked, new one issued) and updates the webhook endpoint events.
- **Multi-tenant:** pass a different `tenantId` per tenant — each gets isolated credentials.
- The endpoint bypasses Clerk auth entirely; it is protected solely by the shared secret.

### Environment variables

On the **Voice** server:
```env
ENGAGE_SHARED_SECRET=<strong random hex>
```

On the **ENGAGE** server:
```env
ORKESTAI_VOICE_API_URL=https://voice.orkestai.com.ar
ORKESTAI_VOICE_SHARED_SECRET=<same value>
```

### Example integration (ENGAGE boot sequence)

```javascript
async function registerWithVoice(tenantId, webhookUrl) {
  const res = await fetch(`${process.env.ORKESTAI_VOICE_API_URL}/internal/service-accounts/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shared-Secret': process.env.ORKESTAI_VOICE_SHARED_SECRET,
    },
    body: JSON.stringify({
      serviceName: 'ENGAGE',
      tenantId,
      webhookUrl,
      webhookEvents: ['call.completed', 'campaign.completed'],
    }),
  });

  if (!res.ok) throw new Error(`Voice registration failed: ${res.status}`);

  const { apiKey, webhookSecret } = await res.json();
  // Store apiKey and webhookSecret securely for this tenant
  return { apiKey, webhookSecret };
}
```

---

## Campaign API (M2M)

Once registered, ENGAGE can trigger campaigns using the API key:

### Create a campaign

```http
POST /api/tenants/:tenantId/campaigns
Authorization: Bearer ok_...
Content-Type: application/json

{
  "name": "Encuesta Mundial 2026",
  "metadata": { "ttsProvider": "elevenlabs" }
}
```

### Set the voice flow

```http
POST /api/campaigns/:campaignId/flow
Authorization: Bearer ok_...

{
  "voice": "ElevenLabs voice ID or Polly voice name",
  "steps": [
    {
      "id": "intro",
      "type": "say",
      "text": "Hola, te llamamos de Prode Caballito."
    },
    {
      "id": "q1",
      "type": "dtmf_question",
      "text": "¿Quién ganará el Mundial? Presioná 1 para Argentina, 2 para Brasil.",
      "options": { "1": "argentina", "2": "brasil" },
      "timeout": 5,
      "numDigits": 1
    }
  ]
}
```

### Add recipients

```http
POST /api/campaigns/:campaignId/recipients
Authorization: Bearer ok_...

{
  "contactIds": ["uuid1", "uuid2"]
}
```

### Start the campaign

```http
POST /api/campaigns/:campaignId/start
Authorization: Bearer ok_...
```

### Get results

```http
GET /api/campaigns/:campaignId/results
Authorization: Bearer ok_...
```

```json
{
  "campaign": { "id": "...", "name": "...", "status": "completed" },
  "callsByStatus": { "completed": 173, "no_answer": 75 },
  "responsesByStep": {
    "q1": { "argentina": 112, "brasil": 31 }
  }
}
```

---

## Infrastructure

```
HTTPS → nginx (443)
  /api/*      → Express  :3000  (orkestai-voice)
  /internal/* → Express  :3000  (orkestai-voice)
  /*          → Next.js  :3001  (orkestai-voice-ui)

PM2 processes:
  orkestai-voice        Express API + webhook receiver
  orkestai-voice-ui     Next.js dashboard
  orkestai-voice-worker Call worker (polls queue, dials, processes DTMF)
```

---

## Tenant IDs (production)

| Tenant | ID |
|--------|----|
| Prode Caballito | `2159c657-8c87-4303-b6af-ce363669d831` |
| OrkestAi | `22bc42f8-9ddd-46d1-85e8-e4a5b9c2c96e` |
