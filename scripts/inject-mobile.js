/**
 * Inject mobile CSS link and JS script into all HTML files.
 * Run: node scripts/inject-mobile.js
 */
const fs = require('fs');
const path = require('path');

const CSS_LINK = '    <link rel="stylesheet" href="/css/mobile.css">';
const JS_SCRIPT = '    <script src="/js/mobile-nav.js"></script>';

const publicDir = path.join(__dirname, '..', 'public');

function findHtmlFiles(dir) {
    const results = [];
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            // Only recurse into blog and podcast subdirs
            if (item === 'blog' || item === 'podcast') {
                results.push(...findHtmlFiles(full));
            }
        } else if (item.endsWith('.html')) {
            results.push(full);
        }
    }
    return results;
}

const htmlFiles = findHtmlFiles(publicDir);
let count = 0;

htmlFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;

    // Inject CSS before </head> if not already present
    if (!content.includes('/css/mobile.css')) {
        content = content.replace('</head>', CSS_LINK + '\n</head>');
        modified = true;
    }

    // Inject JS before </body> if not already present
    if (!content.includes('/js/mobile-nav.js')) {
        content = content.replace('</body>', JS_SCRIPT + '\n</body>');
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        count++;
        console.log('  ✓ ' + path.relative(publicDir, file));
    } else {
        console.log('  = ' + path.relative(publicDir, file) + ' (already injected)');
    }
});

console.log('\nDone. Injected mobile CSS+JS into ' + count + ' files.');
