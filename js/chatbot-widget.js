/**
 * CanalClear AI Chatbot Widget
 * Self-contained floating widget. Inject into any page.
 * Dependencies: chatbot-knowledge.js must be loaded first.
 */
(function() {
  'use strict';

  // ─── Config ──────────────────────────────────────────────────────────────
  const LOGO_URL = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/9d5d2ef6-d9e0-40eb-ad15-df5e737cefc1.png';
  const SESSION_KEY = 'cc_chat_session';
  const HISTORY_KEY = 'cc_chat_history';
  const LANG_KEY    = 'cc_lang';

  // ─── Language Detection ───────────────────────────────────────────────────
  function detectLang() {
    // 1. Check localStorage (user selected via language switcher)
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && ['en','es','zh','el','ja'].includes(stored)) return stored;

    // 2. Check window.currentLang (set by page's i18n system)
    if (window.currentLang && ['en','es','zh','el','ja'].includes(window.currentLang)) return window.currentLang;

    // 3. Check <html lang> attribute
    const htmlLang = (document.documentElement.lang || '').toLowerCase().slice(0,2);
    if (['en','es','zh','el','ja'].includes(htmlLang)) return htmlLang;

    // 4. Browser language
    const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase().slice(0,2);
    if (['en','es','zh','el','ja'].includes(nav)) return nav;

    return 'en';
  }

  function t(key) {
    const lang = detectLang();
    const K = window.CANALCLEAR_KNOWLEDGE;
    if (!K) return key;
    const tr = K.translations[lang] || K.translations.en;
    return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), tr) || key;
  }

  // ─── Session ──────────────────────────────────────────────────────────────
  function getSessionId() {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) { s = 'sess_' + Math.random().toString(36).slice(2) + Date.now(); sessionStorage.setItem(SESSION_KEY, s); }
    return s;
  }

  function loadHistory() {
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }

  function saveHistory(h) {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-40)));
  }

  // ─── Analytics ────────────────────────────────────────────────────────────
  function trackEvent(type, props = {}) {
    fetch('/api/chat/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: type, session_id: getSessionId(), page_path: window.location.pathname, properties: props })
    }).catch(() => {});
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const CSS = `
    :root {
      --cc-navy:   #0A1628;
      --cc-deep:   #0F1D32;
      --cc-slate:  #1A2B45;
      --cc-slate2: #1E3350;
      --cc-teal:   #00D4AA;
      --cc-cyan:   #00B4D8;
      --cc-white:  #F0F4F8;
      --cc-gray:   #8899AA;
      --cc-red:    #FF6B6B;
      --cc-border: rgba(0,212,170,0.18);
    }

    #cc-widget-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00D4AA, #00B4D8);
      border: none;
      cursor: pointer;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,212,170,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
      padding: 0;
    }
    #cc-widget-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(0,212,170,0.55);
    }
    #cc-widget-btn img {
      width: 36px;
      height: 36px;
      object-fit: contain;
      border-radius: 50%;
    }
    #cc-widget-btn .cc-notif {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 18px;
      height: 18px;
      background: var(--cc-red);
      border-radius: 50%;
      border: 2px solid #fff;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
    }

    #cc-widget-panel {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 120px);
      background: var(--cc-navy);
      border: 1px solid var(--cc-border);
      border-radius: 20px;
      z-index: 99998;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 48px rgba(0,0,0,0.5);
      transform: scale(0.92) translateY(12px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease;
      overflow: hidden;
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #cc-widget-panel.cc-open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    @media (max-width: 480px) {
      #cc-widget-panel {
        bottom: 0;
        right: 0;
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        border-radius: 0;
      }
      #cc-widget-btn {
        bottom: 16px;
        right: 16px;
      }
    }

    /* Header */
    .cc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: linear-gradient(135deg, rgba(0,212,170,0.12), rgba(0,180,216,0.08));
      border-bottom: 1px solid var(--cc-border);
      flex-shrink: 0;
    }
    .cc-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .cc-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00D4AA, #00B4D8);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }
    .cc-avatar img {
      width: 32px;
      height: 32px;
      object-fit: contain;
    }
    .cc-header-info h4 {
      color: var(--cc-white);
      font-size: 0.9rem;
      font-weight: 600;
      margin: 0;
      line-height: 1.2;
    }
    .cc-status {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.72rem;
      color: var(--cc-teal);
    }
    .cc-status-dot {
      width: 6px;
      height: 6px;
      background: var(--cc-teal);
      border-radius: 50%;
      animation: cc-pulse 2s infinite;
    }
    @keyframes cc-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .cc-close-btn {
      background: none;
      border: none;
      color: var(--cc-gray);
      cursor: pointer;
      padding: 6px;
      border-radius: 8px;
      font-size: 1.1rem;
      line-height: 1;
      transition: color 0.2s, background 0.2s;
    }
    .cc-close-btn:hover { color: var(--cc-white); background: rgba(255,255,255,0.08); }

    /* Screens */
    .cc-screen {
      display: none;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }
    .cc-screen.cc-active { display: flex; }

    /* Chat Screen */
    .cc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    .cc-messages::-webkit-scrollbar { width: 4px; }
    .cc-messages::-webkit-scrollbar-track { background: transparent; }
    .cc-messages::-webkit-scrollbar-thumb { background: var(--cc-slate2); border-radius: 2px; }

    .cc-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 0.875rem;
      line-height: 1.55;
      word-break: break-word;
      animation: cc-fadein 0.2s ease;
    }
    @keyframes cc-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .cc-msg.cc-bot {
      background: var(--cc-slate);
      color: var(--cc-white);
      border-bottom-left-radius: 4px;
      align-self: flex-start;
    }
    .cc-msg.cc-user {
      background: linear-gradient(135deg, #00D4AA, #00B4D8);
      color: var(--cc-navy);
      border-bottom-right-radius: 4px;
      align-self: flex-end;
      font-weight: 500;
    }

    .cc-msg a { color: var(--cc-teal); text-decoration: underline; }

    /* Typing indicator */
    .cc-typing {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: var(--cc-slate);
      border-radius: 14px;
      border-bottom-left-radius: 4px;
      align-self: flex-start;
      animation: cc-fadein 0.2s ease;
    }
    .cc-typing-dots {
      display: flex;
      gap: 4px;
    }
    .cc-typing-dots span {
      width: 7px;
      height: 7px;
      background: var(--cc-teal);
      border-radius: 50%;
      animation: cc-bounce 1.2s infinite;
    }
    .cc-typing-dots span:nth-child(2) { animation-delay: 0.15s; }
    .cc-typing-dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes cc-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
      40% { transform: scale(1); opacity: 1; }
    }
    .cc-typing-label { font-size: 0.75rem; color: var(--cc-gray); }

    /* Quick replies */
    .cc-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 16px 12px;
    }
    .cc-quick-btn {
      background: var(--cc-slate);
      border: 1px solid var(--cc-border);
      color: var(--cc-teal);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.18s;
      font-family: inherit;
      white-space: nowrap;
    }
    .cc-quick-btn:hover { background: rgba(0,212,170,0.12); border-color: var(--cc-teal); }

    /* Pricing card */
    .cc-pricing-card {
      background: var(--cc-deep);
      border: 1px solid var(--cc-border);
      border-radius: 12px;
      padding: 12px 14px;
      margin-top: 8px;
      font-size: 0.82rem;
    }
    .cc-pricing-card h5 {
      color: var(--cc-teal);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin: 0 0 8px;
    }
    .cc-tier {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .cc-tier:last-child { border-bottom: none; }
    .cc-tier-name { color: var(--cc-white); font-weight: 500; }
    .cc-tier-price { color: var(--cc-teal); font-weight: 600; font-size: 0.85rem; }
    .cc-pricing-ctas {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .cc-cta-btn {
      background: linear-gradient(135deg, #00D4AA, #00B4D8);
      color: var(--cc-navy);
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      font-family: inherit;
      transition: opacity 0.2s;
      display: inline-block;
    }
    .cc-cta-btn:hover { opacity: 0.88; }
    .cc-cta-btn.cc-secondary {
      background: transparent;
      border: 1px solid var(--cc-border);
      color: var(--cc-teal);
    }

    /* Input area */
    .cc-input-area {
      padding: 12px 16px;
      border-top: 1px solid rgba(255,255,255,0.06);
      background: var(--cc-deep);
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
    }
    .cc-input {
      flex: 1;
      background: var(--cc-slate);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 10px 14px;
      color: var(--cc-white);
      font-size: 0.875rem;
      font-family: inherit;
      resize: none;
      min-height: 42px;
      max-height: 100px;
      outline: none;
      transition: border-color 0.2s;
      line-height: 1.4;
    }
    .cc-input::placeholder { color: var(--cc-gray); }
    .cc-input:focus { border-color: var(--cc-teal); }
    .cc-send-btn {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #00D4AA, #00B4D8);
      border: none;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.2s;
      color: var(--cc-navy);
      font-size: 1rem;
    }
    .cc-send-btn:hover { opacity: 0.85; }
    .cc-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Footer */
    .cc-footer {
      text-align: center;
      padding: 6px;
      font-size: 0.68rem;
      color: rgba(136,153,170,0.7);
      flex-shrink: 0;
      border-top: 1px solid rgba(255,255,255,0.04);
    }
    .cc-footer a { color: var(--cc-teal); text-decoration: none; }

    /* Schedule Screen */
    .cc-schedule-screen {
      overflow-y: auto;
      padding: 16px;
    }
    .cc-schedule-screen h3 {
      color: var(--cc-white);
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 16px;
    }
    .cc-form-group {
      margin-bottom: 12px;
    }
    .cc-form-group label {
      display: block;
      font-size: 0.78rem;
      color: var(--cc-gray);
      margin-bottom: 5px;
      font-weight: 500;
    }
    .cc-form-group input,
    .cc-form-group select,
    .cc-form-group textarea {
      width: 100%;
      background: var(--cc-slate);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 9px 12px;
      color: var(--cc-white);
      font-size: 0.85rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;
    }
    .cc-form-group input:focus,
    .cc-form-group select:focus,
    .cc-form-group textarea:focus { border-color: var(--cc-teal); }
    .cc-form-group select option { background: var(--cc-slate); }
    .cc-form-group textarea { resize: vertical; min-height: 64px; }
    .cc-form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .cc-back-btn {
      background: none;
      border: 1px solid rgba(255,255,255,0.12);
      color: var(--cc-gray);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.8rem;
      cursor: pointer;
      font-family: inherit;
      margin-bottom: 14px;
      transition: all 0.2s;
    }
    .cc-back-btn:hover { color: var(--cc-white); border-color: rgba(255,255,255,0.25); }
    .cc-submit-btn {
      width: 100%;
      background: linear-gradient(135deg, #00D4AA, #00B4D8);
      color: var(--cc-navy);
      border: none;
      border-radius: 10px;
      padding: 11px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.2s;
      margin-top: 6px;
    }
    .cc-submit-btn:hover { opacity: 0.88; }
    .cc-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .cc-success-msg {
      background: rgba(0,212,170,0.12);
      border: 1px solid var(--cc-border);
      border-radius: 12px;
      padding: 16px;
      color: var(--cc-teal);
      text-align: center;
      font-size: 0.9rem;
      display: none;
      margin-top: 10px;
      line-height: 1.6;
    }
    .cc-error-msg {
      background: rgba(255,107,107,0.1);
      border: 1px solid rgba(255,107,107,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--cc-red);
      font-size: 0.8rem;
      display: none;
      margin-top: 8px;
    }

    /* Scroll to bottom arrow (when new messages arrive) */
    .cc-scroll-hint {
      position: absolute;
      bottom: 120px;
      right: 40px;
      background: var(--cc-slate2);
      border: 1px solid var(--cc-border);
      color: var(--cc-teal);
      border-radius: 20px;
      padding: 5px 12px;
      font-size: 0.75rem;
      cursor: pointer;
      display: none;
      z-index: 2;
    }
  `;

  // ─── DOM Construction ─────────────────────────────────────────────────────
  function buildWidget() {
    // Inject styles
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Widget button
    const btn = document.createElement('button');
    btn.id = 'cc-widget-btn';
    btn.setAttribute('aria-label', 'Open CanalClear Chat');
    btn.innerHTML = `<img src="${LOGO_URL}" alt="CanalClear"><span class="cc-notif"></span>`;

    // Panel
    const panel = document.createElement('div');
    panel.id = 'cc-widget-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'CanalClear Chat');

    panel.innerHTML = buildPanelHTML();

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    // Show notif dot once if user hasn't interacted
    const history = loadHistory();
    if (history.length === 0) {
      setTimeout(() => {
        const dot = btn.querySelector('.cc-notif');
        if (dot) { dot.style.display = 'flex'; }
      }, 3000);
    }

    bindEvents(btn, panel);
  }

  function buildPanelHTML() {
    return `
      <!-- Header -->
      <div class="cc-header">
        <div class="cc-header-left">
          <div class="cc-avatar"><img src="${LOGO_URL}" alt="Clara"></div>
          <div class="cc-header-info">
            <h4>Clara</h4>
            <div class="cc-status">
              <span class="cc-status-dot"></span>
              CanalClear AI
            </div>
          </div>
        </div>
        <button class="cc-close-btn" id="cc-close-btn" aria-label="Close chat">✕</button>
      </div>

      <!-- Chat Screen -->
      <div class="cc-screen cc-active" id="cc-chat-screen">
        <div class="cc-messages" id="cc-messages"></div>
        <div class="cc-quick-replies" id="cc-quick-replies"></div>
        <div class="cc-input-area">
          <textarea class="cc-input" id="cc-input" rows="1" placeholder="" aria-label="Type a message"></textarea>
          <button class="cc-send-btn" id="cc-send-btn" aria-label="Send message">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div class="cc-footer"><a href="/" aria-label="CanalClear">Powered by CanalClear</a></div>
      </div>

      <!-- Schedule Screen -->
      <div class="cc-screen" id="cc-schedule-screen">
        <div class="cc-schedule-screen" id="cc-schedule-form-wrap">
          <button class="cc-back-btn" id="cc-back-btn">← Back to Chat</button>
          <h3 id="cc-schedule-title"></h3>
          <form id="cc-meeting-form" novalidate>
            <div class="cc-form-group">
              <label for="cc-name" id="cc-name-label"></label>
              <input type="text" id="cc-name" required autocomplete="name">
            </div>
            <div class="cc-form-group">
              <label for="cc-email" id="cc-email-label"></label>
              <input type="email" id="cc-email" required autocomplete="email">
            </div>
            <div class="cc-form-group">
              <label for="cc-company" id="cc-company-label"></label>
              <input type="text" id="cc-company" autocomplete="organization">
            </div>
            <div class="cc-form-group">
              <label for="cc-fleet" id="cc-fleet-label"></label>
              <select id="cc-fleet">
                <option value="">—</option>
              </select>
            </div>
            <div class="cc-form-row">
              <div class="cc-form-group">
                <label for="cc-date" id="cc-date-label"></label>
                <input type="date" id="cc-date" required>
              </div>
              <div class="cc-form-group">
                <label for="cc-time" id="cc-time-label"></label>
                <select id="cc-time" required>
                  <option value="">—</option>
                </select>
              </div>
            </div>
            <div class="cc-form-group">
              <label for="cc-tz" id="cc-tz-label"></label>
              <select id="cc-tz">
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Chicago">Central (CT)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
                <option value="America/Panama">Panama (ET)</option>
                <option value="Europe/London">London (GMT)</option>
                <option value="Europe/Athens">Athens (EET)</option>
                <option value="Asia/Shanghai">Shanghai (CST)</option>
                <option value="Asia/Tokyo">Tokyo (JST)</option>
                <option value="Asia/Singapore">Singapore (SGT)</option>
              </select>
            </div>
            <div class="cc-form-group">
              <label for="cc-msg" id="cc-msg-label"></label>
              <textarea id="cc-msg" rows="2"></textarea>
            </div>
            <div class="cc-error-msg" id="cc-form-error"></div>
            <div class="cc-success-msg" id="cc-form-success"></div>
            <button type="submit" class="cc-submit-btn" id="cc-submit-btn"></button>
          </form>
        </div>
        <div class="cc-footer"><a href="/" aria-label="CanalClear">Powered by CanalClear</a></div>
      </div>
    `;
  }

  // ─── Events ───────────────────────────────────────────────────────────────
  function bindEvents(btn, panel) {
    let isOpen = false;

    btn.addEventListener('click', () => {
      isOpen ? closePanel() : openPanel();
    });

    panel.querySelector('#cc-close-btn').addEventListener('click', closePanel);
    panel.querySelector('#cc-back-btn').addEventListener('click', showChatScreen);
    panel.querySelector('#cc-send-btn').addEventListener('click', handleSend);

    const input = panel.querySelector('#cc-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    panel.querySelector('#cc-meeting-form').addEventListener('submit', handleMeetingSubmit);

    function openPanel() {
      isOpen = true;
      panel.classList.add('cc-open');
      btn.querySelector('.cc-notif').style.display = 'none';
      trackEvent('chat_open', { page: window.location.pathname });
      initChat();
      setTimeout(() => input.focus(), 250);
    }

    function closePanel() {
      isOpen = false;
      panel.classList.remove('cc-open');
    }
  }

  // ─── Chat Logic ───────────────────────────────────────────────────────────
  let chatInited = false;
  let isThinking = false;
  let conversationHistory = [];

  function initChat() {
    if (chatInited) return;
    chatInited = true;

    const history = loadHistory();
    conversationHistory = history.filter(m => m.role).map(m => ({ role: m.role, content: m.content }));

    const messagesEl = document.getElementById('cc-messages');

    if (history.length > 0) {
      // Restore session
      history.forEach(m => {
        if (m.type === 'bot') appendBotMessage(m.content, false);
        else if (m.type === 'user') appendUserMessage(m.content, false);
        else if (m.type === 'pricing') appendPricingCard(false);
      });
    } else {
      // Welcome message
      const welcomeMsg = t('welcome_title') + '\n\n' + t('welcome_msg');
      appendBotMessage(welcomeMsg, true);
      showQuickReplies();
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
    document.getElementById('cc-input').placeholder = t('placeholder');
  }

  function showQuickReplies() {
    const qa = t('quick_actions');
    const qr = document.getElementById('cc-quick-replies');
    qr.innerHTML = '';

    const actions = [
      { label: qa.what_is, msg: qa.what_is },
      { label: qa.pricing, msg: qa.pricing },
      { label: qa.schedule, action: 'schedule' },
      { label: qa.compliance, href: '/compliance-score' },
      { label: qa.contact, msg: qa.contact }
    ];

    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'cc-quick-btn';
      b.textContent = a.label;
      b.addEventListener('click', () => {
        qr.innerHTML = '';
        if (a.action === 'schedule') {
          showScheduleScreen();
          trackEvent('chat_schedule_click', {});
        } else if (a.href) {
          window.location.href = a.href;
        } else if (a.msg) {
          sendMessage(a.msg);
        }
      });
      qr.appendChild(b);
    });
  }

  function handleSend() {
    const input = document.getElementById('cc-input');
    const msg = input.value.trim();
    if (!msg || isThinking) return;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(msg);
    trackEvent('chat_message_sent', { message_length: msg.length });
  }

  function sendMessage(userMsg) {
    appendUserMessage(userMsg, true);
    document.getElementById('cc-quick-replies').innerHTML = '';

    conversationHistory.push({ role: 'user', content: userMsg });
    isThinking = true;
    showTyping();

    const K = window.CANALCLEAR_KNOWLEDGE;
    const systemPrompt = buildSystemPrompt(K, detectLang());

    fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conversationHistory.slice(-12),
        system: systemPrompt,
        language: detectLang()
      })
    })
    .then(r => r.json())
    .then(data => {
      hideTyping();
      isThinking = false;
      if (data.success && data.reply) {
        const reply = data.reply;
        conversationHistory.push({ role: 'assistant', content: reply });

        // Check if pricing should be shown
        const lc = userMsg.toLowerCase();
        if (lc.includes('pric') || lc.includes('cost') || lc.includes('plan') || lc.includes('tier') || lc.includes('precio') || lc.includes('价格') || lc.includes('値段')) {
          appendBotMessage(reply, true);
          appendPricingCard(true);
        } else if (reply.includes('SHOW_SCHEDULE_FORM')) {
          appendBotMessage(reply.replace('SHOW_SCHEDULE_FORM', '').trim(), true);
          showScheduleScreen();
        } else {
          appendBotMessage(reply, true);
          // If reply mentions schedule, show button
          if (reply.toLowerCase().includes('schedule') || reply.toLowerCase().includes('meeting') || reply.toLowerCase().includes('reunión')) {
            appendScheduleCTA();
          }
        }
        saveHistory(buildHistorySnapshot());
      } else {
        appendBotMessage(t('fallback'), true);
        appendContactCTA();
      }
    })
    .catch(() => {
      hideTyping();
      isThinking = false;
      appendBotMessage(t('fallback'), true);
      appendContactCTA();
    });
  }

  function buildSystemPrompt(K, lang) {
    if (!K) return 'You are Clara, CanalClear\'s AI assistant.';
    const tr = K.translations[lang] || K.translations.en;
    return `You are Clara, CanalClear's friendly and knowledgeable AI assistant. CanalClear automates Panama Canal customs compliance for fleet operators, ship agents, and charterers.

KNOWLEDGE:
${JSON.stringify({
  company: K.company,
  what_we_do: K.what_we_do,
  pricing: K.pricing,
  faq: K.faq
}, null, 2)}

INSTRUCTIONS:
- Answer in ${lang === 'es' ? 'Spanish' : lang === 'zh' ? 'Chinese (Simplified)' : lang === 'el' ? 'Greek' : lang === 'ja' ? 'Japanese' : 'English'}.
- Be concise, professional, and helpful. 2-4 sentences max unless a detailed explanation is needed.
- For pricing questions, summarize the tiers clearly. Use exact prices from the knowledge base.
- If asked to schedule a meeting, respond enthusiastically and say you'll open the scheduling form.
- If you don't know something, say: "${tr.fallback}"
- Never make up prices, features, or regulations.
- Always be positive about CanalClear's capabilities.
- For regulatory questions, be accurate — wrong advice about Panama Canal compliance has real financial consequences.`;
  }

  function buildHistorySnapshot() {
    return conversationHistory.map(m => ({ type: m.role === 'user' ? 'user' : 'bot', role: m.role, content: m.content }));
  }

  // ─── Message Rendering ────────────────────────────────────────────────────
  function appendBotMessage(text, animate) {
    const el = document.createElement('div');
    el.className = 'cc-msg cc-bot';
    el.innerHTML = formatText(text);
    if (!animate) el.style.animation = 'none';
    document.getElementById('cc-messages').appendChild(el);
    scrollToBottom();
  }

  function appendUserMessage(text, animate) {
    const el = document.createElement('div');
    el.className = 'cc-msg cc-user';
    el.textContent = text;
    if (!animate) el.style.animation = 'none';
    document.getElementById('cc-messages').appendChild(el);
    scrollToBottom();
  }

  function appendPricingCard(animate) {
    const K = window.CANALCLEAR_KNOWLEDGE;
    if (!K) return;
    const card = document.createElement('div');
    card.className = 'cc-msg cc-bot';
    if (!animate) card.style.animation = 'none';
    const tiers = K.pricing.tiers.map(t =>
      `<div class="cc-tier"><span class="cc-tier-name">${t.name}</span><span class="cc-tier-price">${t.price}</span></div>`
    ).join('');
    card.innerHTML = `
      <div class="cc-pricing-card">
        <h5>📊 CanalClear Pricing</h5>
        ${tiers}
        <div class="cc-pricing-ctas">
          <a href="/pricing" class="cc-cta-btn">View Full Pricing</a>
          <button class="cc-cta-btn cc-secondary" onclick="document.getElementById('cc-schedule-screen').classList.add('cc-active');document.getElementById('cc-chat-screen').classList.remove('cc-active');canalclearInitScheduleForm();">Get Free Assessment</button>
        </div>
      </div>`;
    document.getElementById('cc-messages').appendChild(card);
    scrollToBottom();
  }

  function appendScheduleCTA() {
    const wrapper = document.createElement('div');
    wrapper.style.alignSelf = 'flex-start';
    wrapper.style.padding = '4px 0';
    const btn = document.createElement('button');
    btn.className = 'cc-cta-btn';
    btn.style.fontSize = '0.8rem';
    btn.textContent = '📅 ' + t('quick_actions.schedule');
    btn.addEventListener('click', showScheduleScreen);
    wrapper.appendChild(btn);
    document.getElementById('cc-messages').appendChild(wrapper);
    scrollToBottom();
  }

  function appendContactCTA() {
    const wrapper = document.createElement('div');
    wrapper.style.alignSelf = 'flex-start';
    const btn = document.createElement('a');
    btn.className = 'cc-cta-btn cc-secondary';
    btn.style.fontSize = '0.8rem';
    btn.href = 'mailto:support@canalclear.org';
    btn.textContent = '✉️ ' + t('contact_team');
    wrapper.appendChild(btn);
    document.getElementById('cc-messages').appendChild(wrapper);
    scrollToBottom();
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'cc-typing';
    el.id = 'cc-typing-indicator';
    el.innerHTML = `
      <div class="cc-typing-dots"><span></span><span></span><span></span></div>
      <span class="cc-typing-label">${t('typing')}</span>`;
    document.getElementById('cc-messages').appendChild(el);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById('cc-typing-indicator');
    if (el) el.remove();
  }

  function scrollToBottom() {
    const el = document.getElementById('cc-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function formatText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  // ─── Schedule Screen ──────────────────────────────────────────────────────
  function showChatScreen() {
    document.getElementById('cc-chat-screen').classList.add('cc-active');
    document.getElementById('cc-schedule-screen').classList.remove('cc-active');
  }

  function showScheduleScreen() {
    document.getElementById('cc-schedule-screen').classList.add('cc-active');
    document.getElementById('cc-chat-screen').classList.remove('cc-active');
    initScheduleForm();
  }

  // Expose for inline onclick
  window.canalclearInitScheduleForm = function() { initScheduleForm(); };

  function initScheduleForm() {
    document.getElementById('cc-schedule-title').textContent = t('schedule_title');
    document.getElementById('cc-name-label').textContent = t('name_label');
    document.getElementById('cc-email-label').textContent = t('email_label');
    document.getElementById('cc-company-label').textContent = t('company_label');
    document.getElementById('cc-fleet-label').textContent = t('fleet_label');
    document.getElementById('cc-date-label').textContent = t('date_label');
    document.getElementById('cc-time-label').textContent = t('time_label');
    document.getElementById('cc-tz-label').textContent = t('timezone_label');
    document.getElementById('cc-msg-label').textContent = t('message_label');
    document.getElementById('cc-submit-btn').textContent = t('submit_btn');

    // Set min date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('cc-date').min = tomorrow.toISOString().split('T')[0];

    // Populate fleet options
    const fleetSel = document.getElementById('cc-fleet');
    if (fleetSel.options.length <= 1) {
      t('fleet_options').forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        fleetSel.appendChild(o);
      });
    }

    // Populate time options
    const timeSel = document.getElementById('cc-time');
    if (timeSel.options.length <= 1) {
      t('time_options').forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        timeSel.appendChild(o);
      });
    }

    // Detect user timezone
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const tzSel = document.getElementById('cc-tz');
      for (let i = 0; i < tzSel.options.length; i++) {
        if (tzSel.options[i].value === tz) { tzSel.value = tz; break; }
      }
    } catch {}
  }

  async function handleMeetingSubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById('cc-form-error');
    const successEl = document.getElementById('cc-form-success');
    const submitBtn = document.getElementById('cc-submit-btn');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    const name = document.getElementById('cc-name').value.trim();
    const email = document.getElementById('cc-email').value.trim();
    const date = document.getElementById('cc-date').value;
    const time = document.getElementById('cc-time').value;

    if (!name) { showFormError(t('name_label') + ' is required'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFormError(t('email_label') + ' is required'); return; }
    if (!date) { showFormError(t('date_label') + ' is required'); return; }
    if (!time) { showFormError(t('time_label') + ' is required'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = t('submitting');

    try {
      const res = await fetch('/api/meeting-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          company: document.getElementById('cc-company').value.trim(),
          fleet_size: document.getElementById('cc-fleet').value,
          preferred_date: date,
          preferred_time: time,
          timezone: document.getElementById('cc-tz').value,
          message: document.getElementById('cc-msg').value.trim()
        })
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById('cc-meeting-form').style.display = 'none';
        successEl.textContent = t('success_msg');
        successEl.style.display = 'block';
        trackEvent('meeting_request_submitted', { fleet_size: document.getElementById('cc-fleet').value });

        // Meta Pixel Lead event
        if (window.fbq) { window.fbq('track', 'Lead', { content_name: 'Meeting Request' }); }

        // Return to chat after 3s
        setTimeout(() => {
          showChatScreen();
          appendBotMessage(t('success_msg'), true);
          document.getElementById('cc-meeting-form').style.display = 'block';
          document.getElementById('cc-meeting-form').reset();
          successEl.style.display = 'none';
          submitBtn.disabled = false;
          submitBtn.textContent = t('submit_btn');
        }, 3000);
      } else {
        throw new Error(data.message || 'Failed');
      }
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = t('submit_btn');
      showFormError(t('error_msg'));
    }
  }

  function showFormError(msg) {
    const el = document.getElementById('cc-form-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
  } else {
    buildWidget();
  }

})();
