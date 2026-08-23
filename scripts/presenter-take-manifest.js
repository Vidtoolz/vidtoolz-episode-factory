'use strict';

// Deterministic Presenter Take Manifest authority contract. It verifies
// identity/provenance only: no ASR, performance judgment, editing, or approval.
const crypto = require('node:crypto');
const fs = require('node:fs');
const childProcess = require('node:child_process');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'presenter-take-manifest';
const ULID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const UNIT_RE = /^recording-unit-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const TAKE_RE = /^take-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const PICKUP_RE = /^pickup-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const APPROVAL_STATES = Object.freeze(['draft', 'approved']);
const FIDELITY_CLASSES = Object.freeze(['SCRIPT_FAITHFUL', 'MINOR_DELIVERY_VARIATION', 'STORY_CHANGE', 'RESEARCH_SENSITIVE_CHANGE', 'HUMAN_VERIFIED_REQUIRED', 'UNREVIEWED']);
const FIDELITY_METHODS = Object.freeze(['EXACT_TEXT_MATCH', 'SEMANTIC_TRANSCRIPT_REVIEW', 'HUMAN_VERIFIED']);
const TECH_STATES = Object.freeze(['CAPTURED', 'MEDIA_VALID', 'MEDIA_INVALID', 'TRANSCRIPT_MISSING', 'SCRIPT_STALE']);
const TRANSCRIPT_SOURCES = Object.freeze(['HUMAN_SUPPLIED', 'IMPORTED', 'EXTERNAL_TRANSCRIPTION']);
const PICKUP_REASONS = Object.freeze(['SCRIPT_DEVIATION', 'TECHNICAL_FAILURE', 'PERFORMANCE_REVIEW_REQUEST', 'MISSING_UNIT']);
const PICKUP_STATES = Object.freeze(['OPEN', 'SATISFIED', 'STALE']);
const LIFECYCLE_STATES = Object.freeze(['PREVIEW_ONLY', 'READY_FOR_REVIEW', 'SCRIPT_STALE']);
const RESEARCH_STATES = Object.freeze(['CURRENT', 'WEAK', 'STALE', 'INVALID', 'SUPERSEDED', 'RESEARCH_MORE']);
const KNOWN_FRAMING_PRESETS_DEFAULT = Object.freeze(['right-third', 'left-third', 'center-lower', 'center-frame', 'corner-pip']);
const AGENT_IDS = new Set(['hermes', 'presenter_director', 'editor', 'qc_director', 'story_editor', 'research_director']);

const FIELDS = Object.freeze({
  root: ['schema_version', 'artifact_type', 'manifest_id', 'manifest_revision', 'supersedes', 'supersedes_digest', 'created_at', 'created_by', 'state', 'story', 'recording_units', 'takes', 'pickup_requests', 'recommendations', 'human_selections', 'manifest_digest_sha256'],
  story: ['project_id', 'version_id', 'content_hash', 'approval_state'],
  unit: ['recording_unit_id', 'story', 'section_id', 'order', 'approved_dialogue', 'approved_dialogue_sha256', 'framing_preset', 'capture_type', 'presenter_relation', 'visual_beat_refs', 'teleprompter_segment_ref', 'research_refs'],
  take: ['take_id', 'recording_unit_id', 'recording_unit_dialogue_sha256', 'story', 'capture_binding_sha256', 'media', 'captured_at', 'technical_state', 'transcript', 'fidelity_record', 'pickup_of_take_id', 'research_attention'],
  media: ['path_or_artifact_ref', 'sha256', 'byte_size', 'duration_s', 'media_type', 'requires_audio', 'verification'],
  mediaVerification: ['media_sha256', 'byte_size', 'duration_s', 'has_video', 'has_audio', 'verified_at', 'verifier', 'method'],
  transcript: ['take_id', 'recording_unit_id', 'media_sha256', 'text', 'sha256', 'source', 'created_at'],
  fidelity: ['take_id', 'recording_unit_id', 'story', 'approved_dialogue_sha256', 'media_sha256', 'transcript_sha256', 'classification', 'verifier', 'method', 'verified_at', 'diff_sha256', 'rationale'],
  verifier: ['type', 'id'],
  researchRef: ['script_binding_id', 'canonical_claim_id', 'research_result_id', 'result_revision', 'result_digest_sha256', 'assertion_sha256', 'required_constraint_ids', 'applied_constraint_ids', 'authority_state'],
  researchAttention: ['take_id', 'recording_unit_id', 'research_ref', 'changed_spans', 'diff_sha256', 'status', 'resolution_ref'],
  pickup: ['pickup_request_id', 'story', 'recording_unit_id', 'recording_unit_dialogue_sha256', 'source_take_ids', 'reason_code', 'blocking', 'created_by', 'created_at', 'state', 'closure'],
  pickupClosure: ['pickup_request_id', 'replacement_take_id', 'replacement_media_sha256', 'story', 'recording_unit_id', 'verified_by', 'verified_at', 'scope', 'closure_binding_sha256'],
  recommendation: ['recording_unit_id', 'take_id', 'rank', 'reason', 'created_by', 'created_at'],
  selection: ['manifest_id', 'manifest_revision', 'manifest_authority_digest_sha256', 'story', 'recording_unit_id', 'take_id', 'media_sha256', 'selector', 'selected_at', 'scope', 'selection_binding_sha256'],
});

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function ulid(now = Date.now()) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; let time = now; let out = '';
  for (let i = 0; i < 10; i++) { out = alphabet[time % 32] + out; time = Math.floor(time / 32); }
  for (const byte of crypto.randomBytes(16)) out += alphabet[byte % 32];
  return out;
}
function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
function manifestDigest(manifest) { const copy = { ...manifest }; delete copy.manifest_digest_sha256; return sha256(canonicalize(copy)); }
function selectionContextDigest(manifest) { const copy = { ...manifest, human_selections: [] }; delete copy.manifest_digest_sha256; return sha256(canonicalize(copy)); }
function normalizeText(text) { return String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim(); }
function tokenize(text) { return normalizeText(text).split(' ').filter(Boolean); }
function textDiff(approvedText, capturedText) {
  const a = tokenize(approvedText); const b = tokenize(capturedText);
  const count = (tokens) => tokens.reduce((map, token) => map.set(token, (map.get(token) || 0) + 1), new Map());
  const ca = count(a); const cb = count(b); const removed = []; const added = [];
  for (const [token, n] of ca) for (let i = cb.get(token) || 0; i < n; i++) removed.push(token);
  for (const [token, n] of cb) for (let i = ca.get(token) || 0; i < n; i++) added.push(token);
  const exact = normalizeText(approvedText) === normalizeText(capturedText); const changed = `${removed.join(' ')} ${added.join(' ')}`; const risks = [];
  if (/\d/.test(changed)) risks.push('NUMBER_OR_DATE_TOKEN_CHANGED');
  if (/\b(best|only|always|never|guarantee|proven|free|cheapest|fastest|everyone|nobody)\b/i.test(changed)) risks.push('ABSOLUTE_TERM_CHANGED');
  if (/\b(according|attributed|reported|said|source|study|company|researcher)\b/i.test(changed)) risks.push('ATTRIBUTION_TOKEN_CHANGED');
  if (!exact && /\b(according to|attributed to|reported by|said by|source|study by)\b/i.test(`${approvedText} ${capturedText}`)) risks.push('ATTRIBUTION_TOKEN_CHANGED');
  if (/\b(can|could|may|might|some|often|sometimes|approximately|about|under|when|if|up to)\b/i.test(removed.join(' '))) risks.push('QUALIFIER_TOKEN_REMOVED');
  return { exact, normalized_identical: exact, approved_text_sha256: sha256(normalizeText(approvedText)), captured_text_sha256: sha256(normalizeText(capturedText)), approved_token_count: a.length, captured_token_count: b.length, removed_tokens: removed, added_tokens: added, changed: removed.length > 0 || added.length > 0, factual_risk_flags: [...new Set(risks)] };
}
function strictObject(errors, value, allowed, pathName, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${pathName} must be an object`); return false; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${pathName}.${key} unknown field`);
  for (const key of required) if (value[key] === undefined) errors.push(`${pathName}.${key} required`);
  return true;
}
function storyEqual(a, b, approval = true) { return Boolean(a && b && a.project_id === b.project_id && a.version_id === b.version_id && a.content_hash === b.content_hash && (!approval || a.approval_state === b.approval_state)); }
function storyRef(story) { return { project_id: story.project_id, version_id: story.version_id, content_hash: story.content_hash, approval_state: story.approval_state }; }
function unitCaptureBinding(take) { return sha256(canonicalize({ take_id: take.take_id, recording_unit_id: take.recording_unit_id, recording_unit_dialogue_sha256: take.recording_unit_dialogue_sha256, story: take.story, media_sha256: take.media?.sha256, captured_at: take.captured_at })); }
function verifierValid(verifier, options = {}, human = false) {
  if (!verifier || !['DETERMINISTIC', 'AGENT', 'HUMAN'].includes(verifier.type) || !verifier.id || (human && verifier.type !== 'HUMAN')) return false;
  if (verifier.type !== 'HUMAN') return !human;
  if (AGENT_IDS.has(String(verifier.id).toLowerCase())) return false;
  if (typeof options.humanIdentityVerifier === 'function') return options.humanIdentityVerifier(verifier) === true;
  return (options.allowedHumanIds || ['TEST_HUMAN']).includes(verifier.id);
}

function defaultMediaProbe(media) {
  const file = media.path_or_artifact_ref;
  if (!file || !fs.existsSync(file)) return { ok: false, available: false, reason: 'MEDIA_MISSING' };
  let stat; let actual;
  try { stat = fs.statSync(file); actual = sha256(fs.readFileSync(file)); } catch (error) { return { ok: false, available: false, reason: `MEDIA_UNREADABLE:${error.message}` }; }
  const result = childProcess.spawnSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return { ok: false, available: false, actual_sha256: actual, byte_size: stat.size, reason: `FFPROBE_FAILED:${result.error?.message || result.stderr.trim()}` };
  let json; try { json = JSON.parse(result.stdout); } catch { return { ok: false, available: false, reason: 'FFPROBE_INVALID_JSON' }; }
  const streams = json.streams || [];
  return { ok: true, available: true, actual_sha256: actual, byte_size: stat.size, duration_s: Number(json.format?.duration || 0), has_video: streams.some((s) => s.codec_type === 'video'), has_audio: streams.some((s) => s.codec_type === 'audio') };
}
function verifyMediaBytes(media, options = {}) {
  const probe = (options.mediaProbe || defaultMediaProbe)(media) || {}; const errors = [];
  if (!(probe.ok === true || probe.available === true)) errors.push(probe.reason || 'MEDIA_PROBE_FAILED');
  if (probe.actual_sha256 !== media.sha256) errors.push('MEDIA_SHA256_MISMATCH');
  if (probe.byte_size !== media.byte_size) errors.push('MEDIA_BYTE_SIZE_MISMATCH');
  if (probe.has_video !== true) errors.push('VIDEO_STREAM_MISSING');
  if (media.requires_audio !== false && probe.has_audio !== true) errors.push('AUDIO_STREAM_MISSING');
  if (!(Number(probe.duration_s) > 0)) errors.push('MEDIA_DURATION_INVALID');
  if (Number(media.duration_s) > 0 && Number(probe.duration_s) > 0 && Math.abs(Number(probe.duration_s) - Number(media.duration_s)) > (options.durationToleranceS ?? 0.25)) errors.push('MEDIA_DURATION_MISMATCH');
  const saved = media.verification;
  if (!saved) errors.push('MEDIA_VERIFICATION_REQUIRED');
  else if (saved.media_sha256 !== probe.actual_sha256 || saved.byte_size !== probe.byte_size || saved.has_video !== probe.has_video || saved.has_audio !== probe.has_audio) errors.push('MEDIA_VERIFICATION_STALE');
  return { ok: errors.length === 0, errors, probe };
}
function validateResearchRef(ref, errors, pathName) {
  strictObject(errors, ref, FIELDS.researchRef, pathName, FIELDS.researchRef);
  if (!ref?.script_binding_id || !ref.canonical_claim_id || !ref.research_result_id || !Number.isInteger(ref.result_revision) || ref.result_revision < 1 || !SHA_RE.test(ref.result_digest_sha256 || '') || !SHA_RE.test(ref.assertion_sha256 || '') || !Array.isArray(ref.required_constraint_ids) || !Array.isArray(ref.applied_constraint_ids) || !RESEARCH_STATES.includes(ref.authority_state)) errors.push(`${pathName} invalid`);
}

function validateManifest(manifest, options = {}) {
  const errors = []; let stale = false; const mediaResults = {};
  if (!strictObject(errors, manifest, FIELDS.root, '$', FIELDS.root.filter((f) => !['supersedes', 'supersedes_digest'].includes(f)))) return { ok: false, stale, errors, media_results: mediaResults, digest_valid: false };
  if (manifest.schema_version !== 1 || manifest.artifact_type !== ARTIFACT_TYPE || !ULID_RE.test(manifest.manifest_id || '') || !Number.isInteger(manifest.manifest_revision) || manifest.manifest_revision < 1) errors.push('manifest identity invalid');
  if (!manifest.created_at || Number.isNaN(Date.parse(manifest.created_at)) || !manifest.created_by) errors.push('manifest provenance invalid');
  const digestValid = SHA_RE.test(manifest.manifest_digest_sha256 || '') && manifestDigest(manifest) === manifest.manifest_digest_sha256;
  if (!digestValid) errors.push('stored manifest digest missing/mismatch');
  const story = manifest.story || {}; strictObject(errors, story, FIELDS.story, '$.story', FIELDS.story);
  if (!story.project_id || !story.version_id || !SHA_RE.test(story.content_hash || '') || !APPROVAL_STATES.includes(story.approval_state)) errors.push('story identity invalid');
  const derivedState = story.approval_state === 'approved' ? 'READY_FOR_REVIEW' : 'PREVIEW_ONLY';
  if (!LIFECYCLE_STATES.includes(manifest.state) || (manifest.state !== derivedState && manifest.state !== 'SCRIPT_STALE')) errors.push(`state must derive as ${derivedState}`);
  if (options.currentStory && !storyEqual(story, options.currentStory, true)) { errors.push('current Story identity/approval differs'); stale = true; }
  const currentSections = new Map((options.currentStory?.sections || []).map((s) => [s.section_id, s]));

  const units = Array.isArray(manifest.recording_units) ? manifest.recording_units : []; if (!units.length) errors.push('recording_units required');
  const unitMap = new Map();
  units.forEach((unit, i) => {
    const p = `$.recording_units[${i}]`; strictObject(errors, unit, FIELDS.unit, p, FIELDS.unit);
    if (!UNIT_RE.test(unit.recording_unit_id || '') || unitMap.has(unit.recording_unit_id)) errors.push(`${p}.recording_unit_id invalid/duplicate`); unitMap.set(unit.recording_unit_id, unit);
    strictObject(errors, unit.story, FIELDS.story, `${p}.story`, FIELDS.story);
    if (!storyEqual(unit.story, story, true) || !SHA_RE.test(unit.approved_dialogue_sha256 || '') || sha256(normalizeText(unit.approved_dialogue)) !== unit.approved_dialogue_sha256) errors.push(`${p} Story/dialogue binding invalid`);
    if (!(options.knownFramingPresets || KNOWN_FRAMING_PRESETS_DEFAULT).includes(unit.framing_preset) || !Array.isArray(unit.visual_beat_refs) || !Array.isArray(unit.research_refs)) errors.push(`${p} framing/arrays invalid`);
    (unit.research_refs || []).forEach((ref, n) => validateResearchRef(ref, errors, `${p}.research_refs[${n}]`));
    if (options.currentStory) { const section = currentSections.get(unit.section_id); if (!section) errors.push(`${p}.section_id unknown`); else if (section.order !== unit.order || sha256(normalizeText(section.dialogue)) !== unit.approved_dialogue_sha256) { errors.push(`${p} current section differs`); stale = true; } }
  });

  if (!Array.isArray(manifest.takes)) errors.push('takes must be array'); const takes = manifest.takes || []; const takeMap = new Map();
  takes.forEach((take, i) => {
    const p = `$.takes[${i}]`; strictObject(errors, take, FIELDS.take, p, FIELDS.take);
    if (!TAKE_RE.test(take.take_id || '') || takeMap.has(take.take_id)) errors.push(`${p}.take_id invalid/duplicate`); takeMap.set(take.take_id, take);
    const unit = unitMap.get(take.recording_unit_id); strictObject(errors, take.story, FIELDS.story, `${p}.story`, FIELDS.story);
    if (!unit || !storyEqual(take.story, unit.story, true) || take.recording_unit_dialogue_sha256 !== unit?.approved_dialogue_sha256 || take.capture_binding_sha256 !== unitCaptureBinding(take)) errors.push(`${p} capture lineage invalid`);
    strictObject(errors, take.media, FIELDS.media, `${p}.media`, FIELDS.media); const media = take.media || {};
    if (!media.path_or_artifact_ref || !SHA_RE.test(media.sha256 || '') || !(media.byte_size > 0) || !(media.duration_s > 0) || !media.media_type || typeof media.requires_audio !== 'boolean') errors.push(`${p}.media identity invalid`);
    if (media.verification) strictObject(errors, media.verification, FIELDS.mediaVerification, `${p}.media.verification`, FIELDS.mediaVerification);
    if (!TECH_STATES.includes(take.technical_state) || Number.isNaN(Date.parse(take.captured_at))) errors.push(`${p} technical provenance invalid`);
    if (take.transcript) { const tr = take.transcript; strictObject(errors, tr, FIELDS.transcript, `${p}.transcript`, FIELDS.transcript); if (tr.take_id !== take.take_id || tr.recording_unit_id !== take.recording_unit_id || tr.media_sha256 !== media.sha256 || !SHA_RE.test(tr.sha256 || '') || sha256(normalizeText(tr.text)) !== tr.sha256 || !TRANSCRIPT_SOURCES.includes(tr.source) || Number.isNaN(Date.parse(tr.created_at))) errors.push(`${p}.transcript binding invalid`); }
    if (take.fidelity_record) { const f = take.fidelity_record; strictObject(errors, f, FIELDS.fidelity, `${p}.fidelity_record`, FIELDS.fidelity); strictObject(errors, f.story, FIELDS.story, `${p}.fidelity_record.story`, FIELDS.story); strictObject(errors, f.verifier, FIELDS.verifier, `${p}.fidelity_record.verifier`, FIELDS.verifier); if (f.take_id !== take.take_id || f.recording_unit_id !== take.recording_unit_id || !storyEqual(f.story, take.story, true) || f.approved_dialogue_sha256 !== take.recording_unit_dialogue_sha256 || f.media_sha256 !== media.sha256 || !FIDELITY_CLASSES.includes(f.classification) || !FIDELITY_METHODS.includes(f.method) || !verifierValid(f.verifier, options, f.method === 'HUMAN_VERIFIED')) errors.push(`${p}.fidelity_record evidence invalid`); if (f.method !== 'HUMAN_VERIFIED' && (!take.transcript || f.transcript_sha256 !== take.transcript.sha256)) errors.push(`${p}.fidelity_record transcript invalid`); if (f.method === 'EXACT_TEXT_MATCH') { const d = take.transcript && unit && textDiff(unit.approved_dialogue, take.transcript.text); if (!d?.exact || f.classification !== 'SCRIPT_FAITHFUL' || f.diff_sha256 !== sha256(canonicalize(d))) errors.push(`${p}.fidelity_record exact claim invalid`); } }
    if (!Array.isArray(take.research_attention)) errors.push(`${p}.research_attention invalid`); (take.research_attention || []).forEach((item, n) => { const q = `${p}.research_attention[${n}]`; strictObject(errors, item, FIELDS.researchAttention, q, FIELDS.researchAttention.filter((f) => f !== 'resolution_ref')); validateResearchRef(item.research_ref, errors, `${q}.research_ref`); if (item.take_id !== take.take_id || item.recording_unit_id !== take.recording_unit_id || !['RESOLVED', 'REVIEW_REQUIRED'].includes(item.status)) errors.push(`${q} binding invalid`); });
    if (options.requireMediaVerification) { const result = verifyMediaBytes(media, options); mediaResults[take.take_id] = result; result.errors.forEach((e) => errors.push(`${p}.media ${e}`)); }
  });
  takes.forEach((take) => { if (take.pickup_of_take_id && !takeMap.has(take.pickup_of_take_id)) errors.push(`take ${take.take_id} pickup source unknown`); });

  if (!Array.isArray(manifest.pickup_requests)) errors.push('pickup_requests must be array'); const pickupIds = new Set();
  (manifest.pickup_requests || []).forEach((pickup, i) => { const p = `$.pickup_requests[${i}]`; strictObject(errors, pickup, FIELDS.pickup, p, FIELDS.pickup); if (!PICKUP_RE.test(pickup.pickup_request_id || '') || pickupIds.has(pickup.pickup_request_id)) errors.push(`${p}.pickup_request_id invalid/duplicate`); pickupIds.add(pickup.pickup_request_id); strictObject(errors, pickup.story, FIELDS.story, `${p}.story`, FIELDS.story); const unit = unitMap.get(pickup.recording_unit_id); if (!unit || !storyEqual(pickup.story, story, true) || pickup.recording_unit_dialogue_sha256 !== unit?.approved_dialogue_sha256 || !Array.isArray(pickup.source_take_ids) || pickup.source_take_ids.some((id) => !takeMap.has(id) || takeMap.get(id).recording_unit_id !== pickup.recording_unit_id) || !PICKUP_REASONS.includes(pickup.reason_code) || typeof pickup.blocking !== 'boolean' || !PICKUP_STATES.includes(pickup.state) || !pickup.created_by || Number.isNaN(Date.parse(pickup.created_at))) errors.push(`${p} lineage/fields invalid`); if (pickup.state === 'SATISFIED') { const c = pickup.closure; if (!c) errors.push(`${p}.closure required`); else { strictObject(errors, c, FIELDS.pickupClosure, `${p}.closure`, FIELDS.pickupClosure); strictObject(errors, c.story, FIELDS.story, `${p}.closure.story`, FIELDS.story); strictObject(errors, c.verified_by, FIELDS.verifier, `${p}.closure.verified_by`, FIELDS.verifier); const replacement = takeMap.get(c.replacement_take_id); const copy = { ...c }; delete copy.closure_binding_sha256; if (c.pickup_request_id !== pickup.pickup_request_id || !replacement || replacement.recording_unit_id !== pickup.recording_unit_id || replacement.media.sha256 !== c.replacement_media_sha256 || !storyEqual(c.story, pickup.story, true) || c.recording_unit_id !== pickup.recording_unit_id || !verifierValid(c.verified_by, options) || c.closure_binding_sha256 !== sha256(canonicalize(copy))) errors.push(`${p}.closure invalid`); } } else if (pickup.closure !== null) errors.push(`${p}.closure forbidden unless satisfied`); });

  if (!Array.isArray(manifest.recommendations)) errors.push('recommendations must be array');
  (manifest.recommendations || []).forEach((rec, i) => { const p = `$.recommendations[${i}]`; strictObject(errors, rec, FIELDS.recommendation, p, FIELDS.recommendation); if (!unitMap.has(rec.recording_unit_id) || !takeMap.has(rec.take_id) || takeMap.get(rec.take_id)?.recording_unit_id !== rec.recording_unit_id || !Number.isInteger(rec.rank) || rec.rank < 1) errors.push(`${p} invalid`); });
  if (!Array.isArray(manifest.human_selections)) errors.push('human_selections must be array'); const selected = new Set(); const contextDigest = selectionContextDigest(manifest);
  (manifest.human_selections || []).forEach((selection, i) => { const p = `$.human_selections[${i}]`; strictObject(errors, selection, FIELDS.selection, p, FIELDS.selection); strictObject(errors, selection.story, FIELDS.story, `${p}.story`, FIELDS.story); strictObject(errors, selection.selector, FIELDS.verifier, `${p}.selector`, FIELDS.verifier); const take = takeMap.get(selection.take_id); const copy = { ...selection }; delete copy.selection_binding_sha256; if (selection.manifest_id !== manifest.manifest_id || selection.manifest_revision !== manifest.manifest_revision || selection.manifest_authority_digest_sha256 !== contextDigest || !storyEqual(selection.story, story, true) || !take || take.recording_unit_id !== selection.recording_unit_id || take.media.sha256 !== selection.media_sha256 || !verifierValid(selection.selector, options, true) || Number.isNaN(Date.parse(selection.selected_at)) || !selection.scope || selection.selection_binding_sha256 !== sha256(canonicalize(copy))) errors.push(`${p} authority binding invalid`); if (selected.has(selection.recording_unit_id)) errors.push(`${p} duplicate unit selection`); selected.add(selection.recording_unit_id); });
  return { ok: errors.length === 0, stale, errors, media_results: mediaResults, digest_valid: digestValid };
}

function researchResolved(take, unit, options, reasons) {
  if (!(unit?.research_refs || []).length) return true;
  if (!take.transcript) { reasons.push('RESEARCH_FIDELITY_UNRESOLVED'); return false; }
  const diff = textDiff(unit.approved_dialogue, take.transcript.text); if (!diff.changed) return true;
  let resolved = true;
  for (const ref of unit.research_refs) { const attention = take.research_attention.find((a) => a.research_ref?.script_binding_id === ref.script_binding_id); const authority = options.researchAuthorityByBinding?.[ref.script_binding_id]; const applied = new Set(ref.applied_constraint_ids); const constraints = ref.required_constraint_ids.every((id) => applied.has(id)); const current = authority && authority.result_id === ref.research_result_id && authority.result_revision === ref.result_revision && authority.result_digest_sha256 === ref.result_digest_sha256 && ['CURRENT', 'WEAK'].includes(authority.state); if (!attention || attention.status !== 'RESOLVED' || !current || !constraints) { resolved = false; reasons.push(`RESEARCH_UNRESOLVED:${ref.script_binding_id}`); } }
  return resolved;
}
function evaluateTakeAuthority(manifest, takeId, options = {}) {
  const take = (manifest?.takes || []).find((t) => t.take_id === takeId); if (!take) return { structurally_valid: false, editor_handoff_ready: false, state: 'UNKNOWN_TAKE', reasons: [`UNKNOWN_TAKE:${takeId}`] };
  const reasons = []; if (!options.currentStory) reasons.push('CURRENT_STORY_REQUIRED');
  const validation = validateManifest(manifest, { ...options, requireMediaVerification: true }); if (!validation.ok) reasons.push(...validation.errors.map((e) => `MANIFEST_INVALID:${e}`));
  const storyApproved = manifest.story?.approval_state === 'approved' && options.currentStory?.approval_state === 'approved'; const preview = !storyApproved; if (preview) reasons.push('PREVIEW_ONLY');
  const unit = manifest.recording_units.find((u) => u.recording_unit_id === take.recording_unit_id); const mediaVerified = validation.media_results?.[takeId]?.ok === true; const transcriptBound = Boolean(take.transcript?.take_id === takeId);
  const fidelityVerified = Boolean(take.fidelity_record && !['UNREVIEWED', 'HUMAN_VERIFIED_REQUIRED', 'STORY_CHANGE', 'RESEARCH_SENSITIVE_CHANGE'].includes(take.fidelity_record.classification)); if (!transcriptBound && take.fidelity_record?.method !== 'HUMAN_VERIFIED') reasons.push('TRANSCRIPT_OR_HUMAN_FIDELITY_REQUIRED'); if (!fidelityVerified) reasons.push('FIDELITY_UNRESOLVED');
  const researchOk = researchResolved(take, unit, options, reasons); const pickupOpen = manifest.pickup_requests.some((p) => p.recording_unit_id === take.recording_unit_id && p.blocking && p.state === 'OPEN'); if (pickupOpen) reasons.push('BLOCKING_PICKUP_OPEN');
  const selection = manifest.human_selections.find((s) => s.recording_unit_id === take.recording_unit_id && s.take_id === takeId); const selectionValid = Boolean(selection && validation.ok); if (!selectionValid) reasons.push('HUMAN_SELECTION_REQUIRED');
  const ready = validation.ok && storyApproved && mediaVerified && fidelityVerified && researchOk && !pickupOpen && selectionValid;
  let state = preview ? 'PREVIEW_ONLY' : validation.stale ? 'SCRIPT_STALE' : !validation.ok ? 'INVALID' : pickupOpen ? 'PICKUP_OPEN' : !researchOk ? 'RETURN_TO_RESEARCH' : !selectionValid ? 'AWAITING_HUMAN_SELECTION' : ready ? 'EDITOR_READY' : 'REVIEW_ELIGIBLE';
  return { structurally_valid: validation.ok, manifest_digest_valid: validation.digest_valid, story_current: !validation.stale, story_approved: storyApproved, preview_only: preview, unit_current: Boolean(unit && !validation.stale), media_verified: mediaVerified, transcript_bound: transcriptBound, fidelity_verified: fidelityVerified, research_resolved: researchOk, pickup_open: pickupOpen, human_selection_valid: selectionValid, editor_handoff_ready: ready, state, reasons: [...new Set(reasons)], validation };
}

function buildRecordingUnits(story, options = {}) {
  const presets = options.knownFramingPresets || KNOWN_FRAMING_PRESETS_DEFAULT;
  return (story.sections || []).map((section) => { const framing = section.framing_preset || 'center-lower'; if (!section.section_id) throw new Error('section_id required'); if (!presets.includes(framing)) throw new Error(`unknown framing preset: ${framing}`); return { recording_unit_id: (options.newUnitId || (() => `recording-unit-${ulid()}`))(), story: storyRef(story), section_id: section.section_id, order: section.order, approved_dialogue: section.dialogue, approved_dialogue_sha256: sha256(normalizeText(section.dialogue)), framing_preset: framing, capture_type: section.type || 'composited', presenter_relation: section.presenter_relation || null, visual_beat_refs: section.visual_beat_refs || [], teleprompter_segment_ref: section.teleprompter_segment_ref || null, research_refs: options.researchRefsBySection?.[section.section_id] || section.research_refs || [] }; });
}
function refreshDigest(manifest) { manifest.manifest_digest_sha256 = manifestDigest(manifest); return manifest; }
function createManifest(story, options = {}) { return refreshDigest({ schema_version: 1, artifact_type: ARTIFACT_TYPE, manifest_id: options.manifestId || ulid(), manifest_revision: 1, supersedes: null, supersedes_digest: null, created_at: options.now || new Date().toISOString(), created_by: options.createdBy || 'deterministic-presenter-manifest-writer', state: story.approval_state === 'approved' ? 'READY_FOR_REVIEW' : 'PREVIEW_ONLY', story: storyRef(story), recording_units: buildRecordingUnits(story, options), takes: [], pickup_requests: [], recommendations: [], human_selections: [], manifest_digest_sha256: '' }); }
function successor(previous, mutate, options = {}) { const next = JSON.parse(JSON.stringify(previous)); next.manifest_id = options.manifestId || ulid(); next.manifest_revision = previous.manifest_revision + 1; next.supersedes = previous.manifest_id; next.supersedes_digest = previous.manifest_digest_sha256; next.created_at = options.now || new Date().toISOString(); next.human_selections = []; mutate(next); return refreshDigest(next); }
function registerTake(previous, input, options = {}) { const unit = previous.recording_units.find((u) => u.recording_unit_id === input.recording_unit_id); if (!unit) throw new Error('recording unit not found'); const probe = (options.mediaProbe || defaultMediaProbe)(input.media); if (!(probe?.ok || probe?.available) || probe.actual_sha256 !== input.media.sha256 || probe.byte_size !== input.media.byte_size || probe.has_video !== true || (input.media.requires_audio !== false && probe.has_audio !== true)) throw new Error('media verification failed'); return successor(previous, (next) => { const take = { take_id: input.take_id || `take-${ulid()}`, recording_unit_id: unit.recording_unit_id, recording_unit_dialogue_sha256: unit.approved_dialogue_sha256, story: unit.story, capture_binding_sha256: '', media: { ...input.media, verification: { media_sha256: probe.actual_sha256, byte_size: probe.byte_size, duration_s: probe.duration_s, has_video: probe.has_video, has_audio: probe.has_audio, verified_at: input.verified_at || options.now || new Date().toISOString(), verifier: input.media_verifier || 'presenter-media-verifier', method: options.mediaProbe ? 'INJECTED_MEDIA_PROBE' : 'LOCAL_BYTES_FFPROBE' } }, captured_at: input.captured_at || options.now || new Date().toISOString(), technical_state: 'MEDIA_VALID', transcript: null, fidelity_record: null, pickup_of_take_id: input.pickup_of_take_id || null, research_attention: [] }; take.capture_binding_sha256 = unitCaptureBinding(take); next.takes.push(take); }, options); }
function bindTranscript(previous, takeId, input, options = {}) { return successor(previous, (next) => { const take = next.takes.find((t) => t.take_id === takeId); if (!take) throw new Error('take not found'); take.transcript = { take_id: take.take_id, recording_unit_id: take.recording_unit_id, media_sha256: take.media.sha256, text: input.text, sha256: sha256(normalizeText(input.text)), source: input.source || 'HUMAN_SUPPLIED', created_at: input.created_at || options.now || new Date().toISOString() }; take.fidelity_record = null; }, options); }
function createFidelityRecord(previous, takeId, input = {}, options = {}) { return successor(previous, (next) => { const take = next.takes.find((t) => t.take_id === takeId); if (!take) throw new Error('take not found'); const unit = next.recording_units.find((u) => u.recording_unit_id === take.recording_unit_id); const method = input.method || 'EXACT_TEXT_MATCH'; const verifier = input.verifier || { type: 'DETERMINISTIC', id: 'presenter-fidelity-writer' }; if (method !== 'HUMAN_VERIFIED' && !take.transcript) throw new Error('transcript required'); const diff = take.transcript ? textDiff(unit.approved_dialogue, take.transcript.text) : null; const classification = input.classification || (diff?.exact ? 'SCRIPT_FAITHFUL' : 'HUMAN_VERIFIED_REQUIRED'); if (method === 'EXACT_TEXT_MATCH' && (!diff?.exact || classification !== 'SCRIPT_FAITHFUL')) throw new Error('exact text evidence incompatible'); if (method === 'HUMAN_VERIFIED' && !verifierValid(verifier, options, true)) throw new Error('human verifier required'); take.fidelity_record = { take_id: take.take_id, recording_unit_id: take.recording_unit_id, story: take.story, approved_dialogue_sha256: unit.approved_dialogue_sha256, media_sha256: take.media.sha256, transcript_sha256: take.transcript?.sha256 || null, classification, verifier, method, verified_at: input.verified_at || options.now || new Date().toISOString(), diff_sha256: diff ? sha256(canonicalize(diff)) : null, rationale: input.rationale || null }; }, options); }
function bindResearchAttention(previous, takeId, input, options = {}) { return successor(previous, (next) => { const take = next.takes.find((t) => t.take_id === takeId); if (!take) throw new Error('take not found'); const unit = next.recording_units.find((u) => u.recording_unit_id === take.recording_unit_id); const ref = unit.research_refs.find((r) => r.script_binding_id === input.script_binding_id); if (!ref || !take.transcript) throw new Error('Research binding/transcript required'); const diff = textDiff(unit.approved_dialogue, take.transcript.text); take.research_attention = take.research_attention.filter((a) => a.research_ref.script_binding_id !== ref.script_binding_id); take.research_attention.push({ take_id: take.take_id, recording_unit_id: take.recording_unit_id, research_ref: ref, changed_spans: input.changed_spans || [...diff.removed_tokens, ...diff.added_tokens], diff_sha256: sha256(canonicalize(diff)), status: input.status || 'REVIEW_REQUIRED', resolution_ref: input.resolution_ref || null }); }, options); }
function createPickupRequest(previous, input, options = {}) { return successor(previous, (next) => { const unit = next.recording_units.find((u) => u.recording_unit_id === input.recording_unit_id); if (!unit) throw new Error('unit not found'); next.pickup_requests.push({ pickup_request_id: input.pickup_request_id || `pickup-${ulid()}`, story: unit.story, recording_unit_id: unit.recording_unit_id, recording_unit_dialogue_sha256: unit.approved_dialogue_sha256, source_take_ids: input.source_take_ids || [], reason_code: input.reason_code, blocking: input.blocking !== false, created_by: input.created_by, created_at: input.created_at || options.now || new Date().toISOString(), state: 'OPEN', closure: null }); }, options); }
function closePickup(previous, pickupId, input, options = {}) { return successor(previous, (next) => { const pickup = next.pickup_requests.find((p) => p.pickup_request_id === pickupId); const take = next.takes.find((t) => t.take_id === input.replacement_take_id); if (!pickup || !take || take.recording_unit_id !== pickup.recording_unit_id) throw new Error('replacement take invalid'); const closure = { pickup_request_id: pickupId, replacement_take_id: take.take_id, replacement_media_sha256: take.media.sha256, story: pickup.story, recording_unit_id: pickup.recording_unit_id, verified_by: input.verified_by, verified_at: input.verified_at || options.now || new Date().toISOString(), scope: input.scope || 'pickup-satisfaction', closure_binding_sha256: '' }; if (!verifierValid(closure.verified_by, options)) throw new Error('closure verifier invalid'); const copy = { ...closure }; delete copy.closure_binding_sha256; closure.closure_binding_sha256 = sha256(canonicalize(copy)); pickup.state = 'SATISFIED'; pickup.closure = closure; }, options); }
function createHumanSelection(previous, input, options = {}) { return successor(previous, (next) => { const take = next.takes.find((t) => t.take_id === input.take_id); if (!take || !verifierValid(input.selector, options, true)) throw new Error('verified human selector required'); const selection = { manifest_id: next.manifest_id, manifest_revision: next.manifest_revision, manifest_authority_digest_sha256: '', story: next.story, recording_unit_id: take.recording_unit_id, take_id: take.take_id, media_sha256: take.media.sha256, selector: input.selector, selected_at: input.selected_at || options.now || new Date().toISOString(), scope: input.scope || 'editor-take-selection', selection_binding_sha256: '' }; next.human_selections.push(selection); selection.manifest_authority_digest_sha256 = selectionContextDigest(next); const copy = { ...selection }; delete copy.selection_binding_sha256; selection.selection_binding_sha256 = sha256(canonicalize(copy)); }, options); }
function validateSuccessorManifest(previous, next, options = {}) { const errors = []; const a = validateManifest(previous, options); const b = validateManifest(next, options); if (!a.ok) errors.push('previous manifest invalid'); if (!b.ok) errors.push('next manifest invalid'); if (next.manifest_revision !== previous.manifest_revision + 1 || next.manifest_id === previous.manifest_id || next.supersedes !== previous.manifest_id || next.supersedes_digest !== previous.manifest_digest_sha256 || !storyEqual(previous.story, next.story, true)) errors.push('successor identity/history invalid'); return { ok: errors.length === 0, errors, previous_validation: a, next_validation: b }; }
function buildEditorHandoff(manifest, options = {}) { return { artifact_type: 'presenter-editor-handoff', manifest_id: manifest.manifest_id, manifest_revision: manifest.manifest_revision, manifest_digest_sha256: manifest.manifest_digest_sha256, story: manifest.story, units: manifest.recording_units.map((unit) => { const selection = manifest.human_selections.find((s) => s.recording_unit_id === unit.recording_unit_id); const authority = selection ? evaluateTakeAuthority(manifest, selection.take_id, options) : { editor_handoff_ready: false, state: 'AWAITING_HUMAN_SELECTION', reasons: ['HUMAN_SELECTION_REQUIRED'] }; const take = selection && manifest.takes.find((t) => t.take_id === selection.take_id); const recommendation = manifest.recommendations.filter((r) => r.recording_unit_id === unit.recording_unit_id).sort((a, b) => a.rank - b.rank)[0] || null; return { recording_unit_id: unit.recording_unit_id, section_id: unit.section_id, framing_preset: unit.framing_preset, selected_take: authority.editor_handoff_ready && take ? { take_id: take.take_id, media: { path_or_artifact_ref: take.media.path_or_artifact_ref, sha256: take.media.sha256, duration_s: take.media.duration_s }, transcript_sha256: take.transcript?.sha256 || null, fidelity: take.fidelity_record?.classification || null } : null, advisory_recommendation: recommendation, open_pickups: manifest.pickup_requests.filter((p) => p.recording_unit_id === unit.recording_unit_id && p.blocking && p.state === 'OPEN').map((p) => p.pickup_request_id), ready: authority.editor_handoff_ready, state: authority.state, blockers: authority.reasons }; }) }; }
function buildReviewBundle(manifest, validation = {}, options = {}) { const authority = Object.fromEntries(manifest.takes.map((t) => [t.take_id, evaluateTakeAuthority(manifest, t.take_id, options)])); return { artifact_type: ARTIFACT_TYPE, manifest_id: manifest.manifest_id, manifest_revision: manifest.manifest_revision, manifest_digest_sha256: manifest.manifest_digest_sha256, state: manifest.state, story: manifest.story, validation: { ok: validation.ok, stale: validation.stale, digest_valid: validation.digest_valid, errors: validation.errors || [] }, totals: { recording_units: manifest.recording_units.length, takes: manifest.takes.length, media_verified: Object.values(authority).filter((a) => a.media_verified).length, transcripts_bound: manifest.takes.filter((t) => t.transcript).length, fidelity_verified: Object.values(authority).filter((a) => a.fidelity_verified).length, open_pickups: manifest.pickup_requests.filter((p) => p.state === 'OPEN').length, human_selections: manifest.human_selections.length, editor_ready: Object.values(authority).filter((a) => a.editor_handoff_ready).length }, units: manifest.recording_units.map((unit) => ({ recording_unit_id: unit.recording_unit_id, section_id: unit.section_id, framing_preset: unit.framing_preset, approved_dialogue: unit.approved_dialogue, research_refs: unit.research_refs, takes: manifest.takes.filter((t) => t.recording_unit_id === unit.recording_unit_id).map((take) => ({ take_id: take.take_id, media: take.media, transcript: take.transcript ? { sha256: take.transcript.sha256, source: take.transcript.source, diff: textDiff(unit.approved_dialogue, take.transcript.text) } : null, fidelity_record: take.fidelity_record, research_attention: take.research_attention, authority: authority[take.take_id] })), pickups: manifest.pickup_requests.filter((p) => p.recording_unit_id === unit.recording_unit_id), recommendations: manifest.recommendations.filter((r) => r.recording_unit_id === unit.recording_unit_id), human_selection: manifest.human_selections.find((s) => s.recording_unit_id === unit.recording_unit_id) || null })), human_attention: { blockers: Object.entries(authority).flatMap(([takeId, a]) => a.reasons.map((reason) => ({ take_id: takeId, reason }))) } }; }

module.exports = { SCHEMA_VERSION, ARTIFACT_TYPE, APPROVAL_STATES, FIDELITY_CLASSES, FIDELITY_METHODS, TECH_STATES, TRANSCRIPT_SOURCES, PICKUP_REASONS, PICKUP_STATES, LIFECYCLE_STATES, RESEARCH_STATES, KNOWN_FRAMING_PRESETS_DEFAULT, FIELDS, ulid, newManifestId: () => ulid(), sha256, canonicalize, manifestDigest, selectionContextDigest, normalizeText, textDiff, buildRecordingUnits, verifyMediaBytes, validateManifest, evaluateTakeAuthority, validateSuccessorManifest, buildReviewBundle, buildEditorHandoff, createManifest, registerTake, bindTranscript, createFidelityRecord, bindResearchAttention, createPickupRequest, closePickup, createHumanSelection };

if (require.main === module) { const file = process.argv[2]; if (!file) { console.error('usage: presenter-take-manifest.js <manifest.json>'); process.exit(2); } const result = validateManifest(JSON.parse(fs.readFileSync(file, 'utf8'))); console.log(JSON.stringify(result, null, 2)); process.exit(result.ok ? 0 : 1); }
