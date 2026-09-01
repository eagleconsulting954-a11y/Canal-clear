/**
 * CanalClear Analytics — shared tracking module
 * Handles UTM capture, microsite attribution, session storage, and event posting.
 */
(function (win) {
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CC_KEYS = ['cc_site', 'cc_sid', 'cc_persona', 'cc_segment', 'cc_entry', 'cc_first', 'cc_variant'];
  var up = new URLSearchParams(win.location.search);
  var utms = {};
  UTM_KEYS.forEach(function (k) {
    if (up.get(k)) utms[k] = up.get(k);
  });
  if (Object.keys(utms).length) {
    try { sessionStorage.setItem('cc_utms', JSON.stringify(utms)); } catch (e) {}
  }

  // Preserve microsite source/session attribution across the CanalClear visit.
  var micrositeAttribution = {};
  CC_KEYS.forEach(function (k) {
    if (up.get(k)) micrositeAttribution[k] = up.get(k);
  });
  if (micrositeAttribution.cc_site) {
    try { sessionStorage.setItem('cc_microsite_attribution', JSON.stringify(micrositeAttribution)); } catch (e) {}
  } else {
    try { micrositeAttribution = JSON.parse(sessionStorage.getItem('cc_microsite_attribution') || '{}'); } catch (e) { micrositeAttribution = {}; }
  }

  function getUtmFromCookie() {
    try {
      var match = document.cookie.match(/(?:^|;\s*)cc_utm=([^;]+)/);
      if (match) return JSON.parse(decodeURIComponent(match[1]));
    } catch (e) {}
    return null;
  }

  function getStoredAttribution() {
    try {
      var x = JSON.parse(sessionStorage.getItem('cc_microsite_attribution') || '{}');
      return x && typeof x === 'object' ? x : {};
    } catch (e) { return {}; }
  }

  function ccTrack(eventType, props) {
    try {
      var stored = sessionStorage.getItem('cc_utms');
      var utm = stored ? JSON.parse(stored) : {};
      if (!utm.utm_source && !utm.utm_medium && !utm.utm_campaign) {
        var cookieUtm = getUtmFromCookie();
        if (cookieUtm) utm = cookieUtm;
      }
      var attr = getStoredAttribution();
      var payload = Object.assign(
        { event_type: eventType, page: win.location.pathname, properties: Object.assign({}, props || {}, attr.cc_site ? { microsite_attribution: attr } : {}) },
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

  // Record an authenticated-by-context, no-PII arrival when a microsite visitor lands on /demo.
  function captureMicrositeDemoArrival() {
    if (win.location.pathname !== '/demo' && win.location.pathname !== '/demo.html') return;
    var attr = getStoredAttribution();
    if (!attr.cc_site) return;
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem('cc_utms') || '{}'); } catch (e) {}
    var payload = {
      site_slug: attr.cc_site,
      session_id: attr.cc_sid || '',
      persona: attr.cc_persona || '',
      page_segment: attr.cc_segment || '',
      entry_page: attr.cc_entry || '',
      first_touch_page: attr.cc_first || '',
      hopkins_variant: attr.cc_variant || '',
      utm_source: stored.utm_source || up.get('utm_source') || '',
      utm_medium: stored.utm_medium || up.get('utm_medium') || '',
      utm_campaign: stored.utm_campaign || up.get('utm_campaign') || '',
      utm_content: stored.utm_content || up.get('utm_content') || '',
      landing_path: win.location.pathname,
      referrer_path: document.referrer || ''
    };
    fetch('https://syeefroqxosxxjurfwqu.supabase.co/functions/v1/microsite-demo-arrival', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  }

  // Keep attribution on high-intent internal links while sessionStorage provides the same-origin fallback.
  function decorateConversionLinks() {
    var attr = getStoredAttribution();
    if (!attr.cc_site) return;
    document.querySelectorAll('a[href]').forEach(function (a) {
      var raw = a.getAttribute('href') || '';
      if (!(raw === '/app' || raw.startsWith('/app?') || raw === '/pricing' || raw.startsWith('/pricing?'))) return;
      try {
        var u = new URL(raw, win.location.origin);
        CC_KEYS.forEach(function (k) { if (attr[k] && !u.searchParams.get(k)) u.searchParams.set(k, attr[k]); });
        var stored = JSON.parse(sessionStorage.getItem('cc_utms') || '{}');
        UTM_KEYS.forEach(function (k) { if (stored[k] && !u.searchParams.get(k)) u.searchParams.set(k, stored[k]); });
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (e) {}
    });
  }

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

  function initTimeOnPage() {
    setTimeout(function () { ccTrack('time_on_page', { seconds: 30 }); }, 30000);
    setTimeout(function () { ccTrack('time_on_page', { seconds: 60 }); }, 60000);
  }

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

  win._ccTrack = ccTrack;
  win._ccInitScroll = initScrollDepth;
  win._ccInitTime = initTimeOnPage;
  win._ccInitOutbound = initOutboundLinks;
  win._ccMicrositeAttribution = getStoredAttribution;

  function init() {
    captureMicrositeDemoArrival();
    decorateConversionLinks();
    initScrollDepth();
    initTimeOnPage();
    initOutboundLinks();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
