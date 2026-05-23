/**
 * @fileoverview Contact service — business logic for contact management.
 */

const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');
const { notFound, badRequest } = require('../middleware/errorHandler');
const { getTenantById } = require('./tenantService');

const prisma = new PrismaClient();
const logger = createLogger('ContactService');

/**
 * E.164 phone number validation regex.
 * Matches: +<country_code><number> with 7-15 digits total.
 */
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Creates a new contact for a tenant.
 *
 * @param {string} tenantId
 * @param {Object} data
 * @param {string} data.firstName
 * @param {string} [data.lastName]
 * @param {string} data.phone      - Must be in E.164 format (+5491122334455)
 * @param {string} [data.email]
 * @param {Object} [data.metadata]
 * @returns {Promise<Object>} Created contact record
 */
async function createContact(tenantId, { firstName, lastName, phone, email, metadata = {} }) {
  // Validate tenant exists
  await getTenantById(tenantId);

  if (!firstName || !firstName.trim()) {
    throw badRequest('firstName is required');
  }

  if (!phone || !phone.trim()) {
    throw badRequest('phone is required');
  }

  if (!E164_REGEX.test(phone)) {
    throw badRequest(
      `Invalid phone number "${phone}". Must be in E.164 format (e.g. +5491122334455)`
    );
  }

  logger.info(`Creating contact`, { tenantId, phone });

  const contact = await prisma.contact.create({
    data: {
      tenantId,
      firstName: firstName.trim(),
      lastName: lastName?.trim() || null,
      phone,
      email: email?.trim() || null,
      metadata,
    },
  });

  logger.info(`Contact created`, { id: contact.id, tenantId });
  return contact;
}

/**
 * Lists all contacts for a tenant.
 *
 * @param {string} tenantId
 * @returns {Promise<Object[]>}
 */
async function listContacts(tenantId) {
  await getTenantById(tenantId);

  return prisma.contact.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Finds a contact by ID within a tenant. Throws 404 if not found.
 *
 * @param {string} tenantId
 * @param {string} contactId
 * @returns {Promise<Object>}
 */
async function getContactById(tenantId, contactId) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
  });

  if (!contact) {
    throw notFound('Contact', contactId);
  }

  return contact;
}

/**
 * Verifies that all given contactIds belong to the tenant.
 * Returns the valid contacts.
 *
 * @param {string} tenantId
 * @param {string[]} contactIds
 * @returns {Promise<Object[]>} Array of contact records
 * @throws {Error} 400 if any contact ID does not belong to the tenant
 */
async function validateContactsForTenant(tenantId, contactIds) {
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, tenantId },
  });

  const foundIds = new Set(contacts.map((c) => c.id));
  const missing = contactIds.filter((id) => !foundIds.has(id));

  if (missing.length > 0) {
    throw badRequest(
      `The following contact IDs do not exist or do not belong to this tenant: ${missing.join(', ')}`
    );
  }

  return contacts;
}

/**
 * Updates a contact's editable fields.
 *
 * @param {string} tenantId
 * @param {string} contactId
 * @param {Object} data
 */
async function updateContact(tenantId, contactId, { firstName, lastName, phone, email }) {
  await getContactById(tenantId, contactId);

  const updateData = {};

  if (firstName !== undefined) {
    if (!firstName.trim()) throw badRequest('firstName no puede estar vacío');
    updateData.firstName = firstName.trim();
  }
  if (lastName !== undefined) updateData.lastName = lastName?.trim() || null;
  if (phone !== undefined) {
    if (!E164_REGEX.test(phone)) {
      throw badRequest(`Teléfono inválido "${phone}". Formato E.164 requerido (ej: +5491122334455)`);
    }
    updateData.phone = phone;
  }
  if (email !== undefined) updateData.email = email?.trim() || null;

  if (Object.keys(updateData).length === 0) return getContactById(tenantId, contactId);

  const contact = await prisma.contact.update({ where: { id: contactId }, data: updateData });
  logger.info('Contact updated', { contactId, tenantId });
  return contact;
}


 *
 * @param {string} tenantId
 * @param {string} contactId
 */
async function deleteContact(tenantId, contactId) {
  await getContactById(tenantId, contactId);

  const recipientCount = await prisma.campaignRecipient.count({ where: { contactId } });
  if (recipientCount > 0) {
    throw badRequest(`El contacto está en ${recipientCount} campaña${recipientCount !== 1 ? 's' : ''} y no puede borrarse`);
  }

  await prisma.contact.delete({ where: { id: contactId } });
  logger.info('Contact deleted', { contactId, tenantId });
  return { deleted: true };
}

module.exports = {
  createContact,
  listContacts,
  getContactById,
  validateContactsForTenant,
  updateContact,
  deleteContact,
};
