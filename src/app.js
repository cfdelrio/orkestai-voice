/**
 * @fileoverview Express application factory.
 *
 * Configures and wires up:
 *  - JSON body parsing
 *  - Request logging middleware
 *  - API routes
 *  - 404 handler
 *  - Centralized error handler
 *
 * The app is exported (not started) so server.js can bind it to a port.
 * This separation makes the app importable in tests without starting a server.
 */

const express = require('express');
const { createLogger } = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');
const tenantsRouter = require('./routes/tenants');
const contactsRouter = require('./routes/contacts');
const { tenantRouter: campaignTenantRouter, campaignRouter } = require('./routes/campaigns');
const webhooksRouter = require('./routes/webhooks');
const twimlRouter = require('./routes/twiml');

const app = express();
const logger = createLogger('App');

// ─── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request logging middleware ────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip,
  });
  next();
});

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'orkestai-voice',
    timestamp: new Date().toISOString(),
  });
});

// ─── API routes ────────────────────────────────────────────────────────────────

// Tenant management
app.use('/api/tenants', tenantsRouter);

// Contacts (nested under tenants)
app.use('/api/tenants/:tenantId/contacts', contactsRouter);

// Campaigns (nested under tenants for creation/listing)
app.use('/api/tenants/:tenantId/campaigns', campaignTenantRouter);

// Campaign actions (by campaignId directly)
app.use('/api/campaigns', campaignRouter);

// Webhook receivers
app.use('/api/webhooks', webhooksRouter);

// TwiML endpoints (Twilio fetches these during calls)
app.use('/api/twiml', twimlRouter);

// ─── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
});

// ─── Centralized error handler (must be last) ──────────────────────────────────
app.use(errorHandler);

module.exports = app;
