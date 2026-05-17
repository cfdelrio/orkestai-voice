/**
 * @fileoverview Campaign service — business logic for campaign and flow management.
 */

const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');
const { notFound, badRequest } = require('../middleware/errorHandler');
const { getTenantById } = require('./tenantService');
const { validateContactsForTenant } = require('./contactService');

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
async function createCampaign(tenantId, { name, description, metadata = {} }) {
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

/**
 * Sets (creates or replaces) the VoiceFlow for a campaign.
 *
 * @param {string} campaignId
 * @param {Object} data
 * @param {any[]} data.steps - Array of VoiceFlow steps
 * @returns {Promise<Object>} The VoiceFlow record
 */
async function setFlow(campaignId, { steps }) {
  const campaign = await getCampaignById(campaignId);

  validateFlowSteps(steps);

  logger.info(`Setting voice flow`, { campaignId, stepCount: steps.length });

  // Upsert: delete existing flow and create new one, or just create
  const flow = await prisma.voiceFlow.upsert({
    where: { campaignId },
    update: { steps },
    create: { campaignId, steps },
  });

  logger.info(`VoiceFlow set`, { flowId: flow.id, campaignId, stepCount: steps.length });

  // Return flow along with campaign name for context
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

module.exports = {
  createCampaign,
  listCampaigns,
  getCampaignById,
  validateFlowSteps,
  setFlow,
  addRecipients,
  getCampaignResults,
};
