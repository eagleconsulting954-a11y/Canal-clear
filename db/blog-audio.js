/**
 * db/blog-audio.js — SQL query functions for blog_audio table.
 *
 * Owns: blog audio metadata and audio data lookups.
 * Does NOT own: TTS generation, R2 uploads, or route handling.
 *
 * Note: podcast-audio.js already has blog audio upsert functions.
 * This module provides the read-only lookups used by public-facing routes.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getBlogAudioBySlug(pool, slug) {
  const result = await pool.query(
    'SELECT audio_url, duration_s FROM blog_audio WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

async function getBlogAudioFileBySlug(pool, slug) {
  const result = await pool.query(
    'SELECT audio_data, content_type FROM blog_audio WHERE slug = $1 AND audio_data IS NOT NULL',
    [slug]
  );
  return result.rows[0] || null;
}

module.exports = {
  getBlogAudioBySlug,
  getBlogAudioFileBySlug,
};
