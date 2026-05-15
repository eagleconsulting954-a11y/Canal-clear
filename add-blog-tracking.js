const fs = require('fs');
const path = require('path');
const blogDir = 'public/blog';
const files = fs.readdirSync(blogDir).filter(function(f) {
    return f.endsWith('.html') && f !== 'index.html';
});

const snippet = '\n<!-- CanalClear Analytics -->\n<script src="/js/analytics.js"></script>\n<script>\ndocument.addEventListener(\'DOMContentLoaded\', function() {\n    var ccTrack = window._ccTrack || function(){};\n    ccTrack(\'blog_article_view\', { slug: location.pathname.replace(\'/blog/\',\'\') });\n    document.querySelectorAll(\'a[href="/app"], a[href="/pricing"]\').forEach(function(a) {\n        a.addEventListener(\'click\', function() {\n            ccTrack(\'cta_click\', { label: a.textContent.trim(), href: a.getAttribute(\'href\'), context: \'blog_article\' });\n        });\n    });\n    document.querySelectorAll(\'a[href^="/blog/"]\').forEach(function(a) {\n        a.addEventListener(\'click\', function() {\n            ccTrack(\'blog_related_link_click\', { href: a.getAttribute(\'href\') });\n        });\n    });\n});\n</script>\n';

files.forEach(function(f) {
    const fp = path.join(blogDir, f);
    let content = fs.readFileSync(fp, 'utf8');
    if (!content.includes('analytics.js')) {
        content = content.replace('</body>', snippet + '</body>');
        fs.writeFileSync(fp, content);
        console.log('Updated:', f);
    } else {
        console.log('Already has tracking:', f);
    }
});
