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
 * Dispatch an event to all enabled endpoints for a tenant that subscribe to it.
 * Fire-and-forget: call without await from hot paths.
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
  const timestamp = Math.floor(Date.now() / 1000).toString();

  await Promise.allSettled(
    targets.map(async (ep) => {
      const signature = sign(ep.secret, payload);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(ep.url, {
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
        clearTimeout(timeout);
        logger.info('Webhook delivered', { endpointId: ep.id, event: eventName, status: res.status });
      } catch (err) {
        logger.warn('Webhook delivery failed', { endpointId: ep.id, event: eventName, error: err.message });
      }
    })
  );
}

module.exports = { createEndpoint, listEndpoints, updateEndpoint, deleteEndpoint, dispatch, VALID_EVENTS };
