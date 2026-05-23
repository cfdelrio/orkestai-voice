/**
 * @fileoverview Public feed aggregation service.
 * Builds the anonymized, public-safe feed response for a campaign slug.
 * No private data (phone, email, id, lastName) is ever returned.
 */

const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');

const prisma = new PrismaClient();
const logger = createLogger('PublicFeedService');

class NotFoundError extends Error {
  constructor(msg) { super(msg); this.status = 404; }
}

/**
 * Returns the public feed data for a given slug.
 * Throws 404 if slug not found or feed is disabled.
 */
async function getFeedBySlug(slug) {
  const config = await prisma.publicFeedConfig.findUnique({
    where: { slug },
    include: {
      campaign: {
        include: {
          flow: true,
          recipients: {
            include: {
              calls: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                include: { responses: true },
              },
            },
          },
        },
      },
    },
  });

  if (!config) throw new NotFoundError(`Feed "${slug}" not found`);
  if (!config.enabled) throw new NotFoundError(`Feed "${slug}" is disabled`);

  const { campaign } = config;
  const publicQuestions = Array.isArray(config.publicQuestions) ? config.publicQuestions : [];

  // ─── Stats ────────────────────────────────────────────────────────────────────
  const totalRecipients = campaign.recipients.length;
  let totalCalls = 0;
  let answeredCalls = 0;
  const responsesByStep = {};

  for (const recipient of campaign.recipients) {
    const lastCall = recipient.calls[0];
    if (!lastCall) continue;
    totalCalls++;
    if (lastCall.status === 'answered' || lastCall.status === 'completed') answeredCalls++;
    for (const resp of lastCall.responses) {
      if (!responsesByStep[resp.stepId]) responsesByStep[resp.stepId] = {};
      const val = resp.value || resp.input;
      responsesByStep[resp.stepId][val] = (responsesByStep[resp.stepId][val] || 0) + 1;
    }
  }

  const responseRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

  // ─── Questions ────────────────────────────────────────────────────────────────
  const questions = publicQuestions.map((q) => {
    const stepCounts = responsesByStep[q.stepId] ?? {};
    const totalVotes = Object.values(stepCounts).reduce((a, b) => a + b, 0);
    const optionLabels = q.optionLabels ?? {};

    const results = Object.entries(stepCounts)
      .map(([value, votes]) => ({
        value,
        label: optionLabels[value] ?? value,
        votes,
        percentage: totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0,
      }))
      .sort((a, b) => b.votes - a.votes);

    return { id: q.stepId, title: q.title ?? q.stepId, results };
  });

  // ─── Recent activity (anonymized) ─────────────────────────────────────────────
  let recentActivity = [];
  if (config.showRecentActivity && publicQuestions.length > 0) {
    const publicStepIds = publicQuestions.map((q) => q.stepId);
    const labelMap = {};
    for (const q of publicQuestions) {
      for (const [val, label] of Object.entries(q.optionLabels ?? {})) {
        labelMap[val] = label;
      }
    }

    const recentResponses = await prisma.response.findMany({
      where: {
        stepId: { in: publicStepIds },
        value: { not: null },
        call: { campaignId: campaign.id },
      },
      include: {
        call: {
          include: {
            recipient: {
              include: {
                contact: { select: { firstName: true, metadata: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    recentActivity = recentResponses.map((r) => {
      const contact = r.call?.recipient?.contact;
      const meta = contact?.metadata ?? {};
      return {
        firstName: contact?.firstName ?? 'Anónimo',
        city: typeof meta === 'object' && meta !== null ? (meta.city ?? null) : null,
        response: labelMap[r.value] ?? r.value,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  return {
    config: {
      refreshIntervalSeconds: config.refreshIntervalSeconds,
      showTotalCalls: config.showTotalCalls,
      showResponseRate: config.showResponseRate,
      showRecentActivity: config.showRecentActivity,
      showPercentages: config.showPercentages,
    },
    campaign: {
      name: config.title,
      description: config.description ?? null,
      status: campaign.status,
      updatedAt: campaign.updatedAt.toISOString(),
    },
    stats: config.showTotalCalls || config.showResponseRate ? {
      totalCalls,
      answered: answeredCalls,
      responseRate: config.showResponseRate ? responseRate : undefined,
    } : undefined,
    questions,
    recentActivity: config.showRecentActivity ? recentActivity : [],
  };
}

/**
 * Upsert a PublicFeedConfig for a campaign.
 */
async function upsertFeedConfig(campaignId, data) {
  const existing = await prisma.publicFeedConfig.findUnique({ where: { campaignId } });

  if (existing) {
    return prisma.publicFeedConfig.update({
      where: { campaignId },
      data: {
        enabled: data.enabled ?? existing.enabled,
        slug: data.slug ?? existing.slug,
        title: data.title ?? existing.title,
        description: data.description !== undefined ? data.description : existing.description,
        showTotalCalls: data.showTotalCalls ?? existing.showTotalCalls,
        showResponseRate: data.showResponseRate ?? existing.showResponseRate,
        showRecentActivity: data.showRecentActivity ?? existing.showRecentActivity,
        showPercentages: data.showPercentages ?? existing.showPercentages,
        refreshIntervalSeconds: data.refreshIntervalSeconds ?? existing.refreshIntervalSeconds,
        publicQuestions: data.publicQuestions ?? existing.publicQuestions,
      },
    });
  }

  return prisma.publicFeedConfig.create({
    data: {
      campaignId,
      enabled: data.enabled ?? true,
      slug: data.slug,
      title: data.title,
      description: data.description ?? null,
      showTotalCalls: data.showTotalCalls ?? true,
      showResponseRate: data.showResponseRate ?? true,
      showRecentActivity: data.showRecentActivity ?? true,
      showPercentages: data.showPercentages ?? true,
      refreshIntervalSeconds: data.refreshIntervalSeconds ?? 10,
      publicQuestions: data.publicQuestions ?? [],
    },
  });
}

async function getFeedConfig(campaignId) {
  return prisma.publicFeedConfig.findUnique({ where: { campaignId } });
}

async function deleteFeedConfig(campaignId) {
  const existing = await prisma.publicFeedConfig.findUnique({ where: { campaignId } });
  if (!existing) return null;
  await prisma.publicFeedConfig.delete({ where: { campaignId } });
  return { deleted: true };
}

module.exports = { getFeedBySlug, upsertFeedConfig, getFeedConfig, deleteFeedConfig };
