/*
 * VIDTOOLZ global module navigation — shared dropdown rendered on EVERY
 * participating production module (Episode Factory pages and the standalone
 * unit apps on :8020/:8030/:8035/:8040/:8050).
 *
 * Single source of truth: config/vidtoolz-modules.json in the Episode Factory
 * repo. The cockpit serves GET /module-nav.js, which embeds that manifest as
 * window.VIDTOOLZ_MODULES and appends this renderer — so every module always
 * sees the same names, order, and destinations, and adding/renaming/reordering
 * a module never requires editing existing pages. If the cockpit is down, the
 * script simply fails to load on other modules and their pages work untouched.
 *
 * UMD like idea-engine-ui.js: pure helpers are Node-testable; the browser
 * bootstrap runs only when a document exists. All text renders through
 * textContent (never innerHTML with data). Destinations are allowlisted to
 * local loopback HTTP. Navigation NEVER starts a compute service — items are
 * plain links; unreachable services just show an "offline" note.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidtoolzModuleNav = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALLOWED_URL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}\//;
  var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // Validates one manifest entry. Returns a list of problems; [] = valid.
  function validateModule(entry) {
    var problems = [];
    if (!entry || typeof entry !== 'object') return ['entry is not an object'];
    if (!ID_RE.test(String(entry.id || ''))) problems.push('invalid or missing id');
    if (!String(entry.label || '').trim()) problems.push('empty label');
    if (!ALLOWED_URL_RE.test(String(entry.url || ''))) problems.push('url not an allowlisted local destination');
    if (!ALLOWED_URL_RE.test(String(entry.origin || '') + '/')) problems.push('origin not an allowlisted local origin');
    if (!Array.isArray(entry.match_paths) || entry.match_paths.length === 0) problems.push('missing match_paths');
    if (!isFinite(entry.workflow_order)) problems.push('missing workflow_order');
    return problems;
  }

  // Filters to valid, enabled entries in deterministic workflow order.
  // Duplicate ids / workflow orders / destinations drop the LATER entry and
  // report it, so one bad manifest line can never break the whole menu.
  function prepare(rawModules) {
    var seenIds = {};
    var seenOrders = {};
    var seenUrls = {};
    var ok = [];
    var dropped = [];
    (Array.isArray(rawModules) ? rawModules : []).forEach(function (entry) {
      if (entry && entry.enabled === false) return;
      var problems = validateModule(entry);
      if (problems.length === 0) {
        if (seenIds[entry.id]) problems.push('duplicate id');
        else if (seenOrders[entry.workflow_order]) problems.push('duplicate workflow_order');
        else if (seenUrls[entry.url]) problems.push('duplicate destination url');
      }
      if (problems.length > 0) {
        dropped.push({ id: entry && entry.id, problems: problems });
        return;
      }
      seenIds[entry.id] = true;
      seenOrders[entry.workflow_order] = true;
      seenUrls[entry.url] = true;
      ok.push(entry);
    });
    ok.sort(function (a, b) { return a.workflow_order - b.workflow_order; });
    return { modules: ok, dropped: dropped };
  }

  function normalizePath(pathname) {
    var p = String(pathname || '/').split('?')[0].split('#')[0];
    if (p.length > 1 && p.slice(-1) === '/') p = p.slice(0, -1);
    return p === '' ? '/' : p;
  }

  // Resolves the current module: an explicit <body data-vidtoolz-module="id">
  // declaration wins; route matching (origin + normalized path) is the
  // fallback. Unknown pages resolve to null — the trigger then shows a neutral
  // label and nothing is falsely marked current.
  function resolveActive(modules, origin, pathname, declaredId) {
    if (declaredId) {
      for (var i = 0; i < modules.length; i += 1) {
        if (modules[i].id === declaredId) return modules[i];
      }
      return null; // declared but unknown: neutral, never a false match
    }
    var path = normalizePath(pathname);
    for (var j = 0; j < modules.length; j += 1) {
      var m = modules[j];
      if (m.origin !== origin) continue;
      for (var k = 0; k < m.match_paths.length; k += 1) {
        if (normalizePath(m.match_paths[k]) === path) return m;
      }
    }
    return null;
  }

  // Group model: preserves workflow order; group headings appear where their
  // first module appears. Grouping never reorders items.
  function groupModel(modules) {
    var out = [];
    var index = {};
    modules.forEach(function (m) {
      var g = String(m.group || 'Modules');
      if (index[g] === undefined) {
        index[g] = out.length;
        out.push({ group: g, modules: [] });
      }
      out[index[g]].modules.push(m);
    });
    return out;
  }

  var CSS = [
    '.vtz-mnav { position: fixed; top: 8px; right: 10px; z-index: 55; font-family: inherit; font-size: 13px; }',
    '.vtz-mnav__trigger { display: flex; align-items: center; gap: 7px; max-width: 340px; background: var(--panel, #161b22); color: var(--text, #e6edf3); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 6px 11px; cursor: pointer; font-size: 12.5px; line-height: 1.2; box-shadow: 0 1px 4px rgba(0,0,0,0.35); }',
    '.vtz-mnav__trigger:hover { border-color: var(--accent-blue, #58a6ff); }',
    '.vtz-mnav__trigger:focus-visible { outline: 2px solid var(--accent-blue, #58a6ff); outline-offset: 1px; }',
    '.vtz-mnav__context { color: var(--muted, #8b949e); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; white-space: nowrap; }',
    '.vtz-mnav__current { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }',
    '.vtz-mnav__menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 260px; max-width: min(320px, 92vw); max-height: min(70vh, 560px); overflow-y: auto; background: var(--panel, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 6px; box-shadow: 0 8px 28px rgba(0,0,0,0.5); }',
    '.vtz-mnav__group { color: var(--muted, #8b949e); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 9px 3px; }',
    '.vtz-mnav__item { display: block; padding: 6px 9px; border-radius: 6px; color: var(--text, #e6edf3); text-decoration: none; border: 1px solid transparent; }',
    '.vtz-mnav__item:hover, .vtz-mnav__item:focus-visible { border-color: var(--accent-blue, #58a6ff); background: rgba(88,166,255,0.08); outline: none; }',
    '.vtz-mnav__item[aria-current="page"] { border-color: var(--accent, #3fb950); background: rgba(63,185,80,0.08); }',
    '.vtz-mnav__desc { display: block; color: var(--muted, #8b949e); font-size: 11px; margin-top: 1px; }',
    '.vtz-mnav__off { color: #d29922; font-size: 11px; margin-left: 6px; }',
    '@media (max-width: 1100px) { .vtz-mnav__context { display: none; } }',
  ].join('\n');

  // ── Browser bootstrap ──────────────────────────────────────────────────────
  function mount(doc, win) {
    if (win.__vidtoolzModuleNavMounted) return null;
    win.__vidtoolzModuleNavMounted = true;

    var prepared = prepare(win.VIDTOOLZ_MODULES && win.VIDTOOLZ_MODULES.modules);
    prepared.dropped.forEach(function (d) {
      try { win.console.warn('[vidtoolz-module-nav] dropped manifest entry', d.id, d.problems.join('; ')); } catch (_) {}
    });
    if (prepared.modules.length === 0) return null; // fail safe: no nav, page untouched

    var declaredId = doc.body && doc.body.getAttribute && doc.body.getAttribute('data-vidtoolz-module');
    var active = resolveActive(prepared.modules, win.location.origin, win.location.pathname, declaredId || null);
    if (!active && declaredId) {
      try { win.console.warn('[vidtoolz-module-nav] declared module id not in manifest:', declaredId); } catch (_) {}
    }

    var style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.appendChild(style);

    var nav = doc.createElement('nav');
    nav.className = 'vtz-mnav';
    nav.setAttribute('aria-label', 'VIDTOOLZ production modules');

    var trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vtz-mnav__trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'vtz-mnav-menu');
    var ctx = doc.createElement('span');
    ctx.className = 'vtz-mnav__context';
    ctx.textContent = 'VIDTOOLZ Modules';
    var cur = doc.createElement('span');
    cur.className = 'vtz-mnav__current';
    cur.textContent = active ? active.label : 'Choose module';
    var caret = doc.createElement('span');
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    trigger.appendChild(ctx);
    trigger.appendChild(cur);
    trigger.appendChild(caret);
    nav.appendChild(trigger);

    var menu = doc.createElement('div');
    menu.id = 'vtz-mnav-menu';
    menu.className = 'vtz-mnav__menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    var items = [];
    groupModel(prepared.modules).forEach(function (g) {
      var heading = doc.createElement('div');
      heading.className = 'vtz-mnav__group';
      heading.setAttribute('role', 'presentation');
      heading.textContent = g.group;
      menu.appendChild(heading);
      g.modules.forEach(function (m) {
        var a = doc.createElement('a');
        a.className = 'vtz-mnav__item';
        a.setAttribute('role', 'menuitem');
        a.setAttribute('data-module-id', m.id);
        a.href = m.url;
        var label = doc.createElement('span');
        var isCurrent = active && active.id === m.id;
        label.textContent = (isCurrent ? '✓ ' : '') + m.label + (isCurrent ? ' — Current' : '');
        a.appendChild(label);
        if (m.description) {
          var desc = doc.createElement('span');
          desc.className = 'vtz-mnav__desc';
          desc.textContent = m.description;
          a.appendChild(desc);
        }
        if (isCurrent) {
          a.setAttribute('aria-current', 'page');
          a.addEventListener('click', function (e) { e.preventDefault(); close(); });
        }
        menu.appendChild(a);
        items.push(a);
      });
    });
    nav.appendChild(menu);

    var open = false;
    function setOpen(next) {
      open = next;
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) probeAvailability();
    }
    function close() { setOpen(false); }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!open);
      if (open && items.length > 0) items[0].focus();
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        if (items.length > 0) items[0].focus();
      }
    });
    menu.addEventListener('keydown', function (e) {
      var idx = items.indexOf(doc.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, idx + 1)].focus(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, idx - 1)].focus(); return; }
      if (e.key === 'Home') { e.preventDefault(); items[0].focus(); return; }
      if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); return; }
      if (e.key === 'Tab') close(); // leave normally, no trap
    });
    doc.addEventListener('click', function (e) {
      if (open && !nav.contains(e.target)) close();
    });
    menu.addEventListener('click', function (e) {
      // Selecting a destination closes; navigation itself is the link default.
      var item = e.target && e.target.closest ? e.target.closest('a[role="menuitem"]') : null;
      if (item && !item.hasAttribute('aria-current')) close();
    });

    // One reachability probe per page load, run when the menu first opens.
    // no-cors keeps this a pure reachability check (no CORS requirements) and
    // a fetch can never start a service — offline modules stay clickable with
    // an honest note.
    var probed = false;
    function probeAvailability() {
      if (probed || typeof win.fetch !== 'function') return;
      probed = true;
      prepared.modules.forEach(function (m, i) {
        if (m.origin === win.location.origin) return;
        var signal = null;
        try { signal = win.AbortSignal && win.AbortSignal.timeout ? win.AbortSignal.timeout(1500) : null; } catch (_) {}
        win.fetch(m.origin + '/', { mode: 'no-cors', signal: signal }).catch(function () {
          var a = items[i];
          if (!a || a.querySelector('.vtz-mnav__off')) return;
          var off = doc.createElement('span');
          off.className = 'vtz-mnav__off';
          off.textContent = '· offline';
          a.title = m.label + ' is not running. Start it with the 00-Start-All-Units launcher; opening it now will show a connection error.';
          a.firstChild.appendChild(off);
        });
      });
    }

    var root = doc.getElementById('vidtoolz-module-navigation-root');
    if (root) root.appendChild(nav);
    else doc.body.appendChild(nav);
    return nav;
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.body) {
    try { mount(document, window); } catch (e) {
      try { console.warn('[vidtoolz-module-nav] failed to mount:', e && e.message); } catch (_) {}
    }
  } else if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      try { mount(document, window); } catch (e) {
        try { console.warn('[vidtoolz-module-nav] failed to mount:', e && e.message); } catch (_) {}
      }
    });
  }

  return {
    validateModule: validateModule,
    prepare: prepare,
    normalizePath: normalizePath,
    resolveActive: resolveActive,
    groupModel: groupModel,
    ALLOWED_URL_RE: ALLOWED_URL_RE,
    mount: mount,
  };
}));
