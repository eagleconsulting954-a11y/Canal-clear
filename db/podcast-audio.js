/**
 * db/podcast-audio.js — SQL query functions for podcast_audio and blog_audio tables.
 *
 * Owns: all read/write queries for audio content storage (podcast episodes + blog narration).
 * Does NOT own: audio generation (TTS), RSS feed rendering, or file serving logic.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

// ── Podcast Audio ────────────────────────────────────────────────────────────

async function getPodcastAudioBySlug(pool, slug) {
  const result = await pool.query(
    'SELECT slug, audio_url, duration_s, octet_length(audio_data) AS file_bytes FROM podcast_audio WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

async function getPodcastAudioMap(pool) {
  const result = await pool.query(
    'SELECT slug, audio_url, duration_s, octet_length(audio_data) AS file_bytes FROM podcast_audio'
  );
  const map = {};
  result.rows.forEach(r => { map[r.slug] = r; });
  return map;
}

async function getExistingPodcastSlugs(pool) {
  const result = await pool.query('SELECT slug FROM podcast_audio');
  return result.rows.map(r => r.slug);
}

async function upsertPodcastAudioData(pool, slug, audioUrl, audioData) {
  return pool.query(
    `INSERT INTO podcast_audio (slug, audio_url, audio_data, voice, updated_at)
     VALUES ($1, $2, $3, 'onyx', NOW())
     ON CONFLICT (slug) DO UPDATE SET audio_url = $2, audio_data = $3, updated_at = NOW()`,
    [slug, audioUrl, audioData]
  );
}

async function upsertPodcastAudioUrl(pool, slug, audioUrl) {
  return pool.query(
    `INSERT INTO podcast_audio (slug, audio_url, voice, updated_at)
     VALUES ($1, $2, 'onyx', NOW())
     ON CONFLICT (slug) DO UPDATE SET audio_url = $2, updated_at = NOW()`,
    [slug, audioUrl]
  );
}

async function getPodcastAudioMetadata(pool, slug) {
  const result = await pool.query(
    'SELECT audio_url, duration_s FROM podcast_audio WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

async function getPodcastAudioData(pool, slug) {
  const result = await pool.query(
    'SELECT audio_data, content_type FROM podcast_audio WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

// ── Blog Audio ───────────────────────────────────────────────────────────────

async function getExistingBlogSlugs(pool) {
  const result = await pool.query('SELECT slug FROM blog_audio');
  return result.rows.map(r => r.slug);
}

async function upsertBlogAudioData(pool, slug, audioUrl, audioData) {
  return pool.query(
    `INSERT INTO blog_audio (slug, audio_url, audio_data, voice, updated_at)
     VALUES ($1, $2, $3, 'onyx', NOW())
     ON CONFLICT (slug) DO UPDATE SET audio_url = $2, audio_data = $3, updated_at = NOW()`,
    [slug, audioUrl, audioData]
  );
}

async function upsertBlogAudioUrl(pool, slug, audioUrl) {
  return pool.query(
    `INSERT INTO blog_audio (slug, audio_url, voice, updated_at)
     VALUES ($1, $2, 'onyx', NOW())
     ON CONFLICT (slug) DO UPDATE SET audio_url = $2, updated_at = NOW()`,
    [slug, audioUrl]
  );
}

async function getBlogAudioMetadata(pool, slug) {
  const result = await pool.query(
    'SELECT audio_url, duration_s FROM blog_audio WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

async function getBlogAudioData(pool, slug) {
  const result = await pool.query(
    'SELECT audio_data, content_type FROM blog_audio WHERE slug = $1',
    [slug]
  );
  return result.rows[0] || null;
}

module.exports = {
  getPodcastAudioBySlug,
  getPodcastAudioMap,
  getExistingPodcastSlugs,
  upsertPodcastAudioData,
  upsertPodcastAudioUrl,
  getPodcastAudioMetadata,
  getPodcastAudioData,
  getExistingBlogSlugs,
  upsertBlogAudioData,
  upsertBlogAudioUrl,
  getBlogAudioMetadata,
  getBlogAudioData,
};
