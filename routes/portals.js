/**
 * Portals API — server-side reachability checks for authority login portals.
 * Owns: /api/portals/reachability (HEAD check + 60s in-memory cache per portal).
 * Does NOT own: portal credentials, filing submission, subscription gating.
 */
const express = require('express');
const http = require('http');
const https = require('https');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');

const router = express.Router();

// All 7 authority portals across 5 waterways (matches portals.html cards)
const PORTALS = {
  vumpa:   'https://serviceportal.pancanal.com/sp/faces/oracle/webcenter/portalapp/pages/public/login.jspx',
  pcsopep: 'https://pancanal.com/en/maritime-services/panama-maritime-single-windows-vumpa/',
  sca:     'https://www.suezcanal.gov.eg/English/Services/Pages/ETransitRequest.aspx',
  kegm:    'https://www.kiyiemniyeti.gov.tr/vessel_traffic_information_systems',
  mpa:     'https://digitalport.mpa.gov.sg/',
  jlm:     'https://jlm.enav.my/register',
  samsa:   'https://portal.samsa.com/login',
};

// In-memory cache: { [id]: { online, checkedAt } }
const cache = {};
const CACHE_TTL_MS = 60_000;

/**
 * Checks a single URL with a HEAD request (falls back to GET on 405).
 * Returns { online: boolean, statusCode: number|null, ms: number }.
 */
function probeUrl(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'HEAD',
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 CanalClear-PortalCheck/1.0',
        'Accept': '*/*',
      },
    };

    // Allow self-signed certs on government portals (common with older maritime authority sites)
    if (parsed.protocol === 'https:') {
      options.rejectUnauthorized = false;
    }

    const req = lib.request(options, (res) => {
      const ms = Date.now() - start;
      // Consume response body to free socket
      res.resume();
      // Any HTTP response = server is reachable (even 401, 403, 302)
      resolve({ online: true, statusCode: res.statusCode, ms });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ online: false, statusCode: null, ms: Date.now() - start });
    });

    req.on('error', (err) => {
      // ECONNREFUSED, ENOTFOUND, ETIMEDOUT → offline
      resolve({ online: false, statusCode: null, ms: Date.now() - start, error: err.code });
    });

    req.end();
  });
}

// GET /api/portals/reachability
// Returns live (or cached) reachability for all 8 portals.
// Requires auth or demo session.
router.get('/reachability', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  const now = Date.now();
  const results = {};
  const probes = [];

  for (const [id, url] of Object.entries(PORTALS)) {
    const cached = cache[id];
    if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
      results[id] = { online: cached.online, statusCode: cached.statusCode, cached: true, checkedAt: cached.checkedAt };
    } else {
      // Probe in parallel
      probes.push(
        probeUrl(url).then((r) => {
          cache[id] = { online: r.online, statusCode: r.statusCode, checkedAt: Date.now() };
          results[id] = { online: r.online, statusCode: r.statusCode, cached: false, checkedAt: Date.now() };
        })
      );
    }
  }

  if (probes.length > 0) {
    await Promise.all(probes);
  }

  res.json({ success: true, portals: results, checkedAt: new Date().toISOString() });
});

module.exports = router;
