const { verifyToken } = require('@clerk/backend');
const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('./logger');
const { findTenantByRawKey } = require('../services/apiKeyService');

const prisma = new PrismaClient();
const logger = createLogger('Auth');

// Routes that skip auth entirely (relative to /api mount point)
const PUBLIC_PREFIXES = [
  '/webhooks/',
  '/twiml/',
  '/tenants/slug/',
  '/audio/',
  '/public/',
];
// Routes that verify the JWT but don't require a linked User record in DB
const TOKEN_ONLY_PATHS = [
  '/users/link',
  '/onboarding',
];

function isPublic(path) {
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

function isTokenOnly(path) {
  return TOKEN_ONLY_PATHS.some((p) => path === p || path.startsWith(p));
}

async function extractToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

async function verifyClerkToken(token) {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY no está configurada en el servidor');
  }
  const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  return payload; // { sub: clerkUserId, ... }
}

// Full auth: supports both Clerk JWT and API key (ok_ prefix)
async function requireAuth(req, res, next) {
  if (isPublic(req.path)) return next();

  const token = await extractToken(req);
  if (!token) {
    return res.status(401).json({ error: { message: 'Missing authorization header' } });
  }

  // API key path: tokens starting with "ok_" are machine-to-machine keys
  if (token.startsWith('ok_')) {
    try {
      const record = await findTenantByRawKey(token);
      if (!record) {
        return res.status(401).json({ error: { message: 'Invalid API key' } });
      }
      req.tenantId = record.tenantId;
      req.apiKeyAuth = true;
      return next();
    } catch (err) {
      logger.warn('API key auth failed', { error: err.message });
      return res.status(401).json({ error: { message: 'Invalid API key' } });
    }
  }

  // Clerk JWT path
  try {
    const payload = await verifyClerkToken(token);
    req.clerkUserId = payload.sub;

    if (isTokenOnly(req.path)) return next();

    const user = await prisma.user.findUnique({ where: { clerkUserId: payload.sub } });
    if (!user) {
      return res.status(401).json({ error: { message: 'User not linked to a tenant. Call POST /api/users/link first.' } });
    }

    req.user = user;
    req.tenantId = user.tenantId;
    next();
  } catch (err) {
    logger.warn('Auth failed', { error: err.message, code: err.code, status: err.status, stack: err.stack?.split('\n')[0] });
    return res.status(401).json({ error: { message: 'Invalid or expired token', detail: err.message } });
  }
}

module.exports = { requireAuth };
