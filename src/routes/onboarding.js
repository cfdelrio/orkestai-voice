const { Router } = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const { createTenant } = require('../services/tenantService');

const prisma = new PrismaClient();
const router = Router();

/**
 * POST /api/onboarding
 * Creates a new tenant and links the authenticated Clerk user as owner.
 * TOKEN_ONLY path: requires JWT but not an existing User record.
 *
 * Body: { name, slug }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { clerkUserId } = req;
  const { name, slug } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) throw badRequest('"name" is required');
  if (!slug || typeof slug !== 'string' || !slug.trim()) throw badRequest('"slug" is required');

  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    const tenant = await prisma.tenant.findUnique({ where: { id: existing.tenantId } });
    return res.json({ tenant, user: existing, created: false });
  }

  const tenant = await createTenant({ name: name.trim(), slug: slug.trim().toLowerCase() });
  const user = await prisma.user.create({
    data: { clerkUserId, tenantId: tenant.id, role: 'owner' },
  });

  res.status(201).json({ tenant, user, created: true });
}));

module.exports = router;
