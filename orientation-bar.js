// Compact canonical production-state strip for non-home cockpit pages.
// Reads the canonical /api/cockpit-orientation endpoint (the same source the
// homepage "Where am I?" panel uses) and renders a small, read-only strip.
//
// Design notes:
// - This is the COMPACT companion to the homepage's full panel; it intentionally
//   shows fewer fields and does not duplicate the full panel.
// - render() is DOM-light (only sets container.innerHTML) so it is unit-testable
//   in Node; only mount()/auto-mount touch document.
// - Read-only: no state-changing controls, no active-run resolver.
// - Fails silently into a small "unavailable" note if the API is unreachable.
//
// Usage: include <script src="orientation-bar.js"></script> and add an element
// with id="canonicalOrientationStrip"; it auto-mounts on DOMContentLoaded.
// Or call OrientationBar.mount(containerEl) explicitly.
(function (global) {
  "use strict";

  var STYLE_ID = "orientation-bar-styles";
  var STYLES =
    ".ob-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:10px 16px;padding:8px 14px;" +
    "border:1px solid var(--border);border-radius:8px;background:var(--panel);font-size:12.5px;line-height:1.5;color:var(--muted);}" +
    ".ob-title{color:var(--text);font-weight:700;}" +
    ".ob-field .ob-k{color:var(--muted);}" +
    ".ob-field .ob-v{color:var(--text);}" +
    ".ob-home{margin-left:auto;color:var(--accent,#4a9eff);text-decoration:none;}" +
    ".ob-strip.ob-ambiguous{border-color:var(--danger,#f85149);}" +
    ".ob-warn{color:var(--danger,#f85149);}" +
    ".ob-strip.ob-unavailable{color:var(--muted);}";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function field(label, value) {
    if (!value) return "";
    return '<span class="ob-field"><span class="ob-k">' + esc(label) + ':</span> <span class="ob-v">' + esc(value) + "</span></span>";
  }

  // Pure: only assigns container.innerHTML. Safe to call without a real DOM.
  function render(container, payload) {
    if (!container) return container;
    var o = payload || {};
    if (o.mode === "AMBIGUOUS") {
      container.innerHTML =
        '<div class="ob-strip ob-ambiguous">' +
        '<strong class="ob-title">Canonical production state</strong> ' +
        '<span class="ob-warn">State ambiguous — normal next-action guidance withheld. ' +
        'Return to <a href="index.html">homepage</a> or run the active-state audit.</span>' +
        "</div>";
      return container;
    }
    var freshness = o.indexFreshness || {};
    container.innerHTML =
      '<div class="ob-strip">' +
      '<strong class="ob-title">Canonical production state</strong> ' +
      field("Active", o.activeRun || o.activeProject) +
      field("Gate", o.currentGate) +
      field("Next", o.nextValidAction) +
      field("Index", freshness.state) +
      field("Mode", o.mode) +
      '<a class="ob-home" href="index.html" title="Full orientation panel on the homepage">details &#8599;</a>' +
      "</div>";
    return container;
  }

  function ensureStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function mount(container) {
    if (!container) return container;
    if (typeof document !== "undefined") ensureStyles(document);
    if (typeof fetch !== "function") return container;
    fetch("/api/cockpit-orientation", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (envelope) {
        // The server wraps payloads as { ok, data }.
        render(container, envelope && envelope.data ? envelope.data : envelope);
      })
      .catch(function () {
        container.innerHTML =
          '<div class="ob-strip ob-unavailable">Canonical production state unavailable — start the cockpit server to see live state.</div>';
      });
    return container;
  }

  function autoMount() {
    if (typeof document === "undefined") return;
    var el = document.getElementById("canonicalOrientationStrip");
    if (el) mount(el);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoMount);
    } else {
      autoMount();
    }
  }

  global.OrientationBar = { mount: mount, render: render };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.OrientationBar;
  }
})(typeof window !== "undefined" ? window : globalThis);
