const { Queue } = require('bullmq');
const { getRedisConnection } = require('./redis');

const callQueue = new Queue('calls', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

module.exports = { callQueue };
