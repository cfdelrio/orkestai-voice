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
 * Extracts all unique variable names referenced in a template string.
 *
 * Only handles simple `{{varName}}` tokens — not Handlebars block helpers
 * ({{#if}}, {{/if}}, etc.). For dot-notation like `{{user.name}}` the root
 * key (`user`) is returned so callers can check top-level context membership.
 *
 * @param {string} template
 * @returns {string[]} Deduplicated list of variable names found in the template
 */
function extractTemplateVars(template) {
  if (typeof template !== 'string') return [];
  const regex = /\{\{(\w[\w.]*)\}\}/g;
  const vars = new Set();
  let match;
  while ((match = regex.exec(template)) !== null) {
    // For dot-notation take only the root key: "user.firstName" → "user"
    const root = match[1].split('.')[0];
    vars.add(root);
  }
  return [...vars];
}

/**
 * Returns the list of variable names that appear in `template` but are absent
 * from `context`. An empty array means all variables are satisfied.
 *
 * @param {string} template
 * @param {Object} context - Variables map passed to interpolateTemplate
 * @returns {string[]} Names of missing variables
 */
function validateTemplateVars(template, context) {
  const required = extractTemplateVars(template);
  return required.filter((v) => !Object.prototype.hasOwnProperty.call(context, v));
}

/**
 * Replaces all `{{key}}` occurrences in a template string with the
 * corresponding value from the variables object.
 *
 * Before rendering, detects any placeholders that are absent from `variables`
 * and logs an error so operators can catch misconfigured campaign scripts
 * before the TTS engine reads a literal `{{missingVar}}` to the caller.
 *
 * @param {string} template  - Template string containing `{{placeholder}}` tokens
 * @param {Object.<string, string>} variables - Map of variable names to values
 * @returns {string} Resolved string with placeholders replaced
 */
function interpolateTemplate(template, variables) {
  if (typeof template !== 'string') {
    return String(template ?? '');
  }

  // Detect missing variables before rendering to give operators an actionable error
  const missing = validateTemplateVars(template, variables);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[template] Missing variables in voice script:', {
      missing,
      availableKeys: Object.keys(variables),
    });
    // Continue rendering — leaving the raw {{placeholder}} is better than
    // silently dropping text, and the error above allows operators to fix it.
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

module.exports = { interpolateTemplate, extractTemplateVars, validateTemplateVars };
