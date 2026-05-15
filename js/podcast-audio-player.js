/**
 * CanalClear Podcast Audio Player
 * Dynamically loads TTS audio for podcast episodes.
 * Replaces the "Audio coming soon" placeholder when audio is ready.
 */
(function () {
  var pathMatch = location.pathname.match(/\/podcast\/(episode-\d+)/);
  if (!pathMatch) return;
  var slug = pathMatch[1];

  // ── Custom player CSS ────────────────────────────────────────────────────
  var css = [
    '.pod-player-outer { margin-top: 0; }',
    '.pod-player-inner {',
    '  display: flex; flex-direction: column; gap: 0.85rem;',
    '}',
    '.pod-player-header {',
    '  display: flex; align-items: center; gap: 0.9rem;',
    '}',
    '.pod-player-icon {',
    '  width: 52px; height: 52px; background: rgba(0,212,170,0.15);',
    '  border-radius: 50%; display: flex; align-items: center;',
    '  justify-content: center; font-size: 1.4rem; flex-shrink: 0;',
    '}',
    '.pod-player-meta h3 {',
    '  font-family: "Space Grotesk", sans-serif; font-size: 1rem;',
    '  font-weight: 600; color: #F0F4F8; margin-bottom: 0.2rem;',
    '}',
    '.pod-player-meta p {',
    '  font-size: 0.82rem; color: #00D4AA; font-weight: 600;',
    '  letter-spacing: 0.04em; text-transform: uppercase;',
    '}',
    '.pod-controls {',
    '  display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;',
    '}',
    '.pod-play-btn {',
    '  flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%;',
    '  border: none; background: #00D4AA; color: #0A1628; font-size: 1rem;',
    '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
    '  transition: background 0.2s, transform 0.1s; line-height: 1;',
    '}',
    '.pod-play-btn:hover { background: #00b894; transform: scale(1.05); }',
    '.pod-play-btn:active { transform: scale(0.97); }',
    '.pod-time {',
    '  font-size: 0.78rem; color: #8899AA; font-variant-numeric: tabular-nums;',
    '  min-width: 2.5rem; text-align: center; flex-shrink: 0;',
    '}',
    '.pod-progress-wrap {',
    '  flex: 1; min-width: 80px; height: 5px; background: rgba(255,255,255,0.1);',
    '  border-radius: 5px; cursor: pointer; position: relative;',
    '}',
    '.pod-progress-fill {',
    '  height: 100%; background: #00D4AA; border-radius: 5px;',
    '  width: 0%; transition: width 0.1s linear; pointer-events: none;',
    '}',
    '.pod-speed { display: flex; gap: 0.25rem; flex-shrink: 0; }',
    '.pod-speed-btn {',
    '  background: transparent; border: 1px solid rgba(0,212,170,0.2);',
    '  border-radius: 6px; color: #8899AA; font-size: 0.72rem;',
    '  font-weight: 600; padding: 0.2rem 0.45rem; cursor: pointer;',
    '  transition: all 0.15s;',
    '}',
    '.pod-speed-btn:hover { border-color: #00D4AA; color: #00D4AA; }',
    '.pod-speed-btn.active {',
    '  background: rgba(0,212,170,0.15); border-color: #00D4AA; color: #00D4AA;',
    '}',
    '@media (max-width: 480px) {',
    '  .pod-player-icon { width: 44px; height: 44px; font-size: 1.1rem; }',
    '  .pod-time.pod-duration { display: none; }',
    '}',
  ].join('\n');

  function injectCSS() {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function formatTime(secs) {
    secs = Math.floor(secs || 0);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function buildPlayer(audioUrl, durationS, episodeTitle) {
    var wrap = document.querySelector('.audio-player-wrap');
    if (!wrap) return;

    injectCSS();

    // Build inner HTML
    var playerHTML = [
      '<div class="pod-player-outer">',
      '  <div class="pod-player-inner">',
      '    <div class="pod-player-header">',
      '      <div class="pod-player-icon">&#127911;</div>',
      '      <div class="pod-player-meta">',
      '        <h3>' + (episodeTitle || 'Clear Passage') + '</h3>',
      '        <p>&#127911;&nbsp; AI-Narrated Episode</p>',
      '      </div>',
      '    </div>',
      '    <div class="pod-controls">',
      '      <button class="pod-play-btn" id="podPlayBtn" aria-label="Play episode">',
      '        <span id="podPlayIcon">&#9654;</span>',
      '      </button>',
      '      <div class="pod-time" id="podCurrentTime">0:00</div>',
      '      <div class="pod-progress-wrap" id="podProgressWrap"',
      '           role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">',
      '        <div class="pod-progress-fill" id="podProgressFill"></div>',
      '      </div>',
      '      <div class="pod-time pod-duration" id="podDuration">',
      (durationS ? formatTime(durationS) : '--:--'),
      '      </div>',
      '      <div class="pod-speed" role="group" aria-label="Playback speed">',
      '        <button class="pod-speed-btn active" data-speed="1" aria-pressed="true">1&times;</button>',
      '        <button class="pod-speed-btn" data-speed="1.5" aria-pressed="false">1.5&times;</button>',
      '        <button class="pod-speed-btn" data-speed="2" aria-pressed="false">2&times;</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <audio id="podAudioEl" preload="none"></audio>',
      '</div>',
    ].join('');

    // Replace existing placeholder content
    wrap.innerHTML = playerHTML;

    var audio = document.getElementById('podAudioEl');
    var playBtn = document.getElementById('podPlayBtn');
    var playIcon = document.getElementById('podPlayIcon');
    var progressWrap = document.getElementById('podProgressWrap');
    var progressFill = document.getElementById('podProgressFill');
    var currentTimeEl = document.getElementById('podCurrentTime');
    var durationEl = document.getElementById('podDuration');
    var speedBtns = document.querySelectorAll('.pod-speed-btn');

    audio.src = audioUrl;
    audio.preload = 'metadata';

    playBtn.addEventListener('click', function () {
      if (audio.paused) {
        audio.play().catch(function () {});
        ccTrackSafe('podcast_audio_play', { episode: slug });
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', function () {
      playIcon.innerHTML = '&#10074;&#10074;';
    });
    audio.addEventListener('pause', function () {
      playIcon.innerHTML = '&#9654;';
    });
    audio.addEventListener('ended', function () {
      playIcon.innerHTML = '&#9654;';
      progressFill.style.width = '0%';
      currentTimeEl.textContent = '0:00';
      ccTrackSafe('podcast_audio_complete', { episode: slug });
    });

    audio.addEventListener('timeupdate', function () {
      if (!audio.duration) return;
      var pct = (audio.currentTime / audio.duration) * 100;
      progressFill.style.width = pct + '%';
      progressWrap.setAttribute('aria-valuenow', Math.round(pct));
      currentTimeEl.textContent = formatTime(audio.currentTime);
    });

    audio.addEventListener('loadedmetadata', function () {
      durationEl.textContent = formatTime(audio.duration);
    });

    progressWrap.addEventListener('click', function (e) {
      if (!audio.duration) return;
      var rect = progressWrap.getBoundingClientRect();
      audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
    });

    speedBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var speed = parseFloat(btn.getAttribute('data-speed'));
        audio.playbackRate = speed;
        speedBtns.forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      });
    });

    // Inject AudioObject schema
    try {
      var title = document.querySelector('h1') ? document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim() : slug;
      var schemaEl = document.createElement('script');
      schemaEl.type = 'application/ld+json';
      schemaEl.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'AudioObject',
        'name': title,
        'description': 'AI-narrated audio version of Clear Passage podcast episode: ' + title,
        'contentUrl': audioUrl,
        'encodingFormat': 'audio/mpeg',
        'inLanguage': 'en',
        'isAccessibleForFree': true,
      });
      document.head.appendChild(schemaEl);
    } catch (e) { /* schema is non-critical */ }
  }

  function ccTrackSafe(event, props) {
    try {
      var fn = window._ccTrack || function () {};
      fn(event, props);
    } catch (e) { /* non-critical */ }
  }

  function init() {
    // Get episode title from existing header
    var h3El = document.querySelector('.audio-info h3');
    var episodeTitle = h3El ? h3El.textContent.trim() : '';

    fetch('/api/podcast/' + encodeURIComponent(slug) + '/audio')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.audio_url) return; // not ready yet — keep placeholder
        buildPlayer(data.audio_url, data.duration_s, episodeTitle);
      })
      .catch(function () {}); // silent — no audio available yet
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
