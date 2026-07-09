'use strict';

// Motion Graphics Studio — Remotion SPEC / EXPORT (Slice 3).
//
// SPEC ONLY: this maps an MGS card to a vidtoolz-brandkit-remotion composition +
// props so an operator can render it MANUALLY / LATER in that separate repo. It
// NEVER invokes Remotion, adds no dependency, and never mutates the brandkit. No
// I/O here (the server writes the optional props file). The brandkit repo path is
// injected (options.brandkitRoot) — no hardcoded path in feature code.
//
// The composition ids + prop field names below were verified read-only against
// vidtoolz-brandkit-remotion/src/render-props/*.json:
//   IntroSting  { title, subtitle }
//   LowerThird  { name, role }
// A two-column wrong-way/better-way comparison has NO brandkit composition yet,
// so it is reported unmapped (HyperFrames remains the render path for it).

function str(v) { return typeof v === 'string' ? v.trim() : ''; }

const BRANDKIT_MAP = {
  title: {
    composition_id: 'IntroSting',
    orientation: 'landscape', // base brandkit compositions render 1920x1080
    props: (p) => ({ title: str(p.title), subtitle: str(p.subtitle) || str(p.claim) }),
    dropped: (p) => (str(p.subtitle) && str(p.claim) ? ['claim (IntroSting has no dedicated claim field; subtitle used)'] : []),
  },
  lower_third: {
    composition_id: 'LowerThird',
    orientation: 'landscape',
    props: (p) => ({ name: str(p.name), role: str(p.descriptor) }),
    dropped: () => [],
  },
  comparison: { composition_id: null },
};

// Build the export spec for a card. Deterministic, JSON-safe, no render.
function buildRemotionSpec(card = {}, options = {}) {
  const brandkitRoot = options.brandkitRoot || 'vidtoolz-brandkit-remotion';
  const type = card.type;
  const params = card.params || {};
  const fmt = card.format || {};
  const map = BRANDKIT_MAP[type] || { composition_id: null };
  const mapped = Boolean(map.composition_id);
  const spec = {
    engine: 'remotion',
    export_only: true,
    brandkit_repo: brandkitRoot,
    card_type: type,
    card_id: card.card_id || null,
    format: { width: fmt.width, height: fmt.height, fps: fmt.fps, duration_seconds: fmt.duration_seconds },
    mapped,
    composition_id: map.composition_id || null,
    props: mapped ? map.props(params) : null,
    render_hint: null,
    notes: [
      'Spec/export only — Motion Graphics Studio does NOT render Remotion. Render manually in the separate vidtoolz-brandkit-remotion repo (local only; no cloud/Lambda).',
    ],
  };
  if (mapped) {
    const dropped = (map.dropped ? map.dropped(params) : []);
    if (dropped.length) spec.notes.push('Fields not carried into this composition: ' + dropped.join('; ') + '.');
    if (map.orientation === 'landscape' && Number(fmt.height) > Number(fmt.width)) {
      spec.notes.push('Card is vertical (' + fmt.width + 'x' + fmt.height + ') but the base brandkit composition renders landscape 1920x1080 — pick/author a vertical variant if you need 9:16.');
    }
    // Runnable hint; PROPS_FILE is the props JSON written by the export endpoint.
    spec.render_hint = 'cd ' + brandkitRoot + ' && npx remotion render src/index.tsx ' + map.composition_id + ' <output.mp4> --props <PROPS_FILE>';
  } else {
    spec.notes.push('No brandkit composition renders a "' + String(type) + '" card yet (e.g. a two-column wrong-way/better-way). Use HyperFrames for this card, or add a matching composition to the brandkit.');
  }
  return spec;
}

module.exports = {
  BRANDKIT_MAP,
  buildRemotionSpec,
};
