/**
 * db/chat-analytics.js — SQL query functions for chat_analytics table.
 *
 * Owns: chat event recording and admin stats aggregation.
 * Does NOT own: chatbot AI logic, session management, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function recordChatEvent(pool, { eventType, sessionId, pagePath, properties, ipHash }) {
  return pool.query(
    `INSERT INTO chat_analytics (event_type, session_id, page_path, properties, ip_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [eventType, sessionId || null, pagePath || null, JSON.stringify(properties || {}), ipHash]
  );
}

async function getChatStats(pool) {
  const result = await pool.query(`
    SELECT
      event_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS last_7d,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h
    FROM chat_analytics
    GROUP BY event_type
    ORDER BY total DESC
  `);
  return result.rows;
}

module.exports = {
  recordChatEvent,
  getChatStats,
};
