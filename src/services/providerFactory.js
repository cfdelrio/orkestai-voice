/**
 * @fileoverview Provider factory.
 *
 * Given a ProviderConfig database record, instantiates and returns the
 * correct VoiceProvider implementation. This is the ONLY place in the
 * codebase that maps provider string names to concrete classes.
 *
 * To add a new provider:
 *   1. Implement a class that extends VoiceProvider (src/providers/<name>/<Name>VoiceProvider.js)
 *   2. Add a case for it in createProvider() below
 *   3. That's it — the rest of the system is already provider-agnostic
 */

const InfobipVoiceProvider = require('../providers/infobip/InfobipVoiceProvider');
const { createLogger } = require('../middleware/logger');

const logger = createLogger('ProviderFactory');

/**
 * Supported provider identifiers.
 * The string values match the `provider` column in the ProviderConfig table.
 */
const SUPPORTED_PROVIDERS = ['infobip'];

/**
 * Creates and returns a VoiceProvider instance for the given config.
 *
 * @param {Object} providerConfig - ProviderConfig record from the database
 * @param {string} providerConfig.provider   - Provider identifier (e.g. "infobip")
 * @param {string} providerConfig.apiKey     - Provider API key
 * @param {string} providerConfig.baseUrl    - Provider base URL
 * @param {string} providerConfig.fromNumber - Caller ID / sender number
 * @param {Object} [providerConfig.metadata] - Extra provider-specific config
 * @returns {import('../providers/VoiceProvider')} VoiceProvider instance
 * @throws {Error} If the provider type is unsupported
 */
function createProvider(providerConfig) {
  const { provider } = providerConfig;

  logger.debug(`Creating provider instance`, { provider, configId: providerConfig.id });

  switch (provider) {
    case 'infobip':
      return new InfobipVoiceProvider({
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        fromNumber: providerConfig.fromNumber,
        metadata: providerConfig.metadata || {},
      });

    // ─── Add new providers here ─────────────────────────────────────────────
    // case 'twilio':
    //   return new TwilioVoiceProvider({ ... });
    //
    // case 'amazon_connect':
    //   return new AmazonConnectVoiceProvider({ ... });
    // ────────────────────────────────────────────────────────────────────────

    default: {
      const err = new Error(
        `Unsupported voice provider: "${provider}". ` +
        `Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`
      );
      err.statusCode = 400;
      throw err;
    }
  }
}

module.exports = { createProvider, SUPPORTED_PROVIDERS };
