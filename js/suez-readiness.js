/**
 * CanalClear — Suez Transit Readiness Score
 * 4-question scoring funnel → email gate → score reveal
 *
 * Flow:
 *   Q1: SCA Transit Application
 *   Q2: Crew Manifest
 *   Q3: Cargo Declarations (IMDG 42-24)
 *   Q4: Convoy Scheduling docs
 *   → Email gate (name + email + company + vessel)
 *   → Score reveal (XX/100 with breakdown)
 */

(function () {
  var MODAL_ID = 'suez-readiness-modal';

  // Questions config
  var QUESTIONS = [
    {
      id: 'transit_app',
      label: 'SCA Transit Application',
      question: 'Do you have an SCA Transit Application prepared?',
      icon: '📋',
      options: [
        { label: 'Yes — complete and current',   value: 'complete',     points: 25 },
        { label: 'In progress',                   value: 'in_progress',  points: 12 },
        { label: 'Not started',                   value: 'not_started',  points: 0  },
      ]
    },
    {
      id: 'crew_manifest',
      label: 'Crew Manifest',
      question: 'Is your Crew Manifest current and SCA-compliant?',
      icon: '👥',
      options: [
        { label: 'Yes — all STCW credentials valid', value: 'complete',     points: 25 },
        { label: 'Needs some updates',               value: 'partial',      points: 12 },
        { label: 'Not prepared',                     value: 'not_prepared', points: 0  },
      ]
    },
    {
      id: 'cargo_declarations',
      label: 'Cargo Declarations',
      question: 'Are your Cargo Declarations IMDG Amendment 42-24 compliant?',
      icon: '📦',
      options: [
        { label: 'Yes — validated against IMDG 42-24', value: 'validated',  points: 25 },
        { label: 'Not sure / not checked yet',         value: 'unsure',     points: 10 },
        { label: 'Not prepared',                       value: 'not_ready',  points: 0  },
      ]
    },
    {
      id: 'convoy_scheduling',
      label: 'Convoy Scheduling',
      question: 'Have you completed your Convoy Scheduling documentation?',
      icon: '🚢',
      options: [
        { label: 'Yes — convoy booking confirmed', value: 'confirmed',    points: 25 },
        { label: 'In progress',                    value: 'in_progress',  points: 12 },
        { label: 'Not started',                    value: 'not_started',  points: 0  },
      ]
    }
  ];

  // State
  var state = {
    step: 0,             // 0-3 = questions, 4 = email gate, 5 = score reveal
    answers: {},         // { transit_app: 'complete', crew_manifest: 'partial', ... }
    points: {},          // { transit_app: 25, ... }
    submitting: false,
    scoreData: null,     // { score, breakdown, missing } from API
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  window.openSuezReadinessModal = function () {
    resetState();
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    renderStep();
    // Focus first option
    setTimeout(function () {
      var first = modal.querySelector('.sr-option');
      if (first) first.focus();
    }, 60);
  };

  window.closeSuezReadinessModal = function () {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  // ── Internals ───────────────────────────────────────────────────────────────

  function resetState() {
    state.step = 0;
    state.answers = {};
    state.points = {};
    state.submitting = false;
    state.scoreData = null;
  }

  function totalScore() {
    return Object.values(state.points).reduce(function (a, b) { return a + b; }, 0);
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  function renderStep() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    var body = modal.querySelector('.sr-body');
    if (!body) return;

    if (state.step < QUESTIONS.length) {
      renderQuestion(body, state.step);
    } else if (state.step === QUESTIONS.length) {
      renderEmailGate(body);
    } else {
      renderScoreReveal(body);
    }
  }

  function progressPct() {
    return Math.round((state.step / (QUESTIONS.length + 1)) * 100);
  }

  function progressHtml() {
    var pct = progressPct();
    return '<div class="sr-progress-wrap">' +
      '<div class="sr-progress-bar"><div class="sr-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="sr-progress-label">Step ' + (state.step + 1) + ' of ' + (QUESTIONS.length + 1) + '</span>' +
    '</div>';
  }

  function renderQuestion(body, qi) {
    var q = QUESTIONS[qi];
    var optionsHtml = q.options.map(function (opt) {
      var selected = state.answers[q.id] === opt.value;
      return '<button class="sr-option' + (selected ? ' selected' : '') + '" ' +
        'onclick="srSelectOption(\'' + q.id + '\',\'' + opt.value + '\',' + opt.points + ')">' +
        opt.label +
        '</button>';
    }).join('');

    body.innerHTML = progressHtml() +
      '<div class="sr-question-area">' +
        '<div class="sr-q-icon">' + q.icon + '</div>' +
        '<h3 class="sr-q-text">' + q.question + '</h3>' +
        '<div class="sr-options">' + optionsHtml + '</div>' +
      '</div>' +
      (state.step > 0 ? '<button class="sr-back" onclick="srBack()">← Back</button>' : '');
  }

  function renderEmailGate(body) {
    var previewScore = totalScore();
    var label = previewScore >= 75 ? 'Transit Ready' : previewScore >= 50 ? 'Needs Attention' : 'At Risk';
    var color = previewScore >= 75 ? '#00D4AA' : previewScore >= 50 ? '#F5A623' : '#FF6B6B';

    body.innerHTML = progressHtml() +
      '<div class="sr-gate-area">' +
        '<div class="sr-score-preview" style="border-color:' + color + '">' +
          '<div class="sr-score-big" style="color:' + color + '">' + previewScore + '<span>/100</span></div>' +
          '<div class="sr-score-label" style="color:' + color + '">' + label + '</div>' +
        '</div>' +
        '<p class="sr-gate-caption">Enter your details to see the full breakdown and what to fix before your Suez transit.</p>' +
        '<div class="sr-form">' +
          '<div class="sr-field"><label>Full Name <span class="sr-req">*</span></label><input id="sr-name" type="text" placeholder="Captain J. Smith" autocomplete="name"></div>' +
          '<div class="sr-field"><label>Work Email <span class="sr-req">*</span></label><input id="sr-email" type="email" placeholder="you@shipco.com" autocomplete="email"></div>' +
          '<div class="sr-field"><label>Company</label><input id="sr-company" type="text" placeholder="Acme Shipping Co." autocomplete="organization"></div>' +
          '<div class="sr-field"><label>Vessel Name</label><input id="sr-vessel" type="text" placeholder="e.g. MV Atlantic Star"></div>' +
        '</div>' +
        '<button class="sr-submit-btn" id="sr-submit" onclick="srSubmit()">Show My Full Score →</button>' +
        '<p class="sr-disclaimer">We\'ll email you a copy. No spam.</p>' +
      '</div>' +
      '<button class="sr-back" onclick="srBack()">← Back</button>';
  }

  function renderScoreReveal(body) {
    var d = state.scoreData;
    if (!d) return;

    var score = d.score;
    var label = score >= 75 ? 'Transit Ready' : score >= 50 ? 'Needs Attention' : 'At Risk';
    var color = score >= 75 ? '#00D4AA' : score >= 50 ? '#F5A623' : '#FF6B6B';

    var breakdownHtml = d.breakdown.map(function (item) {
      var itemColor = item.points === item.max ? '#00D4AA' : item.points === 0 ? '#FF6B6B' : '#F5A623';
      var statusIcon = item.points === item.max ? '✓' : item.points === 0 ? '✗' : '⚠';
      return '<div class="sr-breakdown-row">' +
        '<span class="sr-breakdown-icon" style="color:' + itemColor + '">' + statusIcon + '</span>' +
        '<div class="sr-breakdown-info">' +
          '<span class="sr-breakdown-label">' + item.label + '</span>' +
          (item.note ? '<span class="sr-breakdown-note">' + item.note + '</span>' : '') +
        '</div>' +
        '<span class="sr-breakdown-pts" style="color:' + itemColor + '">' + item.points + '/' + item.max + '</span>' +
      '</div>';
    }).join('');

    var missingHtml = '';
    if (d.missing && d.missing.length > 0) {
      missingHtml = '<div class="sr-missing"><h4>What to address before your transit:</h4><ul>' +
        d.missing.map(function (m) { return '<li>' + m + '</li>'; }).join('') +
        '</ul></div>';
    }

    body.innerHTML =
      '<div class="sr-reveal-area">' +
        '<div class="sr-score-ring" style="--score-color:' + color + '">' +
          '<div class="sr-score-main" style="color:' + color + '">' +
            '<div class="sr-score-num">' + score + '</div>' +
            '<div class="sr-score-denom">/100</div>' +
          '</div>' +
          '<div class="sr-score-status">' + label + '</div>' +
        '</div>' +
        '<h3 class="sr-reveal-title">Your Suez Transit Readiness Score</h3>' +
        '<div class="sr-breakdown">' + breakdownHtml + '</div>' +
        missingHtml +
        '<div class="sr-reveal-ctas">' +
          '<a href="/filing?canal=suez" class="sr-cta-primary">Start Suez Filing →</a>' +
          '<button class="sr-cta-secondary" onclick="closeSuezReadinessModal()">Close</button>' +
        '</div>' +
        '<p class="sr-reveal-note">A copy has been sent to your email. Questions? <a href="mailto:eagleconsulting954@gmail.com">eagleconsulting954@gmail.com</a></p>' +
      '</div>';
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  window.srSelectOption = function (questionId, value, points) {
    state.answers[questionId] = value;
    state.points[questionId] = points;

    // Brief highlight then advance
    setTimeout(function () {
      state.step++;
      renderStep();
    }, 220);
  };

  window.srBack = function () {
    if (state.step > 0) {
      state.step--;
      renderStep();
    }
  };

  window.srSubmit = async function () {
    if (state.submitting) return;

    var nameEl = document.getElementById('sr-name');
    var emailEl = document.getElementById('sr-email');
    var companyEl = document.getElementById('sr-company');
    var vesselEl = document.getElementById('sr-vessel');
    var submitBtn = document.getElementById('sr-submit');

    var name = nameEl ? nameEl.value.trim() : '';
    var email = emailEl ? emailEl.value.trim() : '';
    var company = companyEl ? companyEl.value.trim() : '';
    var vessel = vesselEl ? vesselEl.value.trim() : '';

    if (!name) { if (nameEl) { nameEl.focus(); srShake(nameEl); } return; }
    if (!email || !email.includes('@')) { if (emailEl) { emailEl.focus(); srShake(emailEl); } return; }

    state.submitting = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Calculating…'; }

    try {
      var res = await fetch('/api/suez-readiness/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          company: company || null,
          vessel_name: vessel || null,
          answers: state.answers,
        })
      });

      if (res.ok) {
        var data = await res.json();
        state.scoreData = data;
        state.step = QUESTIONS.length + 1; // reveal step
        renderStep();

        // Meta Pixel
        if (typeof fbq !== 'undefined') {
          fbq('track', 'Lead', { content_name: 'Suez Transit Readiness Score', content_category: 'suez | score:' + data.score });
        }
        if (window._ccTrack) {
          window._ccTrack('suez_readiness_submitted', { score: data.score });
        }
      } else {
        state.submitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Show My Full Score →'; }
        srShake(submitBtn);
      }
    } catch (err) {
      state.submitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Show My Full Score →'; }
    }
  };

  function srShake(el) {
    if (!el) return;
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'sr-shake 0.4s ease';
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) window.closeSuezReadinessModal();
    });

    // ESC key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        window.closeSuezReadinessModal();
      }
    });
  });

  // Inject styles
  var style = document.createElement('style');
  style.textContent = `
@keyframes sr-shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-5px)} 40%,80%{transform:translateX(5px)} }
@keyframes sr-fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

#suez-readiness-modal { font-family:'DM Sans',sans-serif; }
.sr-panel {
  background: #0F1D32;
  border: 1px solid rgba(0,212,170,0.2);
  border-radius: 18px;
  width: 100%;
  max-width: 480px;
  padding: 2rem 2rem 1.5rem;
  position: relative;
  animation: sr-fade-in 0.25s ease;
  max-height: 90vh;
  overflow-y: auto;
}
.sr-close {
  position: absolute;
  top: 1rem; right: 1rem;
  background: none; border: none;
  color: #8899AA; font-size: 1.4rem;
  cursor: pointer; line-height: 1;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
}
.sr-close:hover { color: #F0F4F8; }
.sr-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.05rem;
  font-weight: 700;
  color: #F0F4F8;
  margin: 0 2rem 1.25rem 0;
}
.sr-progress-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.sr-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255,255,255,0.08);
  border-radius: 4px;
  overflow: hidden;
}
.sr-progress-fill {
  height: 100%;
  background: #00D4AA;
  border-radius: 4px;
  transition: width 0.35s ease;
}
.sr-progress-label {
  font-size: 0.78rem;
  color: #8899AA;
  white-space: nowrap;
}
.sr-question-area { animation: sr-fade-in 0.2s ease; }
.sr-q-icon { font-size: 2rem; margin-bottom: 0.5rem; }
.sr-q-text {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.1rem;
  font-weight: 600;
  color: #F0F4F8;
  margin-bottom: 1.25rem;
  line-height: 1.45;
}
.sr-options { display: flex; flex-direction: column; gap: 0.65rem; }
.sr-option {
  padding: 0.85rem 1rem;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  color: #C4D0DC;
  font-family: inherit;
  font-size: 0.95rem;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.sr-option:hover { border-color: rgba(0,212,170,0.4); background: rgba(0,212,170,0.06); color: #F0F4F8; }
.sr-option.selected { border-color: #00D4AA; background: rgba(0,212,170,0.1); color: #00D4AA; font-weight: 600; }
.sr-back {
  background: none; border: none;
  color: #8899AA; font-size: 0.85rem;
  cursor: pointer; padding: 0.5rem 0;
  margin-top: 1rem;
  font-family: inherit;
}
.sr-back:hover { color: #F0F4F8; }

/* Email gate */
.sr-gate-area { animation: sr-fade-in 0.2s ease; }
.sr-score-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.25rem;
  border: 2px solid;
  border-radius: 14px;
  background: rgba(0,0,0,0.2);
  margin-bottom: 1rem;
  filter: blur(0px);
}
.sr-score-big {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 3.5rem;
  font-weight: 700;
  line-height: 1;
}
.sr-score-big span { font-size: 1.5rem; font-weight: 400; color: #8899AA; }
.sr-score-label { font-size: 0.9rem; font-weight: 600; margin-top: 0.25rem; }
.sr-gate-caption { color: #8899AA; font-size: 0.9rem; text-align: center; margin-bottom: 1.25rem; }
.sr-form { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
.sr-field label { display: block; font-size: 0.82rem; color: #C4D0DC; margin-bottom: 0.3rem; font-weight: 500; }
.sr-req { color: #FF6B6B; }
.sr-field input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  color: #F0F4F8;
  font-size: 0.95rem;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.sr-field input:focus { border-color: rgba(0,212,170,0.5); }
.sr-submit-btn {
  width: 100%;
  padding: 0.95rem;
  background: #00D4AA;
  color: #0A1628;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}
.sr-submit-btn:hover { background: #00BFAA; }
.sr-submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sr-disclaimer { text-align: center; font-size: 0.78rem; color: #8899AA; margin-top: 0.5rem; }

/* Score reveal */
.sr-reveal-area { animation: sr-fade-in 0.25s ease; }
.sr-score-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 1.25rem;
}
.sr-score-main { display: flex; align-items: flex-end; gap: 0.1rem; }
.sr-score-num {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 4.5rem;
  font-weight: 700;
  line-height: 1;
}
.sr-score-denom { font-size: 1.5rem; font-weight: 400; color: #8899AA; margin-bottom: 0.3rem; }
.sr-score-status { font-size: 0.9rem; font-weight: 600; margin-top: 0.25rem; }
.sr-reveal-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #8899AA;
  text-align: center;
  margin-bottom: 1.25rem;
}
.sr-breakdown { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1rem; }
.sr-breakdown-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(255,255,255,0.03);
  border-radius: 10px;
}
.sr-breakdown-icon { font-size: 1rem; line-height: 1.4; font-weight: 700; flex-shrink: 0; }
.sr-breakdown-info { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; }
.sr-breakdown-label { font-size: 0.9rem; color: #F0F4F8; font-weight: 500; }
.sr-breakdown-note { font-size: 0.8rem; color: #8899AA; }
.sr-breakdown-pts { font-size: 0.85rem; font-weight: 700; flex-shrink: 0; }
.sr-missing {
  background: rgba(255,107,107,0.08);
  border: 1px solid rgba(255,107,107,0.2);
  border-radius: 10px;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
}
.sr-missing h4 { font-size: 0.85rem; color: #FF6B6B; font-weight: 600; margin-bottom: 0.5rem; }
.sr-missing ul { margin: 0; padding-left: 1.2rem; }
.sr-missing li { font-size: 0.85rem; color: #C4D0DC; margin-bottom: 0.25rem; }
.sr-reveal-ctas { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.sr-cta-primary {
  flex: 1;
  padding: 0.85rem 1rem;
  background: #00D4AA;
  color: #0A1628;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  display: inline-block;
}
.sr-cta-secondary {
  padding: 0.85rem 1rem;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  color: #8899AA;
  font-family: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}
.sr-reveal-note { font-size: 0.78rem; color: #8899AA; text-align: center; }
.sr-reveal-note a { color: #00D4AA; }
  `;
  document.head.appendChild(style);

})();
