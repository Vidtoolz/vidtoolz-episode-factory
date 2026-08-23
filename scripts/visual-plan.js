'use strict';
// CANONICAL VISUAL PLAN V1 — deterministic identity/provenance contract that
// binds Story version → section → visual beat → shot → prompt ID, and hands
// off to Generation Supervisor / Camera Director / Editor WITHOUT owning their
// authorities.
//
// This module is the EF-side coverage + shot-intent + prompt-binding authority.
// It is NOT: media provenance authority (Unit B), camera movement plan
// (Camera Director), generation backend plan (Generation Supervisor), final
// asset selection (human), or a Creative concept document (Creative Director).
//
// No LLM. No media generation. Pure deterministic schema + validation.

const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'visual-plan';

// ULID-style id (Crockford base32, 26 chars) — matches Unit B conventions.
function ulid(now = Date.now()) {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now, out = '';
  for (let i = 0; i < 10; i++) { out = ENCODING[time % 32] + out; time = Math.floor(time / 32); }
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) out += ENCODING[bytes[i] % 32];
  return out;
}

// ── canonical enums (repository-native taxonomies only) ──────────────────────
// media_type mirrors config/production-stages.json stages (image-prompts,
// image-gen, image-select, i2v-prompts, video-gen) plus existing lane names.
const MEDIA_TYPES = Object.freeze([
  'GENERATED_STILL',        // image-prompts → image-gen (FLUX)
  'GENERATED_VIDEO',        // i2v-prompts → video-gen (Wan/Kling/Veo)
  'INFOGRAPHIC',            // infographic prompt stage
  'MAP_ANIMATION',          // Earth Studio lane
  'SCREEN_CAPTURE',         // manual capture
  'ARCHIVAL_EXTERNAL',      // external-origin assets (Unit B origin:external)
  'PRESENTER_A_ROLL',       // presenter on camera
  'TEXT_GRAPHIC',           // static card / lower third source
]);
const PRESENTER_RELATIONS = Object.freeze(['PRESENT', 'BROLL', 'REPLACE', 'NONE']);
const SHOT_STATUSES = Object.freeze(['PLANNED', 'PROMPTED', 'GENERATED', 'SELECTED', 'REJECTED']);
const COVERAGE_STATUSES = Object.freeze(['COVERED', 'INTENTIONAL_NONE', 'MISSING']);
const PLAN_STATUSES = Object.freeze(['DRAFT', 'AWAITING_HUMAN_REVIEW', 'APPROVED_FOR_GENERATION', 'STALE']);

// Fields owned by other authorities — hard-rejected in canonical plans.
const PROHIBITED_FIELD_PATTERNS = [
  // generation routing authority (Generation Supervisor)
  /^host$/i, /^endpoint$/i, /^model$/i, /^backend$/i, /^lane$/i, /^worker$/i,
  /^comfyui/i, /^presto$/i, /^vidlap2$/i, /^fallback_route$/i, /^routing$/i,
  /^machine$/i, /^gpu$/i,
  // camera movement mechanics (Camera Director)
  /^heading_tracks?$/i, /^pitch_curves?$/i, /^orbit_geometry$/i, /^easing$/i,
  /^camera_path$/i, /^keyframes?$/i, /^trajectory$/i, /^waypoints?$/i,
  // human-only authority
  /^final_selected_asset$/i, /^selected_asset_id$/i, /^approved_assets?$/i,
];

// Camera INTENT fields allowed at planning level (no mechanics).
const CAMERA_INTENT_FIELDS = Object.freeze([
  'subject', 'purpose', 'desired_reveal', 'scale_transition_intent',
  'movement_need', 'temporal_context', 'geographic_context',
]);

function findProhibitedField(obj, path = '') {
  if (Array.isArray(obj)) {
    for (const [i, v] of obj.entries()) {
      const hit = findProhibitedField(v, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj || {})) {
    const p = path ? `${path}.${k}` : k;
    if (PROHIBITED_FIELD_PATTERNS.some((re) => re.test(k))) return p;
    if (v && typeof v === 'object') {
      const hit = findProhibitedField(v, p);
      if (hit) return hit;
    }
  }
  return null;
}

// ── canonical digest (stable across JSON key order) ──────────────────────────
function canonicalize(value) {
  if (value === undefined) return null; // JSON semantics: undefined fields vanish on round-trip
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}
function planDigest(plan) {
  const copy = { ...plan };
  delete copy.digest;
  return sha256(canonicalize(copy));
}

// ── validation ───────────────────────────────────────────────────────────────
// options:
//   currentStory: { project_id, version_id, content_hash }  → drift check
//   requiredBeats: [{ section_id, beat_id }]                → coverage check
//   knownPromptIds: [string]                                → manifest linkage
function validatePlan(plan, options = {}) {
  const errors = [];
  const add = (e) => errors.push(e);
  if (!plan || typeof plan !== 'object') return { ok: false, stale: false, coverage: null, errors: ['plan is not an object'] };

  if (plan.schema_version !== SCHEMA_VERSION) add(`schema_version must be ${SCHEMA_VERSION}`);
  if (plan.artifact_type !== ARTIFACT_TYPE) add(`artifact_type must be "${ARTIFACT_TYPE}"`);
  if (!plan.plan_id || !/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(plan.plan_id)) add('plan_id missing/malformed (ULID expected)');
  if (!plan.created_at || Number.isNaN(Date.parse(plan.created_at))) add('created_at missing/invalid');
  if (!plan.created_by) add('created_by missing');
  if (!PLAN_STATUSES.includes(plan.status)) add(`status must be one of ${PLAN_STATUSES.join('|')}`);

  // story binding
  const story = plan.story || {};
  if (!story.project_id) add('story.project_id missing');
  if (!story.version_id) add('story.version_id missing');
  if (!story.content_hash || !/^[a-f0-9]{64}$/.test(story.content_hash)) add('story.content_hash must be sha256 hex');

  // boundary enforcement
  const prohibited = findProhibitedField(plan);
  if (prohibited) add(`prohibited field owned by another authority: ${prohibited}`);

  // shots
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  const shotIds = new Set();
  const promptOwners = new Map(); // prompt_id -> shot_id
  for (const [i, shot] of shots.entries()) {
    const w = `shots[${i}]`;
    if (!shot.shot_id) { add(`${w}: shot_id missing`); continue; }
    if (shotIds.has(shot.shot_id)) add(`${w}: duplicate shot_id ${shot.shot_id}`);
    shotIds.add(shot.shot_id);
    if (!shot.section_ref?.section_id) add(`${w}: section_ref.section_id missing`);
    if (!shot.beat_ref?.beat_id) add(`${w}: beat_ref.beat_id missing`);
    if (!MEDIA_TYPES.includes(shot.media_type)) add(`${w}: unknown media_type ${shot.media_type}`);
    if (!shot.narrative_function) add(`${w}: narrative_function missing`);
    if (!shot.shot_brief || !String(shot.shot_brief).trim()) add(`${w}: shot_brief empty`);
    if (!PRESENTER_RELATIONS.includes(shot.presenter_relation)) add(`${w}: presenter_relation must be ${PRESENTER_RELATIONS.join('|')}`);
    if (!SHOT_STATUSES.includes(shot.status)) add(`${w}: status must be ${SHOT_STATUSES.join('|')}`);
    if (shot.duration_target_s != null && (typeof shot.duration_target_s !== 'number' || shot.duration_target_s <= 0)) add(`${w}: duration_target_s invalid`);

    // research-sensitive visuals require canonical refs
    if (shot.research_sensitive && !(Array.isArray(shot.research_binding_refs) && shot.research_binding_refs.length)) {
      add(`${w}: research_sensitive true requires research_binding_refs`);
    }
    for (const ref of shot.research_binding_refs || []) {
      if (!ref.binding_id || !ref.claim_ref?.canonical_id) add(`${w}: research_binding_ref requires binding_id + claim_ref.canonical_id`);
    }

    // prompts bound to this shot
    for (const pr of shot.prompt_refs || []) {
      const pid = typeof pr === 'string' ? pr : pr.prompt_id;
      if (!pid) { add(`${w}: prompt_ref without prompt_id`); continue; }
      if (promptOwners.has(pid)) add(`prompt ${pid} bound to multiple shots (${promptOwners.get(pid)}, ${shot.shot_id})`);
      promptOwners.set(pid, shot.shot_id);
    }
    if (shot.camera_intent) {
      for (const key of Object.keys(shot.camera_intent)) {
        if (!CAMERA_INTENT_FIELDS.includes(key)) add(`${w}.camera_intent.${key} is not an intent-level field`);
      }
    }
    // editor handoff refs
    if (shot.edit_placement != null && typeof shot.edit_placement !== 'string') add(`${w}: edit_placement must be string`);
  }

  // orphan prompts at plan level
  for (const p of plan.prompts || []) {
    const pid = p.prompt_id;
    if (!promptOwners.has(pid)) add(`prompt ${pid} not bound to any shot`);
  }

  // known-prompt linkage (manifest compatibility)
  if (options.knownPromptIds) {
    const known = new Set(options.knownPromptIds);
    for (const [pid, sid] of promptOwners) {
      if (!known.has(pid)) add(`prompt ${pid} not present in known prompt manifest`);
    }
  }

  // story drift
  let stale = false;
  if (options.currentStory) {
    const cs = options.currentStory;
    if (story.version_id !== cs.version_id) { add(`plan bound to version ${story.version_id}, current is ${cs.version_id}`); stale = true; }
    else if (story.content_hash !== cs.content_hash) { add('story content hash changed since plan creation'); stale = true; }
  }

  // coverage
  let coverage = null;
  if (options.requiredBeats) {
    const intentional = new Set((plan.intentional_none || []).map((r) => r.beat_id));
    const coveredBeats = new Set(shots.filter((s) => s.beat_ref?.beat_id).map((s) => s.beat_ref.beat_id));
    coverage = [];
    for (const rb of options.requiredBeats) {
      const bid = rb.beat_id;
      if (coveredBeats.has(bid)) coverage.push({ beat_id: bid, status: 'COVERED' });
      else if (intentional.has(bid)) {
        const rec = (plan.intentional_none || []).find((r) => r.beat_id === bid);
        if (!rec.reason || !String(rec.reason).trim()) add(`intentional_none for beat ${bid} lacks reason`);
        coverage.push({ beat_id: bid, status: 'INTENTIONAL_NONE' });
      } else { coverage.push({ beat_id: bid, status: 'MISSING' }); }
    }
    for (const bid of coveredBeats) {
      if (!options.requiredBeats.some((rb) => rb.beat_id === bid)) add(`shot references unknown beat ${bid}`);
    }
    for (const bid of intentional) {
      if (!options.requiredBeats.some((rb) => rb.beat_id === bid)) add(`intentional_none references unknown beat ${bid}`);
    }
  }

  return { ok: errors.length === 0, stale, coverage, errors };
}

// ── review bundle (deterministic human-readable projection) ──────────────────
function buildReviewBundle(plan, validation = {}) {
  const shots = plan.shots || [];
  const byBeat = new Map();
  for (const s of shots) {
    const b = s.beat_ref?.beat_id || '?';
    if (!byBeat.has(b)) byBeat.set(b, []);
    byBeat.get(b).push(s);
  }
  const cov = validation.coverage || [];
  return {
    artifact_type: ARTIFACT_TYPE, plan_id: plan.plan_id,
    story: plan.story, status: plan.status,
    totals: {
      shots: shots.length,
      beats_covered: cov.filter((c) => c.status === 'COVERED').length,
      beats_intentional_none: cov.filter((c) => c.status === 'INTENTIONAL_NONE').length,
      beats_missing: cov.filter((c) => c.status === 'MISSING').length,
      research_sensitive: shots.filter((s) => s.research_sensitive).length,
      media_types: [...new Set(shots.map((s) => s.media_type))],
    },
    shots: shots.map((s) => ({
      shot_id: s.shot_id, section: s.section_ref, beat: s.beat_ref,
      narrative_function: s.narrative_function, media_type: s.media_type,
      shot_brief: s.shot_brief, prompt_ids: (s.prompt_refs || []).map((p) => (typeof p === 'string' ? p : p.prompt_id)),
      duration_target_s: s.duration_target_s ?? null,
      presenter_relation: s.presenter_relation,
      research_sensitive: Boolean(s.research_sensitive),
      camera_intent: s.camera_intent || null,
      priority: s.priority ?? null, status: s.status,
    })),
    human_attention: {
      missing_beats: cov.filter((c) => c.status === 'MISSING').map((c) => c.beat_id),
      research_sensitive_shots: shots.filter((s) => s.research_sensitive).map((s) => s.shot_id),
      camera_handoff_shots: shots.filter((s) => s.camera_intent).map((s) => s.shot_id),
      generation_requirements: shots.filter((s) => ['GENERATED_STILL', 'GENERATED_VIDEO', 'INFOGRAPHIC', 'MAP_ANIMATION'].includes(s.media_type)).map((s) => ({ shot_id: s.shot_id, media_type: s.media_type })),
    },
    validation: { ok: validation.ok, stale: validation.stale, errors: (validation.errors || []).slice(0, 10) },
  };
}

// ── markdown projection ──────────────────────────────────────────────────────
function renderMarkdown(bundle) {
  const lines = [`# Visual Plan Review — ${bundle.plan_id}`, '',
    `- Story: ${bundle.story.project_id} @ ${bundle.story.version_id} (${bundle.story.content_hash.slice(0, 12)}…)`,
    `- Status: ${bundle.status}`, `- Shots: ${bundle.totals.shots}; covered ${bundle.totals.beats_covered}, intentional-none ${bundle.totals.beats_intentional_none}, missing ${bundle.totals.beats_missing}`, '',
    '| Shot | Beat | Type | Brief | Prompts | Research |', '|---|---|---|---|---|---|'];
  for (const s of bundle.shots) {
    lines.push(`| ${s.shot_id.slice(0, 8)} | ${s.beat?.beat_id || '?'} | ${s.media_type} | ${String(s.shot_brief).slice(0, 80)} | ${s.prompt_ids.join(', ') || '—'} | ${s.research_sensitive ? '⚠️' : ''} |`);
  }
  if (bundle.human_attention.missing_beats.length) lines.push('', `**Missing coverage:** ${bundle.human_attention.missing_beats.join(', ')}`);
  return lines.join('\n');
}

module.exports = {
  SCHEMA_VERSION, ARTIFACT_TYPE, MEDIA_TYPES, PRESENTER_RELATIONS,
  SHOT_STATUSES, COVERAGE_STATUSES, PLAN_STATUSES, CAMERA_INTENT_FIELDS,
  ulid, sha256, canonicalize, planDigest, validatePlan,
  buildReviewBundle, renderMarkdown, newPlanId: () => ulid(),
};

if (require.main === module) {
  const fs = require('node:fs');
  const file = process.argv[2];
  if (!file) { console.error('usage: visual-plan.js <visual-plan.json> [--current-story <json>]'); process.exit(2); }
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  let opts = {};
  if (process.argv.includes('--current-story')) {
    opts.currentStory = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--current-story') + 1], 'utf8'));
  }
  const out = validatePlan(plan, opts);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok && !out.stale ? 0 : 1);
}
