// CanalClear Service Worker
// Handles offline caching for the PWA
// v7: Auth-aware caching — never cache protected pages

const CACHE_NAME = 'canalclear-v7';
const OFFLINE_URL = '/offline.html';

// ─── Protected routes that require authentication ───────────────────────────
// These pages must NEVER be cached — stale cached copies mask auth failures
// and cause users to see pages they're no longer authenticated to access.
const PROTECTED_PATHS = [
  '/app', '/filing', '/acp', '/dashboard', '/admin',
  '/settings/alerts', '/agent-dashboard', '/fleet-ops',
  '/suez-calculator', '/suez/convoy', '/suez/notifications',
  '/onboarding', '/tms-import', '/developer-portal', '/clients',
  '/approval-review',
];

// ─── Precaching list (public assets only) ───────────────────────────────────
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/css/mobile.css',
  '/js/i18n.js',
  '/js/analytics.js',
  '/js/lead-funnel.js',
  '/js/mobile-nav.js',
  '/js/chatbot-knowledge.js',
  '/js/chatbot-widget.js',
  '/js/pwa-manager.js',
  '/js/whatsapp-button.js',
];

// ─── Install: precache critical assets ───────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean ALL old caches (forces refresh on upgrade) ─────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: caching strategies ─────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // ── API requests: always network, never cache ─────────────────────────────
  if (url.pathname.startsWith('/api/')) return;

  // ── Static assets (JS, CSS, icons, fonts): cache-first ──────────────────
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Protected HTML pages: ALWAYS network, NEVER cache ─────────────────────
  // These require auth cookies — serving from cache masks session expiry
  // and causes "phantom pages" where the user sees content but can't interact.
  if (request.destination === 'document' || request.headers.get('accept')?.includes('text/html')) {
    const isProtected = PROTECTED_PATHS.some((p) => url.pathname === p || url.pathname === p + '/');
    if (isProtected) {
      // Network only — no cache fallback for auth-gated pages.
      // If offline, show the offline page instead of a stale auth-gated page.
      event.respondWith(
        fetch(request).catch(() => caches.match(OFFLINE_URL))
      );
      return;
    }

    // ── Public HTML pages: network-first, cache as fallback ──────────────
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  // ── Default: network with no caching ────────────────────────────────────
});

// ─── App installed: notify all clients ───────────────────────────────────────
self.addEventListener('appinstalled', () => {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'PWA_INSTALLED' });
    });
  });
});
