/**
 * @fileoverview Infobip implementation of the VoiceProvider interface.
 *
 * Strategy:
 *  - Flows with ONLY "say"/"goodbye" steps → POST /tts/3/single (simple TTS call)
 *  - Flows with "dtmf_question" steps      → POST /voice/1/ivr/1/scenarios (create)
 *                                            + POST /voice/1/calls/scenario (call)
 *
 * Infobip Docs:
 *   TTS:      https://www.infobip.com/docs/voice-and-video/tts
 *   IVR:      https://www.infobip.com/docs/voice-and-video/ivr
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
    const from = params.fromNumber || this.fromNumber;

    const hasDtmf = flow.steps.some((s) => s.type === 'dtmf_question');

    if (hasDtmf) {
      return this._initiateIvrCall({ toNumber, from, contact, flow, webhookUrl, tenantMetadata });
    } else {
      return this._initiateTtsCall({ toNumber, from, contact, flow, webhookUrl, tenantMetadata });
    }
  }

  // ─── Simple TTS call (no DTMF) ──────────────────────────────────────────────

  async _initiateTtsCall({ toNumber, from, contact, flow, webhookUrl, tenantMetadata }) {
    const vars = this._templateVars(contact, tenantMetadata);
    const fullText = flow.steps
      .filter((s) => s.type === 'say' || s.type === 'goodbye')
      .map((s) => interpolateTemplate(s.text, vars))
      .join('. ');

    const payload = {
      from,
      to:                  toNumber,
      text:                fullText,
      language:            'es-ES',
      voice:               { name: 'es-ES-Standard-A', gender: 'female' },
      notifyUrl:           webhookUrl,
      notifyContentType:   'application/json',
      callbackData:        JSON.stringify({ contactId: contact.id, campaignId: flow.campaignId }),
    };

    logger.info(`TTS call to ${toNumber}`, { contactId: contact.id });
    logger.debug('TTS payload', payload);

    try {
      const response = await this.client.post('/tts/3/single', payload);

      // Response: { messages: [{ to, status: { name }, messageId }], bulkId }
      const msg = response.data?.messages?.[0];
      const providerCallId = msg?.messageId || response.data?.bulkId;
      const rawStatus = msg?.status?.name || 'PENDING_ACCEPTED';

      logger.info(`TTS call initiated`, { providerCallId, status: rawStatus, toNumber });

      return {
        providerCallId: String(providerCallId),
        status: INFOBIP_STATUS_MAP[rawStatus] || 'initiated',
      };
    } catch (error) {
      throw this._buildError('TTS call', toNumber, error);
    }
  }

  // ─── IVR call with DTMF (scenario-based) ────────────────────────────────────

  async _initiateIvrCall({ toNumber, from, contact, flow, webhookUrl, tenantMetadata }) {
    const vars = this._templateVars(contact, tenantMetadata);

    // Step 1: create IVR scenario
    const scenarioSteps = this._buildIvrSteps(flow.steps, vars);
    const scenarioPayload = {
      name:    `campaign-${flow.campaignId}-${Date.now()}`,
      steps:   scenarioSteps,
    };

    logger.info(`Creating IVR scenario for call to ${toNumber}`);
    logger.debug('IVR scenario payload', scenarioPayload);

    let scenarioId;
    try {
      const scenarioRes = await this.client.post('/voice/1/ivr/1/scenarios', scenarioPayload);
      scenarioId = scenarioRes.data?.id;
      if (!scenarioId) throw new Error('No scenario ID returned from Infobip');
      logger.info(`IVR scenario created`, { scenarioId });
    } catch (error) {
      throw this._buildError('IVR scenario creation', toNumber, error);
    }

    // Step 2: start call with scenario
    const callPayload = {
      scenarioId,
      from,
      to:                  [{ phoneNumber: toNumber }],
      notifyUrl:           webhookUrl,
      notifyContentType:   'application/json',
      callbackData:        JSON.stringify({ contactId: contact.id, campaignId: flow.campaignId }),
    };

    logger.debug('IVR call payload', callPayload);

    try {
      const callRes = await this.client.post('/voice/1/calls/scenario', callPayload);

      // Response: { responses: [{ to, status: { name }, callId }] }
      const resp = callRes.data?.responses?.[0];
      const providerCallId = resp?.callId || resp?.to;
      const rawStatus = resp?.status?.name || 'PENDING_ACCEPTED';

      logger.info(`IVR call initiated`, { providerCallId, status: rawStatus, toNumber });

      return {
        providerCallId: String(providerCallId),
        status: INFOBIP_STATUS_MAP[rawStatus] || 'initiated',
      };
    } catch (error) {
      throw this._buildError('IVR call', toNumber, error);
    }
  }

  /**
   * Builds Infobip IVR scenario steps from VoiceFlow steps.
   *
   * Infobip IVR step types (TODO: verify exact schema with Infobip support):
   *   - SAY:     text-to-speech
   *   - COLLECT: capture DTMF with optional TTS prompt
   *   - HANGUP:  end call
   */
  _buildIvrSteps(steps, vars) {
    const ivrSteps = [];

    for (const step of steps) {
      const text = interpolateTemplate(step.text, vars);

      if (step.type === 'say') {
        ivrSteps.push({
          type: 'SAY',
          say: {
            text,
            language: 'es-ES',
            voice:    { name: 'es-ES-Standard-A', gender: 'female' },
          },
        });
      } else if (step.type === 'dtmf_question') {
        ivrSteps.push({
          type: 'COLLECT',
          collect: {
            say: {
              text,
              language: 'es-ES',
              voice:    { name: 'es-ES-Standard-A', gender: 'female' },
            },
            dtmf: {
              maxInputLength: step.maxDigits || 1,
              timeout:        step.timeout   || 5,
            },
          },
        });
      } else if (step.type === 'goodbye') {
        ivrSteps.push({
          type: 'SAY',
          say: {
            text,
            language: 'es-ES',
            voice:    { name: 'es-ES-Standard-A', gender: 'female' },
          },
        });
        ivrSteps.push({ type: 'HANGUP' });
      }
    }

    return ivrSteps;
  }

  async getCallStatus(providerCallId) {
    try {
      // TODO: Verify correct status endpoint — may differ between TTS and IVR calls
      const response = await this.client.get(`/tts/3/single/${providerCallId}`);
      const rawStatus = response.data?.messages?.[0]?.status?.name || 'UNKNOWN';
      return {
        status:   INFOBIP_STATUS_MAP[rawStatus] || 'initiated',
        duration: null,
      };
    } catch (error) {
      throw this._buildError('getCallStatus', providerCallId, error);
    }
  }

  _templateVars(contact, tenantMetadata = {}) {
    return {
      firstName: contact.firstName,
      lastName:  contact.lastName || '',
      phone:     contact.phone,
      brandName: tenantMetadata?.brandName || '',
    };
  }

  _buildError(operation, target, error) {
    const detail =
      error.response?.data?.requestError?.serviceException?.text ||
      error.response?.data?.description ||
      JSON.stringify(error.response?.data) ||
      error.message;

    logger.error(`Failed: ${operation} for ${target}`, {
      error:        detail,
      statusCode:   error.response?.status,
      responseBody: error.response?.data,
    });

    return new Error(`Infobip ${operation} failed: ${detail}`);
  }
}

module.exports = InfobipVoiceProvider;
