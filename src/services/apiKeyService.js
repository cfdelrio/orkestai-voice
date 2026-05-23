const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { createLogger } = require('../middleware/logger');

const prisma = new PrismaClient();
const logger = createLogger('ApiKeyService');

const PREFIX = 'ok_';

function generateKey() {
  return PREFIX + crypto.randomBytes(32).toString('hex');
}

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function createApiKey(tenantId, name) {
  const rawKey = generateKey();
  const keyHash = hashKey(rawKey);
  const record = await prisma.apiKey.create({
    data: { tenantId, name, keyHash },
  });
  logger.info('API key created', { tenantId, keyId: record.id, name });
  return { ...record, key: rawKey };
}

async function listApiKeys(tenantId) {
  return prisma.apiKey.findMany({
    where: { tenantId },
    select: { id: true, name: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function deleteApiKey(tenantId, keyId) {
  const key = await prisma.apiKey.findFirst({ where: { id: keyId, tenantId } });
  if (!key) {
    const err = new Error('API key not found');
    err.statusCode = 404;
    throw err;
  }
  await prisma.apiKey.delete({ where: { id: keyId } });
  return { deleted: true };
}

async function findTenantByRawKey(rawKey) {
  const keyHash = hashKey(rawKey);
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { tenant: true },
  });
  if (!record) return null;
  // Fire-and-forget lastUsedAt update
  prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return record;
}

module.exports = { createApiKey, listApiKeys, deleteApiKey, findTenantByRawKey };
