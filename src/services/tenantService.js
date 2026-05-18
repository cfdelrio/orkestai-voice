/**
 * @fileoverview Tenant service — business logic for tenant management.
 *
 * All database access for tenants goes through this module so that
 * route handlers stay thin and testable.
 */

const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');
const { notFound, badRequest } = require('../middleware/errorHandler');
const { SUPPORTED_PROVIDERS } = require('./providerFactory');

const prisma = new PrismaClient();
const logger = createLogger('TenantService');

/**
 * Creates a new tenant.
 *
 * @param {Object} data
 * @param {string} data.name      - Display name
 * @param {string} data.slug      - URL-safe unique identifier
 * @param {Object} [data.metadata] - Optional arbitrary metadata
 * @returns {Promise<Object>} Created tenant record
 * @throws {Error} 400 if slug is already taken
 */
async function createTenant({ name, slug, metadata = {} }) {
  // Validate slug format: lowercase alphanumerics and hyphens only
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw badRequest('Slug must contain only lowercase letters, numbers, and hyphens');
  }

  logger.info(`Creating tenant`, { name, slug });

  try {
    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        metadata,
      },
    });

    logger.info(`Tenant created`, { id: tenant.id, slug: tenant.slug });
    return tenant;
  } catch (error) {
    // Prisma unique constraint violation
    if (error.code === 'P2002') {
      throw badRequest(`A tenant with slug "${slug}" already exists`);
    }
    throw error;
  }
}

/**
 * Returns all tenants (paginated in the future — for now returns all).
 *
 * @returns {Promise<Object[]>} Array of tenant records
 */
async function listTenants() {
  return prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Finds a tenant by slug. Returns null if not found (no throw).
 *
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
async function getTenantBySlug(slug) {
  return prisma.tenant.findUnique({ where: { slug } });
}

/**
 * Finds a tenant by ID. Throws 404 if not found.
 *
 * @param {string} tenantId
 * @returns {Promise<Object>} Tenant record
 */
async function getTenantById(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw notFound('Tenant', tenantId);
  }

  return tenant;
}

/**
 * Creates a ProviderConfig for a tenant.
 *
 * @param {string} tenantId
 * @param {Object} data
 * @param {string} data.provider   - Provider identifier (e.g. "infobip")
 * @param {string} data.apiKey     - Provider API key
 * @param {string} data.baseUrl    - Provider base URL
 * @param {string} data.fromNumber - Caller ID number in E.164 format
 * @param {Object} [data.metadata] - Optional extra config
 * @returns {Promise<Object>} Created ProviderConfig record
 */
async function createProviderConfig(tenantId, { provider, apiKey, baseUrl, fromNumber, metadata = {} }) {
  // Validate tenant exists
  await getTenantById(tenantId);

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw badRequest(
      `Unsupported provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`
    );
  }

  if (!apiKey || !baseUrl || !fromNumber) {
    throw badRequest('apiKey, baseUrl, and fromNumber are required');
  }

  logger.info(`Creating provider config`, { tenantId, provider });

  const config = await prisma.providerConfig.create({
    data: {
      tenantId,
      provider,
      apiKey,
      baseUrl,
      fromNumber,
      metadata,
    },
  });

  logger.info(`ProviderConfig created`, { id: config.id, tenantId, provider });
  return config;
}

/**
 * Returns the active ProviderConfig for a tenant.
 * If a tenant has multiple configs, returns the most recently created one.
 * Throws 404 if no config exists.
 *
 * @param {string} tenantId
 * @returns {Promise<Object>} ProviderConfig record
 */
async function getProviderConfigForTenant(tenantId) {
  const config = await prisma.providerConfig.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });

  if (!config) {
    const err = new Error(
      `No provider config found for tenant ${tenantId}. ` +
      'Create one via POST /api/tenants/:tenantId/provider-configs'
    );
    err.statusCode = 404;
    throw err;
  }

  return config;
}

module.exports = {
  createTenant,
  listTenants,
  getTenantById,
  getTenantBySlug,
  createProviderConfig,
  getProviderConfigForTenant,
};
