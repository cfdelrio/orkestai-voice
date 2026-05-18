/**
 * @fileoverview Campaign service — business logic for campaign and flow management.
 */

const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');
const { notFound, badRequest } = require('../middleware/errorHandler');
const { getTenantById } = require('./tenantService');
const { validateContactsForTenant } = require('./contactService');
const { callQueue } = require('../queues/index');

const prisma = new PrismaClient();
const logger = createLogger('CampaignService');

/**
 * Valid VoiceFlow step types.
 */
const VALID_STEP_TYPES = ['say', 'dtmf_question', 'goodbye'];

/**
 * Creates a new campaign for a tenant.
 *
 * @param {string} tenantId
 * @param {Object} data
 * @param {string} data.name
 * @param {string} [data.description]
 * @param {Object} [data.metadata]
 * @returns {Promise<Object>} Created campaign record
 */
async function createCampaign(tenantId, { name, description, variables = {}, metadata = {} }) {
  await getTenantById(tenantId);

  if (!name || !name.trim()) {
    throw badRequest('name is required');
  }

  logger.info(`Creating campaign`, { tenantId, name });

  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: name.trim(),
      description: description?.trim() || null,
      status: 'draft',
      variables,
      metadata,
    },
  });

  logger.info(`Campaign created`, { id: campaign.id, tenantId });
  return campaign;
}

/**
 * Lists all campaigns for a tenant.
 *
 * @param {string} tenantId
 * @returns {Promise<Object[]>}
 */
async function listCampaigns(tenantId) {
  await getTenantById(tenantId);

  return prisma.campaign.findMany({
    where: { tenantId },
    include: { flow: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Finds a campaign by ID. Throws 404 if not found.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>} Campaign record (includes flow and tenant)
 */
async function getCampaignById(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { flow: true, tenant: true },
  });

  if (!campaign) {
    throw notFound('Campaign', campaignId);
  }

  return campaign;
}

/**
 * Validates VoiceFlow steps array.
 * Each step must have an id, a valid type, and a non-empty text field.
 * dtmf_question steps must also have an options map.
 *
 * @param {any[]} steps
 * @throws {Error} 400 if validation fails
 */
function validateFlowSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw badRequest('steps must be a non-empty array');
  }

  const seenIds = new Set();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prefix = `Step at index ${i}`;

    if (!step || typeof step !== 'object') {
      throw badRequest(`${prefix}: must be an object`);
    }

    if (!step.id || typeof step.id !== 'string' || !step.id.trim()) {
      throw badRequest(`${prefix}: "id" is required and must be a non-empty string`);
    }

    if (seenIds.has(step.id)) {
      throw badRequest(`${prefix}: duplicate step id "${step.id}"`);
    }
    seenIds.add(step.id);

    if (!VALID_STEP_TYPES.includes(step.type)) {
      throw badRequest(
        `${prefix} (id="${step.id}"): invalid type "${step.type}". ` +
        `Valid types: ${VALID_STEP_TYPES.join(', ')}`
      );
    }

    if (!step.text || typeof step.text !== 'string' || !step.text.trim()) {
      throw badRequest(`${prefix} (id="${step.id}"): "text" is required and must be a non-empty string`);
    }

    if (step.type === 'dtmf_question') {
      if (!step.options || typeof step.options !== 'object' || Array.isArray(step.options)) {
        throw badRequest(
          `${prefix} (id="${step.id}"): dtmf_question steps must have an "options" object ` +
          `mapping DTMF digits to semantic values (e.g. { "1": "yes", "2": "no" })`
        );
      }
    }
  }
}

const VALID_VOICES = [
  'Polly.Mia-Neural',
  'Polly.Lupe-Neural',
  'Polly.Andres-Neural',
  'Polly.Miguel-Neural',
  'es-MX',
  'es-ES',
];

/**
 * Sets (creates or replaces) the VoiceFlow for a campaign.
 *
 * @param {string} campaignId
 * @param {Object} data
 * @param {any[]} data.steps - Array of VoiceFlow steps
 * @param {string} [data.voice] - Voice identifier (Polly voice or language code)
 * @returns {Promise<Object>} The VoiceFlow record
 */
async function setFlow(campaignId, { steps, voice }) {
  const campaign = await getCampaignById(campaignId);

  validateFlowSteps(steps);

  const resolvedVoice = voice && VALID_VOICES.includes(voice) ? voice : 'Polly.Mia-Neural';

  logger.info(`Setting voice flow`, { campaignId, stepCount: steps.length, voice: resolvedVoice });

  const flow = await prisma.voiceFlow.upsert({
    where: { campaignId },
    update: { steps, voice: resolvedVoice },
    create: { campaignId, steps, voice: resolvedVoice },
  });

  logger.info(`VoiceFlow set`, { flowId: flow.id, campaignId, stepCount: steps.length, voice: resolvedVoice });

  return { ...flow, campaignName: campaign.name };
}

/**
 * Adds contacts as recipients to a campaign.
 * Skips contacts that are already recipients (idempotent).
 *
 * @param {string} campaignId
 * @param {string[]} contactIds
 * @returns {Promise<Object[]>} Newly created CampaignRecipient records
 */
async function addRecipients(campaignId, contactIds) {
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw badRequest('contactIds must be a non-empty array of UUIDs');
  }

  const campaign = await getCampaignById(campaignId);
  const tenantId = campaign.tenantId;

  // Validate contacts belong to the tenant
  await validateContactsForTenant(tenantId, contactIds);

  // Find which contacts are already recipients
  const existing = await prisma.campaignRecipient.findMany({
    where: { campaignId, contactId: { in: contactIds } },
    select: { contactId: true },
  });
  const existingIds = new Set(existing.map((r) => r.contactId));

  const newContactIds = contactIds.filter((id) => !existingIds.has(id));

  if (newContactIds.length === 0) {
    logger.info(`All contacts are already recipients`, { campaignId, count: contactIds.length });
    return [];
  }

  logger.info(`Adding recipients to campaign`, {
    campaignId,
    newCount: newContactIds.length,
    skippedCount: existingIds.size,
  });

  const recipients = await prisma.$transaction(
    newContactIds.map((contactId) =>
      prisma.campaignRecipient.create({
        data: { campaignId, contactId, status: 'pending' },
        include: { contact: true },
      })
    )
  );

  logger.info(`Recipients added`, { campaignId, count: recipients.length });
  return recipients;
}

/**
 * Returns campaign results with stats:
 * total recipients, calls grouped by status, and responses grouped by stepId + value.
 *
 * @param {string} campaignId
 * @returns {Promise<Object>}
 */
async function getCampaignResults(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      flow: true,
      recipients: {
        include: {
          contact: true,
          calls: {
            include: { responses: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  if (!campaign) {
    throw notFound('Campaign', campaignId);
  }

  // Aggregate call status counts
  const callStatusCounts = {};
  const responsesByStep = {};

  for (const recipient of campaign.recipients) {
    const lastCall = recipient.calls[0];
    if (lastCall) {
      const st = lastCall.status;
      callStatusCounts[st] = (callStatusCounts[st] || 0) + 1;

      // Group responses by stepId + value
      for (const response of lastCall.responses) {
        const key = response.stepId;
        if (!responsesByStep[key]) {
          responsesByStep[key] = {};
        }
        const val = response.value || response.input;
        responsesByStep[key][val] = (responsesByStep[key][val] || 0) + 1;
      }
    }
  }

  const totalRecipients = campaign.recipients.length;
  const pendingCount = campaign.recipients.filter((r) => r.status === 'pending').length;
  const calledCount = campaign.recipients.filter((r) => r.status === 'called').length;
  const failedCount = campaign.recipients.filter((r) => r.status === 'failed').length;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    },
    flow: campaign.flow,
    stats: {
      totalRecipients,
      recipientsByStatus: {
        pending: pendingCount,
        called: calledCount,
        failed: failedCount,
      },
      callsByStatus: callStatusCounts,
      responsesByStep,
    },
  };
}

/**
 * Pauses a running campaign.
 * Pending jobs remain in the queue but recipients stay as 'pending' so resume can re-enqueue.
 * Note: jobs already picked up by the worker will still complete.
 *
 * @param {string} campaignId
 */
async function pauseCampaign(campaignId) {
  const campaign = await getCampaignById(campaignId);

  if (campaign.status !== 'running') {
    throw badRequest(`Campaign is "${campaign.status}" — only running campaigns can be paused`);
  }

  // Drain waiting (not yet started) jobs for this campaign from the queue
  await callQueue.pause();
  const waiting = await callQueue.getWaiting();
  const toRemove = waiting.filter((j) => j.data.campaignId === campaignId);
  await Promise.all(toRemove.map((j) => j.remove()));
  await callQueue.resume();

  // Reset recipients that were re-queued but not yet picked up back to 'pending'
  // (Worker handles idempotency — if a job was already processed, status is 'called')
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'paused' },
  });

  logger.info('Campaign paused', { campaignId, removedJobs: toRemove.length });

  return { campaignId, status: 'paused', removedJobs: toRemove.length };
}

/**
 * Resumes a paused campaign by re-enqueueing all pending recipients.
 *
 * @param {string} campaignId
 */
async function resumeCampaign(campaignId) {
  const campaign = await getCampaignById(campaignId);

  if (campaign.status !== 'paused') {
    throw badRequest(`Campaign is "${campaign.status}" — only paused campaigns can be resumed`);
  }

  const pendingRecipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: 'pending' },
    include: { contact: true },
  });

  if (pendingRecipients.length === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', completedAt: new Date() },
    });
    return { campaignId, status: 'completed', enqueued: 0 };
  }

  const jobs = pendingRecipients.map((r) => ({
    name: 'initiate-call',
    data: {
      campaignId,
      recipientId: r.id,
      tenantId: campaign.tenantId,
      contactId: r.contact.id,
      phone: r.contact.phone,
    },
  }));

  await callQueue.addBulk(jobs);

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'running' },
  });

  logger.info('Campaign resumed', { campaignId, enqueued: jobs.length });

  return { campaignId, status: 'running', enqueued: jobs.length };
}

/**
 * Deletes a campaign and all related data in the correct FK order.
 * Refuses to delete campaigns that are currently running.
 *
 * @param {string} campaignId
 */
async function deleteCampaign(campaignId) {
  const campaign = await getCampaignById(campaignId);

  if (campaign.status === 'running') {
    throw badRequest('No se puede borrar una campaña activa. Pausala primero.');
  }

  await prisma.$transaction(async (tx) => {
    const calls = await tx.call.findMany({ where: { campaignId }, select: { id: true } });
    const callIds = calls.map((c) => c.id);

    if (callIds.length > 0) {
      await tx.response.deleteMany({ where: { callId: { in: callIds } } });
    }
    await tx.call.deleteMany({ where: { campaignId } });
    await tx.campaignRecipient.deleteMany({ where: { campaignId } });
    await tx.voiceFlow.deleteMany({ where: { campaignId } });
    await tx.campaign.delete({ where: { id: campaignId } });
  });

  logger.info('Campaign deleted', { campaignId });
  return { deleted: true, campaignId };
}

module.exports = {
  createCampaign,
  listCampaigns,
  getCampaignById,
  validateFlowSteps,
  setFlow,
  addRecipients,
  getCampaignResults,
  pauseCampaign,
  resumeCampaign,
  deleteCampaign,
};
