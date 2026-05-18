/**
 * Validation Cache Service
 * In-memory caching for VUMPA validations and ACP rule lookups.
 * Reduces redundant validation runs and rule lookups for common vessels.
 */

const crypto = require('crypto');

// In-memory cache with TTL (time to live)
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for validation results
const RULES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for static ACP rules

/**
 * Generate a cache key from vessel data
 * Consistent hashing so same vessel = same key
 */
function generateCacheKey(data) {
  const key = JSON.stringify({
    vessel_name: data.vessel_name,
    imo_number: data.imo_number,
    loa: data.loa,
    beam: data.beam,
    draft: data.draft,
    cargo_type: data.cargo_type,
    has_dangerous_goods: data.has_dangerous_goods,
    dangerous_goods_class: data.dangerous_goods_class,
  });
  return 'vumpa:' + crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get validation result from cache if available and not expired
 */
function getCachedValidation(data) {
  const key = generateCacheKey(data);
  const cached = cache.get(key);

  if (!cached) return null;
  if (Date.now() > cached.expiry) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

/**
 * Store validation result in cache
 */
function setCachedValidation(data, result) {
  const key = generateCacheKey(data);
  cache.set(key, {
    value: result,
    expiry: Date.now() + CACHE_TTL_MS,
    timestamp: Date.now()
  });
}

/**
 * Get ACP rules from cache (for static lookups like flag states, IMDG classes, etc.)
 * Rules change rarely, so longer TTL
 */
function getCachedRules(ruleType) {
  const key = `rules:${ruleType}`;
  const cached = cache.get(key);

  if (!cached) return null;
  if (Date.now() > cached.expiry) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

/**
 * Store ACP rules in cache
 */
function setCachedRules(ruleType, rules) {
  const key = `rules:${ruleType}`;
  cache.set(key, {
    value: rules,
    expiry: Date.now() + RULES_CACHE_TTL_MS,
    timestamp: Date.now()
  });
}

/**
 * Clear all caches (useful for testing or admin operations)
 */
function clearCache() {
  cache.clear();
}

/**
 * Get cache stats for monitoring
 */
function getCacheStats() {
  let validationCount = 0;
  let rulesCount = 0;
  let totalSize = 0;

  for (const [key, entry] of cache) {
    if (key.startsWith('vumpa:')) validationCount++;
    if (key.startsWith('rules:')) rulesCount++;
    // Rough size estimate
    totalSize += JSON.stringify(entry.value).length;
  }

  return {
    validations: validationCount,
    rules: rulesCount,
    total_entries: cache.size,
    estimated_size_kb: Math.round(totalSize / 1024),
    ttl_ms: CACHE_TTL_MS
  };
}

/**
 * Cleanup expired entries (run periodically)
 */
function cleanupExpiredCache() {
  const now = Date.now();
  let removed = 0;

  for (const [key, entry] of cache) {
    if (now > entry.expiry) {
      cache.delete(key);
      removed++;
    }
  }

  return removed;
}

module.exports = {
  generateCacheKey,
  getCachedValidation,
  setCachedValidation,
  getCachedRules,
  setCachedRules,
  clearCache,
  getCacheStats,
  cleanupExpiredCache
};
