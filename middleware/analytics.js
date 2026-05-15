/**
 * Analytics middleware — bot detection, IP hashing, UTM extraction, page view tracking.
 * Owns: anonymous session tracking, page view inserts, bot filtering.
 * Does NOT own: event tracking (handled by routes/api.js), admin analytics queries.
 */
const crypto = require('crypto');
const { insertPageView } = require('../db/page-views');

const BOT_UA_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
  /yandexbot/i, /sogou/i, /exabot/i, /facebot/i, /ia_archiver/i,
  /gptbot/i, /chatgpt/i, /anthropic/i, /claudebot/i,
  /render-healthcheck/i, /curl\//i, /wget\//i, /python-requests/i,
  /node-fetch/i, /axios\//i, /got\//i, /undici\//i,
  /lighthouse/i, /pagespeed/i, /gtmetrix/i, /pingdom/i,
  /uptimerobot/i, /statuscake/i,
];

function isBotUA(ua) {
  if (!ua) return true;
  return BOT_UA_PATTERNS.some(p => p.test(ua));
}

/**
 * Daily salted IP hash — same visitor = same hash within a day,
 * different day = different hash. No raw IP stored.
 */
function dailyIpHash(ip) {
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT || 'canalclear-analytics-salt';
  return crypto.createHash('sha256').update(`${salt}:${day}:${ip}`).digest('hex').slice(0, 16);
}

function extractUtm(query) {
  return {
    utm_source:   query.utm_source   || null,
    utm_medium:   query.utm_medium   || null,
    utm_campaign: query.utm_campaign || null,
    utm_content:  query.utm_content  || null,
    utm_term:     query.utm_term     || null,
  };
}

/**
 * Optionally extract user_id from JWT cookie without requiring auth.
 * Returns user id (number) or null if no valid token.
 */
function optionalUserId(req) {
  try {
    const token = (req.cookies && req.cookies.cc_token) || null;
    if (!token) return null;
    const jwtLib = require('jsonwebtoken');
    const { JWT_SECRET } = require('./auth');
    const decoded = jwtLib.verify(token, JWT_SECRET);
    return decoded && decoded.id ? decoded.id : null;
  } catch (_) {
    return null;
  }
}

const HTML_PAGE_PATHS = ['/', '/pricing', '/login', '/welcome', '/app', '/filing', '/acp', '/blog', '/demo', '/demo/panama', '/demo/suez', '/demo/dashboard', '/podcast', '/knowledge-base', '/about', '/compliance-guide', '/compliance-score', '/hazmat', '/guide', '/compare', '/funnel', '/funnel/solution', '/funnel/roi', '/funnel/pricing', '/glossary', '/compliance', '/panama', '/suez', '/suez-calculator', '/suez/convoy', '/suez/notifications'];

function isTrackedPage(p) {
  if (HTML_PAGE_PATHS.includes(p)) return true;
  if (p.startsWith('/blog/') || p.startsWith('/podcast/')) return true;
  if (p.startsWith('/funnel')) return true;
  if (p === '/glossary' || p.startsWith('/compliance/')) return true;
  return false;
}

function trackPageView(req, res, next) {
  if (!isTrackedPage(req.path)) return next();

  const pool = req.app.locals.pool;
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
  const referrer = req.headers['referer'] || req.headers['referrer'] || null;
  const botFlagged = isBotUA(ua);
  const ipHash = dailyIpHash(ip);
  const utm = extractUtm(req.query);
  const userId = optionalUserId(req);

  const hasUtm = utm.utm_source || utm.utm_medium || utm.utm_campaign;
  if (hasUtm) {
    try {
      const utmJson = JSON.stringify(utm);
      res.cookie('cc_utm', utmJson, { maxAge: 30 * 60 * 1000, httpOnly: false, sameSite: 'Lax', path: '/' });
    } catch (_) { /* ignore cookie errors */ }
  }

  const sessionId = (req.cookies && req.cookies.cc_sid) || null;

  // Fire-and-forget: never block the response
  insertPageView(pool, {
    page_path: req.path, referrer, ip_hash: ipHash, user_agent: ua.slice(0, 500),
    user_id: userId, session_id: sessionId,
    utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
    utm_content: utm.utm_content, utm_term: utm.utm_term, bot_flagged: botFlagged,
  }).catch(err => console.error('[Analytics] page_view insert error:', err.message));

  next();
}

module.exports = { trackPageView, isBotUA, dailyIpHash, extractUtm };
