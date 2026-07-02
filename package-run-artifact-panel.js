// Read-only package-run artifact panel for the package-runs dashboard.
// Preview / copy / OS-open safe text artifacts for the active run, using the
// already-merged endpoints:
//   GET  /api/package-runs/artifacts?runId=
//   GET  /api/package-runs/artifact-text?runId=&file=
//   POST /api/package-runs/open-file        (nonce-gated; local xdg-open side effect)
// No editing, saving, approving, or state mutation. Copy uses the shared
// window.copyToClipboard utility (clipboard.js). Auto-mounts into
// #packageRunArtifactPanel; degrades gracefully if any endpoint is unavailable.
(function (global) {
  "use strict";

  var STYLE_ID = "package-run-artifact-panel-styles";
  var STYLES =
    ".pra-panel{margin:0 16px 6px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--panel);font-size:12.5px;line-height:1.5;}" +
    ".pra-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;}" +
    ".pra-head strong{font-size:14px;}" +
    ".pra-sub{color:var(--muted);font-size:11.5px;}" +
    ".pra-controls{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:8px 0;}" +
    ".pra-controls select{max-width:60%;}" +
    ".pra-status{margin:4px 0 0;min-height:1.2em;}" +
    ".pra-status[data-kind=error]{color:var(--danger);}" +
    ".pra-preview{max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:6px 0 0;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,0.02);}";

  function ensureStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function formatBytes(value) {
    var n = Number(value) || 0;
    return n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB";
  }
  function unwrap(json) {
    return json && json.data ? json.data : json;
  }
  function copyText(text, onSuccess, onFail) {
    if (global.copyToClipboard) return global.copyToClipboard(text, onSuccess, onFail);
    onFail(new Error("clipboard utility (clipboard.js) is not loaded"));
  }

  function mount(container, options) {
    if (!container) return;
    if (typeof fetch !== "function") return;
    options = options || {};
    if (typeof document !== "undefined") ensureStyles(document);
    container.innerHTML = '<div class="pra-panel"><span class="pra-sub">Loading active-run artifacts…</span></div>';

    var nonce = { value: "", header: "x-vidtoolz-local-write-nonce" };
    var runId = "";
    var cache = {}; // file -> content (so Copy can reuse a loaded Preview)
    var selectEl = null;
    var previewEl = null;
    var statusEl = null;

    function setStatus(message, kind) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.dataset.kind = kind || "";
    }
    function currentFile() {
      return selectEl ? selectEl.value : "";
    }
    function getJson(url) {
      return fetch(url, { cache: "no-store" }).then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, status: r.status, body: unwrap(j) };
        });
      });
    }
    function loadContent(file) {
      if (Object.prototype.hasOwnProperty.call(cache, file)) return Promise.resolve({ ok: true, body: { content: cache[file] } });
      return getJson(
        "/api/package-runs/artifact-text?runId=" + encodeURIComponent(runId) + "&file=" + encodeURIComponent(file)
      ).then(function (res) {
        if (res.ok && res.body && typeof res.body.content === "string") cache[file] = res.body.content;
        return res;
      });
    }

    function handlePreview(file) {
      setStatus("Loading " + file + "…");
      loadContent(file).then(function (res) {
        if (!res.ok) {
          if (previewEl) previewEl.textContent = "";
          setStatus((res.body && res.body.error) || "Could not read artifact.", "error");
          return;
        }
        if (previewEl) previewEl.textContent = res.body.content || "";
        setStatus("Previewing " + file + ".", "ok");
      }).catch(function () {
        setStatus("Artifact API error.", "error");
      });
    }
    function handleCopy(file) {
      setStatus("Copying " + file + "…");
      loadContent(file).then(function (res) {
        if (!res.ok) {
          setStatus((res.body && res.body.error) || "Could not read artifact.", "error");
          return;
        }
        if (previewEl) previewEl.textContent = res.body.content || "";
        copyText(
          res.body.content || "",
          function () { setStatus("Copied " + file + " to clipboard.", "ok"); },
          function (err) { setStatus("Copy failed: " + (err && err.message ? err.message : "unknown"), "error"); }
        );
      }).catch(function () {
        setStatus("Artifact API error.", "error");
      });
    }
    function handleOpen(file) {
      if (!nonce.value) {
        setStatus("Open file requires local cockpit nonce.", "error");
        return;
      }
      setStatus("Opening " + file + "…");
      var headers = { "Content-Type": "application/json" };
      headers[nonce.header] = nonce.value;
      fetch("/api/package-runs/open-file", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ runId: runId, file: file, localWriteNonce: nonce.value }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, body: unwrap(j) };
          });
        })
        .then(function (res) {
          if (res.ok) {
            setStatus("Opened " + file + " in your OS.", "ok");
          } else if (res.status === 403) {
            setStatus("Open file requires local cockpit nonce.", "error");
          } else {
            setStatus((res.body && res.body.error) || "Open failed.", "error");
          }
        })
        .catch(function () {
          setStatus("Open request failed.", "error");
        });
    }

    function renderPanel(artifacts) {
      var openAttrs = nonce.value ? "" : ' disabled title="Open file requires local cockpit nonce."';
      container.innerHTML =
        '<div class="pra-panel">' +
        '<div class="pra-head"><strong>Package-run artifacts</strong>' +
        '<span class="pra-sub">Read-only preview, copy, and OS-open for safe text artifacts in this run (' +
        escapeHtml(runId) + ").</span></div>" +
        (artifacts.length
          ? '<div class="pra-controls">' +
            '<select class="pra-select" aria-label="Artifact file">' +
            artifacts
              .map(function (a) {
                return (
                  '<option value="' + escapeHtml(a.file) + '">' +
                  escapeHtml(a.label || a.file) + " — " + escapeHtml(a.file) +
                  " (" + formatBytes(a.sizeBytes) + ")</option>"
                );
              })
              .join("") +
            "</select>" +
            '<button type="button" data-act="preview">Preview</button>' +
            '<button type="button" data-act="copy">Copy</button>' +
            '<button type="button" data-act="open"' + openAttrs + ">Open file</button>" +
            "</div>" +
            '<p class="pra-status copy-status" role="status"></p>' +
            '<pre class="pra-preview artifact-content" tabindex="0" aria-label="Artifact preview"></pre>'
          : '<p class="pra-sub">No safe text artifacts found for this run.</p>') +
        "</div>";
      selectEl = container.querySelector(".pra-select");
      previewEl = container.querySelector(".pra-preview");
      statusEl = container.querySelector(".pra-status");
      container.querySelectorAll("button[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var file = currentFile();
          if (!file) return;
          var act = btn.getAttribute("data-act");
          if (act === "preview") handlePreview(file);
          else if (act === "copy") handleCopy(file);
          else if (act === "open") handleOpen(file);
        });
      });
    }

    function renderUnavailable(message) {
      container.innerHTML = '<div class="pra-panel"><span class="pra-sub">' + escapeHtml(message) + "</span></div>";
    }

    // 1) nonce (best-effort) → 2) run id → 3) artifacts list.
    getJson("/api/package-engine/status")
      .then(function (res) {
        var d = res.ok ? res.body : null;
        if (d && d.localWriteNonce) {
          nonce.value = d.localWriteNonce;
          nonce.header = d.nonceHeader || nonce.header;
        }
      })
      .catch(function () {})
      .then(function () {
        if (options.runId) return { activeRun: options.runId };
        return getJson("/api/cockpit-orientation").then(function (res) {
          if (!res.ok) throw new Error("orientation unavailable");
          return res.body || {};
        });
      })
      .then(function (orientation) {
        if (!orientation || orientation.mode === "AMBIGUOUS" || !orientation.activeRun) {
          // Projects-lane aware: when the real work is an active project (no
          // package run focused), say so instead of implying broken state.
          if (orientation && orientation.activeProject) {
            renderUnavailable("No package run is focused — active work is project “" + orientation.activeProject + "” on the Projects lane; package-run artifacts don’t apply to it.");
          } else {
            renderUnavailable("No active/focused run available — resolve active state on the homepage before browsing artifacts.");
          }
          return null;
        }
        runId = orientation.activeRun;
        return getJson("/api/package-runs/artifacts?runId=" + encodeURIComponent(runId));
      })
      .then(function (res) {
        if (!res) return;
        if (!res.ok) {
          renderUnavailable("Package-run artifacts unavailable for this run.");
          return;
        }
        renderPanel((res.body && res.body.artifacts) || []);
      })
      .catch(function () {
        renderUnavailable("Package-run artifacts unavailable — start the cockpit server to browse them.");
      });
  }

  function autoMount() {
    if (typeof document === "undefined") return;
    var el = document.getElementById("packageRunArtifactPanel");
    if (el) mount(el, {});
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
    else autoMount();
  }

  global.VidtoolzArtifactPanel = { mount: mount, escapeHtml: escapeHtml, formatBytes: formatBytes };
  if (typeof module !== "undefined" && module.exports) module.exports = global.VidtoolzArtifactPanel;
})(typeof window !== "undefined" ? window : globalThis);
