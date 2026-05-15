/**
 * CanalClear Lead Funnel — 3-step qualifying modal
 * Steps: Canal Selector → Fleet Size → Contact Info
 *
 * Usage:
 *   openLeadFunnelModal()              - index.html (shows canal selector)
 *   openLeadFunnelModal('panama')      - panama.html (canal pre-selected to Panama)
 *   openLeadFunnelModal('suez')        - suez.html (canal pre-selected to Suez)
 *   openChecklistModal()               - blog CTAs (checklist lead magnet mode)
 */

(function () {
  var MODAL_ID = 'lead-funnel-modal';

  // State
  var funnelState = {
    canal: null,            // 'panama' | 'suez' | 'both' | null
    fleetSize: null,        // '1-5' | '6-15' | '16-50' | '50+' | null
    step: 1,               // 1 | 2 | 3 | 'success'
    canalPreselected: false, // true when canal was passed by the page (panama/suez)
    checklistMode: false,   // true when opened as checklist lead magnet
  };

  // ─── Exposed API ─────────────────────────────────────────────────────────────

  window.openLeadFunnelModal = function (initialCanal) {
    resetState();
    if (initialCanal) {
      funnelState.canal = initialCanal; // pre-selected canal (panama/suez page)
      funnelState.step = 2;            // skip canal selector — jump straight to fleet size
      funnelState.canalPreselected = true;
    }
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    renderStep();
    // Focus first interactive element
    setTimeout(function () {
      var firstBtn = modal.querySelector('.lf-canal-card, .lf-fleet-btn, .lf-name-input');
      if (firstBtn) firstBtn.focus();
    }, 50);
  };

  // ─── Checklist modal (lead magnet mode) ──────────────────────────────────
  window.openChecklistModal = function () {
    resetState();
    funnelState.canal = 'panama';
    funnelState.fleetSize = '1-5';
    funnelState.step = 3;
    funnelState.canalPreselected = true;
    funnelState.checklistMode = true;

    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Update modal title for checklist context
    var modalTitle = modal.querySelector('.lf-modal-title');
    if (modalTitle) {
      modalTitle.textContent = 'Get the Free VUMPA Rejection Checklist';
      modalTitle.style.display = '';
    }
    // Update submit button
    var submitBtn = modal.querySelector('#lf-submit');
    if (submitBtn) submitBtn.textContent = 'Download Free Checklist →';
    // Update the below-button note
    var note = modal.querySelector('.lf-submit-note');
    if (note) note.textContent = 'Instant download — the 10 mistakes that cause 34% of Panama Canal filings to get rejected.';

    // Update step indicator
    var stepEl = modal.querySelector('.lf-step-indicator');
    if (stepEl) stepEl.style.display = 'none';

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    renderStep();
    // Focus name input
    setTimeout(function () {
      var nameInput = modal.querySelector('#lf-name');
      if (nameInput) nameInput.focus();
    }, 50);
  };

  window.closeLeadFunnelModal = function () {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  // ─── Internal helpers ────────────────────────────────────────────────────────

  function t(key) {
    return (typeof window.t === 'function') ? window.t(key) : key;
  }

  function tf(key, params) {
    var str = t(key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.replace('{' + k + '}', params[k]);
      });
    }
    return str;
  }

  function resetState() {
    funnelState.canal = null;
    funnelState.fleetSize = null;
    funnelState.step = 1;
    funnelState.canalPreselected = false;
    funnelState.checklistMode = false;
  }

  // ─── Step rendering ──────────────────────────────────────────────────────────

  function renderStep() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    var stepEl = modal.querySelector('.lf-step-indicator');
    var backBtn = modal.querySelector('.lf-back-btn');
    var step1El = modal.querySelector('.lf-step1');
    var step2El = modal.querySelector('.lf-step2');
    var step3El = modal.querySelector('.lf-step3');
    var successEl = modal.querySelector('.lf-success');
    var modalTitle = modal.querySelector('.lf-modal-title');

    // Hide all step content
    [step1El, step2El, step3El, successEl].forEach(function (el) {
      if (el) el.style.display = 'none';
    });

    // Show/hide back button
    if (backBtn) {
      backBtn.style.display = (funnelState.step > 1 && funnelState.step !== 'success') ? '' : 'none';
    }

    if (funnelState.step === 'success') {
      renderSuccess(modal, successEl, modalTitle);
      if (stepEl) stepEl.style.display = 'none';
      if (backBtn) backBtn.style.display = 'none';
      return;
    }

    // Update step indicator
    // When canal is pre-selected the funnel has 2 visible steps (fleet + contact),
    // so adjust display numbers: internal step 2 → "Step 1 of 2", step 3 → "Step 2 of 2"
    if (stepEl) {
      var displayStep = funnelState.canalPreselected ? (funnelState.step - 1) : funnelState.step;
      var totalSteps  = funnelState.canalPreselected ? 2 : 3;
      stepEl.textContent = 'Step ' + displayStep + ' of ' + totalSteps;
      stepEl.style.display = '';
    }

    if (funnelState.step === 1) {
      if (step1El) step1El.style.display = '';
      if (modalTitle) modalTitle.textContent = '';
    } else if (funnelState.step === 2) {
      if (step2El) step2El.style.display = '';
    } else if (funnelState.step === 3) {
      if (step3El) step3El.style.display = '';
      updateStep3Headline(modalTitle);
      resetStep3Inputs(modal);
    }
  }

  function updateStep3Headline(titleEl) {
    if (!titleEl) return;
    var canalKey = 'funnel.step3_heading_' + funnelState.canal;
    titleEl.textContent = t(canalKey) || t('funnel.step3_heading_both');
  }

  function resetStep3Inputs(modal) {
    var nameInput = modal.querySelector('#lf-name');
    var emailInput = modal.querySelector('#lf-email');
    var companyInput = modal.querySelector('#lf-company');
    var phoneInput = modal.querySelector('#lf-phone');
    var submitBtn = modal.querySelector('#lf-submit');
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (companyInput) companyInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = funnelState.checklistMode
        ? 'Download Free Checklist →'
        : t('funnel.submit_btn');
    }
  }

  function renderSuccess(modal, successEl, modalTitle) {
    if (modalTitle) modalTitle.textContent = '';
    if (successEl) successEl.style.display = '';
    // Translate success content
    var heading = successEl.querySelector('.lf-success-heading');
    var body = successEl.querySelector('.lf-success-body');
    if (heading) heading.textContent = t('funnel.success_heading');
    if (body) body.textContent = t('funnel.success_body');
  }

  // ─── Canal selection (Step 1) ─────────────────────────────────────────────────

  window.lfSelectCanal = function (canal) {
    funnelState.canal = canal;
    funnelState.step = 2;
    renderStep();
  };

  // ─── Fleet size selection (Step 2) ───────────────────────────────────────────

  window.lfSelectFleet = function (fleetSize) {
    funnelState.fleetSize = fleetSize;
    funnelState.step = 3;
    renderStep();
    // Focus name input after render
    setTimeout(function () {
      var input = document.querySelector('#lf-name');
      if (input) input.focus();
    }, 50);
  };

  // ─── Back navigation ─────────────────────────────────────────────────────────

  window.lfBack = function () {
    if (funnelState.step === 2) {
      if (funnelState.canalPreselected) {
        // Canal was pre-selected by the page (panama.html / suez.html) —
        // there is no step 1 to go back to, so close the modal instead.
        window.closeLeadFunnelModal();
        return;
      } else {
        // On homepage: back from fleet size goes to canal selector
        funnelState.step = 1;
      }
    } else if (funnelState.step === 3) {
      funnelState.step = 2;
      funnelState.fleetSize = null; // reset fleet on back
    }
    renderStep();
  };

  // ─── Submit (Step 3) ─────────────────────────────────────────────────────────

  window.lfSubmit = async function () {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    var nameInput = modal.querySelector('#lf-name');
    var emailInput = modal.querySelector('#lf-email');
    var companyInput = modal.querySelector('#lf-company');
    var phoneInput = modal.querySelector('#lf-phone');
    var submitBtn = modal.querySelector('#lf-submit');

    var name = nameInput ? nameInput.value.trim() : '';
    var email = emailInput ? emailInput.value.trim() : '';
    var company = companyInput ? companyInput.value.trim() : '';
    var phone = phoneInput ? phoneInput.value.trim() : '';

    // Validation
    if (!name) {
      if (nameInput) nameInput.focus();
      shakeElement(nameInput);
      return;
    }
    if (!email || !email.includes('@')) {
      if (emailInput) emailInput.focus();
      shakeElement(emailInput);
      return;
    }

    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = '…';

    var payload = JSON.stringify({
      canal_selection: funnelState.canal,
      fleet_size: funnelState.fleetSize,
      name: name,
      email: email,
      company: company || null,
      phone: phone || null,
      source: funnelState.checklistMode ? 'checklist' : 'funnel',
    });
    var fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    };

    // Use ad-blocker-safe endpoint first, fall back to original if blocked
    var res;
    try {
      res = await fetch('/api/cc/submit', fetchOpts);
    } catch (primaryErr) {
      // Primary endpoint blocked (likely ad blocker) — try original
      try {
        res = await fetch('/api/lead-funnel/capture', fetchOpts);
      } catch (fallbackErr) {
        // Both endpoints blocked — show user-friendly error
        submitBtn.disabled = false;
        submitBtn.textContent = funnelState.checklistMode
          ? 'Download Free Checklist →'
          : t('funnel.submit_btn');
        showFormError(modal, 'Your browser blocked the request. Please disable your ad blocker for this site and try again, or email us at canal-clear@polsia.app');
        return;
      }
    }

    try {
      if (res && res.ok) {
        // Fire Meta Pixel Lead event
        if (typeof fbq !== 'undefined') {
          fbq('track', 'Lead', {
            content_name: funnelState.checklistMode ? 'Checklist Download' : 'Lead Funnel Submission',
            content_category: funnelState.canal + ' | ' + funnelState.fleetSize,
          });
        }
        // Fire internal analytics
        if (window._ccTrack) {
          window._ccTrack('lead_funnel_submitted', {
            canal: funnelState.canal,
            fleet: funnelState.fleetSize,
            source: funnelState.checklistMode ? 'checklist' : 'funnel',
          });
        }

        if (funnelState.checklistMode) {
          // Checklist mode: show brief success then trigger PDF download
          funnelState.step = 'success';
          renderStep();
          // Update success copy for checklist context
          var modal = document.getElementById(MODAL_ID);
          if (modal) {
            var heading = modal.querySelector('.lf-success-heading');
            var body = modal.querySelector('.lf-success-body');
            if (heading) heading.textContent = 'Your checklist is downloading now.';
            if (body) body.textContent = 'The top 10 VUMPA rejection reasons — check your downloads folder.';
          }
          // Trigger PDF download immediately
          var a = document.createElement('a');
          a.href = '/assets/vumpa-rejection-checklist.pdf';
          a.download = 'vumpa-rejection-checklist.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Close modal after 3 seconds
          setTimeout(function () { window.closeLeadFunnelModal(); }, 3000);
        } else {
          funnelState.step = 'success';
          renderStep();
          // Auto-close after 4 seconds
          setTimeout(function () { window.closeLeadFunnelModal(); }, 4000);
        }
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = funnelState.checklistMode
          ? 'Download Free Checklist →'
          : t('funnel.submit_btn');
        var errMsg = 'Something went wrong — please try again.';
        try {
          var errData = await res.json();
          if (errData && errData.message) errMsg = errData.message;
        } catch (e) { /* ignore parse error */ }
        showFormError(modal, errMsg);
        shakeElement(submitBtn);
      }
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = funnelState.checklistMode
        ? 'Download Free Checklist →'
        : t('funnel.submit_btn');
      showFormError(modal, 'Connection error — please check your internet and try again.');
    }
  };

  // Show an inline error below the submit button
  function showFormError(modal, msg) {
    if (!modal) return;
    // Remove any existing error
    var existing = modal.querySelector('.lf-error-msg');
    if (existing) existing.remove();
    // Create error element
    var errEl = document.createElement('p');
    errEl.className = 'lf-error-msg';
    errEl.style.cssText = 'color:#FF6B6B;font-size:0.82rem;text-align:center;margin-top:0.75rem;line-height:1.4;';
    errEl.textContent = msg;
    var submitBtn = modal.querySelector('#lf-submit');
    if (submitBtn && submitBtn.parentNode) {
      submitBtn.parentNode.insertBefore(errEl, submitBtn.nextSibling);
    }
    // Auto-remove after 8 seconds
    setTimeout(function () { if (errEl.parentNode) errEl.remove(); }, 8000);
  }

  // Shake animation for validation errors
  function shakeElement(el) {
    if (!el) return;
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'lf-shake 0.4s ease';
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) window.closeLeadFunnelModal();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        window.closeLeadFunnelModal();
      }
    });

    // Enter key in step 3 form
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && funnelState.step === 3) {
        var tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          e.preventDefault();
          window.lfSubmit();
        }
      }
    });
  });

  // Inject shake animation if not already present
  var style = document.createElement('style');
  style.textContent = [
    '@keyframes lf-shake {',
    '  0%,100% { transform: translateX(0); }',
    '  20%,60% { transform: translateX(-6px); }',
    '  40%,80% { transform: translateX(6px); }',
    '}'
  ].join('');
  document.head.appendChild(style);

})();