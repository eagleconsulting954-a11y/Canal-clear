#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dir = 'public/blog';
const files = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.html') && f !== 'index.html'; });
let ok = 0, bad = 0;
for (const f of files) {
  const c = fs.readFileSync(path.join(dir, f), 'utf8');
  const banner = c.split('blog-cta-banner').length - 1;
  const plink = c.split('blog-product-link-injected').length - 1;
  const trs = c.split('Transit Readiness Score').length - 1;
  const slug = f.replace('.html', '');
  const isSuez = slug.startsWith('suez-canal-');
  const productHref = isSuez ? 'href="/suez"' : 'href="/panama"';
  const hasProductHref = c.includes(productHref);
  if (banner >= 1 && plink >= 1 && trs >= 1 && hasProductHref) {
    ok++;
  } else {
    bad++;
    console.log('ISSUE: ' + f + ' banner=' + banner + ' productlink=' + plink + ' TRS=' + trs + ' hasProductHref=' + hasProductHref);
  }
}
console.log('\nOK: ' + ok + '/' + files.length + ' posts have all required elements');
if (bad > 0) console.log('Issues: ' + bad);
