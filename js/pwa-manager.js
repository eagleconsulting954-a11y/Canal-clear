/**
 * CanalClear PWA Manager
 * Registers service worker and shows install banner when supported.
 * Multi-language via i18n.js (window.t()).
 */
(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  var DISMISS_KEY = 'canal_pwa_install_dismissed';
  var BANNER_ID = 'pwa-install-banner';

  // ─── Service Worker Registration ────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/sw.js')
        .then(function (reg) {
          console.log('[PWA] Service worker registered:', reg.scope);
        })
        .catch(function (err) {
          console.warn('[PWA] Service worker registration failed:', err);
        });
    });
  }

  // ─── Install Banner ───────────────────────────────────────────────────────────
  var deferredPrompt = null;

  /**
   * Show the install banner.
   * Uses window.t() for i18n if available, falls back to English.
   */
  function showBanner() {
    // Don't show if already dismissed for this session
    if (localStorage.getItem(DISMISS_KEY)) return;

    // Don't show twice
    if (document.getElementById(BANNER_ID)) return;

    var message = (typeof window.t === 'function' && window.t('pwa.banner_message')) || 'Install CanalClear for faster filings and offline access';
    var installLabel = (typeof window.t === 'function' && window.t('pwa.install_btn')) || 'Install App';
    var dismissLabel = (typeof window.t === 'function' && window.t('pwa.dismiss')) || 'Not Now';

    var banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-label', 'Install CanalClear app');
    banner.innerHTML =
      '<div class="pwa-banner-inner">' +
        '<p class="pwa-banner-msg">' + message + '</p>' +
        '<div class="pwa-banner-actions">' +
          '<button class="pwa-btn-install" id="pwa-install-btn" type="button">' + installLabel + '</button>' +
          '<button class="pwa-btn-dismiss" id="pwa-dismiss-btn" type="button">' + dismissLabel + '</button>' +
        '</div>' +
      '</div>' +
      '<style>' +
        '#' + BANNER_ID + '{position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#162338;border-top:1px solid rgba(0,212,170,0.2);padding:1rem 1.5rem;box-shadow:0 -4px 24px rgba(0,0,0,0.3);font-family:"DM Sans",sans-serif;animation:slideUp 0.3s ease-out;}' +
        '@keyframes slideUp{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}}' +
        '.pwa-banner-inner{display:flex;align-items:center;justify-content:space-between;gap:1rem;max-width:1200px;margin:0 auto;}' +
        '.pwa-banner-msg{margin:0;font-size:0.95rem;color:#F0F4F8;flex:1;}' +
        '.pwa-banner-actions{display:flex;gap:0.75rem;flex-shrink:0;}' +
        '.pwa-btn-install{background:#00D4AA;color:#0F1D32;border:none;padding:0.6rem 1.2rem;border-radius:8px;font-size:0.9rem;font-weight:600;cursor:pointer;transition:all 0.2s;white-space:nowrap;}' +
        '.pwa-btn-install:hover{background:#00bfa0;transform:translateY(-1px);}' +
        '.pwa-btn-dismiss{background:transparent;color:#8898A8;border:1px solid rgba(136,152,168,0.3);padding:0.6rem 1rem;border-radius:8px;font-size:0.9rem;cursor:pointer;transition:all 0.2s;white-space:nowrap;}' +
        '.pwa-btn-dismiss:hover{color:#F0F4F8;border-color:rgba(136,152,168,0.6);}' +
        '@media(max-width:600px){.pwa-banner-inner{flex-direction:column;align-items:stretch;}.pwa-banner-actions{justify-content:center;}}' +
      '</style>';

    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choiceResult) {
          if (choiceResult.outcome === 'accepted') {
            hideBanner();
          }
          deferredPrompt = null;
        });
      }
    });

    document.getElementById('pwa-dismiss-btn').addEventListener('click', function () {
      localStorage.setItem(DISMISS_KEY, '1');
      hideBanner();
    });
  }

  function hideBanner() {
    var banner = document.getElementById(BANNER_ID);
    if (banner) banner.remove();
  }

  // ─── Listen for service worker messages ───────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'PWA_INSTALLED') {
        hideBanner();
        localStorage.removeItem(DISMISS_KEY);
      }
    });
  }

  // ─── Intercept browser's native install prompt ───────────────────────────────
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault(); // Prevent browser's default banner
    deferredPrompt = event;
    showBanner();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    localStorage.removeItem(DISMISS_KEY);
    hideBanner();
  });

  // ─── Offline detection ──────────────────────────────────────────────────────
  // Show a subtle "You're offline" indicator when the network goes down
  var offlineIndicator = null;

  function showOfflineIndicator() {
    if (offlineIndicator) return;
    offlineIndicator = document.createElement('div');
    offlineIndicator.id = 'pwa-offline-indicator';
    offlineIndicator.setAttribute('aria-live', 'polite');
    var msg = (typeof window.t === 'function' && window.t('pwa.offline_indicator')) || "You're offline — some features may be limited";
    offlineIndicator.textContent = msg;
    offlineIndicator.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99998;background:#f59e0b;color:#1a1a1a;padding:0.5rem;text-align:center;font-size:0.85rem;font-family:"DM Sans",sans-serif;font-weight:500;';
    document.body.appendChild(offlineIndicator);
  }

  function hideOfflineIndicator() {
    if (offlineIndicator) {
      offlineIndicator.remove();
      offlineIndicator = null;
    }
  }

  window.addEventListener('offline', showOfflineIndicator);
  window.addEventListener('online', hideOfflineIndicator);

  // Check initial state
  if (!navigator.onLine) showOfflineIndicator();

})();