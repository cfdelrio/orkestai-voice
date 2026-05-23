const { Router } = require('express');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const webhookService = require('../services/webhookService');

const router = Router({ mergeParams: true });

// POST /api/tenants/:tenantId/webhook-endpoints
router.post('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { url, events, enabled } = req.body;
  if (!url || typeof url !== 'string') throw badRequest('"url" is required');
  if (!/^https?:\/\/.+/.test(url)) throw badRequest('"url" must be a valid HTTP or HTTPS URL');
  const endpoint = await webhookService.createEndpoint(tenantId, { url, events, enabled });
  // secret is shown at creation time only
  res.status(201).json({ endpoint });
}));

// GET /api/tenants/:tenantId/webhook-endpoints
router.get('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const endpoints = await webhookService.listEndpoints(tenantId);
  res.json({ endpoints, validEvents: webhookService.VALID_EVENTS, count: endpoints.length });
}));

// PUT /api/tenants/:tenantId/webhook-endpoints/:endpointId
router.put('/:endpointId', asyncHandler(async (req, res) => {
  const { tenantId, endpointId } = req.params;
  const { url, events, enabled } = req.body;
  if (url !== undefined && !/^https?:\/\/.+/.test(url)) throw badRequest('"url" must be a valid HTTP or HTTPS URL');
  const endpoint = await webhookService.updateEndpoint(tenantId, endpointId, { url, events, enabled });
  res.json({ endpoint });
}));

// DELETE /api/tenants/:tenantId/webhook-endpoints/:endpointId
router.delete('/:endpointId', asyncHandler(async (req, res) => {
  const { tenantId, endpointId } = req.params;
  const result = await webhookService.deleteEndpoint(tenantId, endpointId);
  res.json(result);
}));

module.exports = router;
