/**
 * @fileoverview Simple Mustache-style template engine for TTS text interpolation.
 *
 * Replaces `{{variableName}}` placeholders in text strings with values from
 * a variables map. Unknown placeholders are left unchanged so callers can
 * diagnose missing variables instead of silently dropping text.
 *
 * Supported variables (provided by callService when building payloads):
 *   {{firstName}}  - Contact's first name
 *   {{lastName}}   - Contact's last name (empty string if null)
 *   {{phone}}      - Contact's phone number
 *   {{brandName}}  - Tenant's brandName from tenant.metadata.brandName
 *
 * Example:
 *   interpolateTemplate('Hola {{firstName}}, te llama {{brandName}}.', {
 *     firstName: 'Juan',
 *     brandName: 'Prode Caballito',
 *   });
 *   // → 'Hola Juan, te llama Prode Caballito.'
 */

/**
 * Replaces all `{{key}}` occurrences in a template string with the
 * corresponding value from the variables object.
 *
 * @param {string} template  - Template string containing `{{placeholder}}` tokens
 * @param {Object.<string, string>} variables - Map of variable names to values
 * @returns {string} Resolved string with placeholders replaced
 */
function interpolateTemplate(template, variables) {
  if (typeof template !== 'string') {
    return String(template ?? '');
  }

  // Replace each {{key}} with the corresponding value, or leave it as-is
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const value = variables[key];
      // Coerce null/undefined to empty string to avoid "null" in TTS output
      return value == null ? '' : String(value);
    }
    // Unknown placeholder — leave unchanged so caller can detect it
    return match;
  });
}

module.exports = { interpolateTemplate };
