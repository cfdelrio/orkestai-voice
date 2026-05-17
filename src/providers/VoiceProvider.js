/**
 * @fileoverview Abstract VoiceProvider interface.
 *
 * All voice provider implementations MUST implement this interface.
 * The rest of the system (routes, services, etc.) only depends on this
 * abstraction — never on concrete provider implementations.
 *
 * To add a new provider (e.g. Twilio, Amazon Connect):
 *   1. Create a class that extends VoiceProvider
 *   2. Implement all methods below
 *   3. Register it in src/services/providerFactory.js
 */

/**
 * @typedef {Object} InitiateCallParams
 * @property {string} toNumber - Destination phone number in E.164 format
 * @property {string} fromNumber - Caller ID in E.164 format
 * @property {Object} contact - Contact record from the database
 * @property {string} contact.id - Contact UUID
 * @property {string} contact.firstName - Contact first name
 * @property {string|null} contact.lastName - Contact last name
 * @property {Object} flow - VoiceFlow record from the database
 * @property {Array<VoiceFlowStep>} flow.steps - Ordered array of flow steps
 * @property {string} webhookUrl - Full URL for provider to send status/DTMF events
 * @property {Object} [tenantMetadata] - Tenant metadata (e.g. brandName for TTS interpolation)
 */

/**
 * @typedef {Object} InitiateCallResult
 * @property {string} providerCallId - Provider-specific unique call identifier
 * @property {string} status - Normalized initial status: "initiated" | "ringing"
 */

/**
 * @typedef {Object} CallStatusResult
 * @property {string} status - Normalized status: "initiated" | "ringing" | "answered" | "completed" | "failed" | "no_answer"
 * @property {number|null} duration - Call duration in seconds, or null if not yet ended
 */

/**
 * @typedef {Object} VoiceFlowStep
 * @property {string} id - Unique step identifier within the flow
 * @property {"say"|"dtmf_question"|"goodbye"} type - Step type
 * @property {string} text - TTS text (may contain {{placeholders}})
 * @property {number} [timeout] - Seconds to wait for DTMF input (dtmf_question only)
 * @property {number} [maxDigits] - Maximum digits to collect (dtmf_question only)
 * @property {Object.<string, string>} [options] - DTMF digit → semantic value mapping (dtmf_question only)
 */

/**
 * Abstract base class for voice call providers.
 *
 * Concrete implementations translate the generic VoiceFlow domain model into
 * provider-specific API calls (IVR scripts, call flows, etc.).
 */
class VoiceProvider {
  /**
   * Initiates an outbound call for a given contact and voice flow.
   *
   * @param {InitiateCallParams} params - Call parameters
   * @returns {Promise<InitiateCallResult>} Normalized result with provider call ID and initial status
   * @throws {Error} If the provider API call fails
   */
  // eslint-disable-next-line no-unused-vars
  async initiateCall(params) {
    throw new Error('VoiceProvider.initiateCall() must be implemented by subclass');
  }

  /**
   * Retrieves the current status of a call by its provider-specific ID.
   *
   * @param {string} providerCallId - The provider's unique call identifier
   * @returns {Promise<CallStatusResult>} Normalized status and duration
   * @throws {Error} If the provider API call fails or call ID is not found
   */
  // eslint-disable-next-line no-unused-vars
  async getCallStatus(providerCallId) {
    throw new Error('VoiceProvider.getCallStatus() must be implemented by subclass');
  }

  /**
   * Builds the provider-specific API payload for a call.
   * Used internally by initiateCall(); may be useful for testing/inspection.
   *
   * @param {Object} contact - Contact record
   * @param {Object} flow - VoiceFlow record
   * @param {string} webhookUrl - Webhook URL for provider callbacks
   * @param {Object} [tenantMetadata] - Tenant-level metadata for TTS interpolation
   * @returns {Object} Provider-specific payload (structure varies by implementation)
   */
  // eslint-disable-next-line no-unused-vars
  buildCallPayload(contact, flow, webhookUrl, tenantMetadata) {
    throw new Error('VoiceProvider.buildCallPayload() must be implemented by subclass');
  }
}

module.exports = VoiceProvider;
