/**
 * @fileoverview Twilio implementation of the VoiceProvider interface.
 *
 * Twilio is pull-based: we POST to Twilio's REST API with a `Url` param,
 * and Twilio GETs that URL to fetch TwiML (XML) dynamically when the call
 * connects. This is different from Infobip, which accepts the full IVR script
 * in the call initiation POST.
 *
 * Docs:
 *   Calls API:   https://www.twilio.com/docs/voice/api/call-resource
 *   TwiML:       https://www.twilio.com/docs/voice/twiml
 */

const axios = require('axios');
const VoiceProvider = require('../VoiceProvider');
const { createLogger } = require('../../middleware/logger');

const logger = createLogger('TwilioVoiceProvider');

const TWILIO_STATUS_MAP = {
  queued:     'ringing',
  ringing:    'ringing',
  'in-progress': 'answered',
  completed:  'completed',
  busy:       'failed',
  failed:     'failed',
  'no-answer': 'failed',
  canceled:   'failed',
};

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

class TwilioVoiceProvider extends VoiceProvider {
  constructor(config) {
    super();
    this.accountSid = config.apiKey;
    this.authToken  = config.metadata?.authToken;
    this.fromNumber = config.fromNumber;

    if (!this.accountSid) throw new Error('TwilioVoiceProvider: apiKey (Account SID) is required');
    if (!this.authToken)  throw new Error('TwilioVoiceProvider: metadata.authToken is required');

    this.client = axios.create({
      baseURL: `${TWILIO_API_BASE}/${this.accountSid}`,
      auth: {
        username: this.accountSid,
        password: this.authToken,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    });
  }

  /**
   * Initiates an outbound call via the Twilio REST API.
   *
   * Twilio will GET the TwiML URL when the call connects to determine
   * what to say/do — the flow is not embedded in this request.
   *
   * @param {import('../VoiceProvider').InitiateCallParams & { recipientId: string }} params
   * @returns {Promise<import('../VoiceProvider').InitiateCallResult>}
   */
  async initiateCall(params) {
    const { toNumber, webhookUrl, recipientId } = params;
    const from = params.fromNumber || this.fromNumber;

    // Derive webhookBase by stripping the path from webhookUrl
    const webhookBase = _extractBase(webhookUrl);

    const twimlUrl      = `${webhookBase}/api/twiml/recipients/${recipientId}`;
    const statusCallback = `${webhookBase}/api/webhooks/twilio/voice`;

    const body = new URLSearchParams({
      To:                   toNumber,
      From:                 from,
      Url:                  twimlUrl,
      StatusCallback:       statusCallback,
      StatusCallbackMethod: 'POST',
    }).toString();

    logger.info(`Initiating Twilio call`, { toNumber, recipientId, twimlUrl });

    try {
      const response = await this.client.post('/Calls.json', body);

      const providerCallId = response.data?.sid;
      const rawStatus      = response.data?.status || 'queued';

      logger.info(`Twilio call initiated`, {
        providerCallId,
        status: rawStatus,
        toNumber,
        recipientId,
      });

      return {
        providerCallId: String(providerCallId),
        status: 'initiated',
      };
    } catch (error) {
      throw this._buildError('initiateCall', toNumber, error);
    }
  }

  /**
   * Retrieves the current status of a call from the Twilio REST API.
   *
   * @param {string} providerCallId - Twilio Call SID (e.g. "CAxxxxxxxx...")
   * @returns {Promise<import('../VoiceProvider').CallStatusResult>}
   */
  async getCallStatus(providerCallId) {
    try {
      const response = await this.client.get(`/Calls/${providerCallId}.json`);

      const rawStatus = response.data?.status || 'unknown';
      const duration  = response.data?.duration != null
        ? parseInt(response.data.duration, 10)
        : null;

      return {
        status:   TWILIO_STATUS_MAP[rawStatus] || 'initiated',
        duration: Number.isFinite(duration) ? duration : null,
      };
    } catch (error) {
      throw this._buildError('getCallStatus', providerCallId, error);
    }
  }

  /**
   * Not applicable for Twilio — TwiML is built by twimlService, not here.
   * Satisfies the VoiceProvider interface requirement.
   */
  buildCallPayload() {
    throw new Error('TwilioVoiceProvider.buildCallPayload() is not used — TwiML is served dynamically via twimlService');
  }

  _buildError(operation, target, error) {
    const detail =
      error.response?.data?.message ||
      error.response?.data?.code ||
      JSON.stringify(error.response?.data) ||
      error.message;

    logger.error(`Failed: ${operation} for ${target}`, {
      error:        detail,
      statusCode:   error.response?.status,
      responseBody: error.response?.data,
    });

    return new Error(`Twilio ${operation} failed: ${detail}`);
  }
}

/**
 * Strips the path from a full URL, returning only scheme + host (+ port if present).
 * e.g. "https://example.com/api/webhooks/twilio/voice" → "https://example.com"
 *
 * @param {string} url
 * @returns {string}
 */
function _extractBase(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Fallback: strip everything after the third slash
    const match = url.match(/^(https?:\/\/[^/]+)/);
    return match ? match[1] : url;
  }
}

module.exports = TwilioVoiceProvider;
