/**
 * @fileoverview Call service — orchestrates campaign execution and call lifecycle.
 *
 * This service is the bridge between the domain model (campaigns, contacts, flows)
 * and the voice provider abstraction. It never directly references Infobip.
 */

const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');
const { badRequest } = require('../middleware/errorHandler');
const { getCampaignById } = require('./campaignService');
const { getProviderConfigForTenant } = require('./tenantService');
const { createProvider } = require('./providerFactory');
const { config } = require('../config/env');

const prisma = new PrismaClient();
const logger = createLogger('CallService');

/**
 * Starts a campaign by iterating over all pending recipients and initiating
 * a call for each one via the configured voice provider.
 *
 * Steps:
 *  1. Validate campaign is in a startable state (draft or paused)
 *  2. Load the campaign's VoiceFlow
 *  3. Load the tenant's ProviderConfig and instantiate the provider
 *  4. For each pending recipient, call provider.initiateCall()
 *  5. Persist a Call record and update recipient status
 *  6. Update campaign status to "active"
 *
 * Calls are initiated sequentially (not in parallel) to avoid rate limiting.
 * TODO: Add configurable concurrency / batch size for large campaigns.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} Summary of the start operation
 */
async function startCampaign(campaignId) {
  const campaign = await getCampaignById(campaignId);

  // Validate campaign can be started
  if (!['draft', 'paused'].includes(campaign.status)) {
    throw badRequest(
      `Campaign "${campaign.name}" is in status "${campaign.status}" and cannot be started. ` +
      'Only "draft" or "paused" campaigns can be started.'
    );
  }

  if (!campaign.flow) {
    throw badRequest(
      `Campaign "${campaign.name}" has no VoiceFlow. ` +
      'Set a flow via POST /api/campaigns/:campaignId/flow before starting.'
    );
  }

  // Load pending recipients with their contact data
  const pendingRecipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'pending' },
    include: { contact: true },
  });

  if (pendingRecipients.length === 0) {
    throw badRequest(
      `Campaign "${campaign.name}" has no pending recipients. ` +
      'Add recipients via POST /api/campaigns/:campaignId/recipients.'
    );
  }

  logger.info(`Starting campaign`, {
    campaignId,
    campaignName: campaign.name,
    recipientCount: pendingRecipients.length,
  });

  // Get provider config and instantiate provider
  const providerConfig = await getProviderConfigForTenant(campaign.tenantId);
  const provider = createProvider(providerConfig);

  // Build webhook URL for this campaign
  const webhookUrl = buildWebhookUrl(providerConfig.provider);

  // Set campaign to active immediately (before calls are placed)
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'active' },
  });

  // Track results
  const results = {
    initiated: 0,
    failed: 0,
    errors: [],
  };

  // Initiate calls sequentially
  for (const recipient of pendingRecipients) {
    const { contact } = recipient;

    try {
      logger.info(`Initiating call for recipient`, {
        recipientId: recipient.id,
        contactId: contact.id,
        phone: contact.phone,
      });

      const callResult = await provider.initiateCall({
        toNumber: contact.phone,
        fromNumber: providerConfig.fromNumber,
        contact,
        flow: campaign.flow,
        webhookUrl,
        tenantMetadata: campaign.tenant?.metadata || {},
        recipientId: recipient.id,
      });

      // Persist Call record
      await prisma.call.create({
        data: {
          campaignId,
          recipientId: recipient.id,
          providerCallId: callResult.providerCallId,
          status: callResult.status || 'initiated',
          metadata: {
            providerConfig: providerConfig.provider,
          },
        },
      });

      // Mark recipient as called
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'called' },
      });

      results.initiated++;
      logger.info(`Call initiated`, {
        recipientId: recipient.id,
        providerCallId: callResult.providerCallId,
        status: callResult.status,
      });
    } catch (error) {
      logger.error(`Failed to initiate call for recipient`, {
        recipientId: recipient.id,
        contactId: contact.id,
        error: error.message,
      });

      // Persist failed Call record
      await prisma.call.create({
        data: {
          campaignId,
          recipientId: recipient.id,
          providerCallId: null,
          status: 'failed',
          metadata: {
            error: error.message,
          },
        },
      });

      // Mark recipient as failed
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed' },
      });

      results.failed++;
      results.errors.push({
        recipientId: recipient.id,
        contactPhone: contact.phone,
        error: error.message,
      });
    }
  }

  logger.info(`Campaign start completed`, {
    campaignId,
    ...results,
  });

  return {
    campaignId,
    campaignName: campaign.name,
    status: 'active',
    results,
  };
}

/**
 * Handles an incoming webhook event (call status update or DTMF response).
 *
 * Called by the webhooks route after the adapter has parsed the raw payload.
 *
 * @param {import('../providers/infobip/InfobipWebhookAdapter').ParsedWebhookEvent} event
 * @returns {Promise<void>}
 */
async function handleWebhookEvent(event) {
  const { providerCallId, status, dtmfDigit, stepId, eventType } = event;

  if (!providerCallId) {
    logger.warn('Webhook event missing providerCallId — ignoring', { event });
    return;
  }

  // Find the call by provider-issued ID
  const call = await prisma.call.findFirst({
    where: { providerCallId },
    include: { campaign: true },
  });

  if (!call) {
    logger.warn('No call found for providerCallId — ignoring webhook', { providerCallId });
    return;
  }

  logger.info(`Processing webhook event`, {
    callId: call.id,
    providerCallId,
    eventType,
    status,
    hasDtmf: dtmfDigit !== null,
  });

  // ─── Update call status ────────────────────────────────────────────────────
  const callUpdateData = { status };

  if (status === 'answered' && !call.startedAt) {
    callUpdateData.startedAt = new Date();
  }

  if (['completed', 'failed', 'no_answer'].includes(status)) {
    callUpdateData.endedAt = new Date();
  }

  await prisma.call.update({
    where: { id: call.id },
    data: callUpdateData,
  });

  // ─── Save DTMF response ────────────────────────────────────────────────────
  if (eventType === 'dtmf' && dtmfDigit !== null) {
    // Try to resolve the semantic value from the flow's step options
    let value = null;

    if (stepId) {
      const flow = await prisma.voiceFlow.findUnique({
        where: { campaignId: call.campaignId },
      });

      if (flow && Array.isArray(flow.steps)) {
        const step = flow.steps.find((s) => s.id === stepId);
        if (step?.options) {
          value = step.options[dtmfDigit] || null;
        }
      }
    }

    await prisma.response.create({
      data: {
        callId: call.id,
        stepId: stepId || 'unknown',
        input: dtmfDigit,
        value,
      },
    });

    logger.info(`DTMF response saved`, {
      callId: call.id,
      stepId: stepId || 'unknown',
      dtmfDigit,
      value,
    });
  }
}

/**
 * Builds the full webhook URL that the provider should send events to.
 *
 * @param {string} providerName - e.g. "infobip"
 * @returns {string} Full HTTPS webhook URL
 */
function buildWebhookUrl(providerName) {
  const base = config.webhook.baseUrl.replace(/\/$/, '');
  return `${base}/api/webhooks/${providerName}/voice`;
}

module.exports = {
  startCampaign,
  handleWebhookEvent,
  buildWebhookUrl,
};
