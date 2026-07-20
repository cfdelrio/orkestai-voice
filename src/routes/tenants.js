/**
 * @fileoverview Tenant and ProviderConfig routes.
 *
 * POST /api/tenants                              - Create a tenant
 * GET  /api/tenants                              - List all tenants
 * GET  /api/tenants/:tenantId                    - Get a tenant by ID
 * POST /api/tenants/:tenantId/provider-configs   - Create provider config for a tenant
 */

const { Router } = require('express');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const tenantService = require('../services/tenantService');

const router = Router();

/**
 * POST /api/tenants
 * Creates a new tenant.
 *
 * Body: { name, slug, metadata? }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { name, slug, metadata } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw badRequest('"name" is required');
  }
  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    throw badRequest('"slug" is required');
  }

  const tenant = await tenantService.createTenant({
    name: name.trim(),
    slug: slug.trim().toLowerCase(),
    metadata: metadata || {},
  });

  res.status(201).json({ tenant });
}));

/**
 * GET /api/tenants
 * Lists all tenants.
 */
router.get('/', asyncHandler(async (_req, res) => {
  const tenants = await tenantService.listTenants();
  res.json({ tenants, count: tenants.length });
}));

/**
 * GET /api/tenants/slug/:slug
 * Returns a tenant by slug (public — used by frontend middleware for subdomain resolution).
 */
router.get('/slug/:slug', asyncHandler(async (req, res) => {
  const tenant = await tenantService.getTenantBySlug(req.params.slug);
  if (!tenant) {
    return res.status(404).json({ error: { message: `Tenant not found for slug: ${req.params.slug}` } });
  }
  res.json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } });
}));

/**
 * GET /api/tenants/:tenantId
 * Returns a single tenant by ID.
 */
router.get('/:tenantId', asyncHandler(async (req, res) => {
  const tenant = await tenantService.getTenantById(req.params.tenantId);
  res.json({ tenant });
}));

/**
 * POST /api/tenants/:tenantId/provider-configs
 * Creates a ProviderConfig for a tenant.
 *
 * Body: { provider, apiKey, baseUrl, fromNumber, metadata? }
 */
router.post('/:tenantId/provider-configs', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { provider, apiKey, baseUrl, fromNumber, metadata } = req.body;

  if (!provider || typeof provider !== 'string') {
    throw badRequest('"provider" is required (e.g. "twilio")');
  }
  if (provider.trim().toLowerCase() === 'infobip' && process.env.ALLOW_INFOBIP_UNVERIFIED !== 'true') {
    throw badRequest(
      'Infobip provider is not production-ready: API field names are unverified. ' +
      'Use "twilio" or set ALLOW_INFOBIP_UNVERIFIED=true for development only.'
    );
  }
  if (!apiKey || typeof apiKey !== 'string') {
    throw badRequest('"apiKey" is required');
  }
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw badRequest('"baseUrl" is required');
  }
  if (!fromNumber || typeof fromNumber !== 'string') {
    throw badRequest('"fromNumber" is required (E.164 format, e.g. "+5491100000000")');
  }

  const providerConfig = await tenantService.createProviderConfig(tenantId, {
    provider: provider.trim().toLowerCase(),
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim(),
    fromNumber: fromNumber.trim(),
    metadata: metadata || {},
  });

  res.status(201).json({ providerConfig });
}));

/**
 * GET /api/tenants/:tenantId/provider-configs
 * Returns the provider config for a tenant (apiKey and authToken masked).
 */
router.get('/:tenantId/provider-configs', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const config = await tenantService.getProviderConfigForTenant(tenantId);
  // Mask sensitive fields
  const masked = {
    ...config,
    apiKey: config.apiKey ? config.apiKey.slice(0, 6) + '••••••••' : null,
    metadata: config.metadata
      ? { ...config.metadata, authToken: config.metadata.authToken ? '••••••••' : undefined }
      : {},
  };
  res.json({ providerConfig: masked });
}));

/**
 * PUT /api/tenants/:tenantId/provider-configs
 * Updates (upserts) the provider config for a tenant.
 */
router.put('/:tenantId/provider-configs', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { provider, apiKey, baseUrl, fromNumber, metadata } = req.body;

  if (!provider) throw badRequest('"provider" is required');
  if (!apiKey)   throw badRequest('"apiKey" is required');
  if (!baseUrl)  throw badRequest('"baseUrl" is required');
  if (!fromNumber) throw badRequest('"fromNumber" is required');

  // If authToken is omitted (Twilio), preserve the existing one
  let resolvedMetadata = metadata || {};
  if (provider === 'twilio' && !resolvedMetadata.authToken) {
    const existing = await tenantService.getProviderConfigForTenant(tenantId).catch(() => null);
    if (existing?.metadata?.authToken) {
      resolvedMetadata = { ...resolvedMetadata, authToken: existing.metadata.authToken };
    }
  }

  const providerConfig = await tenantService.upsertProviderConfig(tenantId, {
    provider: provider.trim().toLowerCase(),
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim(),
    fromNumber: fromNumber.trim(),
    metadata: resolvedMetadata,
  });

  res.json({ providerConfig });
}));

module.exports = router;
