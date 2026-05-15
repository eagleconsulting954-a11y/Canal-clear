const fs = require('fs');
const path = require('path');
const podcastDir = 'public/podcast';
const files = fs.readdirSync(podcastDir).filter(function(f) {
    return f.startsWith('episode-') && f.endsWith('.html');
});

const snippet = '\n<!-- CanalClear Analytics -->\n<script src="/js/analytics.js"></script>\n<script>\ndocument.addEventListener(\'DOMContentLoaded\', function() {\n    var ccTrack = window._ccTrack || function(){};\n    var epMatch = location.pathname.match(/episode-(\\d+)/);\n    ccTrack(\'podcast_episode_view\', { episode: epMatch ? parseInt(epMatch[1]) : 0 });\n    document.querySelectorAll(\'a[href="/app"], a[href="/pricing"]\').forEach(function(a) {\n        a.addEventListener(\'click\', function() {\n            ccTrack(\'cta_click\', { label: a.textContent.trim(), href: a.getAttribute(\'href\'), context: \'podcast_episode\' });\n        });\n    });\n});\n</script>\n';

files.forEach(function(f) {
    const fp = path.join(podcastDir, f);
    let content = fs.readFileSync(fp, 'utf8');
    if (!content.includes('analytics.js')) {
        content = content.replace('</body>', snippet + '</body>');
        fs.writeFileSync(fp, content);
        console.log('Updated:', f);
    } else {
        console.log('Already has tracking:', f);
    }
});
