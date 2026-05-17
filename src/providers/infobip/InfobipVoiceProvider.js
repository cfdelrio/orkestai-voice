/**
 * @fileoverview Infobip implementation of the VoiceProvider interface.
 *
 * Translates the generic VoiceFlow domain model into Infobip Voice API calls.
 * Only this file and InfobipWebhookAdapter know about Infobip-specific details.
 *
 * Infobip Docs: https://www.infobip.com/docs/voice-and-video/outbound-calls
 *
 * TODO: Verify exact endpoint paths once Infobip API credentials are available.
 * TODO: Confirm IVR/scenario payload structure with Infobip support or live testing.
 */

const axios = require('axios');
const VoiceProvider = require('../VoiceProvider');
const { interpolateTemplate } = require('../../services/templateEngine');
const logger = require('../../middleware/logger').createLogger('InfobipVoiceProvider');

/**
 * Maps normalized call statuses to Infobip call states.
 * TODO: Verify exact Infobip status strings from their API documentation.
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
};

/**
 * Infobip implementation of VoiceProvider.
 * Uses the Infobip Voice API to initiate outbound IVR calls.
 */
class InfobipVoiceProvider extends VoiceProvider {
  /**
   * @param {Object} config - Provider configuration from ProviderConfig record
   * @param {string} config.apiKey - Infobip API key
   * @param {string} config.baseUrl - Infobip base URL (e.g. https://XXXXX.api.infobip.com)
   * @param {string} config.fromNumber - Caller ID / sender number in E.164 format
   */
  constructor(config) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.fromNumber = config.fromNumber;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `App ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Initiates an outbound IVR call via the Infobip Voice API.
   *
   * @param {import('../VoiceProvider').InitiateCallParams} params
   * @returns {Promise<import('../VoiceProvider').InitiateCallResult>}
   */
  async initiateCall(params) {
    const { toNumber, contact, flow, webhookUrl, tenantMetadata } = params;

    const payload = this.buildCallPayload(contact, flow, webhookUrl, tenantMetadata);

    logger.info(`Initiating call to ${toNumber}`, { contactId: contact.id, campaignId: flow.campaignId });

    try {
      // TODO: Verify exact endpoint path. Infobip may use /calls/1/calls or /voice/ivr/1/scenarios + /calls
      const response = await this.client.post('/calls/1/calls', {
        ...payload,
        to: toNumber,
        from: params.fromNumber || this.fromNumber,
      });

      // TODO: Verify exact response field names from Infobip API
      const providerCallId = response.data?.id || response.data?.callId;
      const rawStatus = response.data?.status?.name || response.data?.callStatus || 'INITIATED';
      const normalizedStatus = INFOBIP_STATUS_MAP[rawStatus] || 'initiated';

      logger.info(`Call initiated successfully`, {
        providerCallId,
        status: normalizedStatus,
        toNumber,
      });

      return {
        providerCallId: String(providerCallId),
        status: normalizedStatus,
      };
    } catch (error) {
      const errorMessage = error.response?.data?.requestError?.serviceException?.text
        || error.response?.data?.description
        || error.message;

      logger.error(`Failed to initiate call to ${toNumber}`, {
        error: errorMessage,
        statusCode: error.response?.status,
      });

      throw new Error(`Infobip call initiation failed: ${errorMessage}`);
    }
  }

  /**
   * Retrieves current status of a call from the Infobip API.
   *
   * @param {string} providerCallId - Infobip's call ID
   * @returns {Promise<import('../VoiceProvider').CallStatusResult>}
   */
  async getCallStatus(providerCallId) {
    logger.info(`Fetching call status`, { providerCallId });

    try {
      // TODO: Verify exact endpoint path for call status retrieval
      const response = await this.client.get(`/calls/1/calls/${providerCallId}`);

      // TODO: Verify exact response field names from Infobip API
      const rawStatus = response.data?.status?.name || response.data?.callStatus || 'UNKNOWN';
      const normalizedStatus = INFOBIP_STATUS_MAP[rawStatus] || 'initiated';

      // TODO: Verify how Infobip reports duration (seconds? milliseconds?)
      const durationRaw = response.data?.duration || response.data?.callDuration || null;
      const duration = durationRaw !== null ? Math.round(Number(durationRaw)) : null;

      return {
        status: normalizedStatus,
        duration,
      };
    } catch (error) {
      const errorMessage = error.response?.data?.requestError?.serviceException?.text
        || error.response?.data?.description
        || error.message;

      logger.error(`Failed to get call status`, {
        providerCallId,
        error: errorMessage,
        statusCode: error.response?.status,
      });

      throw new Error(`Infobip getCallStatus failed: ${errorMessage}`);
    }
  }

  /**
   * Builds the Infobip-specific API payload from the generic VoiceFlow model.
   *
   * Translates VoiceFlow steps into Infobip IVR actions:
   *  - "say"           → PLAY_TEXT action (TTS)
   *  - "dtmf_question" → COLLECT_DTMF action with TTS prompt
   *  - "goodbye"       → PLAY_TEXT action followed by HANGUP
   *
   * TODO: Verify exact action types and field names in Infobip IVR scenario format.
   * TODO: Confirm whether IVR scenarios must be pre-created or can be sent inline.
   *
   * @param {Object} contact
   * @param {Object} flow
   * @param {string} webhookUrl
   * @param {Object} [tenantMetadata]
   * @returns {Object} Infobip API payload
   */
  buildCallPayload(contact, flow, webhookUrl, tenantMetadata = {}) {
    const templateVars = {
      firstName: contact.firstName,
      lastName: contact.lastName || '',
      phone: contact.phone,
      brandName: tenantMetadata?.brandName || '',
    };

    // Build IVR scenario actions from VoiceFlow steps
    // TODO: Validate against actual Infobip IVR scenario schema
    const scenarioActions = [];

    for (const step of flow.steps) {
      const resolvedText = interpolateTemplate(step.text, templateVars);

      if (step.type === 'say') {
        scenarioActions.push({
          // TODO: Verify Infobip action type name (may be "SAY", "PLAY_TEXT", or different)
          type: 'SAY',
          text: resolvedText,
          language: 'es-ES', // TODO: Make language configurable per tenant or flow
          voice: {
            name: 'Lucia', // TODO: Make TTS voice configurable
            gender: 'female',
          },
        });
      } else if (step.type === 'dtmf_question') {
        scenarioActions.push({
          // TODO: Verify Infobip action type for DTMF collection (may be "COLLECT", "CAPTURE_INPUT", etc.)
          type: 'COLLECT',
          sayText: resolvedText,
          language: 'es-ES',
          voice: {
            name: 'Lucia',
            gender: 'female',
          },
          maxInputLength: step.maxDigits || 1,
          timeout: step.timeout || 5,
          // TODO: Verify how Infobip handles DTMF events — may need a separate webhook per step
          // The stepId is embedded so the webhook adapter can correlate responses
          userData: JSON.stringify({ stepId: step.id }),
        });
      } else if (step.type === 'goodbye') {
        scenarioActions.push({
          type: 'SAY',
          text: resolvedText,
          language: 'es-ES',
          voice: {
            name: 'Lucia',
            gender: 'female',
          },
        });
        scenarioActions.push({
          // TODO: Verify Infobip hangup action type name
          type: 'HANGUP',
        });
      }
    }

    return {
      // TODO: Verify top-level payload structure for Infobip outbound IVR calls
      // Some Infobip integrations use scenario IDs; others send the scenario inline
      scenario: {
        // TODO: Confirm if Infobip requires a named scenario or accepts inline actions
        actions: scenarioActions,
      },
      // Webhook URL for call status and DTMF events
      // TODO: Verify the exact field name Infobip uses for webhook/callback URL
      notifyUrl: webhookUrl,
      notifyContentType: 'application/json',
    };
  }
}

module.exports = InfobipVoiceProvider;
