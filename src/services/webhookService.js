const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { createLogger } = require('../middleware/logger');

const prisma = new PrismaClient();
const logger = createLogger('WebhookService');

const VALID_EVENTS = [
  'call.answered',
  'call.completed',
  'call.failed',
  'call.no_answer',
  'campaign.completed',
];

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function sign(secret, payload) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function validateEvents(events) {
  if (!Array.isArray(events)) return '"events" must be an array';
  const invalid = events.filter((e) => !VALID_EVENTS.includes(e));
  if (invalid.length) return `Invalid events: ${invalid.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}`;
  return null;
}

async function createEndpoint(tenantId, { url, events, enabled }) {
  const eventsToSave = events ?? VALID_EVENTS;
  const validationError = validateEvents(eventsToSave);
  if (validationError) {
    const err = new Error(validationError);
    err.statusCode = 400;
    throw err;
  }
  const secret = generateSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: { tenantId, url, secret, events: eventsToSave, enabled: enabled ?? true },
  });
  logger.info('Webhook endpoint created', { tenantId, endpointId: endpoint.id, url });
  return endpoint; // secret returned at creation
}

async function listEndpoints(tenantId) {
  return prisma.webhookEndpoint.findMany({
    where: { tenantId },
    select: { id: true, url: true, events: true, enabled: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function updateEndpoint(tenantId, endpointId, updates) {
  const existing = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, tenantId } });
  if (!existing) {
    const err = new Error('Webhook endpoint not found');
    err.statusCode = 404;
    throw err;
  }
  if (updates.events !== undefined) {
    const validationError = validateEvents(updates.events);
    if (validationError) {
      const err = new Error(validationError);
      err.statusCode = 400;
      throw err;
    }
  }
  return prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      ...(updates.url !== undefined && { url: updates.url }),
      ...(updates.events !== undefined && { events: updates.events }),
      ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    },
    select: { id: true, url: true, events: true, enabled: true, createdAt: true, updatedAt: true },
  });
}

async function deleteEndpoint(tenantId, endpointId) {
  const existing = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, tenantId } });
  if (!existing) {
    const err = new Error('Webhook endpoint not found');
    err.statusCode = 404;
    throw err;
  }
  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });
  return { deleted: true };
}

/**
 * Attempts to deliver a single webhook to `url` with exponential backoff retry.
 *
 * Retries up to `maxAttempts` times (default: 4) on network errors or 5xx
 * responses. Delays between attempts: 5 s, 15 s, 60 s.
 *
 * 4xx responses are NOT retried — ENGAGE rejected the request for a valid
 * reason and resending would not help.
 *
 * Never throws — all failures are logged so callers don't crash the process.
 *
 * @param {string} url          - Endpoint URL to POST to
 * @param {string} payload      - JSON string body (already serialized)
 * @param {string} secret       - HMAC secret for X-Orkestai-Signature header
 * @param {string} eventName    - Event name for X-Orkestai-Event header
 * @param {string} endpointId   - DB endpoint ID (for logging only)
 * @param {number} [maxAttempts=4]
 */
async function dispatchWithRetry(url, payload, secret, eventName, endpointId, maxAttempts = 4) {
  const signature = sign(secret, payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const delays = [5000, 15000, 60000]; // ms between attempts 1→2, 2→3, 3→4

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Orkestai-Signature': signature,
            'X-Orkestai-Timestamp': timestamp,
            'X-Orkestai-Event': eventName,
          },
          body: payload,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (res.ok) {
        logger.info('Webhook delivered', { endpointId, event: eventName, status: res.status, attempt });
        return; // success — stop retrying
      }

      // 4xx: ENGAGE rejected the request — no point retrying
      if (res.status >= 400 && res.status < 500) {
        logger.warn('[webhook] Received 4xx, not retrying', {
          endpointId, event: eventName, status: res.status, url,
        });
        return;
      }

      // 5xx or unexpected status: throw so the catch block handles retry
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = delays[attempt - 1] ?? 60000;
      logger.warn(
        `[webhook] Attempt ${attempt}/${maxAttempts} failed for ${url}, retrying in ${delay / 1000}s: ${err.message}`,
        { endpointId, event: eventName, error: err.message },
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All attempts exhausted — log definitively but do not throw
  logger.error(
    `[webhook] Failed after ${maxAttempts} attempts to ${url}: ${lastError?.message}`,
    { endpointId, event: eventName, error: lastError?.message },
  );
}

/**
 * Dispatch an event to all enabled endpoints for a tenant that subscribe to it.
 * Fire-and-forget: call without await from hot paths.
 *
 * Each delivery is retried up to 4 times with exponential backoff (5 s / 15 s / 60 s)
 * so that transient ENGAGE downtime doesn't cause permanent data loss.
 */
async function dispatch(tenantId, eventName, data) {
  let endpoints;
  try {
    endpoints = await prisma.webhookEndpoint.findMany({
      where: { tenantId, enabled: true },
    });
  } catch (err) {
    logger.warn('Failed to load webhook endpoints', { tenantId, error: err.message });
    return;
  }

  const targets = endpoints.filter((ep) => {
    const events = Array.isArray(ep.events) ? ep.events : [];
    return events.includes(eventName);
  });

  if (targets.length === 0) return;

  const payload = JSON.stringify({
    event: eventName,
    timestamp: new Date().toISOString(),
    tenantId,
    data,
  });

  await Promise.allSettled(
    targets.map((ep) => dispatchWithRetry(ep.url, payload, ep.secret, eventName, ep.id)),
  );
}

module.exports = { createEndpoint, listEndpoints, updateEndpoint, deleteEndpoint, dispatch, VALID_EVENTS };
