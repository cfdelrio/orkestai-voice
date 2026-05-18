const { Router } = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const { getTenantById } = require('../services/tenantService');

const prisma = new PrismaClient();
const router = Router();

/**
 * POST /api/users/link
 * Links the authenticated Clerk user to a tenant.
 * Requires a valid Clerk JWT (Bearer token) but NOT an existing User record.
 *
 * Body: { tenantId, role? }
 */
router.post('/link', asyncHandler(async (req, res) => {
  const { clerkUserId } = req;
  const { tenantId, role } = req.body;

  if (!tenantId) throw badRequest('"tenantId" is required');

  await getTenantById(tenantId);

  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    return res.json({ user: existing, linked: false });
  }

  const VALID_ROLES = ['owner', 'admin', 'operator', 'viewer'];
  const assignedRole = VALID_ROLES.includes(role) ? role : 'operator';

  const user = await prisma.user.create({
    data: { clerkUserId, tenantId, role: assignedRole },
  });

  res.status(201).json({ user, linked: true });
}));

/**
 * GET /api/users/me
 * Returns the current authenticated user with tenant info.
 */
router.get('/me', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { tenant: true },
  });
  res.json({ user });
}));

module.exports = router;
