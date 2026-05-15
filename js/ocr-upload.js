/**
 * ocr-upload.js — Shared OCR document upload modal for all CanalClear filing wizards.
 *
 * Usage: include this script, then call window.initOCRUpload({ waterway, onFieldsExtracted })
 * The onFieldsExtracted callback receives { fields: { formId: { value, confidence } }, documentType, warnings }
 *
 * The modal is injected once on first init; subsequent calls reuse it.
 */

(function () {
  'use strict';

  // ── Singleton modal DOM ──────────────────────────────────────────────────────

  let modal = null;
  let currentConfig = {};

  const DOCUMENT_TYPE_LABELS = {
    pi_certificate: '🛡️ P&I Certificate',
    crew_manifest: '👥 Crew Manifest',
    cofr: '📋 COFR',
    ship_particulars: '🚢 Ship Particulars',
    dg_manifest: '⚠️ Dangerous Cargo Manifest',
    other: '📄 Maritime Document',
  };

  function injectStyles() {
    if (document.getElementById('ocr-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'ocr-modal-styles';
    style.textContent = `
      #ocr-modal-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(7, 17, 31, 0.85);
        backdrop-filter: blur(6px);
        z-index: 10000;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      }
      #ocr-modal-overlay.ocr-open {
        display: flex;
      }
      #ocr-modal {
        background: #1a2d4a;
        border: 1px solid rgba(232, 90, 0, 0.25);
        border-radius: 16px;
        width: 100%;
        max-width: 540px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        font-family: 'IBM Plex Sans', sans-serif;
      }
      #ocr-modal .ocr-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid rgba(255,255,255,0.07);
      }
      #ocr-modal .ocr-header h3 {
        font-size: 1rem;
        font-weight: 700;
        color: #fff;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      #ocr-modal .ocr-close {
        background: none;
        border: none;
        color: #6b7c93;
        font-size: 1.4rem;
        cursor: pointer;
        padding: 0 0.25rem;
        line-height: 1;
        transition: color 0.15s;
      }
      #ocr-modal .ocr-close:hover { color: #fff; }
      #ocr-modal .ocr-body { padding: 1.5rem; }
      #ocr-drop-zone {
        border: 2px dashed rgba(232, 90, 0, 0.4);
        border-radius: 12px;
        padding: 2.5rem 1.5rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        background: rgba(232, 90, 0, 0.04);
        position: relative;
      }
      #ocr-drop-zone:hover,
      #ocr-drop-zone.drag-over {
        border-color: #E85A00;
        background: rgba(232, 90, 0, 0.09);
      }
      #ocr-drop-zone .dz-icon {
        font-size: 2.4rem;
        margin-bottom: 0.75rem;
        display: block;
      }
      #ocr-drop-zone .dz-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #fff;
        margin-bottom: 0.4rem;
      }
      #ocr-drop-zone .dz-sub {
        font-size: 0.78rem;
        color: #6b7c93;
      }
      #ocr-drop-zone .dz-types {
        margin-top: 0.75rem;
        font-size: 0.72rem;
        color: #6b7c93;
        background: rgba(255,255,255,0.04);
        border-radius: 6px;
        padding: 0.35rem 0.75rem;
        display: inline-block;
      }
      #ocr-file-input { display: none; }
      #ocr-modal .ocr-doc-types {
        margin-top: 1.25rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      #ocr-modal .ocr-doc-chip {
        font-size: 0.72rem;
        color: #8fa3b8;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        padding: 0.25rem 0.65rem;
      }
      #ocr-modal .ocr-progress {
        display: none;
        text-align: center;
        padding: 1.5rem 0;
      }
      #ocr-modal .ocr-progress.show { display: block; }
      #ocr-modal .ocr-spinner {
        width: 40px; height: 40px;
        border: 3px solid rgba(232, 90, 0, 0.2);
        border-top-color: #E85A00;
        border-radius: 50%;
        animation: ocr-spin 0.8s linear infinite;
        margin: 0 auto 1rem;
      }
      @keyframes ocr-spin { to { transform: rotate(360deg); } }
      #ocr-modal .ocr-progress-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: #fff;
        margin-bottom: 0.35rem;
      }
      #ocr-modal .ocr-progress-sub {
        font-size: 0.78rem;
        color: #6b7c93;
      }
      #ocr-modal .ocr-results { display: none; }
      #ocr-modal .ocr-results.show { display: block; }
      #ocr-modal .ocr-doc-type-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.78rem;
        font-weight: 600;
        color: #E85A00;
        background: rgba(232, 90, 0, 0.1);
        border: 1px solid rgba(232, 90, 0, 0.2);
        border-radius: 20px;
        padding: 0.3rem 0.8rem;
        margin-bottom: 1rem;
      }
      #ocr-modal .ocr-fields-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 260px;
        overflow-y: auto;
        margin-bottom: 1rem;
        padding-right: 0.25rem;
      }
      #ocr-modal .ocr-field-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px;
        padding: 0.55rem 0.85rem;
        font-size: 0.82rem;
      }
      #ocr-modal .ocr-field-label {
        flex: 1;
        color: #8fa3b8;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
      }
      #ocr-modal .ocr-field-value {
        flex: 2;
        color: #fff;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #ocr-modal .ocr-conf-pill {
        font-size: 0.68rem;
        font-weight: 700;
        padding: 0.15rem 0.45rem;
        border-radius: 10px;
        white-space: nowrap;
      }
      #ocr-modal .ocr-conf-high {
        background: rgba(34,197,94,0.15);
        color: #4ade80;
      }
      #ocr-modal .ocr-conf-mid {
        background: rgba(251,191,36,0.15);
        color: #fbbf24;
      }
      #ocr-modal .ocr-warnings {
        margin-bottom: 1rem;
      }
      #ocr-modal .ocr-warning-item {
        font-size: 0.78rem;
        color: #fbbf24;
        background: rgba(251,191,36,0.08);
        border: 1px solid rgba(251,191,36,0.2);
        border-radius: 8px;
        padding: 0.55rem 0.85rem;
        margin-bottom: 0.4rem;
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
      }
      #ocr-modal .ocr-actions {
        display: flex;
        gap: 0.75rem;
        justify-content: flex-end;
      }
      #ocr-modal .ocr-btn-cancel {
        padding: 0.65rem 1.25rem;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 9px;
        color: #8fa3b8;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        font-family: 'IBM Plex Sans', sans-serif;
        transition: all 0.15s;
      }
      #ocr-modal .ocr-btn-cancel:hover {
        background: rgba(255,255,255,0.05);
        color: #fff;
      }
      #ocr-modal .ocr-btn-apply {
        padding: 0.65rem 1.5rem;
        background: #E85A00;
        border: none;
        border-radius: 9px;
        color: #07111F;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: pointer;
        font-family: 'IBM Plex Sans', sans-serif;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      #ocr-modal .ocr-btn-apply:hover { background: #CC4F00; }
      #ocr-modal .ocr-error {
        display: none;
        background: rgba(255, 107, 107, 0.08);
        border: 1px solid rgba(255, 107, 107, 0.25);
        border-radius: 10px;
        padding: 1rem 1.25rem;
        color: #FF6B6B;
        font-size: 0.84rem;
        text-align: center;
        margin-top: 0.5rem;
      }
      #ocr-modal .ocr-error.show { display: block; }
      #ocr-modal .ocr-try-again {
        margin-top: 0.75rem;
        background: none;
        border: 1px solid rgba(255, 107, 107, 0.35);
        border-radius: 8px;
        color: #FF6B6B;
        font-size: 0.78rem;
        padding: 0.4rem 0.85rem;
        cursor: pointer;
        font-family: 'IBM Plex Sans', sans-serif;
      }
      #ocr-modal .ocr-try-again:hover { background: rgba(255, 107, 107, 0.08); }
      #ocr-upload-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.55rem 1.1rem;
        background: rgba(232, 90, 0, 0.1);
        border: 1px solid rgba(232, 90, 0, 0.3);
        border-radius: 9px;
        color: #E85A00;
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      #ocr-upload-btn:hover {
        background: rgba(232, 90, 0, 0.18);
        border-color: #E85A00;
      }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    if (modal) return;

    injectStyles();

    const el = document.createElement('div');
    el.id = 'ocr-modal-overlay';
    el.innerHTML = `
      <div id="ocr-modal" role="dialog" aria-modal="true" aria-labelledby="ocr-modal-title">
        <div class="ocr-header">
          <h3 id="ocr-modal-title">📄 Upload Document — Auto-Fill</h3>
          <button class="ocr-close" aria-label="Close" onclick="window.closeOCRModal()">×</button>
        </div>
        <div class="ocr-body">

          <!-- Drop zone (upload state) -->
          <div id="ocr-drop-zone">
            <span class="dz-icon">📂</span>
            <div class="dz-title">Drag & drop or click to upload</div>
            <div class="dz-sub">Upload a certificate, manifest, or ship particulars — we'll auto-fill the form</div>
            <div class="dz-types">PDF · JPG · PNG · WEBP &nbsp;·&nbsp; Max 20 MB</div>
          </div>
          <input type="file" id="ocr-file-input" accept=".pdf,.jpg,.jpeg,.png,.webp">

          <div class="ocr-doc-types">
            <span class="ocr-doc-chip">🛡️ P&I Certificate</span>
            <span class="ocr-doc-chip">👥 Crew Manifest</span>
            <span class="ocr-doc-chip">📋 COFR</span>
            <span class="ocr-doc-chip">🚢 Ship Particulars</span>
            <span class="ocr-doc-chip">⚠️ DG Manifest</span>
          </div>

          <!-- Processing state -->
          <div class="ocr-progress" id="ocr-progress">
            <div class="ocr-spinner"></div>
            <div class="ocr-progress-title">Extracting fields…</div>
            <div class="ocr-progress-sub">AI is reading your document — usually takes 5–10 seconds</div>
          </div>

          <!-- Results state -->
          <div class="ocr-results" id="ocr-results">
            <div class="ocr-doc-type-badge" id="ocr-doc-type-badge"></div>
            <div class="ocr-fields-list" id="ocr-fields-list"></div>
            <div class="ocr-warnings" id="ocr-warnings"></div>
            <div class="ocr-actions">
              <button class="ocr-btn-cancel" onclick="window.closeOCRModal()">Discard</button>
              <button class="ocr-btn-apply" id="ocr-btn-apply">
                ✓ Apply to Form
              </button>
            </div>
          </div>

          <!-- Error state -->
          <div class="ocr-error" id="ocr-error">
            <div id="ocr-error-msg"></div>
            <button class="ocr-try-again" onclick="window.resetOCRModal()">Try another document</button>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(el);
    modal = el;

    // Wire events
    const dropZone  = modal.querySelector('#ocr-drop-zone');
    const fileInput = modal.querySelector('#ocr-file-input');
    const applyBtn  = modal.querySelector('#ocr-btn-apply');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    // Close on overlay click
    el.addEventListener('click', (e) => {
      if (e.target === el) window.closeOCRModal();
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('ocr-open')) window.closeOCRModal();
    });

    applyBtn.addEventListener('click', applyFields);
  }

  // ── State helpers ─────────────────────────────────────────────────────────────

  let extractedData = null;

  function showState(state) {
    const dropZone  = modal.querySelector('#ocr-drop-zone');
    const docTypes  = modal.querySelector('.ocr-doc-types');
    const progress  = modal.querySelector('#ocr-progress');
    const results   = modal.querySelector('#ocr-results');
    const error     = modal.querySelector('#ocr-error');

    dropZone.style.display  = state === 'upload'    ? '' : 'none';
    docTypes.style.display  = state === 'upload'    ? '' : 'none';
    progress.classList.toggle('show', state === 'processing');
    results.classList.toggle('show', state === 'results');
    error.classList.toggle('show', state === 'error');
  }

  async function handleFile(file) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showError('Unsupported file type. Please upload a PDF, JPG, PNG, or WEBP.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showError('File too large. Maximum size is 20 MB.');
      return;
    }

    showState('processing');

    const formData = new FormData();
    formData.append('document', file);
    formData.append('waterway', currentConfig.waterway || 'generic');

    try {
      const res = await fetch('/api/ocr/extract', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!data.success) {
        showError(data.error || 'Extraction failed. Please enter fields manually.');
        return;
      }

      if (!data.fields || Object.keys(data.fields).length === 0) {
        showError('No recognizable fields found in this document. Please enter fields manually.');
        return;
      }

      extractedData = data;
      renderResults(data);
    } catch (err) {
      showError('Network error. Please check your connection and try again.');
    }
  }

  function renderResults(data) {
    const badge      = modal.querySelector('#ocr-doc-type-badge');
    const fieldsList = modal.querySelector('#ocr-fields-list');
    const warningEl  = modal.querySelector('#ocr-warnings');

    badge.textContent = DOCUMENT_TYPE_LABELS[data.documentType] || '📄 Document';

    // Field rows
    fieldsList.innerHTML = '';
    const entries = Object.entries(data.fields);
    if (entries.length === 0) {
      fieldsList.innerHTML = '<div style="color:#6b7c93;font-size:0.82rem;padding:0.5rem">No fields extracted.</div>';
    } else {
      entries.forEach(([formId, { value, confidence }]) => {
        const isHigh = confidence >= 0.85;
        const label  = formIdToLabel(formId);
        const row    = document.createElement('div');
        row.className = 'ocr-field-row';
        row.innerHTML = `
          <span class="ocr-field-label">${label}</span>
          <span class="ocr-field-value" title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>
          <span class="ocr-conf-pill ${isHigh ? 'ocr-conf-high' : 'ocr-conf-mid'}">${Math.round(confidence * 100)}%</span>
        `;
        fieldsList.appendChild(row);
      });
    }

    // Warnings
    warningEl.innerHTML = '';
    (data.warnings || []).forEach(msg => {
      const w = document.createElement('div');
      w.className = 'ocr-warning-item';
      w.innerHTML = `<span>⚠️</span><span>${escapeHtml(msg)}</span>`;
      warningEl.appendChild(w);
    });

    showState('results');
  }

  function applyFields() {
    if (!extractedData || !currentConfig.onFieldsExtracted) return;
    currentConfig.onFieldsExtracted(extractedData);
    window.closeOCRModal();
  }

  function showError(msg) {
    modal.querySelector('#ocr-error-msg').textContent = msg;
    showState('error');
  }

  // ── Public API ─────────────────────────────────────────────────────────────────

  window.initOCRUpload = function (config) {
    // config = { waterway, onFieldsExtracted }
    currentConfig = config || {};
    buildModal();
  };

  window.openOCRModal = function () {
    buildModal();
    window.resetOCRModal();
    modal.classList.add('ocr-open');
    document.body.style.overflow = 'hidden';
  };

  window.closeOCRModal = function () {
    if (!modal) return;
    modal.classList.remove('ocr-open');
    document.body.style.overflow = '';
  };

  window.resetOCRModal = function () {
    if (!modal) return;
    extractedData = null;
    modal.querySelector('#ocr-file-input').value = '';
    showState('upload');
  };

  // ── Helpers ────────────────────────────────────────────────────────────────────

  function formIdToLabel(formId) {
    const labels = {
      'f-vessel-name': 'Vessel Name',
      'f-imo': 'IMO Number',
      'f-flag': 'Flag State',
      'f-callsign': 'Call Sign',
      'f-call-sign': 'Call Sign',
      'f-mmsi': 'MMSI',
      'f-vessel-type': 'Vessel Type',
      'f-gt': 'Gross Tonnage',
      'f-nt': 'Net Tonnage',
      'f-loa': 'LOA (m)',
      'f-beam': 'Beam (m)',
      'f-draft': 'Draft (m)',
      'f-crew': 'Crew Count',
      'f-master': 'Master Name',
      'f-cargo-desc': 'Cargo Description',
      'f-cargo-weight': 'Cargo Weight (MT)',
      'f-cargo-qty': 'Cargo Quantity (MT)',
      'f-un': 'UN Number',
      'f-un2': 'UN Number',
      'f-un-number': 'UN Number',
      'f-imdg': 'IMDG Class',
      'f-dg-class': 'DG Class',
      'f-class': 'DG Class',
      'f-psn': 'Proper Shipping Name',
      'f-origin': 'Port of Origin',
      'f-port-origin': 'Port of Origin',
      'f-pol': 'Port of Loading',
      'f-dest': 'Destination Port',
      'f-next-port': 'Next Port',
      'f-pod': 'Port of Discharge',
      'f-pcsopep-cert': 'PCSOPEP Certificate',
      'f-pcsopep-issue': 'PCSOPEP Issue Date',
      'f-pcsopep-expiry': 'PCSOPEP Expiry Date',
      'f-isps-level': 'ISPS Level',
      'f-class-society': 'Classification Society',
      'f-pi-club': 'P&I Club',
      'f-pi-policy': 'P&I Policy No.',
      'f-pi-expiry': 'P&I Expiry Date',
    };
    return labels[formId] || formId.replace('f-', '').replace(/-/g, ' ');
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
