/**
 * Add comprehensive mobile CSS to all podcast episode pages.
 */
const fs = require('fs');
const path = require('path');

const PODCAST_DIR = path.join(__dirname, '..', 'public', 'podcast');

const MOBILE_CSS = `
        /* ── Podcast Episode Mobile Fixes ── */
        @media (max-width: 768px) {
            .episode-hero { padding: 5rem 1.25rem 2rem; }
            .episode-hero h1 { font-size: clamp(1.4rem, 5vw, 1.9rem); }
            .episode-meta { gap: 0.75rem; font-size: 0.85rem; }
            .audio-section { padding: 1.5rem 1.25rem; }
            .audio-player-wrap { padding: 1.25rem; }
            .audio-coming-soon { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
            .audio-icon { width: 44px; height: 44px; font-size: 1.1rem; }
            .article-section { padding: 2rem 1.25rem 1rem; }
            .article-inner h2 { font-size: 1.25rem; }
            .article-inner p, .article-inner li { font-size: 0.95rem; }
            .stats-grid { grid-template-columns: 1fr 1fr; gap: 0.75rem; }
            .stats-grid > div { padding: 1rem; }
            .cta-section { padding: 2rem 1.25rem; margin: 2rem 0 1rem; }
            .ep-nav { padding: 1.5rem 1.25rem; gap: 0.75rem; flex-direction: column; }
            .ep-nav-btn { min-width: 100%; text-align: center; padding: 0.85rem 1.25rem; }
            footer { padding: 2rem 1.25rem; }
            .footer-links { gap: 0.75rem; }
        }
        @media (max-width: 480px) {
            .stats-grid { grid-template-columns: 1fr; }
            .episode-badge { font-size: 0.72rem; padding: 0.25rem 0.65rem; }
        }`;

const files = fs.readdirSync(PODCAST_DIR).filter(f => f.endsWith('.html'));

let count = 0;
files.forEach(file => {
    const fullPath = path.join(PODCAST_DIR, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Find the closing </style> tag
    const styleClose = content.lastIndexOf('</style>');
    if (styleClose === -1) {
        console.log('  ✗ No </style> found in ' + file);
        return;
    }

    // Check if our mobile CSS is already there
    if (content.includes('Podcast Episode Mobile Fixes')) {
        console.log('  = ' + file + ' (already done)');
        return;
    }

    // Insert before </style>
    content = content.slice(0, styleClose) + MOBILE_CSS + '\n    </style>' + content.slice(styleClose + 8);
    fs.writeFileSync(fullPath, content, 'utf8');
    count++;
    console.log('  ✓ ' + file);
});

console.log('\nDone. Fixed ' + count + ' podcast episode files.');
