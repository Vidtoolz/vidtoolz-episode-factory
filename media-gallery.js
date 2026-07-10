/**
 * VIDTOOLZ Media Gallery
 * Browses all generated assets for a package-run.
 * Fetches from /api/package-runs/media-gallery?run=<runFolder>
 * Renders a responsive grid of images and videos with lightbox.
 */
(function MediaGalleryModule(globalScope) {
  "use strict";

  let lightboxEl = null;

  function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement("div");
    lightboxEl.className = "media-lightbox";
    lightboxEl.innerHTML = `
      <div class="media-lightbox-content">
        <button class="media-lightbox-close" type="button">Close (Esc)</button>
        <div class="media-lightbox-media"></div>
      </div>
    `;
    document.body.appendChild(lightboxEl);

    lightboxEl.querySelector(".media-lightbox-close").addEventListener("click", closeLightbox);
    lightboxEl.addEventListener("click", (e) => {
      if (e.target === lightboxEl) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && lightboxEl.classList.contains("open")) closeLightbox();
    });
    return lightboxEl;
  }

  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove("open");
    const mediaContainer = lightboxEl.querySelector(".media-lightbox-media");
    if (mediaContainer) mediaContainer.innerHTML = "";
  }

  function openLightbox(src, type, name) {
    ensureLightbox();
    const mediaContainer = lightboxEl.querySelector(".media-lightbox-media");
    // Build the media node with the DOM API and assign src/alt as properties.
    // Never template src/name into innerHTML: a filename or path containing a
    // double quote (e.g. a manual-external download) would otherwise break out
    // of the attribute (XSS). Property assignment is not an HTML-parsing sink.
    mediaContainer.innerHTML = "";
    let node;
    if (type === "video") {
      node = document.createElement("video");
      node.controls = true;
      node.autoplay = true;
    } else {
      node = document.createElement("img");
      node.alt = name || "";
    }
    node.src = src;
    mediaContainer.appendChild(node);
    lightboxEl.classList.add("open");
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDuration(seconds) {
    if (!seconds) return "";
    if (seconds < 60) return seconds.toFixed(1) + "s";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }

  // classifyMedia(filename, pathOrSource?, entry?) returns a provenance-aware
  // badge. When the server provided explicit provenance on the entry
  // (source_type / generation_mode), that is AUTHORITATIVE — the directory name
  // (e.g. flux-local/) must never override it, or a manual upload stored there
  // for pipeline compatibility would be mislabeled as FLUX-generated. Only when
  // no explicit provenance exists (legacy entries) do we fall back to heuristics.
  function classifyMedia(filename, pathOrSource, entry) {
    const lower = filename.toLowerCase();
    const ctx = (String(pathOrSource || "") + " " + lower).toLowerCase();
    const isImageExt = !!lower.match(/\.(png|jpg|jpeg|webp)$/);
    const isVideoExt = !!lower.match(/\.(mp4|webm|mov|mkv)$/);
    if (entry && typeof entry === "object") {
      const st = entry.source_type;
      const gm = entry.generation_mode;
      const gp = String(entry.generation_provider || "").toLowerCase();
      if (st === "manual_upload" || gm === "manual_external" || gm === "unknown") {
        if (gp.indexOf("gpt") !== -1) return { type: isVideoExt ? "video" : "image", badge: "gpt", label: "Manual · GPT", external: true };
        if (gp.indexOf("kling") !== -1) return { type: "video", badge: "klingai", label: "Manual · KlingAI", external: true };
        return { type: isVideoExt ? "video" : "image", badge: "manual", label: "Manual upload", external: true };
      }
      if (st === "legacy_unknown") return { type: isVideoExt ? "video" : "image", badge: "legacy", label: "Legacy · source unknown", external: false };
      if (st === "generated" || (gm === "local" && gp.indexOf("flux") !== -1)) return { type: "image", badge: "flux", label: "Generated · FLUX local", external: false };
      if (gm === "local" && (gp.indexOf("wan") !== -1 || gp.indexOf("comfyui") !== -1)) return { type: "video", badge: "wan", label: "LOCAL · Wan2.2", external: false };
    }
    // Manual external first (folder/source hints), so it isn't mislabeled local.
    if (ctx.includes("gpt-manual") || ctx.includes("gpt_manual")) return { type: "image", badge: "gpt", label: "MANUAL · GPT", external: true };
    if (ctx.includes("klingai") || ctx.includes("kling-manual") || (ctx.includes("kling") && ctx.includes("manual"))) return { type: "video", badge: "klingai", label: "MANUAL · KlingAI", external: true };
    if (ctx.includes("manual-external") || ctx.includes("manual_external")) return { type: isVideoExt ? "video" : "image", badge: "manual", label: "MANUAL · Imported", external: true };
    if (lower.includes("kling")) return { type: "video", badge: "kling", label: "Kling" };
    if (lower.includes("wan") || lower.includes("promptfix") || ctx.includes("videos/mp4")) return { type: "video", badge: "wan", label: "LOCAL · Wan2.2", external: false };
    if (lower.includes("flux") || ctx.includes("flux-local") || isImageExt) return { type: "image", badge: "flux", label: "LOCAL · FLUX", external: false };
    if (lower.includes("camera") || lower.includes("a-roll") || lower.includes("aroll") || lower.includes("obs")) return { type: "video", badge: "camera", label: "Camera" };
    if (isVideoExt) return { type: "video", badge: "", label: "Video" };
    return { type: "image", badge: "", label: "Image" };
  }

  /**
   * Mount a media gallery into a container.
   * @param {HTMLElement} container
   * @param {Object} opts - { runFolder, apiUrl }
   */
  function mount(container, opts) {
    if (!container) return;
    opts = opts || {};
    const runFolder = opts.runFolder || "";
    const apiUrl = opts.apiUrl || `/api/package-runs/media-gallery?run=${encodeURIComponent(runFolder)}`;
    container.dataset.runFolder = runFolder;

    container.innerHTML = `
      <div class="media-gallery-loading" style="padding:20px;text-align:center;color:var(--muted);">
        Loading media assets...
      </div>
    `;

    fetch(apiUrl, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const data = json.data !== undefined ? json.data : json;
        renderGallery(container, data.assets || [], data);
      })
      .catch((err) => {
        container.innerHTML = `
          <div style="padding:20px;text-align:center;color:var(--danger);">
            Failed to load media: ${escapeHtml(err.message)}
          </div>
        `;
      });
  }

  function renderGallery(container, assets, meta) {
    if (!assets.length) {
      container.innerHTML = `
        <div style="padding:20px;text-align:center;color:var(--muted);">
          No media assets found${meta && meta.runFolder ? ` for ${escapeHtml(meta.runFolder)}` : ""}.
        </div>
      `;
      return;
    }

    // Group by category
    const categories = {};
    assets.forEach((a) => {
      const cls = classifyMedia(a.name, a.path || a.url || a.source || "", a);
      const cat = cls.label;
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ ...a, ...cls });
    });

    let html = "";

    // Summary bar
    html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
      <span style="font-size:13px;font-weight:600;color:var(--text);">${assets.length} assets</span>
      ${Object.entries(categories).map(([cat, items]) =>
        `<span style="font-size:11px;color:var(--muted);background:var(--panel-soft);padding:2px 8px;border-radius:4px;">${escapeHtml(cat)}: ${items.length}</span>`
      ).join("")}
    </div>`;

    // Resolve-readiness banner: ASCII-safe filename check for the Resolve handoff.
    const rr = meta && meta.resolveReadiness;
    if (rr) {
      html += rr.ready
        ? `<div style="margin-bottom:12px;padding:8px 10px;border-radius:6px;background:rgba(63,185,80,0.12);border:1px solid rgba(63,185,80,0.4);color:var(--accent,#3fb950);font-size:13px;">✓ Ready for Resolve — all ${rr.total} filename(s) are ASCII-safe.</div>`
        : `<div style="margin-bottom:12px;padding:8px 10px;border-radius:6px;background:rgba(248,81,73,0.12);border:1px solid rgba(248,81,73,0.4);color:var(--danger,#f85149);font-size:13px;">⚠ ${rr.needsRename} of ${rr.total} file(s) need ASCII-safe renaming before Resolve import (otherwise "Media Offline"): ${rr.asciiIssues.map(escapeHtml).join(", ")}</div>`;
    }

    // Gallery grid
    html += '<div class="media-gallery">';
    assets.forEach((a) => {
      const cls = classifyMedia(a.name, a.path || a.url || a.source || "", a);
      const isVideo = cls.type === "video";
      const src = a.url || a.path;
      const thumb = a.thumbnail || (isVideo ? src : src);

      html += `<div class="media-card media-${cls.type}"${a.ascii_safe === false ? ' style="outline:2px solid var(--danger,#f85149);outline-offset:-2px;" title="Filename not ASCII-safe — rename before Resolve import"' : ''} data-src="${escapeHtml(src)}" data-type="${cls.type}" data-name="${escapeHtml(a.name)}">`;
      if (isVideo) {
        html += `<video src="${escapeHtml(src)}" muted preload="metadata" title="${escapeHtml(a.name)}"></video>`;
      } else {
        html += `<img src="${escapeHtml(src)}" alt="${escapeHtml(a.name)}" loading="lazy" />`;
      }
      html += `<div class="media-card-info">`;
      html += `<div class="media-card-name">${escapeHtml(a.name)}</div>`;
      html += `<div style="display:flex;gap:6px;align-items:center;">`;
      if (cls.badge) {
        html += `<span class="media-card-badge ${cls.badge}">${escapeHtml(cls.label)}</span>`;
      }
      const metaParts = [];
      if (a.size) metaParts.push(formatFileSize(a.size));
      if (a.duration) metaParts.push(formatDuration(a.duration));
      if (a.width && a.height) metaParts.push(`${a.width}×${a.height}`);
      if (metaParts.length) {
        html += `<span class="media-card-meta">${escapeHtml(metaParts.join(" · "))}</span>`;
      }
      html += `</div>`;
      html += `</div>`;
      html += `</div>`;
    });
    html += "</div>";

    container.innerHTML = html;

    // Wire up click → lightbox
    container.querySelectorAll(".media-card").forEach((card) => {
      card.addEventListener("click", () => {
        const src = card.dataset.src;
        const type = card.dataset.type;
        const name = card.dataset.name;
        openLightbox(src, type, name);
      });
    });
  }

  globalScope.MediaGallery = {
    mount,
    openLightbox,
    closeLightbox,
  };
})(window);
