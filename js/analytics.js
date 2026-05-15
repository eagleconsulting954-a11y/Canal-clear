/**
 * CanalClear Analytics — shared tracking module
 * Handles UTM capture, session storage, and event posting to /api/analytics/event
 */
(function (win) {
  // ── UTM capture (run on every page load) ─────────────────────────────────
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var up = new URLSearchParams(win.location.search);
  var utms = {};
  UTM_KEYS.forEach(function (k) {
    if (up.get(k)) utms[k] = up.get(k);
  });
  if (Object.keys(utms).length) {
    try { sessionStorage.setItem('cc_utms', JSON.stringify(utms)); } catch (e) {}
  }

  // ── Read UTMs from cookie (server-set fallback) ──────────────────────────
  function getUtmFromCookie() {
    try {
      var match = document.cookie.match(/(?:^|;\s*)cc_utm=([^;]+)/);
      if (match) return JSON.parse(decodeURIComponent(match[1]));
    } catch (e) {}
    return null;
  }

  // ── Core track function ───────────────────────────────────────────────────
  function ccTrack(eventType, props) {
    try {
      var stored = sessionStorage.getItem('cc_utms');
      var utm = stored ? JSON.parse(stored) : {};
      // Fallback to server-set UTM cookie if sessionStorage has nothing
      if (!utm.utm_source && !utm.utm_medium && !utm.utm_campaign) {
        var cookieUtm = getUtmFromCookie();
        if (cookieUtm) utm = cookieUtm;
      }
      var payload = Object.assign(
        { event_type: eventType, page: win.location.pathname, properties: props || {} },
        utm
      );
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // ── Scroll depth tracking (fires once per threshold per page) ────────────
  function initScrollDepth() {
    var fired = {};
    var THRESHOLDS = [25, 50, 75, 90];
    function check() {
      var scrolled = win.scrollY + win.innerHeight;
      var total = document.body.scrollHeight;
      if (!total) return;
      var pct = Math.floor((scrolled / total) * 100);
      THRESHOLDS.forEach(function (t) {
        if (pct >= t && !fired[t]) {
          fired[t] = true;
          ccTrack('scroll_depth', { depth_pct: t });
        }
      });
    }
    win.addEventListener('scroll', check, { passive: true });
  }

  // ── Time on page (fires at 30s and 60s) ──────────────────────────────────
  function initTimeOnPage() {
    setTimeout(function () { ccTrack('time_on_page', { seconds: 30 }); }, 30000);
    setTimeout(function () { ccTrack('time_on_page', { seconds: 60 }); }, 60000);
  }

  // ── Outbound link clicks ──────────────────────────────────────────────────
  function initOutboundLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.startsWith('http') && !href.includes('canalclear')) {
        ccTrack('outbound_link_click', { href: href, label: (a.textContent || '').trim().slice(0, 80) });
      }
    });
  }

  // ── Expose globally ───────────────────────────────────────────────────────
  win._ccTrack = ccTrack;
  win._ccInitScroll = initScrollDepth;
  win._ccInitTime = initTimeOnPage;
  win._ccInitOutbound = initOutboundLinks;

  // Auto-init scroll + time on all pages
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initScrollDepth();
      initTimeOnPage();
      initOutboundLinks();
    });
  } else {
    initScrollDepth();
    initTimeOnPage();
    initOutboundLinks();
  }
})(window);
