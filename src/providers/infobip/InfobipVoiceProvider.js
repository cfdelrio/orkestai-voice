/**
 * @fileoverview Infobip implementation of the VoiceProvider interface.
 *
 * Uses Infobip Voice Advanced API (POST /voice/1/calls/advanced) to initiate
 * outbound IVR calls with inline scenario steps.
 *
 * Infobip Docs:
 *   https://www.infobip.com/docs/voice-and-video/outbound-calls#advanced-call
 */

const axios = require('axios');
const VoiceProvider = require('../VoiceProvider');
const { interpolateTemplate } = require('../../services/templateEngine');
const logger = require('../../middleware/logger').createLogger('InfobipVoiceProvider');

const INFOBIP_STATUS_MAP = {
  PENDING_ACCEPTED: 'initiated',
  PENDING:          'initiated',
  RINGING:          'ringing',
  ESTABLISHED:      'answered',
  FINISHED:         'completed',
  COMPLETED:        'completed',
  NO_ANSWER:        'no_answer',
  BUSY:             'failed',
  REJECTED:         'failed',
  FAILED:           'failed',
  CANCELLED:        'failed',
};

class InfobipVoiceProvider extends VoiceProvider {
  constructor(config) {
    super();
    this.apiKey     = config.apiKey;
    this.baseUrl    = config.baseUrl.replace(/\/$/, '');
    this.fromNumber = config.fromNumber;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization:  `App ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      timeout: 30000,
    });
  }

  async initiateCall(params) {
    const { toNumber, contact, flow, webhookUrl, tenantMetadata } = params;

    const scenario = this._buildScenario(contact, flow, tenantMetadata);

    const payload = {
      messages: [
        {
          from:        params.fromNumber || this.fromNumber,
          destinations: [{ to: toNumber }],
          callTimeout:  30,
          notifyUrl:    webhookUrl,
          notifyContentType: 'application/json',
          callbackData: JSON.stringify({ contactId: contact.id, campaignId: flow.campaignId }),
          record:       false,
          scenario,
        },
      ],
    };

    logger.info(`Initiating call to ${toNumber}`, { contactId: contact.id });
    logger.debug('Infobip payload', { payload: JSON.stringify(payload) });

    try {
      const response = await this.client.post('/voice/1/calls/advanced', payload);

      const msg = response.data?.messages?.[0];
      const providerCallId = msg?.messageId || msg?.to;
      const rawStatus = msg?.status?.name || 'PENDING_ACCEPTED';
      const normalizedStatus = INFOBIP_STATUS_MAP[rawStatus] || 'initiated';

      logger.info(`Call initiated`, { providerCallId, status: normalizedStatus, toNumber });

      return {
        providerCallId: String(providerCallId),
        status: normalizedStatus,
      };
    } catch (error) {
      const detail =
        error.response?.data?.requestError?.serviceException?.text ||
        error.response?.data?.description ||
        JSON.stringify(error.response?.data) ||
        error.message;

      logger.error(`Failed to initiate call to ${toNumber}`, {
        error: detail,
        statusCode: error.response?.status,
        responseBody: error.response?.data,
      });

      throw new Error(`Infobip call initiation failed: ${detail}`);
    }
  }

  async getCallStatus(providerCallId) {
    logger.info(`Fetching call status`, { providerCallId });

    try {
      // TODO: Verify exact endpoint for status — may need bulkId instead of messageId
      const response = await this.client.get(`/voice/1/calls/advanced/${providerCallId}`);

      const rawStatus = response.data?.status?.name || 'UNKNOWN';
      const normalizedStatus = INFOBIP_STATUS_MAP[rawStatus] || 'initiated';
      const duration = response.data?.duration ?? null;

      return { status: normalizedStatus, duration };
    } catch (error) {
      const detail =
        error.response?.data?.requestError?.serviceException?.text ||
        error.response?.data?.description ||
        error.message;

      logger.error(`Failed to get call status`, { providerCallId, error: detail });
      throw new Error(`Infobip getCallStatus failed: ${detail}`);
    }
  }

  /**
   * Builds the inline Infobip IVR scenario from VoiceFlow steps.
   *
   * Infobip scenario step types:
   *   - say     → { say: { text, language, voice } }
   *   - capture → { capture: { say: {...}, dtmf: { maxInputLength, timeout } } }
   *   - hangup  → { hangup: {} }
   */
  _buildScenario(contact, flow, tenantMetadata = {}) {
    const vars = {
      firstName: contact.firstName,
      lastName:  contact.lastName || '',
      phone:     contact.phone,
      brandName: tenantMetadata?.brandName || '',
    };

    const steps = [];

    for (const step of flow.steps) {
      const text = interpolateTemplate(step.text, vars);

      const voice = {
        name:   'es-ES-Standard-A', // TODO: make configurable per tenant/flow
        gender: 'female',
      };
      const language = 'es-ES'; // TODO: make configurable per tenant/flow

      if (step.type === 'say') {
        steps.push({ say: { text, language, voice } });

      } else if (step.type === 'dtmf_question') {
        steps.push({
          capture: {
            say: { text, language, voice },
            dtmf: {
              maxInputLength: step.maxDigits || 1,
              timeout:        step.timeout   || 5,
            },
          },
        });

      } else if (step.type === 'goodbye') {
        steps.push({ say: { text, language, voice } });
        steps.push({ hangup: {} });
      }
    }

    return { steps };
  }
}

module.exports = InfobipVoiceProvider;
