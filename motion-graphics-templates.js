'use strict';

// Motion Graphics Studio — pure template model (no I/O, no network).
//
// Deterministic, branded motion CARD definitions: the fields each card type
// takes, sensible defaults (vertical 1080x1920, presenter-safe lower-right),
// param validation, an engine recommendation, and a safe HTML builder used for
// both the in-browser preview and (later) the HyperFrames render source. Every
// operator-supplied string is HTML-escaped before it reaches the DOM, so a card
// containing "<script>" can never inject anything.

const FORMAT_DEFAULT = Object.freeze({ width: 1080, height: 1920, fps: 30, duration_seconds: 5 });
const STYLE_DEFAULT = Object.freeze({ preset: 'vidtoolz_default', safe_area: { presenter_overlay: 'lower_right' } });

// Output modes (alpha slice, 2026-07-21 spec §7): opaque MP4 stays the default
// for every card; transparent_overlay (MOV ProRes 4444) is opt-in and supported
// ONLY for lower thirds in this slice. Absent field on old cards = opaque.
const OUTPUT_MODES = Object.freeze(['opaque_card', 'transparent_overlay']);
const OUTPUT_MODE_DEFAULT = 'opaque_card';
const TRANSPARENT_CAPABLE_TYPES = Object.freeze(['lower_third']);

function normalizeOutputMode(type, mode) {
  return mode === 'transparent_overlay' && TRANSPARENT_CAPABLE_TYPES.indexOf(type) !== -1 ? 'transparent_overlay' : OUTPUT_MODE_DEFAULT;
}

function validateOutputMode(type, mode) {
  if (OUTPUT_MODES.indexOf(mode) === -1) {
    return { ok: false, error: `output_mode must be ${OUTPUT_MODES.join('|')}, got "${String(mode)}".` };
  }
  if (mode === 'transparent_overlay' && TRANSPARENT_CAPABLE_TYPES.indexOf(type) === -1) {
    return { ok: false, error: `transparent_overlay is supported only for ${TRANSPARENT_CAPABLE_TYPES.join('|')} cards in this slice — "${String(type)}" cards render opaque.` };
  }
  return { ok: true, error: null };
}

// First-slice card types (title/claim, wrong-way/better-way, lower third).
const TEMPLATES = [
  {
    type: 'title',
    label: 'Title / claim card',
    fields: [
      { key: 'title', label: 'Title', kind: 'line', required: true },
      { key: 'subtitle', label: 'Subtitle', kind: 'line', required: false },
      { key: 'claim', label: 'Sharp claim', kind: 'text', required: false },
    ],
    candidate_only: false,
  },
  {
    type: 'comparison',
    label: 'Wrong-way / better-way',
    fields: [
      { key: 'wrong', label: 'Wrong way', kind: 'text', required: true },
      { key: 'better', label: 'Better way', kind: 'text', required: true },
      { key: 'explanation', label: 'Why (optional)', kind: 'text', required: false },
    ],
    candidate_only: false,
  },
  {
    type: 'lower_third',
    label: 'Lower third',
    fields: [
      { key: 'name', label: 'Name / title line', kind: 'line', required: true },
      { key: 'descriptor', label: 'Descriptor', kind: 'line', required: false },
    ],
    // Transparent output exists but is NOT claimed Resolve-ready until the
    // supervised compositing proof records a verdict (spec 2026-07-21).
    candidate_only: true,
    note: 'Opaque plate by default. Transparent overlay (MOV ProRes 4444) is opt-in via Output mode — alpha is validated technically at render time, but do not treat it as Resolve-ready alpha until the supervised compositing proof records a verdict.',
  },
  {
    type: 'chapter',
    label: 'Chapter card',
    fields: [
      { key: 'chapter', label: 'Chapter number / label', kind: 'line', required: true },
      { key: 'title', label: 'Chapter title', kind: 'line', required: true },
      { key: 'subtitle', label: 'Subtitle (optional)', kind: 'line', required: false },
    ],
    candidate_only: false,
  },
  {
    type: 'proof_gate',
    label: 'Proof-gate card',
    fields: [
      { key: 'claim', label: 'The claim', kind: 'line', required: true },
      { key: 'evidence', label: 'The evidence', kind: 'text', required: true },
      { key: 'verdict', label: 'Verdict (optional)', kind: 'line', required: false },
    ],
    candidate_only: false,
  },
];

const TEMPLATE_TYPES = TEMPLATES.map((t) => t.type);

function templateFor(type) {
  return TEMPLATES.find((t) => t.type === type) || null;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeFormat(format = {}) {
  return {
    width: clampInt(format.width, 240, 3840, FORMAT_DEFAULT.width),
    height: clampInt(format.height, 240, 3840, FORMAT_DEFAULT.height),
    fps: clampInt(format.fps, 1, 60, FORMAT_DEFAULT.fps),
    duration_seconds: clampInt(format.duration_seconds, 1, 60, FORMAT_DEFAULT.duration_seconds),
  };
}

function normalizeStyle(style = {}) {
  const overlay = (style.safe_area && style.safe_area.presenter_overlay) || STYLE_DEFAULT.safe_area.presenter_overlay;
  return {
    preset: typeof style.preset === 'string' && style.preset.trim() ? style.preset.trim() : STYLE_DEFAULT.preset,
    safe_area: { presenter_overlay: ['lower_right', 'lower_left', 'none'].indexOf(overlay) !== -1 ? overlay : 'lower_right' },
  };
}

function defaultParamsForType(type) {
  if (type === 'comparison') return { wrong: '', better: '', explanation: '' };
  if (type === 'lower_third') return { name: '', descriptor: '' };
  if (type === 'chapter') return { chapter: '', title: '', subtitle: '' };
  if (type === 'proof_gate') return { claim: '', evidence: '', verdict: '' };
  return { title: '', subtitle: '', claim: '' }; // title
}

// Recommend a render engine for a card type. In the current slice every card
// renders via HyperFrames (proven deterministic HTML/CSS path); Remotion is
// reserved for reusable, data-driven branded systems and is spec/export only for
// now (no in-app Remotion render). The GUI shows engine + reason before render.
function recommendEngine(type) {
  return {
    engine: 'hyperframes',
    recommendation_reason:
      'Deterministic HTML/CSS card — best rendered by HyperFrames. Remotion is reserved for reusable/data-driven branded templates and is spec/export only in this module for now.',
  };
}

// Build a card object (unsaved) with defaults filled in for a given type.
function buildDefaultCard(type, overrides = {}) {
  const t = templateFor(type) || templateFor('title');
  const rec = recommendEngine(t.type);
  return {
    type: t.type,
    status: 'draft',
    engine: overrides.engine || rec.engine,
    recommended_engine: rec.engine,
    recommendation_reason: rec.recommendation_reason,
    candidate_only: Boolean(t.candidate_only),
    output_mode: normalizeOutputMode(t.type, overrides.output_mode),
    params: Object.assign(defaultParamsForType(t.type), overrides.params || {}),
    format: normalizeFormat(overrides.format || {}),
    style: normalizeStyle(overrides.style || {}),
    renders: [],
    current_render_id: null,
  };
}

// Validate the operator-facing params for a card type. Returns { ok, errors }.
function validateCardParams(type, params = {}) {
  const t = templateFor(type);
  const errors = [];
  if (!t) { return { ok: false, errors: ['Unknown card type: ' + String(type)] }; }
  for (const f of t.fields) {
    if (f.required) {
      const v = params[f.key];
      if (!(typeof v === 'string' && v.trim())) errors.push(`${f.label} is required.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── deterministic, safe HTML for preview / render source ─────────────────────
// A self-contained page sized to the card's aspect ratio, with a presenter
// safe-area guide. All params are escaped. Kept intentionally calm/branded.
// options.include_guides (default true) controls the safe-area guide box and
// its label: previews SHOW them (layout aid), the render source EXCLUDES them
// — a dashed guide rectangle baked into a production MP4 is a defect, found
// during the 2026-07-21 production proof.
function buildCardHtml(card = {}, options = {}) {
  const includeGuides = !options || options.include_guides !== false;
  const type = (templateFor(card.type) ? card.type : 'title');
  const fmt = normalizeFormat(card.format || {});
  const style = normalizeStyle(card.style || {});
  const p = card.params || {};
  const overlay = style.safe_area.presenter_overlay;
  let body = '';
  if (type === 'comparison') {
    body = `
      <div class="mg-stack">
        <div class="mg-col mg-wrong"><div class="mg-tag">Wrong way</div><div class="mg-colbody">${escapeHtml(p.wrong)}</div></div>
        <div class="mg-col mg-better"><div class="mg-tag">Better way</div><div class="mg-colbody">${escapeHtml(p.better)}</div></div>
        ${p.explanation ? `<div class="mg-explain">${escapeHtml(p.explanation)}</div>` : ''}
      </div>`;
  } else if (type === 'lower_third') {
    body = `
      <div class="mg-lower-third">
        <div class="mg-lt-name">${escapeHtml(p.name)}</div>
        ${p.descriptor ? `<div class="mg-lt-desc">${escapeHtml(p.descriptor)}</div>` : ''}
      </div>`;
  } else if (type === 'chapter') {
    body = `
      <div class="mg-chapter-block">
        <div class="mg-chapter-kicker">${escapeHtml(p.chapter)}</div>
        <div class="mg-chapter-rule"></div>
        <div class="mg-chapter-title">${escapeHtml(p.title)}</div>
        ${p.subtitle ? `<div class="mg-chapter-sub">${escapeHtml(p.subtitle)}</div>` : ''}
      </div>`;
  } else if (type === 'proof_gate') {
    body = `
      <div class="mg-proof-block">
        <div class="mg-tag">Claim</div>
        <div class="mg-proof-claim">${escapeHtml(p.claim)}</div>
        <div class="mg-tag mg-tag-ev">Evidence</div>
        <div class="mg-proof-ev">${escapeHtml(p.evidence)}</div>
        ${p.verdict ? `<div class="mg-proof-verdict">${escapeHtml(p.verdict)}</div>` : ''}
      </div>`;
  } else { // title / claim
    body = `
      <div class="mg-title-block">
        <div class="mg-title">${escapeHtml(p.title)}</div>
        ${p.subtitle ? `<div class="mg-subtitle">${escapeHtml(p.subtitle)}</div>` : ''}
        ${p.claim ? `<div class="mg-claim">${escapeHtml(p.claim)}</div>` : ''}
      </div>`;
  }
  const overlayClass = overlay === 'lower_left' ? 'mg-overlay-ll' : (overlay === 'none' ? 'mg-overlay-none' : 'mg-overlay-lr');
  // Output-mode backgrounds (alpha slice 2026-07-21): transparent_overlay keeps
  // the page + stage fully transparent so the render carries a real alpha
  // channel — the lower-third plate keeps its designed semi-transparent fill.
  // The checkerboard is a PREVIEW aid only (same rule as the safe-area guides:
  // includeGuides marks preview context); the render source never contains it.
  const transparent = normalizeOutputMode(type, card.output_mode) === 'transparent_overlay';
  const pageBg = transparent
    ? (includeGuides ? 'repeating-conic-gradient(#3a3f45 0% 25%, #23272d 0% 50%) 0 0/32px 32px' : 'transparent')
    : '#0d1117';
  const stageBg = transparent ? 'transparent' : 'linear-gradient(160deg,#0d1117,#161b22)';
  // Inline CSS only; no external assets (works as a HyperFrames composition too).
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  html,body{margin:0;padding:0;background:${pageBg};}
  .mg-stage{position:relative;width:${fmt.width}px;height:${fmt.height}px;background:${stageBg};color:#e6edf3;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden;box-sizing:border-box;padding:8% 8% 12%;}
  .mg-brand{position:absolute;top:5%;left:8%;font-size:${Math.round(fmt.width*0.022)}px;letter-spacing:.14em;text-transform:uppercase;color:#8b949e;font-weight:700;}
  .mg-title-block{position:absolute;top:22%;left:8%;right:8%;}
  .mg-title{font-size:${Math.round(fmt.width*0.085)}px;line-height:1.08;font-weight:800;}
  .mg-subtitle{margin-top:3%;font-size:${Math.round(fmt.width*0.04)}px;color:#9ec1ff;font-weight:600;}
  .mg-claim{margin-top:6%;font-size:${Math.round(fmt.width*0.05)}px;line-height:1.2;color:#e6edf3;}
  .mg-stack{position:absolute;top:16%;left:8%;right:8%;display:flex;flex-direction:column;gap:4%;}
  .mg-col{border-radius:18px;padding:5% 6%;}
  .mg-wrong{background:rgba(248,81,73,.14);border:2px solid #7d2b28;}
  .mg-better{background:rgba(46,160,67,.16);border:2px solid #2ea04355;}
  .mg-tag{font-size:${Math.round(fmt.width*0.03)}px;text-transform:uppercase;letter-spacing:.1em;color:#8b949e;margin-bottom:2%;font-weight:700;}
  .mg-colbody{font-size:${Math.round(fmt.width*0.052)}px;line-height:1.18;font-weight:700;}
  .mg-explain{margin-top:2%;font-size:${Math.round(fmt.width*0.034)}px;color:#9ec1ff;}
  .mg-lower-third{position:absolute;left:6%;bottom:14%;right:30%;background:rgba(13,17,23,.86);border-left:8px solid #2f81f7;border-radius:0 12px 12px 0;padding:3% 4%;}
  .mg-lt-name{font-size:${Math.round(fmt.width*0.05)}px;font-weight:800;}
  .mg-lt-desc{margin-top:1%;font-size:${Math.round(fmt.width*0.032)}px;color:#9ec1ff;font-weight:600;}
  .mg-chapter-block{position:absolute;top:26%;left:8%;right:8%;}
  .mg-chapter-kicker{font-size:${Math.round(fmt.width*0.034)}px;letter-spacing:.22em;text-transform:uppercase;color:#9ec1ff;font-weight:700;}
  .mg-chapter-rule{width:14%;height:6px;background:#2f81f7;border-radius:3px;margin:3% 0 4%;}
  .mg-chapter-title{font-size:${Math.round(fmt.width*0.078)}px;line-height:1.1;font-weight:800;}
  .mg-chapter-sub{margin-top:3%;font-size:${Math.round(fmt.width*0.04)}px;color:#8b949e;font-weight:600;}
  .mg-proof-block{position:absolute;top:18%;left:8%;right:8%;}
  .mg-tag-ev{margin-top:5%;}
  .mg-proof-claim{font-size:${Math.round(fmt.width*0.058)}px;line-height:1.15;font-weight:800;margin-top:2%;}
  .mg-proof-ev{margin-top:2%;font-size:${Math.round(fmt.width*0.04)}px;line-height:1.3;color:#e6edf3;background:rgba(47,129,247,.10);border:1px solid #2f81f755;border-radius:14px;padding:4% 5%;}
  .mg-proof-verdict{margin-top:4%;font-size:${Math.round(fmt.width*0.044)}px;font-weight:700;color:#2ea043;}
  .mg-safe{position:absolute;width:34%;height:26%;border:2px dashed rgba(158,193,255,.35);border-radius:12px;}
  .mg-overlay-lr{right:6%;bottom:8%;}
  .mg-overlay-ll{left:6%;bottom:8%;}
  .mg-overlay-none{display:none;}
  .mg-safe-label{position:absolute;bottom:1%;left:6%;font-size:${Math.round(fmt.width*0.02)}px;color:#586069;}
</style></head>
<body>
  <div id="root" class="mg-stage" data-type="${escapeHtml(type)}" data-composition-id="${escapeHtml(card.card_id || type)}" data-start="0" data-duration="${fmt.duration_seconds}" data-width="${fmt.width}" data-height="${fmt.height}" data-fps="${fmt.fps}">
    <div class="mg-brand">VIDTOOLZ</div>
    ${body}
    ${includeGuides ? `<div class="mg-safe ${overlayClass}"></div>
    <div class="mg-safe-label">presenter-safe area: ${escapeHtml(overlay)}</div>` : ''}
  </div>
</body></html>`;
}

module.exports = {
  FORMAT_DEFAULT,
  STYLE_DEFAULT,
  OUTPUT_MODES,
  OUTPUT_MODE_DEFAULT,
  TRANSPARENT_CAPABLE_TYPES,
  normalizeOutputMode,
  validateOutputMode,
  TEMPLATES,
  TEMPLATE_TYPES,
  templateFor,
  escapeHtml,
  normalizeFormat,
  normalizeStyle,
  defaultParamsForType,
  recommendEngine,
  buildDefaultCard,
  validateCardParams,
  buildCardHtml,
};
