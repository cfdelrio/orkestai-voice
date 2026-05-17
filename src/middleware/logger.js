/**
 * @fileoverview Simple structured logger utility.
 *
 * Creates module-scoped loggers that prefix every message with
 * an ISO timestamp and the module name. Uses console under the hood
 * so no external dependencies are required.
 *
 * Usage:
 *   const logger = require('./middleware/logger').createLogger('MyModule');
 *   logger.info('Server started', { port: 3000 });
 *   // → [2025-05-10T12:00:00.000Z] [MyModule] [INFO] Server started {"port":3000}
 */

/**
 * Creates a logger instance scoped to a specific module name.
 *
 * @param {string} moduleName - Label printed with every log line
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function }}
 */
function createLogger(moduleName) {
  /**
   * Formats and emits a log line.
   *
   * @param {string} level   - Log level label (INFO, WARN, ERROR, DEBUG)
   * @param {string} message - Human-readable message
   * @param {Object} [context] - Optional structured data to append as JSON
   * @param {boolean} [isError] - When true, writes to stderr via console.error
   */
  function log(level, message, context, isError = false) {
    const timestamp = new Date().toISOString();
    const contextStr = context && Object.keys(context).length > 0
      ? ' ' + JSON.stringify(context)
      : '';
    const line = `[${timestamp}] [${moduleName}] [${level}] ${message}${contextStr}`;

    if (isError) {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    /**
     * Logs an informational message.
     * @param {string} message
     * @param {Object} [context]
     */
    info(message, context) {
      log('INFO', message, context, false);
    },

    /**
     * Logs a warning message.
     * @param {string} message
     * @param {Object} [context]
     */
    warn(message, context) {
      log('WARN', message, context, false);
    },

    /**
     * Logs an error message (writes to stderr).
     * @param {string} message
     * @param {Object} [context]
     */
    error(message, context) {
      log('ERROR', message, context, true);
    },

    /**
     * Logs a debug message (only in non-production environments).
     * @param {string} message
     * @param {Object} [context]
     */
    debug(message, context) {
      if (process.env.NODE_ENV !== 'production') {
        log('DEBUG', message, context, false);
      }
    },
  };
}

module.exports = { createLogger };
