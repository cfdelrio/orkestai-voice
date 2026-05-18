require('dotenv').config();
const { validateConfig } = require('../config/env');
const { createWorker } = require('./callWorker');
const { createLogger } = require('../middleware/logger');

validateConfig();

const logger = createLogger('WorkerProcess');

const worker = createWorker();

logger.info('Call worker started', {
  concurrency: process.env.CALL_CONCURRENCY ?? '3',
  redisUrl: process.env.REDIS_URL ? '[set]' : '[not set]',
});

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down worker gracefully`);
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
