'use strict';
// PRESENTER TAKE MANIFEST V1 — deterministic identity/provenance contract for
// presenter recording: approved Story version → recording unit → take → exact
// media bytes → captured transcript → script-fidelity record → pickup lineage
// → human selection.
//
// It owns IDENTITY and PROVENANCE only. It does NOT decide: performance
// quality, delivery authenticity, humor/timing, whether an intentional
// deviation is acceptable, final take selection, or QC. It may RECORD
// externally-supplied judgments bound to exact bytes.
//
// No ASR. No semantic performance judgment. Pure deterministic validation.

const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'presenter-take-manifest';
const ULID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

function ulid(now = Date.now()) {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now, out = '';
  for (let i = 0; i < 10; i++) { out = ENCODING[time % 32] + out; time = Math.floor(time / 32); }
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) out += ENCODING[bytes[i] % 32];
  return out;
}

const APPROVAL_STATES = Object.freeze(['draft', 'approved']);
const FIDELITY_CLASSES = Object.freeze([
  'SCRIPT_FAITHFUL', 'MINOR_DELIVERY_VARIATION', 'STORY_CHANGE',
  'RESEARCH_SENSITIVE_CHANGE', 'HUMAN_VERIFIED_REQUIRED', 'UNREVIEWED',
]);
const TECH_STATES = Object.freeze(['CAPTURED', 'MEDIA_VALID', 'MEDIA_INVALID', 'TRANSCRIPT_MISSING', 'SCRIPT_STALE']);
const TRANSCRIPT_SOURCES = Object.freeze(['HUMAN_SUPPLIED', 'IMPORTED', 'EXTERNAL_TRANSCRIPTION']);
const PICKUP_REASONS = Object.freeze(['SCRIPT_DEVIATION', 'TECHNICAL_FAILURE', 'PERFORMANCE_REVIEW_REQUEST', 'MISSING_UNIT']);
const PICKUP_STATES = Object.freeze(['OPEN', 'SATISFIED', 'STALE']);
const LIFECYCLE_STATES = Object.freeze(['PREVIEW_ONLY', 'READY_FOR_REVIEW', 'EDITOR_READY', 'SCRIPT_STALE']);

// Authority leakage — hard-rejected anywhere in the artifact.
const FORBIDDEN_FIELDS = new Set([
  'best_take', 'approved_take', 'editor_selected', 'qc_pass', 'publish_ready',
  'performance_approved', 'story_rewrite', 'research_override', 'selected',
  'final_take', 'performance_score', 'approved_performance',
]);

// Framing preset ids come from Script Builder data/presets.yaml (canonical).
// Validation accepts an explicit allow-list supplied by the caller so the EF
// module never hard-codes SB config.
const KNOWN_FRAMING_PRESETS_DEFAULT = Object.freeze([
  'right-third', 'left-third', 'center-lower', 'center-frame', 'corner-pip',
]);

function findForbidden(value, pathName = '$', hits = []) {
  if (!value || typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) hits.push(`${pathName}.${key}`);
    findForbidden(child, `${pathName}.${key}`, hits);
  }
  return hits;
}

// ── canonical digest (order-stable, undefined-skipping) ──────────────────────
function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}
function manifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.manifest_digest_sha256;
  return sha256(canonicalize(copy));
}

// ── deterministic textual diff (mechanical only — no semantic equivalence) ───
function normalizeText(text) {
  return String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}
function tokenize(text) {
  return normalizeText(text).split(' ').filter(Boolean);
}
// Mechanical comparison of captured text vs approved dialogue.
function textDiff(approvedText, capturedText) {
  const a = tokenize(approvedText);
  const b = tokenize(capturedText);
  const setA = new Map(); const setB = new Map();
  for (const t of a) setA.set(t, (setA.get(t) || 0) + 1);
  for (const t of b) setB.set(t, (setB.get(t) || 0) + 1);
  const removed = [], added = [];
  for (const [tok, n] of setA) { const m = setB.get(tok) || 0; for (let i = 0; i < n - m; i++) removed.push(tok); }
  for (const [tok, n] of setB) { const m = setA.get(tok) || 0; for (let i = 0; i < n - m; i++) added.push(tok); }
  const exact = normalizeText(approvedText) === normalizeText(capturedText);
  // structural factual-risk signals (no meaning conclusions)
  const NUMBER_RE = /\d/;
  const ABSOLUTE_RE = /\b(best|only|always|never|guarantee|proven|free|cheapest|fastest|everyone|nobody)\b/i;
  const factualRisk = [];
  if (removed.some((t) => NUMBER_RE.test(t)) || added.some((t) => NUMBER_RE.test(t))) factualRisk.push('NUMBER_TOKEN_CHANGED');
  if (removed.some((t) => ABSOLUTE_RE.test(t)) || added.some((t) => ABSOLUTE_RE.test(t))) factualRisk.push('ABSOLUTE_TERM_CHANGED');
  return {
    exact,
    normalized_identical: exact,
    approved_text_sha256: sha256(normalizeText(approvedText)),
    captured_text_sha256: sha256(normalizeText(capturedText)),
    approved_token_count: a.length,
    captured_token_count: b.length,
    removed_tokens: removed,
    added_tokens: added,
    changed: removed.length > 0 || added.length > 0,
    factual_risk_flags: factualRisk,
  };
}

// ── recording unit derivation ────────────────────────────────────────────────
// story: { project_id, version_id, content_hash, approval_state, sections:[{section_id, order, dialogue, framing_preset, type}] }
// options: { newUnitId, knownFramingPresets, researchBindingsBySection }
function buildRecordingUnits(story, options = {}) {
  const newUnitId = options.newUnitId || (() => `recording-unit-${ulid()}`);
  const presets = options.knownFramingPresets || KNOWN_FRAMING_PRESETS_DEFAULT;
  const units = [];
  for (const s of story.sections) {
    if (!s.section_id) throw new Error('section_id required for recording unit derivation');
    const preset = s.framing_preset || 'center-lower';
    if (!presets.includes(preset)) throw new Error(`unknown framing preset: ${preset}`);
    units.push({
      recording_unit_id: newUnitId(),
      story: { project_id: story.project_id, version_id: story.version_id, content_hash: story.content_hash },
      section_id: s.section_id,
      order: s.order,
      approved_dialogue: s.dialogue,
      approved_dialogue_sha256: sha256(normalizeText(s.dialogue)),
      framing_preset: preset,
      capture_type: s.type || 'composited',
      presenter_relation: s.presenter_relation || null,
      visual_beat_refs: s.visual_beat_refs || [],
      teleprompter_segment_ref: s.teleprompter_segment_ref || null,
      research_binding_ids: s.research_binding_ids || [],
    });
  }
  return units;
}

// ── validation ───────────────────────────────────────────────────────────────
// options:
//   currentStory: { project_id, version_id, content_hash }        → drift
//   knownFramingPresets: [string]
//   mediaProbe: (media) → probe result                            → technical validation
//   researchBindingsByUnit: { unitId → [binding refs] }
function validateManifest(manifest, options = {}) {
  const errors = [];
  const add = (e) => errors.push(e);
  if (!manifest || typeof manifest !== 'object') return { ok: false, stale: false, authority: null, errors: ['manifest is not an object'] };

  if (manifest.schema_version !== SCHEMA_VERSION) add(`schema_version must be ${SCHEMA_VERSION}`);
  if (manifest.artifact_type !== ARTIFACT_TYPE) add(`artifact_type must be "${ARTIFACT_TYPE}"`);
  if (!ULID_RE.test(manifest.manifest_id || '')) add('manifest_id malformed (ULID expected)');
  if (!Number.isInteger(manifest.manifest_revision) || manifest.manifest_revision < 1) add('manifest_revision must be positive');
  if (!manifest.created_at || Number.isNaN(Date.parse(manifest.created_at))) add('created_at invalid');
  if (!manifest.created_by) add('created_by missing');
  if (!/^[a-f0-9]{64}$/.test(manifest.manifest_digest_sha256 || '')) add('manifest_digest_sha256 missing/malformed');
  else if (manifestDigest(manifest) !== manifest.manifest_digest_sha256) add('stored manifest digest mismatch');

  for (const hit of findForbidden(manifest)) add(`forbidden authority field: ${hit}`);

  // story binding
  const story = manifest.story || {};
  if (!story.project_id || !story.version_id || !/^[a-f0-9]{64}$/.test(story.content_hash || '')) add('story identity incomplete');
  if (story.approval_state != null && !APPROVAL_STATES.includes(story.approval_state)) add('story.approval_state invalid');

  // units
  const units = Array.isArray(manifest.recording_units) ? manifest.recording_units : [];
  const unitIds = new Set(); const unitsById = new Map();
  for (const [i, u] of units.entries()) {
    const w = `recording_units[${i}]`;
    if (!/^recording-unit-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(u.recording_unit_id || '')) add(`${w}.recording_unit_id malformed`);
    else if (unitIds.has(u.recording_unit_id)) add(`${w}: duplicate recording_unit_id`);
    unitIds.add(u.recording_unit_id); unitsById.set(u.recording_unit_id, u);
    if (!u.story || u.story.project_id !== story.project_id || u.story.version_id !== story.version_id || u.story.content_hash !== story.content_hash) add(`${w}: unit Story identity does not match manifest`);
    if (!u.section_id) add(`${w}.section_id missing`);
    if (!/^[a-f0-9]{64}$/.test(u.approved_dialogue_sha256 || '')) add(`${w}.approved_dialogue_sha256 missing`);
    else if (u.approved_dialogue != null && sha256(normalizeText(u.approved_dialogue)) !== u.approved_dialogue_sha256) add(`${w}: approved_dialogue hash mismatch`);
    if (!u.framing_preset) add(`${w}.framing_preset missing`);
    else {
      const presets = options.knownFramingPresets || KNOWN_FRAMING_PRESETS_DEFAULT;
      if (!presets.includes(u.framing_preset)) add(`${w}: unknown framing preset ${u.framing_preset}`);
    }
  }

  // takes
  const takes = Array.isArray(manifest.takes) ? manifest.takes : [];
  const takeIds = new Set();
  for (const [i, t] of takes.entries()) {
    const w = `takes[${i}]`;
    if (!/^take-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(t.take_id || '')) add(`${w}.take_id malformed`);
    else if (takeIds.has(t.take_id)) add(`${w}: duplicate take_id`);
    takeIds.add(t.take_id);
    if (!unitIds.has(t.recording_unit_id)) add(`${w}: references unknown recording unit`);
    else {
      const unit = unitsById.get(t.recording_unit_id);
      if (t.story && unit && (t.story.version_id !== unit.story.version_id || t.story.content_hash !== unit.story.content_hash)) add(`${w}: take Story identity differs from its unit`);
    }
    const media = t.media || {};
    if (!media.path_or_artifact_ref) add(`${w}.media.path_or_artifact_ref required`);
    if (!/^[a-f0-9]{64}$/.test(media.sha256 || '')) add(`${w}.media.sha256 required (exact byte binding)`);
    if (typeof media.byte_size !== 'number' || media.byte_size <= 0) add(`${w}.media.byte_size invalid`);
    if (typeof media.duration_s !== 'number' || media.duration_s <= 0) add(`${w}.media.duration_s invalid`);
    if (!media.media_type) add(`${w}.media.media_type required`);
    if (!t.captured_at || Number.isNaN(Date.parse(t.captured_at))) add(`${w}.captured_at invalid`);
    if (!TECH_STATES.includes(t.technical_state)) add(`${w}.technical_state invalid`);
    if (t.fidelity_state != null && !FIDELITY_CLASSES.includes(t.fidelity_state)) add(`${w}.fidelity_state invalid`);
    // transcript binding
    if (t.transcript != null) {
      const tr = t.transcript;
      if (!tr.text && tr.text !== '') add(`${w}.transcript.text missing`);
      if (!/^[a-f0-9]{64}$/.test(tr.sha256 || '')) add(`${w}.transcript.sha256 missing`);
      else if (tr.text != null && sha256(normalizeText(tr.text)) !== tr.sha256) add(`${w}: transcript hash mismatch`);
      if (!TRANSCRIPT_SOURCES.includes(tr.source)) add(`${w}.transcript.source invalid`);
      if (tr.media_sha256 !== media.sha256) add(`${w}: transcript media_sha256 does not bind this take's media bytes`);
    }
    // pickup lineage
    if (t.pickup_of_take_id != null && !takeIds.has(t.pickup_of_take_id) && !takes.slice(0, i).some((x) => x.take_id === t.pickup_of_take_id)) {
      add(`${w}: pickup_of_take_id references unknown take`);
    }
  }

  // pickups
  const pickups = Array.isArray(manifest.pickup_requests) ? manifest.pickup_requests : [];
  const pickupIds = new Set();
  for (const [i, p] of pickups.entries()) {
    const w = `pickup_requests[${i}]`;
    if (!/^pickup-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(p.pickup_request_id || '')) add(`${w}.pickup_request_id malformed`);
    else if (pickupIds.has(p.pickup_request_id)) add(`${w}: duplicate pickup_request_id`);
    pickupIds.add(p.pickup_request_id);
    if (!unitIds.has(p.recording_unit_id)) add(`${w}: references unknown recording unit`);
    if (!PICKUP_REASONS.includes(p.reason_code)) add(`${w}.reason_code invalid`);
    if (!PICKUP_STATES.includes(p.state)) add(`${w}.state invalid`);
    if (!p.created_by) add(`${w}.created_by missing`);
  }

  // human selections
  const selections = Array.isArray(manifest.human_selections) ? manifest.human_selections : [];
  const seenUnitsSelected = new Set();
  for (const [i, sel] of selections.entries()) {
    const w = `human_selections[${i}]`;
    if (!takeIds.has(sel.take_id)) add(`${w}: references unknown take`);
    const take = takes.find((t) => t.take_id === sel.take_id);
    if (take) {
      if (sel.recording_unit_id !== take.recording_unit_id) add(`${w}: unit does not match take`);
      if (sel.media_sha256 !== take.media.sha256) add(`${w}: media_sha256 does not match take media bytes`);
    }
    if (!sel.selected_by || sel.selected_by === 'hermes') add(`${w}: selected_by must be a human`);
    if (!sel.selected_at || Number.isNaN(Date.parse(sel.selected_at))) add(`${w}.selected_at invalid`);
    if (seenUnitsSelected.has(sel.recording_unit_id)) add(`${w}: multiple selections for one recording unit`);
    seenUnitsSelected.add(sel.recording_unit_id);
  }

  // drift
  let stale = false;
  if (options.currentStory) {
    const cs = options.currentStory;
    if (story.version_id !== cs.version_id) { add(`manifest bound to version ${story.version_id}, current is ${cs.version_id}`); stale = true; }
    else if (story.content_hash !== cs.content_hash) { add('Story content hash changed since manifest creation'); stale = true; }
  }

  // technical media validation (optional external probe)
  if (options.mediaProbe) {
    for (const [i, t] of takes.entries()) {
      const probe = options.mediaProbe(t.media);
      if (probe && probe.available === false) add(`takes[${i}]: media probe failed: ${probe.reason}`);
    }
  }

  return { ok: errors.length === 0, stale, errors };
}

// ── take authority projection ────────────────────────────────────────────────
function evaluateTakeAuthority(manifest, takeId, options = {}) {
  const reasons = [];
  const story = manifest.story || {};
  const take = (manifest.takes || []).find((t) => t.take_id === takeId);
  if (!take) return { eligible: false, state: 'UNKNOWN_TAKE', reasons: [`unknown take ${takeId}`] };
  if (options.currentStory) {
    const cs = options.currentStory;
    if (story.version_id !== cs.version_id || story.content_hash !== cs.content_hash) { reasons.push('SCRIPT_STALE'); }
  }
  if (take.technical_state === 'MEDIA_INVALID') reasons.push('MEDIA_INVALID');
  if (take.technical_state === 'CAPTURED') reasons.push('MEDIA_VALIDATION_PENDING');
  if (!take.transcript) reasons.push('TRANSCRIPT_REQUIRED_FOR_FIDELITY_REVIEW');
  const fidelityKnown = take.fidelity_state && !['UNREVIEWED', 'HUMAN_VERIFIED_REQUIRED'].includes(take.fidelity_state);
  if (!fidelityKnown) reasons.push('SCRIPT_FIDELITY_UNREVIEWED');
  const openPickup = (manifest.pickup_requests || []).some((p) => p.recording_unit_id === take.recording_unit_id && p.state === 'OPEN');
  const selection = (manifest.human_selections || []).find((s) => s.recording_unit_id === take.recording_unit_id);
  const structurallyValid = reasons.filter((r) => ['SCRIPT_STALE', 'MEDIA_INVALID'].includes(r)).length === 0;
  const editorReady = structurallyValid && fidelityKnown && selection && selection.take_id === takeId;
  let state = 'REVIEW_ELIGIBLE';
  if (reasons.includes('SCRIPT_STALE')) state = 'SCRIPT_STALE';
  else if (reasons.includes('MEDIA_INVALID')) state = 'MEDIA_INVALID';
  else if (editorReady) state = 'EDITOR_READY';
  else if (openPickup) state = 'PICKUP_OPEN';
  else if (!selection) state = 'AWAITING_HUMAN_SELECTION';
  return {
    eligible: structurallyValid, structurally_valid: structurallyValid,
    story_current: !reasons.includes('SCRIPT_STALE'), media_valid: take.technical_state !== 'MEDIA_INVALID',
    transcript_bound: Boolean(take.transcript), script_fidelity_known: fidelityKnown,
    pickup_open: openPickup, human_selection_valid: Boolean(selection && selection.take_id === takeId),
    editor_handoff_ready: editorReady, state, reasons,
  };
}

// ── successor validation ─────────────────────────────────────────────────────
function validateSuccessorManifest(previous, next) {
  const errors = [];
  if (next.manifest_revision !== previous.manifest_revision + 1) errors.push('successor revision must be previous + 1');
  if (next.supersedes !== previous.manifest_id) errors.push('successor must reference previous manifest_id via supersedes');
  if (next.supersedes_digest !== previous.manifest_digest_sha256) errors.push('successor supersedes_digest must match previous stored digest');
  return { ok: errors.length === 0, errors };
}

// ── review bundle ────────────────────────────────────────────────────────────
function buildReviewBundle(manifest, validation = {}, options = {}) {
  const units = manifest.recording_units || [];
  const takes = manifest.takes || [];
  const selections = manifest.human_selections || [];
  const selByUnit = new Map(selections.map((s) => [s.recording_unit_id, s]));
  const takesByUnit = new Map();
  for (const t of takes) {
    if (!takesByUnit.has(t.recording_unit_id)) takesByUnit.set(t.recording_unit_id, []);
    takesByUnit.get(t.recording_unit_id).push(t);
  }
  return {
    artifact_type: ARTIFACT_TYPE, manifest_id: manifest.manifest_id,
    manifest_revision: manifest.manifest_revision, state: manifest.state || null,
    story: manifest.story,
    totals: {
      recording_units: units.length, takes: takes.length,
      takes_with_transcript: takes.filter((t) => t.transcript).length,
      fidelity_reviewed: takes.filter((t) => t.fidelity_state && !['UNREVIEWED'].includes(t.fidelity_state)).length,
      open_pickups: (manifest.pickup_requests || []).filter((p) => p.state === 'OPEN').length,
      human_selections: selections.length,
    },
    units: units.map((u) => ({
      recording_unit_id: u.recording_unit_id, section_id: u.section_id, order: u.order,
      framing_preset: u.framing_preset, capture_type: u.capture_type,
      research_binding_ids: u.research_binding_ids || [],
      approved_dialogue: u.approved_dialogue,
      takes: (takesByUnit.get(u.recording_unit_id) || []).map((t) => ({
        take_id: t.take_id, media_sha256: t.media.sha256, duration_s: t.media.duration_s,
        technical_state: t.technical_state, fidelity_state: t.fidelity_state || 'UNREVIEWED',
        transcript_bound: Boolean(t.transcript), pickup_of_take_id: t.pickup_of_take_id || null,
      })),
      human_selection: selByUnit.get(u.recording_unit_id) || null,
    })),
    human_attention: {
      note: 'Take selection is Mikko-only. Agent recommendations are advisory and recorded separately.',
      unselected_units: units.filter((u) => !selByUnit.has(u.recording_unit_id)).map((u) => u.recording_unit_id),
      open_pickups: (manifest.pickup_requests || []).filter((p) => p.state === 'OPEN').map((p) => p.pickup_request_id),
    },
    validation: { ok: validation.ok, stale: validation.stale, errors: (validation.errors || []).slice(0, 10) },
  };
}

module.exports = {
  SCHEMA_VERSION, ARTIFACT_TYPE, APPROVAL_STATES, FIDELITY_CLASSES, TECH_STATES,
  TRANSCRIPT_SOURCES, PICKUP_REASONS, PICKUP_STATES, LIFECYCLE_STATES,
  FORBIDDEN_FIELDS, KNOWN_FRAMING_PRESETS_DEFAULT,
  ulid, sha256, canonicalize, manifestDigest, textDiff, normalizeText,
  buildRecordingUnits, validateManifest, evaluateTakeAuthority,
  validateSuccessorManifest, buildReviewBundle,
  newManifestId: () => ulid(),
};

if (require.main === module) {
  const fs = require('node:fs');
  const file = process.argv[2];
  if (!file) { console.error('usage: presenter-take-manifest.js <manifest.json>'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = validateManifest(manifest);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok && !out.stale ? 0 : 1);
}
