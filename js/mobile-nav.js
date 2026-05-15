/**
 * CanalClear — Mobile Navigation
 * Injects a hamburger button and mobile overlay nav into every page.
 * Works with both .nav-links class containers and inline-styled containers.
 */
(function() {
    'use strict';

    function init() {
        var nav = document.querySelector('nav');
        if (!nav) return;

        var navInner = nav.querySelector('.nav-inner');
        if (!navInner) return;

        // Find the nav links container — support both patterns:
        // 1. <div class="nav-links">
        // 2. Inline-styled <div style="display:flex;..."> at the end of nav-inner
        var linksContainer = navInner.querySelector('.nav-links');
        if (!linksContainer) {
            // Find the last div child (the links container)
            var divs = navInner.querySelectorAll(':scope > div');
            if (divs.length > 0) {
                linksContainer = divs[divs.length - 1];
                linksContainer.classList.add('nav-links-inline');
            }
        }

        if (!linksContainer) return;

        // Collect visible nav links from the container (skip hidden ones like Admin)
        var links = Array.from(linksContainer.querySelectorAll('a')).filter(function(a) {
            // Skip links that are explicitly hidden via inline display:none
            var style = window.getComputedStyle(a);
            return style.display !== 'none';
        });
        if (links.length === 0) return;

        // Build mobile overlay HTML
        var mobileLinksHTML = links.map(function(a) {
            var href = a.getAttribute('href') || '#';
            var text = a.textContent.trim();
            // Style CTA-type buttons specially
            var isOpenValidator = /open validator|open app|start free|get started|validate/i.test(text);
            var cls = isOpenValidator ? 'mobile-cta' : '';
            return '<a href="' + href + '" class="' + cls + '">' + text + '</a>';
        }).join('');

        // Create overlay
        var overlay = document.createElement('div');
        overlay.className = 'mobile-nav-overlay';
        overlay.innerHTML = '<div class="mobile-nav-links">' + mobileLinksHTML + '</div>';
        document.body.appendChild(overlay);

        // Create hamburger button
        var btn = document.createElement('button');
        btn.className = 'hamburger-btn';
        btn.setAttribute('aria-label', 'Toggle navigation');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span></span><span></span><span></span>';
        navInner.appendChild(btn);

        // Toggle function
        function toggleMenu() {
            var isOpen = overlay.classList.contains('open');
            if (isOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        }

        function openMenu() {
            overlay.classList.add('open');
            btn.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
            document.body.style.overflow = 'hidden';
        }

        function closeMenu() {
            overlay.classList.remove('open');
            btn.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            document.body.style.overflow = '';
        }

        btn.addEventListener('click', toggleMenu);

        // Close on link click
        overlay.querySelectorAll('a').forEach(function(a) {
            a.addEventListener('click', closeMenu);
        });

        // Close on ESC
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeMenu();
        });

        // Close on overlay background click (outside links container)
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeMenu();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
