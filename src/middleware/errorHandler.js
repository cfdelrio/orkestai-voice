/**
 * @fileoverview Centralized Express error-handling middleware.
 *
 * Must be registered AFTER all routes (app.use(errorHandler) at the end).
 * Catches errors thrown or passed via next(err) from route handlers and
 * services, normalizes them into a consistent JSON response shape.
 *
 * Response shape on error:
 * {
 *   "error": {
 *     "message": "Human-readable description",
 *     "code":    "OPTIONAL_ERROR_CODE"   // omitted if not present
 *   }
 * }
 */

const { createLogger } = require('./logger');

const logger = createLogger('ErrorHandler');

/**
 * Standard error codes that route handlers can attach to errors
 * to control the HTTP status code without needing to import http-errors.
 *
 * Usage in a service:
 *   const err = new Error('Campaign not found');
 *   err.statusCode = 404;
 *   throw err;
 */

/**
 * Express 4 error-handling middleware (4 params required by Express).
 *
 * @param {Error} err   - The thrown or forwarded error
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next - Must be declared even if unused
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Determine HTTP status code
  const statusCode = err.statusCode || err.status || 500;

  // Log with context for observability
  const logContext = {
    method: req.method,
    path: req.path,
    statusCode,
    errorName: err.name,
  };

  if (statusCode >= 500) {
    // Server-side errors: log full stack trace
    logger.error(err.message, { ...logContext, stack: err.stack });
  } else {
    // Client-side errors (4xx): log without stack trace (expected behavior)
    logger.warn(err.message, logContext);
  }

  // Build response body
  const body = {
    error: {
      message: err.message || 'An unexpected error occurred',
    },
  };

  // Attach optional error code (useful for client-side handling)
  if (err.code) {
    body.error.code = err.code;
  }

  // In development, include the stack trace in the response for easier debugging
  if (process.env.NODE_ENV === 'development' && statusCode >= 500) {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

/**
 * Catches async route handler rejections and passes them to errorHandler.
 * Wrap async route handlers with this to avoid unhandled promise rejections.
 *
 * Usage:
 *   router.post('/path', asyncHandler(async (req, res) => { ... }));
 *
 * @param {Function} fn - Async Express route handler
 * @returns {Function} Wrapped handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Creates a 400 Bad Request error with a descriptive message.
 * @param {string} message
 * @returns {Error}
 */
function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Creates a 404 Not Found error.
 * @param {string} resource - Resource name (e.g. "Campaign", "Tenant")
 * @param {string} id       - Identifier that was not found
 * @returns {Error}
 */
function notFound(resource, id) {
  const err = new Error(`${resource} not found: ${id}`);
  err.statusCode = 404;
  return err;
}

module.exports = { errorHandler, asyncHandler, badRequest, notFound };
