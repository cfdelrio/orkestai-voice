/**
 * @fileoverview Webhook receiver routes.
 *
 * POST /api/webhooks/infobip/voice
 *   Receives call status updates and DTMF responses from Infobip.
 *   Parses the payload through InfobipWebhookAdapter (which is the ONLY
 *   component that understands Infobip field names), then delegates to
 *   callService.handleWebhookEvent() with a normalized event.
 *
 * Note: Webhook endpoints always respond with 200 OK to prevent the
 * provider from retrying delivery. If processing fails, the error is logged
 * but the HTTP response is still 200.
 */

const { Router } = require('express');
const { parseWebhookEvent } = require('../providers/infobip/InfobipWebhookAdapter');
const callService = require('../services/callService');
const { createLogger } = require('../middleware/logger');

const router = Router();
const logger = createLogger('WebhooksRoute');

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

module.exports = router;
