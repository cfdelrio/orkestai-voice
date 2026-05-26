/**
 * @fileoverview Webhook receiver routes.
 *
 * POST /api/webhooks/infobip/voice
 *   Receives call status updates and DTMF responses from Infobip.
 *   Parses the payload through InfobipWebhookAdapter (which is the ONLY
 *   component that understands Infobip field names), then delegates to
 *   callService.handleWebhookEvent() with a normalized event.
 *
 * POST /api/webhooks/twilio/voice
 *   Receives StatusCallback events from Twilio. Validates the
 *   X-Twilio-Signature header before processing to prevent spoofed events.
 *   Validation is fail-closed: if TWILIO_AUTH_TOKEN is unset the request is
 *   rejected regardless of NODE_ENV.
 *
 * Note: Webhook endpoints always respond with 200 OK to prevent the
 * provider from retrying delivery. If processing fails, the error is logged
 * but the HTTP response is still 200.
 *
 * Note on raw body for Twilio signature validation:
 *   Twilio sends form-urlencoded bodies (application/x-www-form-urlencoded).
 *   Express's express.urlencoded() middleware already parses these into req.body
 *   before reaching this route. twilio.validateRequest() accepts the parsed
 *   params object (not the raw body string), so no raw body capture is needed.
 *   If the content-type were application/json, params would be {} and the
 *   signature would be computed over the URL alone.
 */

const { Router } = require('express');
const twilio = require('twilio');
const { parseWebhookEvent } = require('../providers/infobip/InfobipWebhookAdapter');
const { parseWebhookEvent: parseTwilioEvent } = require('../providers/twilio/TwilioWebhookAdapter');
const callService = require('../services/callService');
const { createLogger } = require('../middleware/logger');

const router = Router();
const logger = createLogger('WebhooksRoute');

// ─── Twilio signature validation middleware ────────────────────────────────────
/**
 * Express middleware that validates the X-Twilio-Signature header on incoming
 * requests. Must run AFTER express.urlencoded() so req.body is already parsed.
 *
 * Twilio signs requests by computing HMAC-SHA1 over:
 *   URL + sorted key=value pairs (for form-urlencoded bodies)
 * using the account's Auth Token as the key.
 *
 * @see https://www.twilio.com/docs/usage/security#validating-signatures-from-twilio
 */
function validateTwilioWebhook(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Fail closed: if the auth token is missing in any environment, reject the request.
  // Accepting unverified webhooks is a P0 security issue — never skip validation.
  if (!authToken) {
    logger.error('[twilio-webhook] TWILIO_AUTH_TOKEN not configured — rejecting request');
    return res.status(500).json({ error: 'Webhook validation not configured' });
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    logger.warn('[twilio-webhook] Missing X-Twilio-Signature header', { path: req.path });
    return res.status(403).json({ error: 'Missing X-Twilio-Signature header' });
  }

  // Reconstruct the full URL that Twilio signed (must match exactly).
  // X-Forwarded-Proto and X-Forwarded-Host are set by the load balancer / reverse proxy.
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const url = `${protocol}://${host}${req.originalUrl}`;

  // For form-urlencoded bodies (Twilio's default) req.body is the parsed params object.
  // For JSON bodies params should be {} — Twilio doesn't send JSON StatusCallbacks.
  const params =
    req.is('application/x-www-form-urlencoded') && req.body && typeof req.body === 'object'
      ? req.body
      : {};

  const isValid = twilio.validateRequest(authToken, signature, url, params);

  if (!isValid) {
    logger.error('[twilio-webhook] Invalid Twilio signature', {
      url,
      signaturePrefix: signature.substring(0, 20) + '...',
    });
    return res.status(403).json({ error: 'Invalid Twilio signature' });
  }

  return next();
}

/**
 * POST /api/webhooks/infobip/voice
 *
 * Infobip posts call lifecycle events here:
 *  - Call state changes (INITIATED → RINGING → ESTABLISHED → FINISHED)
 *  - DTMF input collection results
 *
 * TODO: Add signature verification once Infobip shared-secret support is confirmed.
 *       Infobip may include an HMAC signature header for webhook authenticity.
 */
router.post('/infobip/voice', async (req, res) => {
  // Always ack immediately — provider must not retry
  res.status(200).json({ received: true });

  const rawPayload = req.body;

  logger.debug('Received Infobip voice webhook', {
    contentType: req.headers['content-type'],
    bodyKeys: rawPayload && typeof rawPayload === 'object' ? Object.keys(rawPayload) : [],
  });

  // Parse using the adapter — this is the ONLY place InfobipWebhookAdapter is used
  const event = parseWebhookEvent(rawPayload);

  // Delegate handling to callService (provider-agnostic from here on)
  try {
    await callService.handleWebhookEvent(event);
  } catch (error) {
    logger.error('Error processing webhook event', {
      error: error.message,
      providerCallId: event.providerCallId,
      eventType: event.eventType,
    });
    // Do NOT throw — we already sent 200 OK
  }
});

/**
 * POST /api/webhooks/twilio/voice
 *
 * Twilio posts call lifecycle StatusCallback events here.
 * Twilio expects a 200 response immediately; processing happens asynchronously.
 *
 * Note: DTMF responses from <Gather> are handled separately by the TwiML routes
 *       (POST /api/twiml/recipients/:recipientId/gather/:stepId) which both save
 *       the response AND serve the next TwiML. This endpoint handles status events only.
 *
 * Security: validateTwilioWebhook middleware verifies X-Twilio-Signature before
 *   any processing occurs.
 */
router.post('/twilio/voice', validateTwilioWebhook, async (req, res) => {
  // Always ack immediately — Twilio must not retry
  res.status(200).send('');

  const rawPayload = req.body;

  logger.debug('Received Twilio voice webhook', {
    contentType: req.headers['content-type'],
    bodyKeys: rawPayload && typeof rawPayload === 'object' ? Object.keys(rawPayload) : [],
  });

  // Parse using the Twilio adapter
  const event = parseTwilioEvent(rawPayload);

  // Delegate handling to callService (provider-agnostic from here on)
  try {
    await callService.handleWebhookEvent(event);
  } catch (error) {
    logger.error('Error processing Twilio webhook event', {
      error: error.message,
      providerCallId: event.providerCallId,
      eventType: event.eventType,
    });
    // Do NOT throw — we already sent 200 OK
  }
});

module.exports = router;
