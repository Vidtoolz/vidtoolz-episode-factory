'use strict';
// SCREEN CAPTURE V1 — PRESENTATION DERIVATIVE (1080×1920, faithful, declared).
//
// The presentation is rendered from the FINALIZED raw only, by an isolated
// headless Chrome laying out either the exact raw text bytes (TEXT raws:
// typeset, never retyped) or the raw PNG (pixel raws: scaled/cropped within the
// declared zoom bound, required context retained). Geometry is MEASURED from
// the rendered DOM and recorded in a transformation manifest with the raw hash.
// Header/footer annotations sit outside the evidence box and carry the
// data-bound source identity; nothing in the evidence box is drawn by hand.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./cdp.js');
const { sha256Bytes, digest } = require('./contract.js');

const RENDERER = Object.freeze({ id: 'vidtoolz-presentation-renderer', version: '1.0.0', engine: 'chrome-headless' });
const CANVAS = { width: 1080, height: 1920 };
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function fail(code, message) { return Object.assign(new Error(message), { code, stage: 'presentation' }); }

// Layout constants: header block inside the top safe area; evidence box
// inside left/right/top/bottom safe margins with room for the footer line.
function geometry(spec) {
  const sa = spec.presentation.safe_area;
  const headerTop = sa.top; const headerHeight = 150; const footerHeight = 70;
  const box = { x: sa.left, y: headerTop + headerHeight + 16, width: CANVAS.width - sa.left - sa.right, height: CANVAS.height - sa.bottom - footerHeight - (headerTop + headerHeight + 16) };
  return { header: { x: sa.left, y: headerTop, width: box.width, height: headerHeight }, box, footer: { x: sa.left, y: box.y + box.height + 8, width: box.width, height: footerHeight - 8 } };
}

function textHtml({ spec, rawText, geometryPx, header, footer, lineNumbersFrom, fontPx }) {
  const g = geometryPx;
  const lines = rawText.split('\n');
  const rows = lines.map((line, i) => `<div class="row"><span class="ln">${lineNumbersFrom != null ? lineNumbersFrom + i : ''}</span><span class="tx">${escapeHtml(line) || ' '}</span></div>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${CANVAS.width}px;height:${CANVAS.height}px;background:#0b0d12;color:#e6edf3;font-family:'DejaVu Sans',Arial,sans-serif;overflow:hidden}
#header{position:absolute;left:${g.header.x}px;top:${g.header.y}px;width:${g.header.width}px;height:${g.header.height}px;display:flex;flex-direction:column;justify-content:flex-end;gap:10px}
#claim{font-size:40px;font-weight:700;line-height:1.15;color:#fff;overflow:hidden;max-height:96px}
#identity{font-size:26px;color:#9fb3c8;font-family:'DejaVu Sans Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#evidence{position:absolute;left:${g.box.x}px;top:${g.box.y}px;width:${g.box.width}px;height:${g.box.height}px;background:#0d1117;border:2px solid #30363d;border-radius:8px;box-sizing:border-box;overflow:hidden;padding:18px}
#text{font-family:'DejaVu Sans Mono',monospace;font-size:${fontPx}px;line-height:1.3;color:#e6edf3;white-space:pre-wrap;word-break:break-all}
.row{display:flex}.ln{flex:0 0 ${lineNumbersFrom != null ? '3.2em' : '0'};color:#6e7681;text-align:right;padding-right:${lineNumbersFrom != null ? '0.8em' : '0'};user-select:none}.tx{flex:1 1 auto;min-width:0}
#footer{position:absolute;left:${g.footer.x}px;top:${g.footer.y}px;width:${g.footer.width}px;height:${g.footer.height}px;font-size:24px;color:#8b949e;font-family:'DejaVu Sans Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center}
</style><body>
<div id="header"><div id="claim">${escapeHtml(header.claim)}</div><div id="identity">${escapeHtml(header.identity)}</div></div>
<div id="evidence"><div id="text">${rows}</div></div>
<div id="footer">${escapeHtml(footer)}</div></body>`;
}

function imageHtml({ geometryPx, header, footer, rawFileUrl, crop, scale }) {
  const g = geometryPx;
  // crop = region of the raw (raw px) shown; scale = raw px → canvas px
  const imgW = Math.round(crop.width * scale); const imgH = Math.round(crop.height * scale);
  const offX = Math.round((g.box.width - 4 - imgW) / 2); const offY = Math.round((g.box.height - 4 - imgH) / 2);
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${CANVAS.width}px;height:${CANVAS.height}px;background:#0b0d12;color:#e6edf3;font-family:'DejaVu Sans',Arial,sans-serif;overflow:hidden}
#header{position:absolute;left:${g.header.x}px;top:${g.header.y}px;width:${g.header.width}px;height:${g.header.height}px;display:flex;flex-direction:column;justify-content:flex-end;gap:10px}
#claim{font-size:40px;font-weight:700;line-height:1.15;color:#fff;overflow:hidden;max-height:96px}
#identity{font-size:26px;color:#9fb3c8;font-family:'DejaVu Sans Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#evidence{position:absolute;left:${g.box.x}px;top:${g.box.y}px;width:${g.box.width}px;height:${g.box.height}px;background:#000;border:2px solid #30363d;border-radius:8px;box-sizing:border-box;overflow:hidden}
#clip{position:absolute;left:${offX}px;top:${offY}px;width:${imgW}px;height:${imgH}px;overflow:hidden}
#raw{position:absolute;left:${-Math.round(crop.x * scale)}px;top:${-Math.round(crop.y * scale)}px;transform-origin:0 0;transform:scale(${scale});image-rendering:auto}
#footer{position:absolute;left:${g.footer.x}px;top:${g.footer.y}px;width:${g.footer.width}px;height:${g.footer.height}px;font-size:24px;color:#8b949e;font-family:'DejaVu Sans Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center}
</style><body>
<div id="header"><div id="claim">${escapeHtml(header.claim)}</div><div id="identity">${escapeHtml(header.identity)}</div></div>
<div id="evidence"><div id="clip"><img id="raw" src="${rawFileUrl}"></div></div>
<div id="footer">${escapeHtml(footer)}</div></body>`;
}

// Renders the derivative. input: { spec, rawPath, rawSha256, rawFormat, rawText?, rawWidth?, rawHeight?, sourceIdentityLine, requiredContextBoxes, lineNumbersFrom?, targetRect?, targetFontPx?, workDir, profileRoot }
async function render(input) {
  const { spec } = input; const g = geometry(spec); const minText = spec.presentation.minimum_text_px; const maxZoom = spec.presentation.max_zoom;
  const header = { claim: spec.evidence_target.claim, identity: input.sourceIdentityLine };
  const footer = `raw sha256 ${input.rawSha256.slice(0, 16)}… · ${spec.capture_id} · ${input.rawFormat} → derivative revision-0001`;
  const transformations = []; let html; let declared;
  if (input.rawFormat === 'TEXT') {
    const fontPx = Math.max(minText, 36);
    html = textHtml({ spec, rawText: input.rawText, geometryPx: g, header, footer, lineNumbersFrom: input.lineNumbersFrom, fontPx });
    transformations.push({ type: 'TYPESET', raw_sha256: input.rawSha256, font: 'DejaVu Sans Mono', font_px: fontPx, line_height: 1.3, wrap: 'pre-wrap', line_numbers: input.lineNumbersFrom != null ? { from: input.lineNumbersFrom } : null, retained_context_ids: input.requiredContextBoxes.map((b) => b.id), note: 'exact raw text bytes typeset; no character retyped, reordered or removed' });
    declared = { crop: null, scale: 1, zoom: 1 };
  } else if (input.rawFormat === 'PNG') {
    const rw = input.rawWidth; const rh = input.rawHeight; const boxW = g.box.width - 4; const boxH = g.box.height - 4;
    const fit = Math.min(boxW / rw, boxH / rh);
    // readability: relevant text (target element font) must reach minimum_text_px after scaling
    const fontPx = input.targetFontPx || null;
    let scale = fit; let crop = { x: 0, y: 0, width: rw, height: rh };
    if (fontPx && fontPx * fit < minText) {
      const needed = minText / fontPx; const zoomRel = Math.min(needed / fit, maxZoom);
      scale = fit * zoomRel;
      if (fontPx * scale < minText - 0.5) throw fail('PRESENTATION_FAILED', `relevant text would be ${Math.round(fontPx * scale)} px after the maximum ${maxZoom}× zoom; below the ${minText} px minimum — replan a closer source state`);
      const cw = Math.min(rw, Math.floor(boxW / scale)); const ch = Math.min(rh, Math.floor(boxH / scale));
      const t = input.targetRect || { x: 0, y: 0, width: rw, height: rh };
      // the crop must contain the whole target rect (required context) — centre on it
      if (t.width > cw || t.height > ch) throw fail('PRESENTATION_FAILED', 'target region does not fit at the readable zoom; replan');
      let cx = Math.round(t.x + t.width / 2 - cw / 2); let cy = Math.round(t.y + t.height / 2 - ch / 2);
      cx = Math.max(0, Math.min(cx, rw - cw)); cy = Math.max(0, Math.min(cy, rh - ch));
      crop = { x: cx, y: cy, width: cw, height: ch };
      transformations.push({ type: 'CROP', raw_sha256: input.rawSha256, region: crop, retained_context_ids: input.requiredContextBoxes.map((b) => b.id), reason: 'readability: keep target and surrounding context, drop nothing the intent requires' });
      transformations.push({ type: 'ZOOM', scale: Math.round((scale / fit) * 1000) / 1000, retained_context_ids: input.requiredContextBoxes.map((b) => b.id) });
    } else {
      transformations.push({ type: 'SCALE', factor: Math.round(fit * 10000) / 10000, retained_context_ids: input.requiredContextBoxes.map((b) => b.id), note: 'whole raw shown; downscale only' });
    }
    // pixel context boxes must lie inside the crop
    for (const b of input.requiredContextBoxes) if (b.kind === 'pixels' && b.rect && (b.rect.x < crop.x || b.rect.y < crop.y || b.rect.x + b.rect.width > crop.x + crop.width || b.rect.y + b.rect.height > crop.y + crop.height)) throw fail('PRESENTATION_FAILED', `required context ${b.id} would be cropped away`);
    html = imageHtml({ geometryPx: g, header, footer, rawFileUrl: `file://${input.rawPath}`, crop, scale });
    declared = { crop, scale: Math.round(scale * 10000) / 10000, zoom: Math.round((scale / fit) * 1000) / 1000 };
  } else throw fail('PRESENTATION_FAILED', `unsupported raw format ${input.rawFormat}`);
  transformations.push({ type: 'CALLOUT', kind: 'header-identity', covers_context_ids: [], region: g.header, text_px: 26, content: header.identity });
  transformations.push({ type: 'CALLOUT', kind: 'footer-provenance', covers_context_ids: [], region: g.footer, text_px: 24 });

  fs.mkdirSync(input.workDir, { recursive: true, mode: 0o700 });
  const htmlPath = path.join(input.workDir, 'presentation.html'); fs.writeFileSync(htmlPath, html);
  const session = await launch({ profileRoot: input.profileRoot, width: CANVAS.width, height: CANVAS.height });
  try {
    const { cdp } = session;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: CANVAS.width, height: CANVAS.height, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise((resolve) => { cdp.on((m) => { if (m.method === 'Page.loadEventFired') resolve(true); }); setTimeout(() => resolve(false), 15000); });
    await cdp.send('Page.navigate', { url: `file://${htmlPath}` });
    if (!(await loaded)) throw fail('PRESENTATION_FAILED', 'renderer did not load');
    await new Promise((r) => setTimeout(r, 120));
    const measured = JSON.parse(await cdp.eval(`(()=>{const e=document.getElementById('evidence').getBoundingClientRect();const t=document.getElementById('text');const img=document.getElementById('raw');const fs=t?parseFloat(getComputedStyle(t).fontSize):null;const overflow=t?t.scrollHeight>document.getElementById('evidence').clientHeight-36:false;const lines=t?t.querySelectorAll('.row').length:0;const h=document.getElementById('header').getBoundingClientRect();const f=document.getElementById('footer').getBoundingClientRect();return JSON.stringify({evidence_box:{x:Math.round(e.x),y:Math.round(e.y),width:Math.round(e.width),height:Math.round(e.height)},text_font_px:fs,text_overflow:overflow,text_rows:lines,img_natural:img?{w:img.naturalWidth,h:img.naturalHeight,complete:img.complete}:null,header:{x:Math.round(h.x),y:Math.round(h.y),width:Math.round(h.width),height:Math.round(h.height)},footer:{x:Math.round(f.x),y:Math.round(f.y),width:Math.round(f.width),height:Math.round(f.height)},fonts:document.fonts?document.fonts.status:null});})()`));
    if (input.rawFormat === 'TEXT' && measured.text_overflow) throw fail('PRESENTATION_FAILED', `${measured.text_rows} raw lines do not fit at ${measured.text_font_px} px inside the evidence box; the raw is intact but this range is not mobile-readable — replan a smaller range`);
    if (input.rawFormat === 'PNG' && (!measured.img_natural || !measured.img_natural.complete || measured.img_natural.w !== input.rawWidth)) throw fail('PRESENTATION_FAILED', 'raw image did not load into the renderer');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(shot.data, 'base64');
    const minimumTextPx = input.rawFormat === 'TEXT' ? measured.text_font_px : (input.targetFontPx ? Math.round(input.targetFontPx * declared.scale * 10) / 10 : null);
    const layout = { evidence_box: measured.evidence_box, minimum_text_px: minimumTextPx, header_box: measured.header, footer_box: measured.footer, canvas: CANVAS };
    const manifest = {
      schema: 'vidtoolz.presentation-transformation-manifest.v1', renderer: RENDERER, raw_sha256: input.rawSha256, raw_format: input.rawFormat, raw_dimensions: input.rawFormat === 'PNG' ? { width: input.rawWidth, height: input.rawHeight } : null,
      output: { width: CANVAS.width, height: CANVAS.height, format: 'PNG' }, crop: declared.crop, scale: declared.scale, zoom: declared.zoom, transformations, layout, typography: { evidence_font: 'DejaVu Sans Mono', evidence_font_px: minimumTextPx, header_px: 40, identity_px: 26, footer_px: 24 },
      forbidden_transformations_absent: ['RETYPE', 'REDRAW', 'GENERATIVE_FILL', 'CONTENT_REPLACE'], rendered_at: new Date().toISOString(), presentation_sha256: sha256Bytes(png),
    };
    manifest.manifest_digest_sha256 = digest(manifest);
    return { png, manifest, layout, transformations, measured };
  } finally { session.close(); try { fs.rmSync(htmlPath, { force: true }); } catch (_) {} }
}

module.exports = { RENDERER, CANVAS, geometry, render };
