/**
 * CanalClear Blog Audio Player
 * Dynamically loads TTS audio for blog posts.
 * Adds player after breadcrumb when audio is available.
 */
(function () {
  const slug = location.pathname.replace('/blog/', '').replace(/^\/|\/$/g, '');
  if (!slug || slug === 'blog') return;

  // ── CSS ───────────────────────────────────────────────────────────────────
  const css = `
.blog-audio-wrap {
  max-width: 760px;
  margin: 0 auto 1.5rem;
  padding: 0 2rem;
}
.blog-audio-inner {
  background: linear-gradient(135deg, rgba(0,212,170,0.07), rgba(0,180,216,0.04));
  border: 1px solid rgba(0,212,170,0.2);
  border-radius: 14px;
  padding: 1rem 1.25rem;
}
.blog-audio-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #00D4AA;
  margin-bottom: 0.65rem;
}
.blog-audio-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.blog-audio-play {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: #00D4AA;
  color: #0A1628;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.1s;
  line-height: 1;
}
.blog-audio-play:hover { background: #00b894; transform: scale(1.05); }
.blog-audio-play:active { transform: scale(0.97); }
.blog-audio-time {
  font-size: 0.78rem;
  color: #8899AA;
  font-variant-numeric: tabular-nums;
  min-width: 2.5rem;
  text-align: center;
  flex-shrink: 0;
}
.blog-audio-progress-wrap {
  flex: 1;
  min-width: 80px;
  height: 4px;
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
}
.blog-audio-progress-fill {
  height: 100%;
  background: #00D4AA;
  border-radius: 4px;
  width: 0%;
  transition: width 0.1s linear;
  pointer-events: none;
}
.blog-audio-speed {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}
.blog-speed-btn {
  background: transparent;
  border: 1px solid rgba(0,212,170,0.2);
  border-radius: 6px;
  color: #8899AA;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.2rem 0.45rem;
  cursor: pointer;
  transition: all 0.15s;
}
.blog-speed-btn:hover { border-color: #00D4AA; color: #00D4AA; }
.blog-speed-btn.active { background: rgba(0,212,170,0.15); border-color: #00D4AA; color: #00D4AA; }
@media (max-width: 480px) {
  .blog-audio-wrap { padding: 0 1rem; }
  .blog-audio-inner { padding: 0.85rem 1rem; }
  .blog-audio-time.blog-duration { display: none; }
}
  `;

  // ── HTML ──────────────────────────────────────────────────────────────────
  const html = `
<div class="blog-audio-wrap" id="blogAudioWrap" style="display:none">
  <div class="blog-audio-inner">
    <span class="blog-audio-label">🎧 Listen to this article</span>
    <div class="blog-audio-controls">
      <button class="blog-audio-play" id="blogAudioPlay" aria-label="Play article">
        <span id="blogPlayIcon">&#9654;</span>
      </button>
      <div class="blog-audio-time" id="blogCurrentTime">0:00</div>
      <div class="blog-audio-progress-wrap" id="blogProgressWrap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="blog-audio-progress-fill" id="blogProgressFill"></div>
      </div>
      <div class="blog-audio-time blog-duration" id="blogDuration">--:--</div>
      <div class="blog-audio-speed" role="group" aria-label="Playback speed">
        <button class="blog-speed-btn active" data-speed="1" aria-pressed="true">1×</button>
        <button class="blog-speed-btn" data-speed="1.5" aria-pressed="false">1.5×</button>
        <button class="blog-speed-btn" data-speed="2" aria-pressed="false">2×</button>
      </div>
    </div>
  </div>
  <audio id="blogAudioEl" preload="none"></audio>
</div>
  `;

  // ── Inject ────────────────────────────────────────────────────────────────
  function injectPlayer() {
    // Inject CSS
    var styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // Find insertion point: after breadcrumb, before article body
    var breadcrumb = document.querySelector('.breadcrumb');
    var articleBody = document.querySelector('.article-body, article');
    var insertBefore = articleBody || null;
    var parent = insertBefore ? insertBefore.parentNode : (breadcrumb ? breadcrumb.parentNode : document.body);

    var temp = document.createElement('div');
    temp.innerHTML = html;
    var playerEl = temp.firstElementChild;

    if (insertBefore) {
      parent.insertBefore(playerEl, insertBefore);
    } else if (breadcrumb) {
      breadcrumb.parentNode.insertBefore(playerEl, breadcrumb.nextSibling);
    } else {
      parent.appendChild(playerEl);
    }

    // Fetch audio URL
    fetch('/api/blog/' + encodeURIComponent(slug) + '/audio')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.audio_url) return; // no audio yet
        setupPlayer(data.audio_url, data.duration_s);
        injectAudioSchema(data.audio_url, slug);
      })
      .catch(function () {}); // silent — no audio available
  }

  // ── Player logic ──────────────────────────────────────────────────────────
  function setupPlayer(audioUrl, durationS) {
    var wrap = document.getElementById('blogAudioWrap');
    var audio = document.getElementById('blogAudioEl');
    var playBtn = document.getElementById('blogAudioPlay');
    var playIcon = document.getElementById('blogPlayIcon');
    var progressWrap = document.getElementById('blogProgressWrap');
    var progressFill = document.getElementById('blogProgressFill');
    var currentTimeEl = document.getElementById('blogCurrentTime');
    var durationEl = document.getElementById('blogDuration');
    var speedBtns = document.querySelectorAll('.blog-speed-btn');

    audio.src = audioUrl;
    audio.preload = 'metadata';

    // Show player
    wrap.style.display = '';

    // Pre-fill duration if known
    if (durationS) durationEl.textContent = formatTime(durationS);

    // Play / Pause
    playBtn.addEventListener('click', function () {
      if (audio.paused) {
        audio.play().catch(function () {});
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', function () {
      playIcon.innerHTML = '&#10074;&#10074;'; // pause icon
    });
    audio.addEventListener('pause', function () {
      playIcon.innerHTML = '&#9654;'; // play icon
    });
    audio.addEventListener('ended', function () {
      playIcon.innerHTML = '&#9654;';
      progressFill.style.width = '0%';
      currentTimeEl.textContent = '0:00';
    });

    // Time update
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

    // Progress click / scrub
    progressWrap.addEventListener('click', function (e) {
      if (!audio.duration) return;
      var rect = progressWrap.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      audio.currentTime = pct * audio.duration;
    });

    // Speed controls
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
  }

  // ── AudioObject Schema ────────────────────────────────────────────────────
  function injectAudioSchema(audioUrl, slug) {
    var title = document.querySelector('h1') ? document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim() : slug;
    var schemaScript = document.createElement('script');
    schemaScript.type = 'application/ld+json';
    schemaScript.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'AudioObject',
      'name': title,
      'description': 'AI-narrated audio version of the article: ' + title,
      'contentUrl': audioUrl,
      'encodingFormat': 'audio/mpeg',
      'inLanguage': 'en',
      'isAccessibleForFree': true,
    });
    document.head.appendChild(schemaScript);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function formatTime(seconds) {
    seconds = Math.floor(seconds || 0);
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPlayer);
  } else {
    injectPlayer();
  }
})();
