const IORedis = require('ioredis');

let connection;

function getRedisConnection() {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
    connection.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
  }
  return connection;
}

module.exports = { getRedisConnection };
