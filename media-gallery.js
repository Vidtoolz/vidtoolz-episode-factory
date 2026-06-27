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
    if (type === "video") {
      mediaContainer.innerHTML = `<video src="${src}" controls autoplay></video>`;
    } else {
      mediaContainer.innerHTML = `<img src="${src}" alt="${name || ""}" />`;
    }
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

  function classifyMedia(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes("kling")) return { type: "video", badge: "kling", label: "Kling" };
    if (lower.includes("wan") || lower.includes("promptfix")) return { type: "video", badge: "wan", label: "Wan2.2" };
    if (lower.includes("flux") || lower.match(/\.(png|jpg|jpeg|webp)$/)) return { type: "image", badge: "flux", label: "FLUX" };
    if (lower.includes("camera") || lower.includes("a-roll") || lower.includes("aroll") || lower.includes("obs")) return { type: "video", badge: "camera", label: "Camera" };
    if (lower.match(/\.(mp4|webm|mov)$/)) return { type: "video", badge: "", label: "Video" };
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
      const cls = classifyMedia(a.name);
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
      const cls = classifyMedia(a.name);
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
