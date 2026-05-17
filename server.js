/**
 * @fileoverview Application entry point.
 *
 * Validates environment variables, then starts the HTTP server.
 * Import/require order matters: config validation runs before anything
 * that might use env vars.
 */

const { validateConfig, config } = require('./src/config/env');

// Fail fast if required environment variables are missing
validateConfig();

const app = require('./src/app');
const { createLogger } = require('./src/middleware/logger');

const logger = createLogger('Server');

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info(`orkestai-voice started`, {
    port: PORT,
    env: config.nodeEnv,
    webhookBase: config.webhook.baseUrl,
  });
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

/**
 * Gracefully shuts down the HTTP server, allowing in-flight requests to complete.
 * @param {string} signal - OS signal that triggered the shutdown (e.g. "SIGTERM")
 */
function gracefulShutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);

  server.close((err) => {
    if (err) {
      logger.error('Error during server close', { error: err.message });
      process.exit(1);
    }
    logger.info('Server closed. Goodbye.');
    process.exit(0);
  });

  // Force-exit after 10 seconds if server hasn't closed
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Log unhandled promise rejections instead of crashing silently
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception — exiting', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = server; // exported for testing
