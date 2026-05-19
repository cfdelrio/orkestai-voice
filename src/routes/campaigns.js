/**
 * @fileoverview Campaign routes.
 *
 * POST /api/tenants/:tenantId/campaigns          - Create a campaign
 * GET  /api/tenants/:tenantId/campaigns          - List campaigns for a tenant
 * GET  /api/campaigns/:campaignId                - Get a campaign by ID
 * POST /api/campaigns/:campaignId/flow           - Set/replace VoiceFlow
 * POST /api/campaigns/:campaignId/recipients     - Add recipients
 * POST /api/campaigns/:campaignId/start          - Start the campaign (initiate calls)
 * GET  /api/campaigns/:campaignId/results        - Get campaign results and stats
 */

const { Router } = require('express');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const campaignService = require('../services/campaignService');
const callService = require('../services/callService');
const publicFeedService = require('../services/publicFeedService');

// ─── Tenant-scoped campaign routes ────────────────────────────────────────────

const tenantRouter = Router({ mergeParams: true });

/**
 * POST /api/tenants/:tenantId/campaigns
 * Creates a campaign under a tenant.
 *
 * Body: { name, description?, metadata? }
 */
tenantRouter.post('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { name, description, variables, voiceInstructions, voice, ttsProvider, elevenLabsVoiceId, metadata } = req.body;

  if (!name || typeof name !== 'string') {
    throw badRequest('"name" is required');
  }

  const campaign = await campaignService.createCampaign(tenantId, {
    name,
    description: description || null,
    variables: variables && typeof variables === 'object' ? variables : {},
    voiceInstructions: typeof voiceInstructions === 'string' ? voiceInstructions : undefined,
    voice: typeof voice === 'string' ? voice : undefined,
    ttsProvider: typeof ttsProvider === 'string' ? ttsProvider : undefined,
    elevenLabsVoiceId: typeof elevenLabsVoiceId === 'string' ? elevenLabsVoiceId : undefined,
    metadata: metadata || {},
  });

  res.status(201).json({ campaign });
}));

/**
 * GET /api/tenants/:tenantId/campaigns
 * Lists all campaigns for a tenant.
 */
tenantRouter.get('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const campaigns = await campaignService.listCampaigns(tenantId);
  res.json({ campaigns, count: campaigns.length });
}));

// ─── Campaign-level routes (no tenantId in URL) ───────────────────────────────

const campaignRouter = Router();

/**
 * GET /api/campaigns/:campaignId
 * Returns a single campaign by ID.
 */
campaignRouter.get('/:campaignId', asyncHandler(async (req, res) => {
  const campaign = await campaignService.getCampaignById(req.params.campaignId);
  res.json({ campaign });
}));

/**
 * POST /api/campaigns/:campaignId/flow
 * Sets or replaces the VoiceFlow for a campaign.
 *
 * Body: { steps: [{ id, type, text, ...stepSpecificFields }] }
 */
campaignRouter.post('/:campaignId/flow', asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { steps, voice } = req.body;

  if (!steps) {
    throw badRequest('"steps" array is required');
  }

  const flow = await campaignService.setFlow(campaignId, { steps, voice });
  res.status(201).json({ flow });
}));

/**
 * POST /api/campaigns/:campaignId/recipients
 * Adds contacts as recipients to a campaign.
 *
 * Body: { contactIds: [uuid, ...] }
 */
campaignRouter.post('/:campaignId/recipients', asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { contactIds } = req.body;

  if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
    throw badRequest('"contactIds" must be a non-empty array of contact UUIDs');
  }

  const recipients = await campaignService.addRecipients(campaignId, contactIds);

  res.status(201).json({
    added: recipients.length,
    skipped: contactIds.length - recipients.length,
    recipients,
  });
}));

/**
 * POST /api/campaigns/:campaignId/start
 * Starts a campaign: iterates pending recipients and calls the voice provider.
 * Sets campaign status to "active".
 */
campaignRouter.post('/:campaignId/start', asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const result = await callService.startCampaign(campaignId);
  res.json(result);
}));

/**
 * GET /api/campaigns/:campaignId/results
 * Returns campaign stats: call counts by status, DTMF responses grouped by stepId.
 */
campaignRouter.get('/:campaignId/results', asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const results = await campaignService.getCampaignResults(campaignId);
  res.json(results);
}));

/**
 * PATCH /api/campaigns/:campaignId/pause
 * Pauses a running campaign.
 */
campaignRouter.patch('/:campaignId/pause', asyncHandler(async (req, res) => {
  const result = await campaignService.pauseCampaign(req.params.campaignId);
  res.json(result);
}));

/**
 * PATCH /api/campaigns/:campaignId/resume
 * Resumes a paused campaign.
 */
campaignRouter.patch('/:campaignId/resume', asyncHandler(async (req, res) => {
  const result = await campaignService.resumeCampaign(req.params.campaignId);
  res.json(result);
}));

/**
 * PATCH /api/campaigns/:campaignId
 * Updates campaign voice instructions and/or variables.
 * Clears pre-generated audio cache when voice instructions change.
 *
 * Body: { voiceInstructions?, variables? }
 */
campaignRouter.patch('/:campaignId', asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { voiceInstructions, voice, ttsProvider, elevenLabsVoiceId, variables } = req.body;

  const campaign = await campaignService.updateCampaign(campaignId, {
    voiceInstructions: typeof voiceInstructions === 'string' ? voiceInstructions : undefined,
    voice: typeof voice === 'string' ? voice : undefined,
    ttsProvider: typeof ttsProvider === 'string' ? ttsProvider : undefined,
    elevenLabsVoiceId: typeof elevenLabsVoiceId === 'string' ? elevenLabsVoiceId : undefined,
    variables: variables && typeof variables === 'object' ? variables : undefined,
  });

  res.json({ campaign });
}));

/**
 * DELETE /api/campaigns/:campaignId
 * Deletes a campaign and all associated data (flow, recipients, calls, responses).
 * Running campaigns cannot be deleted.
 */
campaignRouter.delete('/:campaignId', asyncHandler(async (req, res) => {
  const result = await campaignService.deleteCampaign(req.params.campaignId);
  res.json(result);
}));

/**
 * GET /api/campaigns/:campaignId/feed-config
 * Returns the public feed config for a campaign (null if not set).
 */
campaignRouter.get('/:campaignId/feed-config', asyncHandler(async (req, res) => {
  const config = await publicFeedService.getFeedConfig(req.params.campaignId);
  res.json({ feedConfig: config });
}));

/**
 * POST /api/campaigns/:campaignId/feed-config
 * Creates or updates the public feed config.
 *
 * Body: { slug, title, description?, enabled?, publicQuestions?, showRecentActivity?, refreshIntervalSeconds? }
 */
campaignRouter.post('/:campaignId/feed-config', asyncHandler(async (req, res) => {
  const { campaignId } = req.params;
  const { slug, title, ...rest } = req.body;

  const existing = await publicFeedService.getFeedConfig(campaignId);
  if (!existing && (!slug || !title)) {
    throw badRequest('"slug" and "title" are required when creating a feed config');
  }
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    throw badRequest('"slug" must be lowercase alphanumeric with hyphens only');
  }

  const config = await publicFeedService.upsertFeedConfig(campaignId, { slug, title, ...rest });
  res.status(existing ? 200 : 201).json({ feedConfig: config });
}));

/**
 * DELETE /api/campaigns/:campaignId/feed-config
 * Removes the public feed config (disables the feed permanently).
 */
campaignRouter.delete('/:campaignId/feed-config', asyncHandler(async (req, res) => {
  const result = await publicFeedService.deleteFeedConfig(req.params.campaignId);
  if (!result) return res.status(404).json({ error: { message: 'Feed config not found' } });
  res.json(result);
}));

module.exports = { tenantRouter, campaignRouter };
