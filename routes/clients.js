/**
 * routes/clients.js — Client/Principal workspace management API
 *
 * Owns: CRUD for client profiles, vessel/voyage-to-client assignment, filing count summaries.
 * Does NOT own: auth logic (middleware/auth), pool construction (server.js), filing CRUD (routes/api.js).
 *
 * All routes require authentication. Billing stays at the agent account level (not per-client).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db/clients');
const { checkClientOwnership, assignVesselToClient } = require('../db/vessels');

// ── List all clients for the authenticated user ───────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const clients = await db.listClients(req.app.locals.pool, req.user.id);
    res.json({ success: true, clients });
  } catch (err) {
    console.error('[clients] list error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load clients' });
  }
});

// ── Get filing counts per client (dashboard summary) ─────────────────────────
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const summary = await db.getFilingCountsByClient(req.app.locals.pool, req.user.id);
    res.json({ success: true, summary });
  } catch (err) {
    console.error('[clients] summary error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load summary' });
  }
});

// ── Get single client ─────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const client = await db.getClientById(req.app.locals.pool, req.params.id, req.user.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, client });
  } catch (err) {
    console.error('[clients] get error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load client' });
  }
});

// ── Create a client ───────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { name, short_name, contact_name, contact_email, contact_phone, notes, color } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Client name is required' });
  }

  try {
    const client = await db.createClient(req.app.locals.pool, req.user.id, {
      name: name.trim(),
      short_name: short_name?.trim() || null,
      contact_name: contact_name?.trim() || null,
      contact_email: contact_email?.trim() || null,
      contact_phone: contact_phone?.trim() || null,
      notes: notes?.trim() || null,
      color: color || '#4A90E2',
    });
    res.json({ success: true, client });
  } catch (err) {
    console.error('[clients] create error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create client' });
  }
});

// ── Update a client ───────────────────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, short_name, contact_name, contact_email, contact_phone, notes, color } = req.body;

  try {
    const client = await db.updateClient(req.app.locals.pool, req.params.id, req.user.id, {
      name: name?.trim() || null,
      short_name: short_name?.trim() || null,
      contact_name: contact_name?.trim() || null,
      contact_email: contact_email?.trim() || null,
      contact_phone: contact_phone?.trim() || null,
      notes: notes?.trim() || null,
      color: color || null,
    });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, client });
  } catch (err) {
    console.error('[clients] update error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update client' });
  }
});

// ── Delete a client (soft) ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteClient(req.app.locals.pool, req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Client not found or cannot delete default client' });
    }
    res.json({ success: true, message: `Client "${deleted.name}" deleted` });
  } catch (err) {
    console.error('[clients] delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete client' });
  }
});

// ── Assign a filing to a client ───────────────────────────────────────────────
router.post('/assign/filing/:filingId', requireAuth, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ success: false, message: 'client_id required' });

  try {
    const result = await db.assignFilingToClient(
      req.app.locals.pool, req.params.filingId, client_id, req.user.id
    );
    if (!result) return res.status(404).json({ success: false, message: 'Filing or client not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[clients] assign filing error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to assign filing' });
  }
});

// ── Assign a vessel to a client ───────────────────────────────────────────────
router.post('/assign/vessel/:vesselId', requireAuth, async (req, res) => {
  const { client_id } = req.body;
  const pool = req.app.locals.pool;
  const userId = req.user.id;

  // client_id = null means unassign
  if (client_id !== null && client_id !== undefined) {
    const existing = await checkClientOwnership(pool, client_id, userId);
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });
  }

  try {
    const result = await assignVesselToClient(pool, req.params.vesselId, client_id || null, userId);
    if (!result) return res.status(404).json({ success: false, message: 'Vessel not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[clients] assign vessel error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to assign vessel' });
  }
});

// ── Assign a voyage to a client ───────────────────────────────────────────────
router.post('/assign/voyage/:voyageId', requireAuth, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ success: false, message: 'client_id required' });

  try {
    const result = await db.assignVoyageToClient(
      req.app.locals.pool, req.params.voyageId, client_id, req.user.id
    );
    if (!result) return res.status(404).json({ success: false, message: 'Voyage or client not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[clients] assign voyage error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to assign voyage' });
  }
});

module.exports = router;
