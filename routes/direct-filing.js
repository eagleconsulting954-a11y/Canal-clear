/**
 * routes/direct-filing.js — Direct Authority Filing waitlist API.
 * Owns: POST /api/direct-filing/waitlist — capture waitlist signups with authority preferences.
 * Does NOT own: DB pool construction (server.js), email delivery (routes/api.js drip logic).
 */
const express = require('express');
const { addWaitlistEntry, getWaitlistCount } = require('../db/direct-filing-waitlist');

const router = express.Router();

const VALID_AUTHORITIES = new Set([
  'panama_vuce',
  'suez_sca',
  'turkish_vts',
  'singapore_mpa',
  'samsa_za',
]);

router.post('/waitlist', async (req, res) => {
  const pool = req.app.locals.pool;
  const { email, company_name, fleet_size, authorities, comment } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Validate authority keys against known set
  const sanitisedAuthorities = Array.isArray(authorities)
    ? authorities.filter(a => VALID_AUTHORITIES.has(a))
    : [];

  try {
    const entry = await addWaitlistEntry(pool, {
      email,
      companyName: company_name,
      fleetSize: fleet_size,
      authorities: sanitisedAuthorities,
      comment,
    });

    return res.json({ success: true, id: entry.id });
  } catch (err) {
    console.error('[direct-filing] waitlist insert error:', err.message);
    return res.status(500).json({ error: 'Failed to save signup — please try again.' });
  }
});

// Public count endpoint so the page can show live waitlist size
router.get('/waitlist/count', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const count = await getWaitlistCount(pool);
    return res.json({ count });
  } catch {
    return res.json({ count: 0 });
  }
});

module.exports = router;
