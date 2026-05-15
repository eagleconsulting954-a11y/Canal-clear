/**
 * CanalClear Podcast Embed Player
 * Handles inline podcast player cards embedded in blog posts
 * + Related Episodes / Related Blog Posts section interactions.
 * i18n: EN / ES / ZH / EL / JA
 */
(function () {
  'use strict';

  // ── i18n ─────────────────────────────────────────────────────────────────
  var I18N = {
    en: {
      listen_label: '🎧 Listen to this topic',
      listen_on_podcast: 'Listen on Clear Passage',
      related_episodes: 'Related Podcast Episodes',
      related_posts: 'Related Blog Posts',
      play: 'Play',
      pause: 'Pause',
      min: 'min',
      ep: 'Ep.',
      series: 'Clear Passage',
    },
    es: {
      listen_label: '🎧 Escucha este tema',
      listen_on_podcast: 'Escuchar en Clear Passage',
      related_episodes: 'Episodios de Podcast Relacionados',
      related_posts: 'Artículos del Blog Relacionados',
      play: 'Reproducir',
      pause: 'Pausar',
      min: 'min',
      ep: 'Ep.',
      series: 'Clear Passage',
    },
    zh: {
      listen_label: '🎧 收听此主题',
      listen_on_podcast: '在 Clear Passage 收听',
      related_episodes: '相关播客节目',
      related_posts: '相关博客文章',
      play: '播放',
      pause: '暂停',
      min: '分钟',
      ep: '第',
      series: 'Clear Passage',
    },
    el: {
      listen_label: '🎧 Ακούστε αυτό το θέμα',
      listen_on_podcast: 'Ακούστε στο Clear Passage',
      related_episodes: 'Σχετικά Επεισόδια Podcast',
      related_posts: 'Σχετικές Αναρτήσεις Blog',
      play: 'Αναπαραγωγή',
      pause: 'Παύση',
      min: 'λεπτ.',
      ep: 'Επ.',
      series: 'Clear Passage',
    },
    ja: {
      listen_label: '🎧 このトピックを聴く',
      listen_on_podcast: 'Clear Passage で聴く',
      related_episodes: '関連ポッドキャストエピソード',
      related_posts: '関連ブログ記事',
      play: '再生',
      pause: '一時停止',
      min: '分',
      ep: 'Ep.',
      series: 'Clear Passage',
    },
  };

  function detectLang() {
    var qs = new URLSearchParams(window.location.search).get('lang');
    if (qs && I18N[qs]) return qs;
    var nav = (navigator.language || 'en').toLowerCase().split('-')[0];
    return I18N[nav] ? nav : 'en';
  }

  var lang = detectLang();
  var t = I18N[lang];

  // ── Utilities ─────────────────────────────────────────────────────────────
  function formatTime(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  var CSS = `
/* ── Podcast Embed Card ── */
.podcast-embed-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: linear-gradient(135deg, rgba(0,212,170,0.08) 0%, rgba(0,180,216,0.05) 100%);
  border: 1px solid rgba(0,212,170,0.28);
  border-radius: 14px;
  padding: 1rem 1.25rem;
  margin: 1.75rem 0;
  position: relative;
  overflow: hidden;
  cursor: default;
}
.podcast-embed-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, #00D4AA, #00B4D8);
  border-radius: 14px 14px 0 0;
}
.podcast-embed-play-btn {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: #00D4AA;
  color: #0A1628;
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, transform 0.15s;
  line-height: 1;
}
.podcast-embed-play-btn:hover { background: #00b894; transform: scale(1.06); }
.podcast-embed-play-btn:active { transform: scale(0.96); }
.podcast-embed-info {
  flex: 1;
  min-width: 0;
}
.podcast-embed-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #00D4AA;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 0.3rem;
  font-family: 'Space Grotesk', sans-serif;
}
.podcast-embed-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #F0F4F8;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Space Grotesk', sans-serif;
}
.podcast-embed-meta {
  font-size: 0.78rem;
  color: #8899AA;
  margin-top: 0.2rem;
}
.podcast-embed-progress-wrap {
  flex: 0 0 120px;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: flex-end;
}
.podcast-embed-bar-wrap {
  width: 100%;
  height: 3px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
}
.podcast-embed-bar-fill {
  height: 100%;
  background: #00D4AA;
  border-radius: 3px;
  width: 0%;
  transition: width 0.1s linear;
  pointer-events: none;
}
.podcast-embed-time {
  font-size: 0.72rem;
  color: #8899AA;
  font-variant-numeric: tabular-nums;
}
.podcast-embed-link {
  flex-shrink: 0;
  font-size: 0.78rem;
  color: #00D4AA;
  text-decoration: none;
  font-weight: 600;
  border-bottom: 1px solid rgba(0,212,170,0.3);
  transition: border-color 0.2s;
  white-space: nowrap;
  align-self: center;
}
.podcast-embed-link:hover { border-color: #00D4AA; }
audio.podcast-embed-audio { display: none; }

/* ── Related Episodes Section ── */
.related-episodes-section {
  margin: 2.5rem 0 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(0,212,170,0.1);
}
.related-section-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  color: #F0F4F8;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.related-section-title::before {
  content: '🎙️';
  font-size: 1rem;
}
.related-episodes-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.85rem;
}
.related-ep-card {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  background: rgba(26,43,69,0.6);
  border: 1px solid rgba(0,212,170,0.12);
  border-radius: 12px;
  padding: 0.9rem 1rem;
  text-decoration: none;
  transition: border-color 0.2s, background 0.2s;
}
.related-ep-card:hover {
  border-color: rgba(0,212,170,0.35);
  background: rgba(0,212,170,0.06);
}
.related-ep-num {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0,212,170,0.12);
  border: 1px solid rgba(0,212,170,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  color: #00D4AA;
}
.related-ep-info { flex: 1; min-width: 0; }
.related-ep-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #F0F4F8;
  line-height: 1.35;
  font-family: 'Space Grotesk', sans-serif;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.related-ep-meta {
  font-size: 0.75rem;
  color: #8899AA;
  margin-top: 0.25rem;
}

/* ── Related Blog Posts Section ── */
.related-blog-section {
  margin: 2.5rem 0 1.5rem;
  padding: 1.75rem 2rem;
  background: rgba(15,29,50,0.5);
  border: 1px solid rgba(0,212,170,0.1);
  border-radius: 16px;
}
.related-blog-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: #F0F4F8;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.related-blog-title::before {
  content: '📝';
  font-size: 1rem;
}
.related-blog-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.related-blog-item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  text-decoration: none;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  transition: background 0.2s;
}
.related-blog-item:hover { background: rgba(0,212,170,0.06); }
.related-blog-arrow {
  color: #00D4AA;
  font-size: 0.85rem;
  flex-shrink: 0;
  margin-top: 0.1em;
}
.related-blog-item-title {
  font-size: 0.9rem;
  color: #C4D0DC;
  line-height: 1.4;
  transition: color 0.2s;
}
.related-blog-item:hover .related-blog-item-title { color: #F0F4F8; }

/* ── Mobile ── */
@media (max-width: 640px) {
  .podcast-embed-card { flex-wrap: wrap; gap: 0.75rem; }
  .podcast-embed-progress-wrap { flex: 0 0 100%; flex-direction: row; align-items: center; gap: 0.5rem; }
  .podcast-embed-bar-wrap { flex: 1; }
  .podcast-embed-title { white-space: normal; }
  .podcast-embed-link { font-size: 0.72rem; }
  .related-episodes-list { grid-template-columns: 1fr; }
  .related-blog-section { padding: 1.25rem; }
}
  `;

  // ── Inject CSS once ───────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('podcast-embed-css')) return;
    var style = document.createElement('style');
    style.id = 'podcast-embed-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── Build inline player card HTML ─────────────────────────────────────────
  function buildEmbedCard(ep) {
    var epNumMatch = ep.slug.match(/\d+/);
    var epNum = epNumMatch ? epNumMatch[0] : '';
    return [
      '<div class="podcast-embed-card" data-ep-slug="' + ep.slug + '">',
      '  <button class="podcast-embed-play-btn" aria-label="' + t.play + '">&#9654;</button>',
      '  <div class="podcast-embed-info">',
      '    <div class="podcast-embed-label" ',
      '         data-i18n-en="🎧 Listen to this topic"',
      '         data-i18n-es="🎧 Escucha este tema"',
      '         data-i18n-zh="🎧 收听此主题"',
      '         data-i18n-el="🎧 Ακούστε αυτό το θέμα"',
      '         data-i18n-ja="🎧 このトピックを聴く">' + t.listen_label + '</div>',
      '    <div class="podcast-embed-title">' + ep.title + '</div>',
      '    <div class="podcast-embed-meta">' + t.series + ' &middot; ' + t.ep + ' ' + epNum + ' &middot; ' + ep.duration + ' ' + t.min + '</div>',
      '  </div>',
      '  <div class="podcast-embed-progress-wrap">',
      '    <div class="podcast-embed-bar-wrap">',
      '      <div class="podcast-embed-bar-fill"></div>',
      '    </div>',
      '    <div class="podcast-embed-time">0:00</div>',
      '  </div>',
      '  <a href="/podcast/' + ep.slug + '" class="podcast-embed-link"',
      '     data-i18n-en="Full episode →"',
      '     data-i18n-es="Episodio completo →"',
      '     data-i18n-zh="完整集数 →"',
      '     data-i18n-el="Πλήρες επεισόδιο →"',
      '     data-i18n-ja="全エピソード →">Full episode →</a>',
      '  <audio class="podcast-embed-audio" preload="none"></audio>',
      '</div>',
    ].join('\n');
  }

  // ── Wire up a player card ─────────────────────────────────────────────────
  function wireCard(card) {
    var slug = card.getAttribute('data-ep-slug');
    if (!slug || card._wired) return;
    card._wired = true;

    var playBtn = card.querySelector('.podcast-embed-play-btn');
    var barWrap = card.querySelector('.podcast-embed-bar-wrap');
    var barFill = card.querySelector('.podcast-embed-bar-fill');
    var timeEl = card.querySelector('.podcast-embed-time');
    var audio = card.querySelector('.podcast-embed-audio');
    var loaded = false;

    function loadAudio() {
      if (loaded) return;
      loaded = true;
      audio.src = '/api/podcast/' + encodeURIComponent(slug) + '/audio-file';
      audio.preload = 'auto';
    }

    playBtn.addEventListener('click', function () {
      loadAudio();
      if (audio.paused) {
        audio.play().catch(function () {});
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', function () {
      playBtn.innerHTML = '&#10074;&#10074;';
      playBtn.setAttribute('aria-label', t.pause);
    });
    audio.addEventListener('pause', function () {
      playBtn.innerHTML = '&#9654;';
      playBtn.setAttribute('aria-label', t.play);
    });
    audio.addEventListener('ended', function () {
      playBtn.innerHTML = '&#9654;';
      barFill.style.width = '0%';
      timeEl.textContent = '0:00';
    });
    audio.addEventListener('timeupdate', function () {
      if (!audio.duration) return;
      var pct = (audio.currentTime / audio.duration) * 100;
      barFill.style.width = pct + '%';
      timeEl.textContent = formatTime(audio.currentTime);
    });

    barWrap.addEventListener('click', function (e) {
      loadAudio();
      if (!audio.duration) return;
      var rect = barWrap.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      audio.currentTime = pct * audio.duration;
    });
  }

  // ── Apply i18n to data-i18n-* elements ───────────────────────────────────
  function applyI18n(root) {
    var attr = 'data-i18n-' + lang;
    root.querySelectorAll('[' + attr + ']').forEach(function (el) {
      el.textContent = el.getAttribute(attr);
    });
  }

  // ── Boot: wire all embed cards on page ────────────────────────────────────
  function boot() {
    injectCSS();
    document.querySelectorAll('.podcast-embed-card').forEach(wireCard);
    applyI18n(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
