/**
 * @fileoverview Infobip Voice webhook adapter.
 *
 * Parses the raw JSON payload that Infobip sends to our webhook endpoint
 * and normalizes it into a provider-agnostic structure that the rest of
 * the system understands.
 *
 * Only this file and InfobipVoiceProvider are allowed to reference
 * Infobip-specific field names.
 *
 * Infobip Voice webhook docs:
 *   https://www.infobip.com/docs/voice-and-video/outbound-calls#webhooks
 *
 * TODO: Verify all field names below against the live Infobip webhook payload.
 *       The field names used here are based on Infobip documentation and may
 *       need adjustment when tested against a real Infobip account.
 */

const { createLogger } = require('../../middleware/logger');

const logger = createLogger('InfobipWebhookAdapter');

/**
 * Maps Infobip raw call status strings to our normalized status values.
 * TODO: Confirm all possible Infobip status values from their documentation.
 */
const INFOBIP_STATUS_MAP = {
  INITIATED: 'initiated',
  RINGING: 'ringing',
  ESTABLISHED: 'answered',
  FINISHED: 'completed',
  NO_ANSWER: 'no_answer',
  BUSY: 'failed',
  REJECTED: 'failed',
  FAILED: 'failed',
  CANCELLED: 'failed',
  COMPLETED: 'completed', // Some Infobip versions use COMPLETED instead of FINISHED
};

/**
 * @typedef {Object} ParsedWebhookEvent
 * @property {string|null}  providerCallId - Infobip's unique call identifier
 * @property {string}       status         - Normalized call status
 * @property {string|null}  dtmfDigit      - DTMF digit(s) collected, or null
 * @property {string|null}  stepId         - VoiceFlow step ID the DTMF came from, or null
 * @property {string}       eventType      - Raw event type: "call_status" | "dtmf" | "unknown"
 * @property {Object}       raw            - Original raw payload for debugging / auditing
 */

/**
 * Parses an Infobip Voice webhook POST body into a normalized event object.
 *
 * Infobip sends two types of voice events:
 *  1. Call status updates  (callStatus field changes: RINGING → ESTABLISHED → FINISHED)
 *  2. DTMF digit events    (dtmfDigit / collectedDigits field present)
 *
 * @param {Object} rawPayload - Parsed JSON body from the HTTP POST
 * @returns {ParsedWebhookEvent}
 */
function parseWebhookEvent(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    logger.warn('Received empty or non-object webhook payload');
    return {
      providerCallId: null,
      status: 'unknown',
      dtmfDigit: null,
      stepId: null,
      eventType: 'unknown',
      raw: rawPayload,
    };
  }

  logger.debug('Parsing Infobip webhook payload', { keys: Object.keys(rawPayload) });

  // ─── Extract provider call ID ───────────────────────────────────────────────
  // TODO: Verify exact field name. Infobip may use "id", "callId", or "bulkId".
  const providerCallId =
    rawPayload.id ||
    rawPayload.callId ||
    rawPayload.callSessionId ||
    null;

  // ─── Normalize call status ──────────────────────────────────────────────────
  // TODO: Verify exact field path. Infobip may nest status as status.name or
  //       send it as a top-level string field "callStatus".
  const rawStatus =
    rawPayload.callStatus ||
    rawPayload.status?.name ||
    rawPayload.state ||
    null;

  const normalizedStatus = rawStatus
    ? (INFOBIP_STATUS_MAP[rawStatus.toUpperCase()] || 'unknown')
    : 'unknown';

  // ─── Extract DTMF digit ─────────────────────────────────────────────────────
  // TODO: Verify exact field name. Infobip may use "dtmfDigit", "collectedDigits",
  //       "digit", or nest it inside an "input" or "data" object.
  const dtmfDigit =
    rawPayload.dtmfDigit ||
    rawPayload.collectedDigits ||
    rawPayload.digits ||
    rawPayload.digit ||
    rawPayload.data?.dtmfDigit ||
    rawPayload.data?.collectedDigits ||
    null;

  // ─── Extract step ID ────────────────────────────────────────────────────────
  // The stepId was embedded in the userData field when building the call payload
  // (see InfobipVoiceProvider.buildCallPayload → userData: JSON.stringify({ stepId })).
  // TODO: Verify exact field name Infobip uses to echo back userData / custom data.
  let stepId = null;
  const rawUserData =
    rawPayload.userData ||
    rawPayload.data?.userData ||
    rawPayload.customData ||
    null;

  if (rawUserData) {
    try {
      const parsed = typeof rawUserData === 'string'
        ? JSON.parse(rawUserData)
        : rawUserData;
      stepId = parsed.stepId || null;
    } catch {
      logger.warn('Failed to parse userData from webhook payload', { rawUserData });
    }
  }

  // ─── Determine event type ───────────────────────────────────────────────────
  let eventType = 'call_status';
  if (dtmfDigit !== null && dtmfDigit !== undefined && String(dtmfDigit).length > 0) {
    eventType = 'dtmf';
  }

  const parsed = {
    providerCallId: providerCallId ? String(providerCallId) : null,
    status: normalizedStatus,
    dtmfDigit: dtmfDigit !== null ? String(dtmfDigit) : null,
    stepId,
    eventType,
    raw: rawPayload,
  };

  logger.debug('Webhook event parsed', {
    providerCallId: parsed.providerCallId,
    eventType: parsed.eventType,
    status: parsed.status,
    hasDtmf: parsed.dtmfDigit !== null,
    hasStepId: parsed.stepId !== null,
  });

  return parsed;
}

module.exports = { parseWebhookEvent };
