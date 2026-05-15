// WhatsApp floating button — injects "Message the Founder" CTA on all pages.
// Opens wa.me with a pre-filled message; uses official WhatsApp brand green.
(function () {
  'use strict';

  var WHATSAPP_URL =
    'https://wa.me/19543098130?text=' +
    encodeURIComponent("Hi, I'd like to learn more about CanalClear");

  var style = document.createElement('style');
  style.textContent = [
    '#wa-float-btn {',
    '  position: fixed;',
    '  bottom: 90px;',
    '  left: 24px !important;',
    '  right: auto !important;',
    '  z-index: 9999;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 10px;',
    '  background: #25D366;',
    '  color: #ffffff;',
    '  text-decoration: none;',
    '  padding: 12px 18px 12px 14px;',
    '  border-radius: 50px;',
    '  box-shadow: 0 4px 18px rgba(0,0,0,0.35);',
    '  font-family: "IBM Plex Sans", system-ui, sans-serif;',
    '  font-size: 0.88rem;',
    '  font-weight: 600;',
    '  letter-spacing: 0.01em;',
    '  white-space: nowrap;',
    '  opacity: 0;',
    '  transform: translateY(16px);',
    '  transition: opacity 0.4s ease, transform 0.4s ease, box-shadow 0.2s ease, background 0.2s ease;',
    '  -webkit-tap-highlight-color: transparent;',
    '}',
    '#wa-float-btn.wa-visible {',
    '  opacity: 1;',
    '  transform: translateY(0);',
    '}',
    '#wa-float-btn:hover {',
    '  background: #1ebe5d;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,0.45);',
    '}',
    '#wa-float-btn:active {',
    '  transform: scale(0.96);',
    '}',
    '#wa-float-icon {',
    '  flex-shrink: 0;',
    '  width: 22px;',
    '  height: 22px;',
    '}',
    '#wa-float-label {',
    '  display: inline;',
    '}',
    /* Mobile: keep label visible but slightly smaller; ensure it doesn't overlap bottom nav */
    '@media (max-width: 480px) {',
    '  #wa-float-btn {',
    '    bottom: 80px;',
    '    left: 14px !important;',
    '    right: auto !important;',
    '    padding: 11px 14px 11px 12px;',
    '    font-size: 0.82rem;',
    '    gap: 8px;',
    '  }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // WhatsApp official SVG icon (white, no wordmark — brand-safe placeholder)
  var svgIcon =
    '<svg id="wa-float-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="16" fill="#25D366"/>' +
    '<path fill="#fff" d="M16 6.4C10.698 6.4 6.4 10.698 6.4 16c0 1.733.456 3.358 1.25 4.768L6.4 25.6l4.965-1.23A9.556 9.556 0 0016 25.6c5.302 0 9.6-4.298 9.6-9.6S21.302 6.4 16 6.4zm0 17.472a7.832 7.832 0 01-4.013-1.106l-.287-.172-2.947.73.765-2.873-.19-.298A7.84 7.84 0 018.16 16c0-4.326 3.514-7.84 7.84-7.84 4.326 0 7.84 3.514 7.84 7.84 0 4.326-3.514 7.84-7.84 7.84zm4.302-5.874c-.236-.118-1.395-.688-1.611-.766-.216-.077-.374-.118-.532.119-.158.236-.61.766-.748.923-.138.158-.276.177-.512.059-.236-.118-.995-.367-1.896-1.17-.701-.625-1.174-1.397-1.312-1.633-.138-.236-.015-.364.103-.481.106-.106.236-.276.354-.413.118-.138.157-.236.236-.394.079-.158.039-.296-.02-.413-.059-.118-.532-1.283-.729-1.757-.192-.461-.387-.398-.532-.406l-.453-.007a.868.868 0 00-.63.296c-.216.236-.827.808-.827 1.97 0 1.162.847 2.284.964 2.442.118.158 1.667 2.546 4.039 3.569.565.244 1.006.39 1.35.498.567.18 1.083.155 1.49.094.454-.068 1.395-.57 1.592-1.12.197-.55.197-1.021.138-1.12-.059-.098-.217-.157-.453-.275z"/>' +
    '</svg>';

  var btn = document.createElement('a');
  btn.id = 'wa-float-btn';
  btn.href = WHATSAPP_URL;
  btn.target = '_blank';
  btn.rel = 'noopener noreferrer';
  btn.setAttribute('aria-label', 'Message the Founder on WhatsApp');
  btn.innerHTML = svgIcon + '<span id="wa-float-label">Message the Founder</span>';

  document.body.appendChild(btn);

  // Fade-in after short delay so it doesn't distract on page load
  setTimeout(function () {
    btn.classList.add('wa-visible');
  }, 900);
})();
