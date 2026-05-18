const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');
const { getProviderConfigForTenant } = require('../services/tenantService');
const { createProvider } = require('../services/providerFactory');
const { buildWebhookUrl } = require('../services/callService');
const { getRedisConnection } = require('../queues/redis');
const { generateAudioForRecipient } = require('../services/audioService');
const { interpolateTemplate } = require('../services/templateEngine');
const { config } = require('../config/env');

const prisma = new PrismaClient();
const logger = createLogger('CallWorker');

const CONCURRENCY = parseInt(process.env.CALL_CONCURRENCY ?? '3', 10);

async function processCallJob(job) {
  const { campaignId, recipientId, tenantId, contactId, phone } = job.data;

  logger.info('Processing call job', { jobId: job.id, recipientId, phone });

  const [providerConfig, recipient] = await Promise.all([
    getProviderConfigForTenant(tenantId),
    prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: { contact: true, campaign: { include: { flow: true, tenant: true } } },
    }),
  ]);

  if (!recipient) {
    logger.warn('Recipient not found — skipping job', { recipientId });
    return;
  }

  // Skip if already called (idempotency on retry)
  if (recipient.status === 'called') {
    logger.info('Recipient already called — skipping', { recipientId });
    return;
  }

  const campaign = recipient.campaign;
  const provider = createProvider(providerConfig);
  const webhookUrl = buildWebhookUrl(providerConfig.provider);

  // Pre-generate TTS audio for all flow steps before initiating the call.
  // This ensures Twilio can fetch <Play> URLs the moment the call connects.
  if (campaign.flow?.steps && process.env.OPENAI_API_KEY) {
    const campaignVars = campaign.variables && typeof campaign.variables === 'object'
      ? campaign.variables : {};
    const vars = {
      ...campaignVars,
      firstName: recipient.contact.firstName || '',
      lastName:  recipient.contact.lastName  || '',
      phone:     recipient.contact.phone     || '',
    };
    const voiceInstructions = campaign.tenant?.metadata?.voiceInstructions
      || campaign.metadata?.voiceInstructions
      || undefined;
    try {
      await generateAudioForRecipient(recipientId, campaign.flow.steps, vars, voiceInstructions);
    } catch (audioErr) {
      // Non-fatal: fall back to <Say> in TwiML if audio generation fails
      logger.warn('Audio pre-generation failed — will use Say fallback', {
        recipientId,
        error: audioErr.message,
      });
    }
  }

  try {
    const callResult = await provider.initiateCall({
      toNumber: recipient.contact.phone,
      fromNumber: providerConfig.fromNumber,
      contact: recipient.contact,
      flow: campaign.flow,
      webhookUrl,
      tenantMetadata: campaign.tenant?.metadata || {},
      recipientId,
    });

    await prisma.$transaction([
      prisma.call.create({
        data: {
          campaignId,
          recipientId,
          providerCallId: callResult.providerCallId,
          status: callResult.status || 'initiated',
          metadata: { provider: providerConfig.provider },
        },
      }),
      prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: { status: 'called' },
      }),
    ]);

    logger.info('Call initiated', { recipientId, providerCallId: callResult.providerCallId });
  } catch (err) {
    logger.error('Call initiation failed', { recipientId, error: err.message });

    await prisma.$transaction([
      prisma.call.create({
        data: {
          campaignId,
          recipientId,
          providerCallId: null,
          status: 'failed',
          metadata: { error: err.message },
        },
      }),
      prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: { status: 'failed' },
      }),
    ]);

    throw err; // let BullMQ handle retry
  }

  // After each job, check if the campaign is done
  const pendingCount = await prisma.campaignRecipient.count({
    where: { campaignId, status: 'pending' },
  });

  if (pendingCount === 0) {
    const hasRunning = await prisma.campaign.findFirst({
      where: { id: campaignId, status: 'running' },
    });
    if (hasRunning) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date() },
      });
      logger.info('Campaign marked completed', { campaignId });
    }
  }
}

function createWorker() {
  const worker = new Worker('calls', processCallJob, {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  });

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}

module.exports = { createWorker };
