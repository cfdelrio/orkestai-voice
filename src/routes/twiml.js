/**
 * @fileoverview TwiML serving routes for Twilio voice calls.
 *
 * Twilio GETs these endpoints to fetch TwiML (XML) instructions during
 * a call. They must always respond with 200 OK and valid TwiML — even
 * on error — so Twilio does not retry indefinitely.
 *
 * Routes:
 *   GET  /api/twiml/recipients/:recipientId
 *     → Serves initial TwiML when the call connects
 *
 *   POST /api/twiml/recipients/:recipientId/gather/:stepId
 *     → Saves DTMF response, serves TwiML for remaining steps
 */

const { Router } = require('express');
const { config } = require('../config/env');
const { getTwimlForRecipient, getTwimlAfterGather, hangupTwiml } = require('../services/twimlService');
const { createLogger } = require('../middleware/logger');

const router = Router();
const logger = createLogger('TwimlRoute');

/**
 * Derives the webhook base URL (scheme + host) from config.
 * This is used as the action base for Gather verbs.
 */
function getWebhookBase() {
  return config.webhook.baseUrl.replace(/\/$/, '');
}

/**
 * GET /api/twiml/recipients/:recipientId
 *
 * Twilio fetches this when the outbound call is answered.
 * Returns the initial TwiML for the recipient's campaign flow.
 */
router.all('/recipients/:recipientId', async (req, res) => {
  const { recipientId } = req.params;

  logger.info('TwiML initial fetch', { recipientId, method: 'GET' });

  res.set('Content-Type', 'text/xml');

  try {
    const webhookBase = getWebhookBase();
    const twiml = await getTwimlForRecipient(recipientId, webhookBase);
    res.status(200).send(twiml);
  } catch (error) {
    logger.error('Error generating initial TwiML', {
      recipientId,
      error: error.message,
    });
    // Always return valid TwiML so Twilio doesn't retry
    res.status(200).send(hangupTwiml());
  }
});

/**
 * POST /api/twiml/recipients/:recipientId/gather/:stepId
 *
 * Twilio POSTs here after a <Gather> verb completes (caller pressed a digit
 * or the gather timed out). The `Digits` field in req.body contains the input.
 *
 * Saves the DTMF response and returns TwiML for the remaining flow steps.
 */
router.post('/recipients/:recipientId/gather/:stepId', async (req, res) => {
  const { recipientId, stepId } = req.params;
  const digit = req.body?.Digits || '';

  logger.info('TwiML gather action', { recipientId, stepId, digit });

  res.set('Content-Type', 'text/xml');

  try {
    const webhookBase = getWebhookBase();
    const twiml = await getTwimlAfterGather(recipientId, stepId, digit, webhookBase);
    res.status(200).send(twiml);
  } catch (error) {
    logger.error('Error generating post-gather TwiML', {
      recipientId,
      stepId,
      digit,
      error: error.message,
    });
    // Always return valid TwiML so Twilio doesn't retry
    res.status(200).send(hangupTwiml());
  }
});

module.exports = router;
