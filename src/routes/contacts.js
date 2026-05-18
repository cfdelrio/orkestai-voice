/**
 * @fileoverview Contact routes.
 *
 * POST /api/tenants/:tenantId/contacts   - Create a contact
 * GET  /api/tenants/:tenantId/contacts   - List contacts for a tenant
 * GET  /api/tenants/:tenantId/contacts/:contactId - Get single contact
 */

const { Router } = require('express');
const { asyncHandler, badRequest } = require('../middleware/errorHandler');
const contactService = require('../services/contactService');

const router = Router({ mergeParams: true });

/**
 * POST /api/tenants/:tenantId/contacts
 * Creates a new contact for a tenant.
 *
 * Body: { firstName, lastName?, phone, email?, metadata? }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { firstName, lastName, phone, email, metadata } = req.body;

  if (!firstName || typeof firstName !== 'string') {
    throw badRequest('"firstName" is required');
  }
  if (!phone || typeof phone !== 'string') {
    throw badRequest('"phone" is required (E.164 format, e.g. "+5491122334455")');
  }

  const contact = await contactService.createContact(tenantId, {
    firstName,
    lastName: lastName || null,
    phone,
    email: email || null,
    metadata: metadata || {},
  });

  res.status(201).json({ contact });
}));

/**
 * GET /api/tenants/:tenantId/contacts
 * Lists all contacts for a tenant.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const contacts = await contactService.listContacts(tenantId);
  res.json({ contacts, count: contacts.length });
}));

/**
 * GET /api/tenants/:tenantId/contacts/:contactId
 * Returns a single contact by ID.
 */
router.get('/:contactId', asyncHandler(async (req, res) => {
  const { tenantId, contactId } = req.params;
  const contact = await contactService.getContactById(tenantId, contactId);
  res.json({ contact });
}));

/**
 * DELETE /api/tenants/:tenantId/contacts/:contactId
 * Deletes a contact (only if not linked to any campaign).
 */
router.delete('/:contactId', asyncHandler(async (req, res) => {
  const { tenantId, contactId } = req.params;
  const result = await contactService.deleteContact(tenantId, contactId);
  res.json(result);
}));

module.exports = router;
