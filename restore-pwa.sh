#!/bin/bash
set -e
COMMIT=7197e26
mkdir -p public/icons public/js

# Core PWA files
git show $COMMIT:public/manifest.json > public/manifest.json
git show $COMMIT:public/sw.js > public/sw.js
git show $COMMIT:public/offline.html > public/offline.html
git show $COMMIT:public/js/pwa-manager.js > public/js/pwa-manager.js
git show $COMMIT:public/icons/icon-192.svg > public/icons/icon-192.svg
git show $COMMIT:public/icons/icon-512.svg > public/icons/icon-512.svg

# Helper scripts
git show $COMMIT:add-pwa-meta.js > add-pwa-meta.js
git show $COMMIT:add-sw-registration.js > add-sw-registration.js

# Restore modified HTML files
for file in about acp admin-analytics admin app compliance-guide compliance-score demo filing index knowledge-base login pricing settings-alerts welcome; do
  git show $COMMIT:public/${file}.html > public/${file}.html 2>/dev/null || true
done

# Podcast pages
for file in episode-1 episode-2 episode-3 episode-4 episode-5 episode-6 episode-7 episode-8 episode-9 episode-10 episode-14 episode-15; do
  git show $COMMIT:public/podcast/${file}.html > public/podcast/${file}.html 2>/dev/null || true
done
git show $COMMIT:public/podcast.html > public/podcast.html 2>/dev/null || true

# Blog pages
for file in how-to-avoid-panama-canal-compliance-fines-in-2026 how-to-file-pcsopep-panama-canal how-to-file-vumpa-panama-canal how-to-reduce-shipping-delays index marpol-compliance-checklist-ship-operators-2026 panama-canal-compliance-checklist-2026 panama-canal-compliance-checklist-fleet-operators panama-canal-compliance-complete-guide-2026 panama-canal-transit-documents-required panama-canal-vumpa-requirements-2026 pcsopep-documentation-complete-guide pcsopep-requirements-2026 pcsopep-requirements-panama-canal true-cost-of-non-compliance-global-shipping vessel-readiness-inspection-panama-canal vumpa-digital-submission-guide-2026 vumpa-filing-requirements-step-by-step what-is-port-state-control why-ai-is-the-future-of-panama-canal-compliance; do
  git show $COMMIT:public/blog/${file}.html > public/blog/${file}.html 2>/dev/null || true
done

# i18n.js
git show $COMMIT:public/js/i18n.js > public/js/i18n.js

echo "All PWA files restored from $COMMIT"