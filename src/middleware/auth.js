const { createClerkClient } = require('@clerk/backend');
const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('./logger');

const prisma = new PrismaClient();
const logger = createLogger('Auth');

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Routes that skip auth entirely
const PUBLIC_PREFIXES = [
  '/api/webhooks/',
  '/api/twiml/',
  '/health',
];
// Routes that verify the JWT but don't require a linked User record in DB
const TOKEN_ONLY_PATHS = [
  '/api/users/link',
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
  const payload = await clerk.verifyToken(token);
  return payload; // { sub: clerkUserId, ... }
}

// Full auth: verifies JWT and looks up User in DB
async function requireAuth(req, res, next) {
  if (isPublic(req.path)) return next();

  const token = await extractToken(req);
  if (!token) {
    return res.status(401).json({ error: { message: 'Missing authorization header' } });
  }

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
    logger.warn('Auth failed', { error: err.message });
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

module.exports = { requireAuth };
