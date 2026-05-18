/**
 * Application configuration loaded from environment variables.
 * All env vars are validated at startup to fail fast on misconfiguration.
 */

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    url: process.env.DATABASE_URL,
  },

  webhook: {
    baseUrl: process.env.WEBHOOK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
  },

  nodeEnv: process.env.NODE_ENV || 'development',
};

/**
 * Validates required environment variables.
 * Throws if any required variable is missing.
 */
function validateConfig() {
  const required = ['DATABASE_URL'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values.'
    );
  }
}

module.exports = { config, validateConfig };
