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
 *
 * Security: POST endpoints validate X-Twilio-Signature to prevent spoofed
 *   gather/recording callbacks. GET requests (initial TwiML fetch) are not
 *   signed by Twilio in the same way, so only POST routes require validation.
 */

const { Router } = require('express');
const twilio = require('twilio');
const { config } = require('../config/env');
const { getTwimlForRecipient, getTwimlAfterGather, getTwimlAfterRecording, hangupTwiml } = require('../services/twimlService');
const { createLogger } = require('../middleware/logger');

const router = Router();
const logger = createLogger('TwimlRoute');

// ─── Twilio signature validation middleware ────────────────────────────────────
/**
 * Validates X-Twilio-Signature on POST requests from Twilio.
 * Identical logic to webhooks.js — both sets of endpoints are called by Twilio.
 */
function validateTwilioWebhook(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[twilio-twiml] TWILIO_AUTH_TOKEN not configured in production');
      // TwiML endpoints must return valid XML even on error so Twilio doesn't retry
      res.set('Content-Type', 'text/xml');
      return res.status(200).send(hangupTwiml());
    }
    logger.warn('[twilio-twiml] TWILIO_AUTH_TOKEN not set — skipping signature validation');
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    logger.warn('[twilio-twiml] Missing X-Twilio-Signature header', { path: req.path });
    res.set('Content-Type', 'text/xml');
    return res.status(200).send(hangupTwiml());
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const url = `${protocol}://${host}${req.originalUrl}`;

  const params =
    req.is('application/x-www-form-urlencoded') && req.body && typeof req.body === 'object'
      ? req.body
      : {};

  const isValid = twilio.validateRequest(authToken, signature, url, params);

  if (!isValid) {
    logger.error('[twilio-twiml] Invalid Twilio signature', {
      url,
      signaturePrefix: signature.substring(0, 20) + '...',
    });
    // Return hangup TwiML — do not serve call instructions to unauthorized callers
    res.set('Content-Type', 'text/xml');
    return res.status(200).send(hangupTwiml());
  }

  return next();
}

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
router.post('/recipients/:recipientId/gather/:stepId', validateTwilioWebhook, async (req, res) => {
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

/**
 * POST /api/twiml/recipients/:recipientId/recording/:stepId
 *
 * Twilio POSTs here after a <Record> verb completes (caller stopped speaking
 * or maxLength was reached). The body contains RecordingUrl, RecordingSid,
 * and RecordingDuration. We save the recording URL, kick off Whisper
 * transcription asynchronously, and return TwiML for the remaining steps.
 */
router.post('/recipients/:recipientId/recording/:stepId', validateTwilioWebhook, async (req, res) => {
  const { recipientId, stepId } = req.params;
  const recordingUrl      = req.body?.RecordingUrl      || '';
  const recordingSid      = req.body?.RecordingSid      || '';
  const recordingDuration = parseInt(req.body?.RecordingDuration || '0', 10);

  logger.info('TwiML recording callback', { recipientId, stepId, recordingSid, duration: recordingDuration });

  res.set('Content-Type', 'text/xml');

  try {
    const webhookBase = getWebhookBase();
    const twiml = await getTwimlAfterRecording(
      recipientId, stepId, recordingUrl, recordingSid, recordingDuration, webhookBase,
    );
    res.status(200).send(twiml);
  } catch (error) {
    logger.error('Error generating post-recording TwiML', {
      recipientId, stepId, error: error.message,
    });
    res.status(200).send(hangupTwiml());
  }
});

module.exports = router;
