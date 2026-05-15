/**
 * CanalClear Cookie Notice
 * GDPR-compliant cookie consent banner.
 * - Shown only to users who haven't consented yet
 * - Stores consent in localStorage + sets cc_cookie_consent cookie
 * - Does not block analytics that are already loaded (Google Analytics
 *   is loaded in <head>; this banner is for notice/consent tracking only)
 */
(function () {
  'use strict';

  var CONSENT_KEY = 'cc_cookie_consent';
  var CONSENT_VERSION = '1'; // bump to re-prompt on policy changes

  function getConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (e) {}
    // Also set a cookie for server-side reading
    var expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = CONSENT_KEY + '=' + encodeURIComponent(value) +
      '; expires=' + expires.toUTCString() +
      '; path=/; SameSite=Lax';
  }

  function dismiss(banner) {
    banner.style.transform = 'translateY(120%)';
    banner.style.opacity = '0';
    setTimeout(function () {
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    }, 350);
  }

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'cc-cookie-notice';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div class="cc-cookie-inner">' +
        '<div class="cc-cookie-text">' +
          '<span class="cc-cookie-icon">🍪</span>' +
          '<div>' +
            '<strong>Cookie &amp; Privacy Notice</strong>' +
            '<p>We use strictly necessary cookies for authentication, plus optional analytics cookies to understand how the platform is used. ' +
            'See our <a href="/privacy#cookies">Privacy Policy</a> for details.</p>' +
          '</div>' +
        '</div>' +
        '<div class="cc-cookie-actions">' +
          '<a href="/privacy" class="cc-btn-learn">Privacy Policy</a>' +
          '<button id="cc-accept-btn" class="cc-btn-accept">Accept &amp; Close</button>' +
        '</div>' +
      '</div>';

    banner.style.cssText = [
      'position: fixed',
      'bottom: 0',
      'left: 0',
      'right: 0',
      'z-index: 9999',
      'transform: translateY(0)',
      'opacity: 1',
      'transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease',
    ].join(';');

    var style = document.createElement('style');
    style.textContent = [
      '#cc-cookie-notice {',
      '  font-family: "IBM Plex Sans", sans-serif;',
      '  background: #142238;',
      '  border-top: 1px solid rgba(232, 90, 0, 0.3);',
      '  box-shadow: 0 -4px 24px rgba(0,0,0,0.35);',
      '}',
      '.cc-cookie-inner {',
      '  max-width: 1100px;',
      '  margin: 0 auto;',
      '  padding: 1rem 2rem;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 1.5rem;',
      '  flex-wrap: wrap;',
      '}',
      '.cc-cookie-text {',
      '  display: flex;',
      '  align-items: flex-start;',
      '  gap: 0.75rem;',
      '  flex: 1;',
      '  min-width: 280px;',
      '}',
      '.cc-cookie-icon {',
      '  font-size: 1.25rem;',
      '  flex-shrink: 0;',
      '  margin-top: 0.1rem;',
      '}',
      '.cc-cookie-text strong {',
      '  display: block;',
      '  color: #ffffff;',
      '  font-size: 0.875rem;',
      '  font-weight: 600;',
      '  margin-bottom: 0.2rem;',
      '}',
      '.cc-cookie-text p {',
      '  color: #8fa3b8;',
      '  font-size: 0.8125rem;',
      '  line-height: 1.5;',
      '  margin: 0;',
      '}',
      '.cc-cookie-text a {',
      '  color: #E85A00;',
      '  text-decoration: none;',
      '}',
      '.cc-cookie-text a:hover { text-decoration: underline; }',
      '.cc-cookie-actions {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 0.75rem;',
      '  flex-shrink: 0;',
      '}',
      '.cc-btn-learn {',
      '  color: #6b7c93;',
      '  font-size: 0.8125rem;',
      '  text-decoration: none;',
      '  padding: 0.45rem 0.9rem;',
      '  border: 1px solid rgba(107,124,147,0.3);',
      '  border-radius: 6px;',
      '  transition: color 0.2s, border-color 0.2s;',
      '  white-space: nowrap;',
      '}',
      '.cc-btn-learn:hover { color: #ffffff; border-color: rgba(255,255,255,0.3); }',
      '.cc-btn-accept {',
      '  background: #E85A00;',
      '  color: #ffffff;',
      '  border: none;',
      '  border-radius: 6px;',
      '  padding: 0.5rem 1.1rem;',
      '  font-size: 0.875rem;',
      '  font-weight: 600;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  white-space: nowrap;',
      '  transition: opacity 0.2s;',
      '}',
      '.cc-btn-accept:hover { opacity: 0.88; }',
      '@media (max-width: 600px) {',
      '  .cc-cookie-inner { padding: 1rem 1.25rem; gap: 1rem; }',
      '  .cc-cookie-actions { width: 100%; justify-content: flex-end; }',
      '}',
    ].join('\n');

    document.head.appendChild(style);

    return banner;
  }

  function init() {
    var existing = getConsent();
    // Already consented at current version — don't show
    if (existing === CONSENT_VERSION) return;

    var banner = createBanner();

    // Wait for DOM to be ready
    function attach() {
      document.body.appendChild(banner);

      // Small delay so the CSS transition fires on initial render
      setTimeout(function () {
        banner.style.transform = 'translateY(0)';
        banner.style.opacity = '1';
      }, 80);

      var acceptBtn = document.getElementById('cc-accept-btn');
      if (acceptBtn) {
        acceptBtn.addEventListener('click', function () {
          setConsent(CONSENT_VERSION);
          dismiss(banner);
        });
      }
    }

    if (document.body) {
      attach();
    } else {
      document.addEventListener('DOMContentLoaded', attach);
    }
  }

  init();
})();
