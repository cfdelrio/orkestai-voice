/**
 * @fileoverview Twilio Voice webhook adapter.
 *
 * Parses the form-encoded POST body that Twilio sends to our StatusCallback
 * endpoint and normalizes it into the provider-agnostic structure that
 * callService.handleWebhookEvent() expects.
 *
 * Only this file and TwilioVoiceProvider are allowed to reference
 * Twilio-specific field names.
 *
 * Twilio StatusCallback docs:
 *   https://www.twilio.com/docs/voice/api/call-resource#statuscallback-parameters
 *
 * Note: Twilio sends form-encoded bodies (application/x-www-form-urlencoded).
 *       Express's express.urlencoded() middleware parses these into req.body
 *       before this adapter sees them.
 */

const { createLogger } = require('../../middleware/logger');

const logger = createLogger('TwilioWebhookAdapter');

/**
 * Maps Twilio call status strings to our normalized status values.
 *
 * Twilio status values: queued, ringing, in-progress, completed, busy,
 *                       failed, no-answer, canceled
 */
const TWILIO_STATUS_MAP = {
  queued:        'initiated',
  ringing:       'ringing',
  'in-progress': 'answered',
  completed:     'completed',
  busy:          'failed',
  failed:        'failed',
  'no-answer':   'failed',
  canceled:      'failed',
};

/**
 * @typedef {Object} ParsedWebhookEvent
 * @property {string|null}  providerCallId - Twilio Call SID
 * @property {string}       status         - Normalized call status
 * @property {string|null}  dtmfDigit      - DTMF digit(s) from Gather, or null
 * @property {string|null}  stepId         - VoiceFlow step ID (from gather URL path), or null
 * @property {string}       eventType      - "dtmf" | "call_status"
 * @property {Object}       raw            - Original raw payload for debugging / auditing
 */

/**
 * Parses a Twilio Voice StatusCallback POST body into a normalized event object.
 *
 * Twilio sends all call lifecycle events to the same StatusCallback URL.
 * DTMF digits are delivered as a separate POST to the gather action URL
 * (handled by twimlService / twiml routes), which may also set a `stepId`
 * field in the payload if Twilio forwards it.
 *
 * @param {Object} rawPayload - Parsed form body from req.body
 * @returns {ParsedWebhookEvent}
 */
function parseWebhookEvent(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    logger.warn('Received empty or non-object Twilio webhook payload');
    return {
      providerCallId: null,
      status: 'unknown',
      dtmfDigit: null,
      stepId: null,
      eventType: 'unknown',
      raw: rawPayload,
    };
  }

  logger.debug('Parsing Twilio webhook payload', { keys: Object.keys(rawPayload) });

  // ─── Extract provider call ID ─────────────────────────────────────────────
  const providerCallId = rawPayload.CallSid || null;

  // ─── Normalize call status ────────────────────────────────────────────────
  const rawStatus = rawPayload.CallStatus || null;
  const normalizedStatus = rawStatus
    ? (TWILIO_STATUS_MAP[rawStatus] || 'unknown')
    : 'unknown';

  // ─── Extract DTMF digit ───────────────────────────────────────────────────
  // Twilio sends "Digits" in Gather action callbacks.
  // StatusCallback events do not carry Digits.
  const dtmfDigit = rawPayload.Digits != null && rawPayload.Digits !== ''
    ? String(rawPayload.Digits)
    : null;

  // ─── Extract step ID ──────────────────────────────────────────────────────
  // stepId is a custom field that may be forwarded by Twilio if we embedded it
  // as a query param on the gather action URL, or in a custom param.
  const stepId = rawPayload.stepId || null;

  // ─── Determine event type ─────────────────────────────────────────────────
  const eventType = dtmfDigit !== null ? 'dtmf' : 'call_status';

  const parsed = {
    providerCallId: providerCallId ? String(providerCallId) : null,
    status: normalizedStatus,
    dtmfDigit,
    stepId,
    eventType,
    raw: rawPayload,
  };

  logger.debug('Twilio webhook event parsed', {
    providerCallId: parsed.providerCallId,
    eventType:      parsed.eventType,
    status:         parsed.status,
    hasDtmf:        parsed.dtmfDigit !== null,
    hasStepId:      parsed.stepId !== null,
  });

  return parsed;
}

module.exports = { parseWebhookEvent };
