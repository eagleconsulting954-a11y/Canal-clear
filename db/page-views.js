/**
 * db/page-views.js — SQL query functions for page_views and analytics_events.
 *
 * Owns: page view inserts, analytics event inserts, admin analytics aggregation queries.
 * Does NOT own: bot detection, UTM extraction, or session management.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function insertPageView(pool, data) {
  const {
    page_path, referrer, ip_hash, user_agent, user_id, session_id,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, bot_flagged,
  } = data;
  return pool.query(
    `INSERT INTO page_views (page_path, referrer, ip_hash, user_agent, user_id, session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, bot_flagged)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [page_path, referrer, ip_hash, user_agent, user_id, session_id,
     utm_source, utm_medium, utm_campaign, utm_content, utm_term, bot_flagged]
  );
}

async function getDailyViews(pool, days) {
  const result = await pool.query(`
    SELECT DATE(created_at) AS day, COUNT(*) AS views
    FROM page_views
    WHERE bot_flagged = FALSE AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY day ORDER BY day DESC
  `, [days]);
  return result.rows;
}

async function getTopPages(pool, days) {
  const result = await pool.query(`
    SELECT page_path, COUNT(*) AS views
    FROM page_views
    WHERE bot_flagged = FALSE AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY page_path ORDER BY views DESC LIMIT 10
  `, [days]);
  return result.rows;
}

async function getTopReferrers(pool, days) {
  const result = await pool.query(`
    SELECT COALESCE(referrer, 'Direct / Unknown') AS referrer, COUNT(*) AS visits
    FROM page_views
    WHERE bot_flagged = FALSE AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY referrer ORDER BY visits DESC LIMIT 15
  `, [days]);
  return result.rows;
}

async function getTopEvents(pool, days) {
  const result = await pool.query(`
    SELECT event_type, COUNT(*) AS count
    FROM analytics_events
    WHERE bot_flagged = FALSE AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY event_type ORDER BY count DESC LIMIT 10
  `, [days]);
  return result.rows;
}

async function getFunnelData(pool, days) {
  const result = await pool.query(`
    SELECT page_path, COUNT(DISTINCT ip_hash) AS uniq_visitors
    FROM page_views
    WHERE bot_flagged = FALSE
      AND page_path IN ('/', '/pricing', '/login', '/welcome', '/app')
      AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY page_path
  `, [days]);
  return result.rows;
}

async function getUtmSources(pool, days) {
  const result = await pool.query(`
    SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS visits
    FROM page_views
    WHERE bot_flagged = FALSE
      AND utm_source IS NOT NULL
      AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY utm_source, utm_medium, utm_campaign
    ORDER BY visits DESC LIMIT 20
  `, [days]);
  return result.rows;
}

module.exports = {
  insertPageView,
  getDailyViews,
  getTopPages,
  getTopReferrers,
  getTopEvents,
  getFunnelData,
  getUtmSources,
};
