/**
 * routes/integrations.js — Integration waitlist API
 *
 * Owns: POST /api/integrations/waitlist (join waitlist for a specific integration),
 *       POST /api/integrations/request (free-text request for unlisted systems).
 * Does NOT own: page serving (/integrations HTML), auth, pool construction.
 */
const express = require('express');
const router = express.Router();
const { addToWaitlist } = require('../db/integration-waitlist');

// Known integration slugs (whitelist prevents arbitrary data insertion)
const VALID_SLUGS = new Set([
  'veson-imos', 'q88', 'dataloy', 'shipnet', 'oneocean',
  'marinetraffic', 'vesselfinder', 'spire-maritime',
  'slack', 'microsoft-teams', 'whatsapp',
  'other',
]);

/**
 * POST /api/integrations/waitlist
 * Body: { email, company_name?, integration_slug }
 */
router.post('/waitlist', async (req, res) => {
  const { email, company_name, integration_slug } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  if (!integration_slug || !VALID_SLUGS.has(integration_slug)) {
    return res.status(400).json({ error: 'invalid integration_slug' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  try {
    const pool = req.app.locals.pool;
    const { inserted } = await addToWaitlist(pool, { email, company_name, integration_slug });
    res.json({ ok: true, inserted });
  } catch (err) {
    console.error('[integrations/waitlist] error:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});

/**
 * POST /api/integrations/request
 * Body: { email, company_name?, system_name, notes? }
 * Stores as slug='other' with system_name folded into company_name field for simplicity.
 */
router.post('/request', async (req, res) => {
  const { email, company_name, system_name, notes } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  if (!system_name || typeof system_name !== 'string') {
    return res.status(400).json({ error: 'system_name is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  // Encode the requested system name in company_name for storage
  // Format: "<company> | Requested: <system_name> | Notes: <notes>"
  const parts = [];
  if (company_name) parts.push(company_name.trim());
  parts.push(`Requested: ${system_name.trim().slice(0, 200)}`);
  if (notes) parts.push(`Notes: ${notes.trim().slice(0, 500)}`);
  const companyField = parts.join(' | ');

  try {
    const pool = req.app.locals.pool;
    await addToWaitlist(pool, {
      email,
      company_name: companyField,
      integration_slug: 'other',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[integrations/request] error:', err.message);
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;
