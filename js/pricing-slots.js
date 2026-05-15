/**
 * pricing-slots.js — Live founding-slot counter widget
 *
 * Fetches /api/pricing-slots and updates all slot display elements on the page.
 * Used by: pricing.html, bosporus.html, demo-bosporus.html, get/calculator.html
 *
 * Targets:
 *   #pricing-slots-text          — main pricing hero badge (pricing.html)
 *   .cc-slots-inline              — inline span replacements (all pages)
 *   #pricing-scarcity-banner      — entire banner element (sold-out swap)
 *
 * Sold-out state (remaining === 0):
 *   - Replaces scarcity text with "Founding Pricing Sold Out — Join Waitlist"
 *   - Swaps the banner to a waitlist form (pricing.html only, via #pricing-scarcity-banner)
 */
(function () {
  'use strict';

  function formatSlotText(remaining, total) {
    return remaining + ' of ' + total + ' Founding Spots Remaining';
  }

  function applySlots(data) {
    var remaining = data.remaining;
    var total = data.total;
    var soldOut = data.sold_out || remaining <= 0;

    if (soldOut) {
      // Replace all slot text spans with sold-out message
      var els = document.querySelectorAll('.cc-slots-inline, #pricing-slots-text');
      els.forEach(function (el) {
        el.textContent = 'Founding Pricing Sold Out';
      });

      // Swap banner on pricing.html
      var banner = document.getElementById('pricing-scarcity-banner');
      if (banner) {
        banner.innerHTML = [
          '🔒 <strong>Founding Pricing Sold Out.</strong> ',
          'Join the waitlist to be notified when new founding spots open. ',
          '<a href="mailto:support@canalclear.org?subject=Waitlist%3A%20Founding%20Pricing" ',
          'style="color:#f0c040;text-decoration:underline;">Join Waitlist →</a>'
        ].join('');
      }
    } else {
      var text = formatSlotText(remaining, total);

      // Update main hero span (pricing.html)
      var heroEl = document.getElementById('pricing-slots-text');
      if (heroEl) {
        heroEl.textContent = text;
      }

      // Update all inline spans
      var inlineEls = document.querySelectorAll('.cc-slots-inline');
      inlineEls.forEach(function (el) {
        el.textContent = text;
      });
    }
  }

  function loadSlots() {
    // Only run if there's something to update
    var hasTargets = (
      document.getElementById('pricing-slots-text') ||
      document.querySelectorAll('.cc-slots-inline').length > 0
    );
    if (!hasTargets) return;

    fetch('/api/pricing-slots')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && typeof data.remaining === 'number') {
          applySlots(data);
        }
      })
      .catch(function () {
        // Fail silently — static fallback text already in HTML
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSlots);
  } else {
    loadSlots();
  }
})();
