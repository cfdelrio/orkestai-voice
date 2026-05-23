const { Router } = require('express');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const apiKeyService = require('../services/apiKeyService');

const router = Router({ mergeParams: true });

// POST /api/tenants/:tenantId/api-keys
router.post('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw badRequest('"name" is required');
  }
  const result = await apiKeyService.createApiKey(tenantId, name.trim());
  // raw key returned ONCE — caller must store it securely
  res.status(201).json({
    apiKey: { id: result.id, name: result.name, createdAt: result.createdAt },
    key: result.key,
  });
}));

// GET /api/tenants/:tenantId/api-keys
router.get('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const apiKeys = await apiKeyService.listApiKeys(tenantId);
  res.json({ apiKeys, count: apiKeys.length });
}));

// DELETE /api/tenants/:tenantId/api-keys/:keyId
router.delete('/:keyId', asyncHandler(async (req, res) => {
  const { tenantId, keyId } = req.params;
  const result = await apiKeyService.deleteApiKey(tenantId, keyId);
  res.json(result);
}));

module.exports = router;
