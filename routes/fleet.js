/**
 * routes/fleet.js — Fleet Tracking API + Fleet Dashboard
 *
 * Owns: /api/fleet/dashboard, /api/ais/positions, /api/ais/vessel/:imo/track, /api/ais/geofences
 * Does NOT own: authentication (middleware/auth), filing status (routes/api.js),
 *               vessel/certificate CRUD (routes/api.js), client management (routes/clients.js)
 *
 * Endpoints:
 *   GET  /api/fleet/dashboard         — vessel list + cert compliance + summary (with client_id filter)
 *   GET  /api/ais/positions           — current vessel positions for fleet map
 *   GET  /api/ais/vessel/:imo/track   — last 72h track history for a vessel
 *   GET  /api/ais/geofences           — canal alert zone definitions (radii + centres)
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getFleetDashboard } = require('../db/vessels');

// ── GET /dashboard — fleet compliance dashboard with optional client_id filter ─
router.get('/dashboard', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const clientId = req.query.client_id ? parseInt(req.query.client_id, 10) : null;

  try {
    const vessels = await getFleetDashboard(req.app.locals.pool, userId, clientId);

    // Score each vessel
    const scored = vessels.map(v => {
      const certs = v.certificates_raw || [];
      const expired   = certs.filter(c => c.days_left !== null && c.days_left <= 0).length;
      const urgent    = certs.filter(c => c.days_left !== null && c.days_left > 0 && c.days_left <= 7).length;
      const expiring  = certs.filter(c => c.days_left !== null && c.days_left > 7 && c.days_left <= 30).length;

      let badge = 'green';
      if (expired > 0 || urgent > 0) badge = 'red';
      else if (expiring > 0 || certs.length === 0) badge = 'yellow';

      return {
        id:               v.id,
        name:             v.name,
        imo:              v.imo,
        flag:             v.flag,
        type:             v.type,
        class_society:    v.class_society,
        client_id:        v.client_id,
        compliance_badge: badge,
        certificates:     certs,
      };
    });

    const total        = scored.length;
    const compliant    = scored.filter(v => v.compliance_badge === 'green').length;
    const expiring_soon = scored.filter(v => v.compliance_badge === 'yellow').length;
    const expired      = scored.filter(v => v.compliance_badge === 'red').length;

    res.json({ success: true, vessels: scored, summary: { total, compliant, expiring_soon, expired } });
  } catch (err) {
    console.error('[fleet/dashboard] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Static mock data — realistic positions near the 5 canal chokepoints.
// Replace with live AIS feed (MarineTraffic / Spire) when integration ships.
// ─────────────────────────────────────────────────────────────────────────────

const CANALS = {
  panama:   { name: 'Panama Canal',      lat:  9.0675,  lng: -79.6842 },
  suez:     { name: 'Suez Canal',        lat: 30.5234,  lng:  32.3001 },
  bosporus: { name: 'Bosporus Strait',   lat: 41.1200,  lng:  29.0690 },
  malacca:  { name: 'Strait of Malacca', lat:  2.8000,  lng: 101.6000 },
  cape:     { name: 'Cape of Good Hope', lat: -34.2090, lng:  18.4649 },
};

// Geofence rings: 96h / 48h / 24h / 6h at ~20kt ship speed
// Distances are approximate degrees of lat/lng (1° ≈ 111km; 20kt ≈ 37km/h)
const GEOFENCE_RINGS = [
  { hours: 96, radiusKm: 3552, radiusDeg: 24.0, color: '#4CAF50' }, // green
  { hours: 48, radiusKm: 1776, radiusDeg: 12.0, color: '#FFD93D' }, // yellow
  { hours: 24, radiusKm:  888, radiusDeg:  6.0, color: '#FF9800' }, // amber
  { hours:  6, radiusKm:  222, radiusDeg:  1.5, color: '#FF6B6B' }, // red
];

// Mock fleet vessels — positions that tell a real story around the 5 chokepoints
const MOCK_VESSELS = [
  // Panama Canal approaches
  {
    imo: '9234567', name: 'MV Horizonte Azul', type: 'Container',
    lat: 9.341, lng: -79.901, speed: 11.2, heading: 142,
    status: 'approaching', nearestCanal: 'panama',
    etaHours: 18, filingStatus: 'compliant',
    flag: '🇵🇦', dwt: 62400, beam: 32.2, loa: 215,
    track: [
      [9.89, -80.42], [9.71, -80.21], [9.55, -80.08], [9.44, -79.99], [9.341, -79.901]
    ]
  },
  {
    imo: '9345678', name: 'MV Pacific Star', type: 'Bulk Carrier',
    lat: 8.622, lng: -79.451, speed: 0.3, heading: 0,
    status: 'transiting', nearestCanal: 'panama',
    etaHours: 0, filingStatus: 'compliant',
    flag: '🇧🇸', dwt: 78200, beam: 32.3, loa: 229,
    track: [
      [9.11, -79.78], [8.98, -79.70], [8.85, -79.63], [8.73, -79.55], [8.622, -79.451]
    ]
  },
  // Suez Canal approaches
  {
    imo: '9456789', name: 'MT Nile Meridian', type: 'Tanker',
    lat: 29.391, lng: 32.841, speed: 14.8, heading: 10,
    status: 'approaching', nearestCanal: 'suez',
    etaHours: 8, filingStatus: 'pending',
    flag: '🇬🇷', dwt: 105000, beam: 43.8, loa: 274,
    track: [
      [27.12, 33.88], [27.64, 33.60], [28.21, 33.32], [28.89, 33.04], [29.391, 32.841]
    ]
  },
  {
    imo: '9567890', name: 'MV Desert Wind', type: 'RoRo',
    lat: 32.102, lng: 32.041, speed: 13.1, heading: 355,
    status: 'approaching', nearestCanal: 'suez',
    etaHours: 36, filingStatus: 'overdue',
    flag: '🇨🇾', dwt: 24800, beam: 28.0, loa: 200,
    track: [
      [34.81, 31.22], [34.21, 31.48], [33.61, 31.64], [32.89, 31.84], [32.102, 32.041]
    ]
  },
  // Bosporus approaches
  {
    imo: '9678901', name: 'MV Aegean Glory', type: 'Chemical Tanker',
    lat: 40.721, lng: 28.891, speed: 9.4, heading: 22,
    status: 'approaching', nearestCanal: 'bosporus',
    etaHours: 14, filingStatus: 'compliant',
    flag: '🇲🇹', dwt: 19200, beam: 24.0, loa: 170,
    track: [
      [39.98, 26.21], [40.12, 26.89], [40.31, 27.61], [40.52, 28.24], [40.721, 28.891]
    ]
  },
  // Malacca approaches
  {
    imo: '9789012', name: 'MV Eastern Promise', type: 'VLCC',
    lat: 1.641, lng: 103.921, speed: 16.2, heading: 295,
    status: 'approaching', nearestCanal: 'malacca',
    etaHours: 12, filingStatus: 'compliant',
    flag: '🇸🇬', dwt: 310000, beam: 60.0, loa: 333,
    track: [
      [1.21, 106.88], [1.29, 106.21], [1.38, 105.52], [1.48, 104.72], [1.641, 103.921]
    ]
  },
  {
    imo: '9890123', name: 'MV Malacca Trader', type: 'Container',
    lat: 4.218, lng: 100.231, speed: 0.5, heading: 0,
    status: 'transiting', nearestCanal: 'malacca',
    etaHours: 0, filingStatus: 'compliant',
    flag: '🇲🇾', dwt: 48600, beam: 32.0, loa: 294,
    track: [
      [3.89, 102.41], [3.71, 101.89], [3.51, 101.32], [3.88, 100.81], [4.218, 100.231]
    ]
  },
  // Cape of Good Hope approaches
  {
    imo: '9901234', name: 'MV Cape Sovereign', type: 'Bulk Carrier',
    lat: -32.418, lng: 17.231, speed: 12.8, heading: 195,
    status: 'approaching', nearestCanal: 'cape',
    etaHours: 28, filingStatus: 'pending',
    flag: '🇿🇦', dwt: 92000, beam: 42.0, loa: 250,
    track: [
      [-30.12, 14.88], [-30.88, 15.41], [-31.48, 16.11], [-32.01, 16.71], [-32.418, 17.231]
    ]
  },
  // Pacific — clear vessel
  {
    imo: '9012345', name: 'MV Transpacific Ace', type: 'Car Carrier',
    lat: 15.821, lng: -130.441, speed: 18.3, heading: 265,
    status: 'clear', nearestCanal: 'panama',
    etaHours: 96, filingStatus: 'compliant',
    flag: '🇯🇵', dwt: 21000, beam: 32.5, loa: 200,
    track: [
      [15.99, -125.81], [15.96, -126.88], [15.92, -128.01], [15.87, -129.24], [15.821, -130.441]
    ]
  },
  // Indian Ocean
  {
    imo: '9123456', name: 'MV Indian Spirit', type: 'LNG Carrier',
    lat: 8.341, lng: 68.921, speed: 14.9, heading: 290,
    status: 'approaching', nearestCanal: 'suez',
    etaHours: 72, filingStatus: 'compliant',
    flag: '🇮🇳', dwt: 84000, beam: 43.4, loa: 277,
    track: [
      [8.11, 72.88], [8.16, 72.12], [8.21, 71.41], [8.28, 70.22], [8.341, 68.921]
    ]
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ais/positions — all vessel positions + status (no auth — demo-safe)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/positions', (req, res) => {
  // Add slight random drift to simulate live feed on repeated polls
  const vessels = MOCK_VESSELS.map(v => {
    // Only drift actively-moving vessels
    const drift = v.speed > 2 ? 0.008 : 0;
    const headingRad = (v.heading * Math.PI) / 180;
    return {
      imo:          v.imo,
      name:         v.name,
      type:         v.type,
      lat:          +(v.lat + Math.sin(headingRad) * drift * (Math.random() * 0.5 + 0.5)).toFixed(5),
      lng:          +(v.lng + Math.cos(headingRad) * drift * (Math.random() * 0.5 + 0.5)).toFixed(5),
      speed:        +(v.speed + (Math.random() * 0.4 - 0.2)).toFixed(1),
      heading:      Math.round(v.heading + (Math.random() * 4 - 2)),
      status:       v.status,
      nearestCanal: v.nearestCanal,
      etaHours:     v.etaHours,
      filingStatus: v.filingStatus,
      flag:         v.flag,
      dwt:          v.dwt,
      loa:          v.loa,
      beam:         v.beam,
      updatedAt:    new Date().toISOString(),
    };
  });

  // Sort by urgency: overdue first, then pending, then approaching, then clear
  const urgency = { overdue: 0, pending: 1, approaching: 2, transiting: 3, clear: 4 };
  vessels.sort((a, b) => {
    const ua = urgency[a.filingStatus] ?? 5;
    const ub = urgency[b.filingStatus] ?? 5;
    if (ua !== ub) return ua - ub;
    return a.etaHours - b.etaHours;
  });

  res.json({ success: true, vessels, updatedAt: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ais/vessel/:imo/track — last 72h track history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/vessel/:imo/track', (req, res) => {
  const vessel = MOCK_VESSELS.find(v => v.imo === req.params.imo);
  if (!vessel) {
    return res.status(404).json({ success: false, message: 'Vessel not found' });
  }
  // Return track as array of [lat, lng, timestamp] tuples
  const now = Date.now();
  const trackWithTime = vessel.track.map((point, i) => ({
    lat: point[0],
    lng: point[1],
    ts: new Date(now - (vessel.track.length - 1 - i) * 14 * 60 * 60 * 1000).toISOString(),
  }));
  res.json({ success: true, imo: vessel.imo, name: vessel.name, track: trackWithTime });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ais/geofences — canal alert zone definitions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/geofences', (req, res) => {
  const zones = Object.entries(CANALS).map(([key, canal]) => ({
    id:    key,
    name:  canal.name,
    lat:   canal.lat,
    lng:   canal.lng,
    rings: GEOFENCE_RINGS.map(r => ({
      hours:     r.hours,
      radiusKm:  r.radiusKm,
      color:     r.color,
    })),
  }));
  res.json({ success: true, zones });
});

module.exports = router;
