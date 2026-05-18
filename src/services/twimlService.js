/**
 * @fileoverview TwiML generation service for Twilio voice calls.
 *
 * Twilio is pull-based: when a call connects, Twilio GETs a URL on our
 * server to fetch TwiML (XML) that tells it what to say, gather DTMF, etc.
 *
 * This service:
 *  1. Looks up the recipient, contact, campaign, and flow from the database
 *  2. Builds valid TwiML XML from the flow steps
 *  3. Persists DTMF responses when a gather action is completed
 *
 * TwiML reference: https://www.twilio.com/docs/voice/twiml
 */

const { PrismaClient } = require('@prisma/client');
const { interpolateTemplate } = require('./templateEngine');
const { createLogger } = require('../middleware/logger');
const { audioExists, getAudioUrl, transcribeAndSaveRecording } = require('./audioService');
const { getProviderConfigForTenant } = require('./tenantService');

const prisma = new PrismaClient();
const logger = createLogger('TwimlService');

// ─── XML helpers ──────────────────────────────────────────────────────────────

/**
 * Escapes characters that are special in XML.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wraps TwiML verb strings in the standard XML declaration + Response envelope.
 *
 * @param {string} innerXml - Raw TwiML verb content (no envelope)
 * @returns {string} Complete TwiML document
 */
function wrapResponse(innerXml) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${innerXml}</Response>`;
}

/**
 * Returns a minimal TwiML that just hangs up. Used on error paths so Twilio
 * doesn't retry the TwiML fetch indefinitely.
 *
 * @returns {string}
 */
function hangupTwiml() {
  return wrapResponse('<Hangup/>');
}

// ─── TwiML step builders ──────────────────────────────────────────────────────

/**
 * Builds a TwiML <Say> tag using the configured voice.
 * Polly voices (e.g. "Polly.Mia-Neural") use the voice attribute.
 * Language codes (e.g. "es-MX", "es-ES") use the language attribute.
 *
 * @param {string} text  - Already XML-escaped text
 * @param {string} voice - Voice identifier from VoiceFlow.voice
 * @returns {string}
 */
function buildSayTag(text, voice) {
  if (voice && voice.startsWith('Polly.')) {
    return `<Say voice="${voice}">${text}</Say>`;
  }
  return `<Say language="${voice || 'es-MX'}">${text}</Say>`;
}

/**
 * Builds TwiML XML verbs for an array of flow steps.
 *
 * @param {Array<Object>} steps        - Flow steps to render
 * @param {Object}        vars         - Template variables { firstName, brandName, ... }
 * @param {string}        webhookBase  - Base URL (scheme+host) for gather action URLs
 * @param {string}        recipientId  - CampaignRecipient UUID
 * @param {string}        voice        - Voice identifier from VoiceFlow.voice
 * @returns {string} Raw TwiML verb string (no envelope)
 */
function buildTwimlVerbs(steps, vars, webhookBase, recipientId, voice) {
  let xml = '';
  let hasGoodbye = false;

  for (const step of steps) {
    const text = escapeXml(interpolateTemplate(step.text || '', vars));

    // Use pre-generated OpenAI TTS audio if available, otherwise fall back to <Say>
    const audioTag = audioExists(recipientId, step.id)
      ? `<Play>${getAudioUrl(recipientId, step.id, webhookBase)}</Play>`
      : buildSayTag(text, voice);

    if (step.type === 'say') {
      xml += audioTag;

    } else if (step.type === 'dtmf_question') {
      const numDigits = step.maxDigits || 1;
      const timeout   = step.timeout   || 5;
      const action    = `${webhookBase}/api/twiml/recipients/${recipientId}/gather/${step.id}`;

      xml += `<Gather numDigits="${numDigits}" action="${action}" method="POST" timeout="${timeout}">`;
      xml += audioTag;
      xml += `</Gather>`;

    } else if (step.type === 'speech_question') {
      const maxLength = step.maxLength || 30;
      const timeout   = step.timeout   || 5;
      const action    = `${webhookBase}/api/twiml/recipients/${recipientId}/recording/${step.id}`;

      xml += audioTag;
      xml += `<Record action="${action}" method="POST" maxLength="${maxLength}" timeout="${timeout}" playBeep="true" />`;
      // <Record> transfers control to action URL — no trailing <Hangup/> needed here
      hasGoodbye = true;
      break;

    } else if (step.type === 'goodbye') {
      xml += audioTag;
      xml += `<Hangup/>`;
      hasGoodbye = true;
      break;
    }
  }

  // Always terminate with Hangup if no goodbye step ended the call
  if (!hasGoodbye) {
    xml += `<Hangup/>`;
  }

  return xml;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates initial TwiML for a recipient when their call first connects.
 *
 * Twilio GETs GET /api/twiml/recipients/:recipientId when the call answers.
 *
 * @param {string} recipientId - CampaignRecipient UUID
 * @param {string} webhookBase - Base URL (scheme+host) for gather action URLs
 * @returns {Promise<string>} Complete TwiML XML document
 */
async function getTwimlForRecipient(recipientId, webhookBase) {
  logger.info('Generating initial TwiML', { recipientId });

  let recipient;
  try {
    recipient = await prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: {
        contact: true,
        campaign: {
          include: {
            flow:   true,
            tenant: true,
          },
        },
      },
    });
  } catch (err) {
    logger.error('DB error looking up recipient for TwiML', { recipientId, error: err.message });
    return hangupTwiml();
  }

  if (!recipient) {
    logger.warn('Recipient not found for TwiML', { recipientId });
    return hangupTwiml();
  }

  const { contact, campaign } = recipient;
  const flow = campaign?.flow;

  if (!flow || !Array.isArray(flow.steps) || flow.steps.length === 0) {
    logger.warn('No flow steps found for recipient TwiML', { recipientId, campaignId: campaign?.id });
    return hangupTwiml();
  }

  const campaignVars = campaign.variables && typeof campaign.variables === 'object' ? campaign.variables : {};
  const vars = {
    // Campaign-level variables (defined when creating the campaign)
    ...campaignVars,
    // Contact fields always override — they come from the actual contact record
    firstName: contact.firstName || '',
    lastName:  contact.lastName  || '',
    phone:     contact.phone     || '',
  };

  const verbs = buildTwimlVerbs(flow.steps, vars, webhookBase, recipientId, flow.voice);
  const twiml = wrapResponse(verbs);

  logger.debug('Initial TwiML generated', { recipientId, twimlLength: twiml.length, voice: flow.voice });
  return twiml;
}

/**
 * Generates TwiML for the steps that come after a DTMF gather action,
 * and persists the DTMF response to the database.
 *
 * Twilio POSTs to POST /api/twiml/recipients/:recipientId/gather/:stepId
 * after the caller presses a digit (or the gather times out).
 *
 * @param {string} recipientId - CampaignRecipient UUID
 * @param {string} stepId      - The VoiceFlow step ID whose gather was just completed
 * @param {string} digit       - The digit(s) pressed by the caller (may be empty on timeout)
 * @param {string} webhookBase - Base URL (scheme+host) for subsequent gather action URLs
 * @returns {Promise<string>} Complete TwiML XML document
 */
async function getTwimlAfterGather(recipientId, stepId, digit, webhookBase) {
  logger.info('Generating post-gather TwiML', { recipientId, stepId, digit });

  let recipient;
  try {
    recipient = await prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: {
        contact: true,
        campaign: {
          include: {
            flow:   true,
            tenant: true,
          },
        },
      },
    });
  } catch (err) {
    logger.error('DB error looking up recipient for post-gather TwiML', {
      recipientId, stepId, error: err.message,
    });
    return hangupTwiml();
  }

  if (!recipient) {
    logger.warn('Recipient not found for post-gather TwiML', { recipientId });
    return hangupTwiml();
  }

  const { contact, campaign } = recipient;
  const flow = campaign?.flow;

  if (!flow || !Array.isArray(flow.steps)) {
    logger.warn('No flow steps for post-gather TwiML', { recipientId, stepId });
    return hangupTwiml();
  }

  // ─── Persist the DTMF response ────────────────────────────────────────────
  if (digit && digit.length > 0) {
    try {
      // Find the most recent call for this recipient. We intentionally don't
      // filter by status here: Twilio's completed callback can arrive before
      // the gather POST if the network is fast, and we still want to save the
      // response.
      const call = await prisma.call.findFirst({
        where: { recipientId },
        orderBy: { createdAt: 'desc' },
      });

      if (call) {
        // Resolve semantic value from step options if available
        const step = flow.steps.find((s) => s.id === stepId);
        const value = step?.options?.[digit] || null;

        await prisma.response.create({
          data: {
            callId: call.id,
            stepId,
            input:  digit,
            value,
          },
        });

        logger.info('DTMF response saved via gather', {
          callId: call.id,
          stepId,
          digit,
          value,
        });
      } else {
        logger.warn('No active call found to save DTMF response', { recipientId, stepId });
      }
    } catch (err) {
      // Don't fail TwiML generation if response persistence fails
      logger.error('Failed to persist DTMF response', {
        recipientId, stepId, digit, error: err.message,
      });
    }
  }

  // ─── Build TwiML for remaining steps ─────────────────────────────────────
  const stepIndex = flow.steps.findIndex((s) => s.id === stepId);
  const remainingSteps = stepIndex >= 0
    ? flow.steps.slice(stepIndex + 1)
    : [];

  if (remainingSteps.length === 0) {
    logger.debug('No remaining steps after gather — hanging up', { recipientId, stepId });
    return wrapResponse('<Hangup/>');
  }

  const campaignVars = campaign.variables && typeof campaign.variables === 'object' ? campaign.variables : {};
  const vars = {
    ...campaignVars,
    firstName: contact.firstName || '',
    lastName:  contact.lastName  || '',
    phone:     contact.phone     || '',
  };

  const verbs = buildTwimlVerbs(remainingSteps, vars, webhookBase, recipientId, flow.voice);
  const twiml = wrapResponse(verbs);

  logger.debug('Post-gather TwiML generated', { recipientId, stepId, twimlLength: twiml.length, voice: flow.voice });
  return twiml;
}

/**
 * Generates TwiML for the steps that come after a <Record> verb completes,
 * persists the recording URL as a Response, and kicks off async Whisper transcription.
 *
 * Twilio POSTs to POST /api/twiml/recipients/:recipientId/recording/:stepId
 * when the caller finishes speaking (or silence timeout).
 *
 * @param {string} recipientId      - CampaignRecipient UUID
 * @param {string} stepId           - The speech_question step that triggered the recording
 * @param {string} recordingUrl     - Twilio recording URL (needs .mp3 suffix to download)
 * @param {string} recordingSid     - Twilio recording SID
 * @param {number} recordingDuration - Duration in seconds
 * @param {string} webhookBase      - Base URL for subsequent action URLs
 * @returns {Promise<string>} Complete TwiML XML document
 */
async function getTwimlAfterRecording(recipientId, stepId, recordingUrl, recordingSid, recordingDuration, webhookBase) {
  logger.info('Generating post-recording TwiML', { recipientId, stepId, recordingSid, duration: recordingDuration });

  let recipient;
  try {
    recipient = await prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: {
        contact: true,
        campaign: {
          include: { flow: true, tenant: true },
        },
      },
    });
  } catch (err) {
    logger.error('DB error for post-recording TwiML', { recipientId, stepId, error: err.message });
    return hangupTwiml();
  }

  if (!recipient) {
    logger.warn('Recipient not found for post-recording TwiML', { recipientId });
    return hangupTwiml();
  }

  const { contact, campaign } = recipient;
  const flow = campaign?.flow;

  if (!flow || !Array.isArray(flow.steps)) {
    return hangupTwiml();
  }

  // ─── Persist recording URL and kick off async transcription ──────────────
  if (recordingUrl) {
    try {
      const call = await prisma.call.findFirst({
        where: { recipientId },
        orderBy: { createdAt: 'desc' },
      });

      if (call) {
        const response = await prisma.response.create({
          data: {
            callId: call.id,
            stepId,
            input: recordingUrl,
            value: null, // populated async by Whisper
          },
        });

        logger.info('Voice recording response saved', { callId: call.id, stepId, responseId: response.id });

        // Download + transcribe in background — don't block TwiML response
        setImmediate(async () => {
          try {
            const providerConfig = await getProviderConfigForTenant(campaign.tenantId);
            const accountSid = providerConfig.apiKey;
            const authToken = providerConfig.metadata?.authToken;
            await transcribeAndSaveRecording(recordingUrl, response.id, accountSid, authToken);
          } catch (err) {
            logger.error('Failed to start transcription', { responseId: response.id, error: err.message });
          }
        });
      } else {
        logger.warn('No call found to attach recording response', { recipientId, stepId });
      }
    } catch (err) {
      logger.error('Failed to persist recording response', { recipientId, stepId, error: err.message });
    }
  }

  // ─── Build TwiML for remaining steps ─────────────────────────────────────
  const stepIndex = flow.steps.findIndex((s) => s.id === stepId);
  const remainingSteps = stepIndex >= 0 ? flow.steps.slice(stepIndex + 1) : [];

  if (remainingSteps.length === 0) {
    return wrapResponse('<Hangup/>');
  }

  const campaignVars = campaign.variables && typeof campaign.variables === 'object' ? campaign.variables : {};
  const vars = {
    ...campaignVars,
    firstName: contact.firstName || '',
    lastName:  contact.lastName  || '',
    phone:     contact.phone     || '',
  };

  const verbs = buildTwimlVerbs(remainingSteps, vars, webhookBase, recipientId, flow.voice);
  return wrapResponse(verbs);
}

module.exports = {
  getTwimlForRecipient,
  getTwimlAfterGather,
  getTwimlAfterRecording,
  hangupTwiml,
};
