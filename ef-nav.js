/*
 * Shared Episode Factory navigation (2026-07-10 declutter slice #1).
 * ONE definition of the nav, injected into every <nav class="ef-nav"> mount, so
 * the bar is no longer hardcoded (and duplicated) across ~24 pages. Slim layout:
 * a few PRIMARY links always visible (Super Focus is the star), everything else
 * tucked behind a "More ▾" dropdown. Pure vanilla JS, no dependencies. Touches
 * no backend, no routes, no Super Focus internals.
 */
(function () {
  'use strict';
  // Super Focus is the primary destination and deliberately the star.
  var PRIMARY = [
    { href: 'super-focus.html', label: 'Super Focus', star: true },
    { href: 'package-runs-dashboard.html', label: 'Dashboard' },
    { href: 'index.html', label: 'Home' },
    { href: 'publish-gate.html', label: 'Publish Gate' },
  ];
  // Everything else the old flat nav exposed — reachable, just not shouting.
  var MORE = [
    { href: 'projects.html', label: 'Projects' },
    { href: 'resume.html', label: 'Resume' },
    { href: 'mission-control.html', label: 'Mission Control' },
    { href: 'new-video-build.html', label: 'Build New Video' },
    { href: 'topic-scout.html', label: 'Topic Scout' },
    { href: 'daily-idea-scout.html', label: 'Daily Ideas' },
    { href: 'package-engine.html', label: 'Package Engine' },
    { href: 'production-pipeline.html', label: 'Pipeline' },
    { href: 'image-prompts-editor.html', label: 'Image Prompts' },
    { href: 'image-selector.html', label: 'Image Select' },
    { href: 'aigen-review.html', label: 'AIGEN Review' },
    { href: 'production-day-dashboard.html', label: 'Production Day' },
    { href: 'score-engine.html', label: 'Score Engine' },
  ];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function currentPage() {
    var f = (location.pathname.split('/').pop() || '').toLowerCase();
    return f || 'index.html';
  }
  function linkHtml(l, here) {
    var cls = [];
    if (l.href.toLowerCase() === here) cls.push('active');
    if (l.star) cls.push('ef-nav-star');
    var c = cls.length ? ' class="' + cls.join(' ') + '"' : '';
    var star = l.star ? '★ ' : '';
    return '<a href="' + esc(l.href) + '"' + c + '>' + star + esc(l.label) + '</a>';
  }

  function build(mount) {
    var here = currentPage();
    var moreActive = MORE.some(function (l) { return l.href.toLowerCase() === here; });
    mount.innerHTML =
      '<span class="ef-nav-brand">EF</span>' +
      PRIMARY.map(function (l) { return linkHtml(l, here); }).join('') +
      '<div class="ef-nav-more">' +
        '<button type="button" class="ef-nav-more-btn' + (moreActive ? ' active' : '') + '" aria-haspopup="true" aria-expanded="false">More ▾</button>' +
        '<div class="ef-nav-more-menu" role="menu">' + MORE.map(function (l) { return linkHtml(l, here); }).join('') + '</div>' +
      '</div>';
    var wrap = mount.querySelector('.ef-nav-more');
    var btn = mount.querySelector('.ef-nav-more-btn');
    var menu = mount.querySelector('.ef-nav-more-menu');
    function setOpen(v) { menu.classList.toggle('open', v); btn.setAttribute('aria-expanded', v ? 'true' : 'false'); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!menu.classList.contains('open')); });
    menu.addEventListener('click', function (e) { e.stopPropagation(); }); // clicking a link still navigates
    document.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    void wrap;
  }

  function init() {
    var mounts = document.querySelectorAll('nav.ef-nav');
    for (var i = 0; i < mounts.length; i++) {
      if (!mounts[i].getAttribute('data-ef-built')) { mounts[i].setAttribute('data-ef-built', '1'); build(mounts[i]); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
