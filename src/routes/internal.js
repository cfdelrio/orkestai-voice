const crypto = require('crypto');
const { Router } = require('express');
const { PrismaClient } = require('@prisma/client');
const { createApiKey } = require('../services/apiKeyService');
const { createEndpoint } = require('../services/webhookService');
const { createLogger } = require('../middleware/logger');
const { asyncHandler } = require('../middleware/errorHandler');

const prisma = new PrismaClient();
const router = Router();
const logger = createLogger('Internal');

function timingSafeCompare(a, b) {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // still run timingSafeEqual against a dummy to avoid length-based timing leak
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * POST /internal/service-accounts/register
 *
 * Idempotent auto-registration for internal services (e.g. ENGAGE).
 * Auth: X-Shared-Secret header == process.env.ENGAGE_SHARED_SECRET
 *
 * Body: { serviceName, webhookUrl, webhookEvents? }
 * Response: { apiKey, webhookSecret, tenantId }
 */
router.post('/service-accounts/register', asyncHandler(async (req, res) => {
  const sharedSecret = process.env.ENGAGE_SHARED_SECRET;
  if (!sharedSecret) {
    logger.warn('ENGAGE_SHARED_SECRET not configured — rejecting internal registration');
    return res.status(503).json({ error: { message: 'Endpoint not configured on this server' } });
  }

  const provided = String(req.headers['x-shared-secret'] ?? '');
  if (!timingSafeCompare(provided, sharedSecret)) {
    logger.warn('Invalid shared secret on /internal/service-accounts/register', {
      ip: req.ip,
    });
    return res.status(401).json({ error: { message: 'Invalid shared secret' } });
  }

  const { serviceName, webhookUrl, webhookEvents } = req.body;

  if (!serviceName || typeof serviceName !== 'string' || !serviceName.trim()) {
    return res.status(400).json({ error: { message: '"serviceName" is required' } });
  }
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return res.status(400).json({ error: { message: '"webhookUrl" is required' } });
  }
  if (!/^https?:\/\/.+/.test(webhookUrl)) {
    return res.status(400).json({ error: { message: '"webhookUrl" must be a valid HTTP/HTTPS URL' } });
  }

  const tenantId = process.env.ENGAGE_VOICE_TENANT_ID;
  if (!tenantId) {
    logger.warn('ENGAGE_VOICE_TENANT_ID not configured');
    return res.status(503).json({ error: { message: 'ENGAGE_VOICE_TENANT_ID not configured on this server' } });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    logger.error('ENGAGE_VOICE_TENANT_ID points to non-existent tenant', { tenantId });
    return res.status(503).json({ error: { message: 'Tenant not found — check ENGAGE_VOICE_TENANT_ID' } });
  }

  const keyName = `${serviceName.trim()} (auto)`;
  const eventsToSave = Array.isArray(webhookEvents) && webhookEvents.length > 0
    ? webhookEvents
    : ['call.completed', 'campaign.completed'];

  // ── API Key: revoke any existing with the same name, create fresh ──────────
  // Raw key is not stored, so we always rotate: delete old → create new.
  const existingKeys = await prisma.apiKey.findMany({ where: { tenantId, name: keyName } });
  if (existingKeys.length > 0) {
    await prisma.apiKey.deleteMany({ where: { tenantId, name: keyName } });
    logger.info('Rotated existing API key', { serviceName, count: existingKeys.length });
  }
  const apiKeyRecord = await createApiKey(tenantId, keyName);

  // ── Webhook Endpoint: upsert by URL ───────────────────────────────────────
  const existingEndpoint = await prisma.webhookEndpoint.findFirst({
    where: { tenantId, url: webhookUrl },
  });

  let webhookEndpoint;
  if (existingEndpoint) {
    webhookEndpoint = await prisma.webhookEndpoint.update({
      where: { id: existingEndpoint.id },
      data: { events: eventsToSave, enabled: true },
    });
    logger.info('Updated existing webhook endpoint', { serviceName, endpointId: existingEndpoint.id });
  } else {
    webhookEndpoint = await createEndpoint(tenantId, { url: webhookUrl, events: eventsToSave, enabled: true });
    logger.info('Created webhook endpoint', { serviceName, endpointId: webhookEndpoint.id });
  }

  logger.info('Service account registered', { serviceName, tenantId, keyId: apiKeyRecord.id });

  return res.json({
    apiKey: apiKeyRecord.key,
    webhookSecret: webhookEndpoint.secret,
    tenantId,
  });
}));

module.exports = router;
