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
const { callQueue } = require('../queues/index');
const webhookService = require('./webhookService');

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
async function startCampaign(campaignId, { sandbox = false, limit = 5 } = {}) {
  const campaign = await getCampaignById(campaignId);

  const startableStatuses = sandbox
    ? ['draft', 'sandbox', 'paused', 'completed']
    : ['draft', 'paused', 'completed'];

  if (!startableStatuses.includes(campaign.status)) {
    throw badRequest(
      `Campaign "${campaign.name}" is in status "${campaign.status}" and cannot be started.`
    );
  }

  if (!campaign.flow) {
    throw badRequest(
      `Campaign "${campaign.name}" has no VoiceFlow. ` +
      'Set a flow via POST /api/campaigns/:campaignId/flow before starting.'
    );
  }

  // Reset sandbox-processed recipients back to pending
  await prisma.campaignRecipient.updateMany({
    where: { campaignId, status: { in: ['sandbox', 'sandbox_pending'] } },
    data: { status: 'pending' },
  });

  // When re-launching a completed campaign with no pending recipients, reset all called/failed
  if (campaign.status === 'completed') {
    const pendingBeforeReset = await prisma.campaignRecipient.count({
      where: { campaignId, status: 'pending' },
    });
    if (pendingBeforeReset === 0) {
      await prisma.campaignRecipient.updateMany({
        where: { campaignId, status: { in: ['called', 'failed'] } },
        data: { status: 'pending' },
      });
    }
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

  const selected = sandbox
    ? pendingRecipients.slice(0, Math.max(1, limit))
    : pendingRecipients;

  logger.info(`Starting campaign`, {
    campaignId,
    campaignName: campaign.name,
    sandbox,
    recipientCount: selected.length,
  });

  // Validate provider config exists before enqueueing
  await getProviderConfigForTenant(campaign.tenantId);

  if (sandbox) {
    // Pre-mark selected recipients so worker can use them for idempotency checks
    await prisma.campaignRecipient.updateMany({
      where: { id: { in: selected.map((r) => r.id) } },
      data: { status: 'sandbox_pending' },
    });
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: sandbox ? 'sandbox' : 'running',
      startedAt: campaign.startedAt ?? new Date(),
    },
  });

  const jobs = selected.map((recipient) => ({
    name: 'initiate-call',
    data: {
      campaignId,
      recipientId: recipient.id,
      tenantId: campaign.tenantId,
      contactId: recipient.contact.id,
      phone: recipient.contact.phone,
      ...(sandbox && { sandbox: true }),
    },
  }));

  await callQueue.addBulk(jobs);

  logger.info(`Campaign jobs enqueued`, { campaignId, count: jobs.length, sandbox });

  return {
    campaignId,
    campaignName: campaign.name,
    status: sandbox ? 'sandbox' : 'running',
    enqueued: jobs.length,
    ...(sandbox && { sandbox: true }),
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

  const updatedCall = await prisma.call.update({
    where: { id: call.id },
    data: callUpdateData,
  });

  // ─── Save DTMF response ────────────────────────────────────────────────────
  let savedResponse = null;
  if (eventType === 'dtmf' && dtmfDigit !== null) {
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

    savedResponse = await prisma.response.create({
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

  // ─── Dispatch outgoing webhooks (fire-and-forget) ─────────────────────────
  // Sandbox calls don't trigger outgoing webhooks
  if (call.metadata?.sandbox) return updatedCall;

  const tenantId = call.campaign.tenantId;
  const callPayload = {
    callId: call.id,
    campaignId: call.campaignId,
    recipientId: call.recipientId,
    providerCallId: call.providerCallId,
    status: updatedCall.status,
    startedAt: updatedCall.startedAt,
    endedAt: updatedCall.endedAt,
    duration: updatedCall.duration,
  };

  if (status === 'answered') {
    webhookService.dispatch(tenantId, 'call.answered', callPayload).catch(() => {});
  } else if (status === 'completed') {
    const responses = await prisma.response.findMany({ where: { callId: call.id } });
    webhookService.dispatch(tenantId, 'call.completed', { ...callPayload, responses }).catch(() => {});
    maybeDispatchCampaignCompleted(call.campaignId, tenantId);
  } else if (status === 'failed') {
    webhookService.dispatch(tenantId, 'call.failed', callPayload).catch(() => {});
    maybeDispatchCampaignCompleted(call.campaignId, tenantId);
  } else if (status === 'no_answer') {
    webhookService.dispatch(tenantId, 'call.no_answer', callPayload).catch(() => {});
    maybeDispatchCampaignCompleted(call.campaignId, tenantId);
  }
}

async function maybeDispatchCampaignCompleted(campaignId, tenantId) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, status: true, startedAt: true, completedAt: true },
    });
    if (!campaign || campaign.status === 'completed') return;
    // Sandbox runs don't fire campaign.completed webhook
    if (campaign.status === 'sandbox') return;

    const pending = await prisma.campaignRecipient.count({
      where: { campaignId, status: 'pending' },
    });
    if (pending > 0) return;

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', completedAt: new Date() },
    });

    webhookService.dispatch(tenantId, 'campaign.completed', {
      campaignId,
      campaignName: campaign.name,
      completedAt: new Date().toISOString(),
    }).catch(() => {});
  } catch (err) {
    logger.warn('maybeDispatchCampaignCompleted failed', { campaignId, error: err.message });
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
