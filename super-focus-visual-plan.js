'use strict';

// Super Focus — Visual Plan domain module.
//
// The visual plan is the authoritative upstream production object between the
// saved script and the image prompts:
//
//   script beat → viewer task → visual function → visual assignment
//   → acceptance criteria → approved assignment → image prompt → …
//
// The central product rule: a PROMPT says what to generate; a visual
// ASSIGNMENT says what job the visual must perform in the argument.
//
// Pure, dependency-free domain logic in the style of script-evaluator.js:
// no I/O, no network — the server owns persistence (super-focus.js) and the
// Ollama provider. Everything here is deterministic and unit-testable.
//
// Compatibility boundary with ~/vidtoolz-beat-sheet (inspected 2026-07-19):
// the shared vocabulary keeps the same semantics — a "beat" is a contiguous
// script range (start/end char offsets with the exact text preserved), an
// assignment "status" is draft|approved|rejected, and staleness is a
// non-destructive stale flag + stale_reason. Beat-sheet's "assignment" object
// carries prompt-level items (prompt_text, lanes); the Super Focus assignment
// deliberately sits one level UP from prompts (viewer_task / visual_function /
// acceptance_criteria) and never contains prompt syntax. The segmentation
// approach (sentence boundaries require trailing whitespace, so decimals,
// versions like "Wan 2.2" / "DaVinci 21.0.2", filenames, and URLs never
// split) is adapted from beat-sheet lib/segment.js rather than imported, to
// keep the two local-first modules independently deployable.

const crypto = require('crypto');

const VISUAL_PLAN_SCHEMA_VERSION = 1;

// ── controlled vocabularies ──────────────────────────────────────────────────

const VISUAL_DISPOSITIONS = [
  'visual_required',
  'visual_optional',
  'presenter_only',
  'reuse_previous',
  'text_graphic',
  'unresolved',
];

const VISUAL_FUNCTIONS = [
  'clarify',
  'prove',
  'demonstrate',
  'contrast',
  'intensify',
  'structure',
  'orient',
  'illustrate',
  'reset_attention',
  'establish_mood',
  'custom',
];

const MEDIA_TYPES = [
  'presenter_only',
  'generated_still',
  'image_to_video',
  'infographic',
  'screen_capture',
  'existing_footage',
  'text_graphic',
  'reusable_motif',
];

const ASSIGNMENT_STATUSES = ['draft', 'approved', 'rejected'];

// Media types the image-prompt lane can actually produce; everything else is
// skipped with an explicit reason at prompt-creation time.
const IMAGE_LANE_MEDIA_TYPES = ['generated_still', 'image_to_video', 'reusable_motif', 'infographic'];

// Beat dispositions that never require an assignment.
const NO_ASSIGNMENT_DISPOSITIONS = ['presenter_only', 'reuse_previous'];

// ── bounds (defensive; scripts are short-form ~2-3 min) ─────────────────────

const BOUNDS = {
  script_max_chars: 200000,
  beats_max: 200,
  beat_target_chars: 280,       // soft target for one claim-sized beat
  viewer_task_max: 300,
  assignment_max: 1200,
  custom_label_max: 60,
  operator_notes_max: 2000,
  criteria_max_count: 8,
  criterion_max_chars: 300,
  wpm: 140,                     // matches beat-sheet estimateRangeTimes default
};

// ── small helpers ────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function sha256(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text)).digest('hex');
}

function fail(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  throw e;
}

function shortHex() { return crypto.randomBytes(4).toString('hex'); }

function makeBeatId(existing = new Set()) {
  for (let i = 0; i < 10000; i += 1) {
    const id = `beat-${shortHex()}`;
    if (!existing.has(id)) return id;
  }
  fail('Could not allocate a beat id.', 500);
  return '';
}

function makeAssignmentId(existing = new Set()) {
  for (let i = 0; i < 10000; i += 1) {
    const id = `assignment-${shortHex()}`;
    if (!existing.has(id)) return id;
  }
  fail('Could not allocate an assignment id.', 500);
  return '';
}

// Bounded plain string: rejects non-strings (objects/arrays/numbers where text
// is expected) instead of coercing, and enforces a max length.
function boundedString(value, label, maxLen, { required = false } = {}) {
  if (value == null) {
    if (required) fail(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const clean = value.trim();
  if (required && !clean) fail(`${label} is required.`);
  if (clean.length > maxLen) fail(`${label} is too long (max ${maxLen} characters).`);
  return clean;
}

function enumValue(value, allowed, label, fallback) {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    fail(`${label} is required.`);
  }
  const clean = String(value).trim().toLowerCase();
  if (allowed.indexOf(clean) === -1) {
    fail(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return clean;
}

function boundedCriteria(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('acceptance_criteria must be an array of strings.');
  if (value.length > BOUNDS.criteria_max_count) {
    fail(`acceptance_criteria has too many entries (max ${BOUNDS.criteria_max_count}).`);
  }
  return value
    .map((c, i) => boundedString(c, `acceptance_criteria[${i}]`, BOUNDS.criterion_max_chars))
    .filter(Boolean);
}

// A char offset must not land between the halves of a surrogate pair — the
// resulting beat texts would contain lone surrogates (invalid Unicode).
function isSurrogateSafe(text, offset) {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function scriptTextOf(script) {
  if (typeof script !== 'string') fail('Script must be a string.');
  if (script.length > BOUNDS.script_max_chars) fail('Script is too long for visual planning.');
  return script;
}

// Word-proportional duration estimate (adapted from beat-sheet
// lib/segment.js estimateRangeTimes; same 140 wpm default).
function estimateDurationSeconds(scriptText, start, end) {
  const spans = [];
  const re = /\S+/gu;
  let m;
  while ((m = re.exec(scriptText)) !== null) spans.push({ start: m.index, end: m.index + m[0].length });
  if (!spans.length) return 0;
  const totalSeconds = (spans.length / BOUNDS.wpm) * 60;
  const inRange = spans.filter((w) => w.start < end && w.end > start).length;
  return Math.round(((inRange / spans.length) * totalSeconds) * 10) / 10;
}

// ── sentence segmentation (offset-based, version-number safe) ───────────────
//
// Adapted from beat-sheet lib/segment.js: a '.', '!', '?' or '…' ends a
// sentence ONLY when followed (after closing quotes) by whitespace or
// end-of-text. "Wan 2.2", "FLUX.1", "DaVinci 21.0.2", decimals, filenames
// and URLs never split because there is no whitespace after the dot.

const ABBREVIATIONS = new Set([
  'esim', 'mm', 'jne', 'tms', 'ym', 'nk', 'ns', 'vrt', 'ks',
  'dr', 'prof', 'mr', 'mrs', 'ms', 'vs', 'etc', 'e.g', 'i.e',
]);

function isBoundaryPunct(ch) { return ch === '.' || ch === '!' || ch === '?' || ch === '…'; }
function isClosingQuote(ch) {
  return ch === '"' || ch === "'" || ch === '”' || ch === '’' || ch === '»' || ch === ')' || ch === ']';
}

function previousToken(text, punctIndex) {
  let j = punctIndex - 1;
  while (j >= 0 && /[\p{L}.]/u.test(text[j])) j -= 1;
  return text.slice(j + 1, punctIndex).toLowerCase();
}

// Split one paragraph (no newlines inside) into sentence spans, offsets
// relative to `text`. Every returned span is non-empty after trimming.
function sentenceSpans(text, base = 0) {
  const out = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!isBoundaryPunct(ch)) { i += 1; continue; }
    if (ch === '.') {
      const token = previousToken(text, i).replace(/\.+$/g, '');
      if (ABBREVIATIONS.has(token)) { i += 1; continue; }
    }
    let end = i + 1;
    while (end < text.length && isClosingQuote(text[end])) end += 1;
    if (end < text.length && !/\s/u.test(text[end])) { i += 1; continue; } // "2.2", "FLUX.1", URLs
    out.push({ start: base + start, end: base + end });
    while (end < text.length && /\s/u.test(text[end])) end += 1;
    start = end;
    i = end;
  }
  if (start < text.length) out.push({ start: base + start, end: base + text.length });
  return out;
}

function trimSpan(scriptText, span) {
  let s = span.start;
  let e = span.end;
  while (s < e && /\s/u.test(scriptText[s])) s += 1;
  while (e > s && /\s/u.test(scriptText[e - 1])) e -= 1;
  return { start: s, end: e };
}

// Deterministic beat segmentation: newline groups are hard boundaries
// (script lines/paragraphs are authored units); long paragraphs are packed
// into claim-sized beats of consecutive sentences up to beat_target_chars.
// Returns trimmed, ordered, non-overlapping spans.
function segmentScriptIntoSpans(scriptText) {
  const text = scriptTextOf(scriptText);
  const spans = [];
  const paraRe = /[^\n]+/g;
  let m;
  while ((m = paraRe.exec(text)) !== null) {
    const para = trimSpan(text, { start: m.index, end: m.index + m[0].length });
    if (para.end <= para.start) continue;
    if (para.end - para.start <= BOUNDS.beat_target_chars) {
      spans.push(para);
      continue;
    }
    // Pack sentences into beats up to the target size (never split a sentence).
    const sentences = sentenceSpans(text.slice(para.start, para.end), para.start)
      .map((s) => trimSpan(text, s))
      .filter((s) => s.end > s.start);
    let current = null;
    sentences.forEach((s) => {
      if (!current) { current = { start: s.start, end: s.end }; return; }
      if (s.end - current.start <= BOUNDS.beat_target_chars) current.end = s.end;
      else { spans.push(current); current = { start: s.start, end: s.end }; }
    });
    if (current) spans.push(current);
  }
  return spans;
}

// ── beat + assignment shaping ────────────────────────────────────────────────

function shapeBeat(scriptText, fields) {
  const start = Math.round(Number(fields.start_char));
  const end = Math.round(Number(fields.end_char));
  if (!Number.isInteger(start) || !Number.isInteger(end)) fail('Beat range must be integer offsets.');
  if (start < 0 || end > scriptText.length || start >= end) fail('Beat range is outside the saved script.');
  if (!isSurrogateSafe(scriptText, start) || !isSurrogateSafe(scriptText, end)) {
    fail('Beat range splits a Unicode surrogate pair.');
  }
  const text = scriptText.slice(start, end);
  if (!text.trim()) fail('Beat range contains no text.');
  return {
    beat_id: fields.beat_id,
    order: 0, // recomputed by sortPlanBeats
    start_char: start,
    end_char: end,
    script_text: text,
    estimated_duration_seconds: estimateDurationSeconds(scriptText, start, end),
    visual_disposition: enumValue(
      fields.visual_disposition, VISUAL_DISPOSITIONS, 'visual_disposition', 'unresolved'
    ),
    stale: Boolean(fields.stale),
    ...(fields.stale_reason ? { stale_reason: String(fields.stale_reason) } : {}),
  };
}

function sortPlanBeats(beats) {
  return beats
    .slice()
    .sort((a, b) => a.start_char - b.start_char || a.end_char - b.end_char
      || String(a.beat_id).localeCompare(String(b.beat_id)))
    .map((b, i) => Object.assign({}, b, { order: i + 1 }));
}

function assertNoOverlap(beats) {
  const sorted = beats.slice().sort((a, b) => a.start_char - b.start_char);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start_char < sorted[i - 1].end_char) {
      fail(`Beats ${sorted[i - 1].beat_id} and ${sorted[i].beat_id} overlap.`);
    }
  }
}

function assertUniqueIds(list, key, label) {
  const seen = new Set();
  list.forEach((item) => {
    const id = item && item[key];
    if (!id || typeof id !== 'string') fail(`${label} is missing an id.`);
    if (seen.has(id)) fail(`Duplicate ${label} id: ${id}.`);
    seen.add(id);
  });
}

// Content hash of the fields that define what the visual must do. Stable key
// order; downstream prompt provenance compares against this.
function assignmentContentHash(assignment) {
  return sha256(JSON.stringify({
    viewer_task: assignment.viewer_task || '',
    visual_function: assignment.visual_function || '',
    visual_function_custom: assignment.visual_function_custom || '',
    assignment: assignment.assignment || '',
    acceptance_criteria: assignment.acceptance_criteria || [],
    media_type: assignment.media_type || '',
  }));
}

// Validate and shape one assignment's editable content (not status/ids).
function shapeAssignmentContent(fields = {}) {
  const out = {
    viewer_task: boundedString(fields.viewer_task, 'viewer_task', BOUNDS.viewer_task_max),
    visual_function: enumValue(fields.visual_function, VISUAL_FUNCTIONS, 'visual_function', 'illustrate'),
    assignment: boundedString(fields.assignment, 'assignment', BOUNDS.assignment_max),
    acceptance_criteria: boundedCriteria(fields.acceptance_criteria),
    media_type: enumValue(fields.media_type, MEDIA_TYPES, 'media_type', 'generated_still'),
    operator_notes: boundedString(fields.operator_notes, 'operator_notes', BOUNDS.operator_notes_max),
  };
  if (out.visual_function === 'custom') {
    out.visual_function_custom = boundedString(
      fields.visual_function_custom, 'visual_function_custom', BOUNDS.custom_label_max, { required: true }
    );
  }
  return out;
}

// ── plan-level operations (pure: plan in, new plan out) ─────────────────────

function emptyPlan(scriptText, options = {}) {
  const created = options.now || nowIso();
  return {
    schema_version: VISUAL_PLAN_SCHEMA_VERSION,
    source_script_hash: sha256(scriptText),
    created_at: created,
    updated_at: created,
    stale: false,
    beats: [],
    assignments: [],
  };
}

// Validate an entire plan object (used on read and before every persist).
function validatePlan(plan, scriptText) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('Visual plan must be an object.', 422);
  if (plan.schema_version !== VISUAL_PLAN_SCHEMA_VERSION) fail('Unknown visual plan schema version.', 422);
  if (!Array.isArray(plan.beats) || !Array.isArray(plan.assignments)) fail('Visual plan is malformed.', 422);
  if (plan.beats.length > BOUNDS.beats_max) fail('Visual plan has too many beats.', 422);
  assertUniqueIds(plan.beats, 'beat_id', 'beat');
  assertUniqueIds(plan.assignments, 'assignment_id', 'assignment');
  const beatIds = new Set(plan.beats.map((b) => b.beat_id));
  plan.assignments.forEach((a) => {
    if (!beatIds.has(a.beat_id)) fail(`Assignment ${a.assignment_id} references missing beat ${a.beat_id}.`, 422);
    enumValue(a.status, ASSIGNMENT_STATUSES, 'assignment status');
  });
  const byBeat = new Set();
  plan.assignments.forEach((a) => {
    if (byBeat.has(a.beat_id)) fail(`Beat ${a.beat_id} has more than one assignment.`, 422);
    byBeat.add(a.beat_id);
  });
  // Beat ranges only checked against the script when the plan is fresh — a
  // stale plan legitimately references the OLD script's offsets.
  if (typeof scriptText === 'string' && sha256(scriptText) === plan.source_script_hash) {
    plan.beats.forEach((b) => {
      if (b.start_char < 0 || b.end_char > scriptText.length || b.start_char >= b.end_char) {
        fail(`Beat ${b.beat_id} range is outside the saved script.`, 422);
      }
    });
    assertNoOverlap(plan.beats);
  }
  return plan;
}

// Create beats from the saved script. Refuses to discard assignment work: a
// plan that already has assignments must be re-anchored or cleared explicitly.
function createBeats(scriptText, existingPlan, options = {}) {
  const text = scriptTextOf(scriptText);
  if (!text.trim()) fail('Save a non-empty script before creating beats.');
  if (existingPlan && Array.isArray(existingPlan.assignments) && existingPlan.assignments.length > 0
      && !options.replace) {
    fail('This project already has visual assignments. Re-anchor the plan, or clear it explicitly before re-creating beats.', 409);
  }
  const spans = segmentScriptIntoSpans(text);
  if (!spans.length) fail('No beats could be created from the saved script.');
  if (spans.length > BOUNDS.beats_max) fail(`Script produces too many beats (max ${BOUNDS.beats_max}).`);
  const plan = emptyPlan(text, options);
  const ids = new Set();
  plan.beats = sortPlanBeats(spans.map((span) => {
    const id = makeBeatId(ids);
    ids.add(id);
    return shapeBeat(text, {
      beat_id: id, start_char: span.start, end_char: span.end, visual_disposition: 'unresolved',
    });
  }));
  return validatePlan(plan, text);
}

function findBeat(plan, beatId) {
  const beat = (plan.beats || []).find((b) => b.beat_id === beatId);
  if (!beat) fail(`No beat ${beatId} in the visual plan.`, 404);
  return beat;
}

function assignmentForBeat(plan, beatId) {
  return (plan.assignments || []).find((a) => a.beat_id === beatId) || null;
}

function findAssignment(plan, assignmentId) {
  const a = (plan.assignments || []).find((x) => x.assignment_id === assignmentId);
  if (!a) fail(`No assignment ${assignmentId} in the visual plan.`, 404);
  return a;
}

function touchPlan(plan, options = {}) {
  return Object.assign({}, plan, { updated_at: options.now || nowIso() });
}

// Set a beat's visual disposition (presenter-only, reuse-previous, …).
function setBeatDisposition(plan, scriptText, beatId, disposition, options = {}) {
  const beat = findBeat(plan, beatId);
  const clean = enumValue(disposition, VISUAL_DISPOSITIONS, 'visual_disposition');
  const beats = plan.beats.map((b) => (b.beat_id === beatId ? Object.assign({}, b, { visual_disposition: clean }) : b));
  let assignments = plan.assignments;
  // Moving a beat with an assignment to a no-assignment disposition keeps the
  // assignment (never delete operator work) but flags it for review.
  if (NO_ASSIGNMENT_DISPOSITIONS.indexOf(clean) !== -1 && assignmentForBeat(plan, beatId)) {
    assignments = plan.assignments.map((a) => (a.beat_id === beatId
      ? Object.assign({}, a, { stale: true, stale_reason: `Beat is now ${clean.replace('_', ' ')} — this assignment may no longer be needed.` })
      : a));
  }
  void beat;
  return validatePlan(touchPlan(Object.assign({}, plan, { beats: sortPlanBeats(beats), assignments }), options), scriptText);
}

// Split a beat at an absolute script offset. The existing assignment (if any)
// stays attached to the FIRST half and is marked stale for review.
function splitBeat(plan, scriptText, beatId, atOffset, options = {}) {
  const text = scriptTextOf(scriptText);
  if (sha256(text) !== plan.source_script_hash) {
    fail('The visual plan is stale against the saved script. Re-anchor before editing beats.', 409);
  }
  const beat = findBeat(plan, beatId);
  const at = Math.round(Number(atOffset));
  if (!Number.isInteger(at) || at <= beat.start_char || at >= beat.end_char) {
    fail('Split offset must fall strictly inside the beat.');
  }
  if (!isSurrogateSafe(text, at)) fail('Split offset lands inside a Unicode surrogate pair.');
  const firstSpan = trimSpan(text, { start: beat.start_char, end: at });
  const secondSpan = trimSpan(text, { start: at, end: beat.end_char });
  if (firstSpan.end <= firstSpan.start || secondSpan.end <= secondSpan.start) {
    fail('Both halves of a split must contain text.');
  }
  const ids = new Set(plan.beats.map((b) => b.beat_id));
  const secondId = makeBeatId(ids);
  const first = shapeBeat(text, Object.assign({}, beat, {
    start_char: firstSpan.start, end_char: firstSpan.end,
  }));
  const second = shapeBeat(text, {
    beat_id: secondId, start_char: secondSpan.start, end_char: secondSpan.end,
    visual_disposition: 'unresolved',
  });
  const beats = plan.beats.filter((b) => b.beat_id !== beatId).concat([first, second]);
  const assignments = plan.assignments.map((a) => (a.beat_id === beatId
    ? Object.assign({}, a, { stale: true, stale_reason: 'Beat was split — review the assignment against the new beat text.' })
    : a));
  return validatePlan(touchPlan(Object.assign({}, plan, { beats: sortPlanBeats(beats), assignments }), options), text);
}

// Merge a beat with the NEXT adjacent beat. Refuses when both carry
// assignments (nothing is ever silently discarded); a single assignment
// carries over to the merged beat, marked stale for review.
function mergeWithNext(plan, scriptText, beatId, options = {}) {
  const text = scriptTextOf(scriptText);
  if (sha256(text) !== plan.source_script_hash) {
    fail('The visual plan is stale against the saved script. Re-anchor before editing beats.', 409);
  }
  const ordered = sortPlanBeats(plan.beats);
  const idx = ordered.findIndex((b) => b.beat_id === beatId);
  if (idx === -1) fail(`No beat ${beatId} in the visual plan.`, 404);
  if (idx === ordered.length - 1) fail('This is the last beat — there is no next beat to merge with.');
  const a = ordered[idx];
  const b = ordered[idx + 1];
  const assignA = assignmentForBeat(plan, a.beat_id);
  const assignB = assignmentForBeat(plan, b.beat_id);
  if (assignA && assignB) {
    fail('Both beats have assignments. Clear one first — merging would discard operator work.', 409);
  }
  const merged = shapeBeat(text, {
    beat_id: a.beat_id,
    start_char: a.start_char,
    end_char: b.end_char,
    visual_disposition: a.visual_disposition === b.visual_disposition ? a.visual_disposition : 'unresolved',
  });
  const beats = ordered.filter((x) => x.beat_id !== a.beat_id && x.beat_id !== b.beat_id).concat([merged]);
  const keep = assignA || assignB;
  const assignments = plan.assignments
    .filter((x) => x.beat_id !== a.beat_id && x.beat_id !== b.beat_id)
    .concat(keep ? [Object.assign({}, keep, {
      beat_id: a.beat_id,
      stale: true,
      stale_reason: 'Beats were merged — review the assignment against the combined beat text.',
    })] : []);
  return validatePlan(touchPlan(Object.assign({}, plan, { beats: sortPlanBeats(beats), assignments }), options), text);
}

// ── assignment operations ────────────────────────────────────────────────────

// Save (create or update) the assignment for a beat. Approved assignments must
// be revoked before editing; content edits recompute the content hash.
function saveAssignment(plan, scriptText, beatId, fields = {}, options = {}) {
  findBeat(plan, beatId);
  const existing = assignmentForBeat(plan, beatId);
  if (existing && existing.status === 'approved' && !options.allowApprovedEdit) {
    fail('This assignment is approved. Revoke approval before editing it.', 409);
  }
  const content = shapeAssignmentContent(fields);
  const stamp = options.now || nowIso();
  const scriptHash = sha256(scriptTextOf(scriptText));
  let assignment;
  if (existing) {
    assignment = Object.assign({}, existing, content, {
      status: existing.status === 'rejected' ? 'draft' : existing.status, // editing a rejected one revives a draft
      updated_at: stamp,
    });
    delete assignment.stale;
    delete assignment.stale_reason;
  } else {
    const ids = new Set(plan.assignments.map((x) => x.assignment_id));
    assignment = Object.assign({
      assignment_id: makeAssignmentId(ids),
      beat_id: beatId,
      status: 'draft',
      created_by: options.createdBy === 'local-model' ? 'local-model' : 'operator',
      created_at: stamp,
      updated_at: stamp,
      source_script_hash: scriptHash,
    }, content);
  }
  assignment.assignment_hash = assignmentContentHash(assignment);
  const assignments = plan.assignments.filter((x) => x.beat_id !== beatId).concat([assignment]);
  return validatePlan(touchPlan(Object.assign({}, plan, { assignments }), options), scriptText);
}

function setAssignmentStatus(plan, scriptText, assignmentId, nextStatus, options = {}) {
  const a = findAssignment(plan, assignmentId);
  const status = enumValue(nextStatus, ASSIGNMENT_STATUSES, 'status');
  // Explicit transition rules — the operator is the only approval authority.
  if (status === 'approved') {
    if (a.status !== 'draft') fail(`Only a draft assignment can be approved (this one is ${a.status}).`, 409);
    if (a.stale) fail('This assignment is flagged for review. Save it (or re-anchor the plan) before approving.', 409);
    if (!String(a.assignment || '').trim()) fail('An empty assignment cannot be approved.');
  }
  if (status === 'rejected' && a.status === 'approved') {
    fail('Revoke approval first, then reject.', 409);
  }
  const stamp = options.now || nowIso();
  const assignments = plan.assignments.map((x) => (x.assignment_id === assignmentId
    ? Object.assign({}, x, { status, updated_at: stamp })
    : x));
  return validatePlan(touchPlan(Object.assign({}, plan, { assignments }), options), scriptText);
}

function approveAssignment(plan, scriptText, assignmentId, options = {}) {
  return setAssignmentStatus(plan, scriptText, assignmentId, 'approved', options);
}

function rejectAssignment(plan, scriptText, assignmentId, options = {}) {
  return setAssignmentStatus(plan, scriptText, assignmentId, 'rejected', options);
}

// Revoke approval → back to draft (audit trail via updated_at; content kept).
function revokeAssignment(plan, scriptText, assignmentId, options = {}) {
  const a = findAssignment(plan, assignmentId);
  if (a.status !== 'approved') fail('Only an approved assignment can have approval revoked.', 409);
  const stamp = options.now || nowIso();
  const assignments = plan.assignments.map((x) => (x.assignment_id === assignmentId
    ? Object.assign({}, x, { status: 'draft', updated_at: stamp })
    : x));
  return validatePlan(touchPlan(Object.assign({}, plan, { assignments }), options), scriptText);
}

// Clear (delete) a DRAFT assignment. Approved/rejected work is never cleared
// silently — approved must be revoked first; rejected is kept as a record
// unless explicitly cleared with allowRejected.
function clearAssignment(plan, scriptText, assignmentId, options = {}) {
  const a = findAssignment(plan, assignmentId);
  if (a.status === 'approved') fail('Revoke approval before clearing this assignment.', 409);
  if (a.status === 'rejected' && !options.allowRejected) {
    fail('This assignment is rejected (kept as a record). Pass explicit confirmation to clear it.', 409);
  }
  const assignments = plan.assignments.filter((x) => x.assignment_id !== assignmentId);
  return validatePlan(touchPlan(Object.assign({}, plan, { assignments }), options), scriptText);
}

// ── slot-safe generation planning ────────────────────────────────────────────

const DEFAULT_GENERATION_BATCH = 3;

// Decide which beats a generation batch may fill. NEVER overwrites: only
// beats with no assignment at all are eligible (a rejected assignment is only
// replaced when its beat id is explicitly selected).
function selectBeatsForGeneration(plan, options = {}) {
  const requested = Array.isArray(options.beatIds) ? options.beatIds.map(String) : null;
  const batch = Number.isInteger(options.batch) && options.batch > 0
    ? Math.min(options.batch, 10) : DEFAULT_GENERATION_BATCH;
  const ordered = sortPlanBeats(plan.beats || []);
  const eligible = [];
  const skipped = [];
  ordered.forEach((beat) => {
    if (requested && requested.indexOf(beat.beat_id) === -1) return;
    const existing = assignmentForBeat(plan, beat.beat_id);
    const skip = (reason) => skipped.push({ beat_id: beat.beat_id, order: beat.order, reason });
    if (NO_ASSIGNMENT_DISPOSITIONS.indexOf(beat.visual_disposition) !== -1) {
      skip(beat.visual_disposition === 'presenter_only' ? 'Presenter only' : 'Reuses the previous visual');
    } else if (existing && existing.status === 'approved') {
      skip('Assignment already approved');
    } else if (existing && existing.status === 'rejected') {
      if (requested) eligible.push(beat); // explicit selection may regenerate a rejected one
      else skip('Assignment rejected — select it explicitly to regenerate');
    } else if (existing) {
      skip('Assignment already exists');
    } else {
      eligible.push(beat);
    }
  });
  return { beats: eligible.slice(0, batch), skipped, truncated: Math.max(0, eligible.length - batch) };
}

// Build the local-model request for ONE beat's visual assignment. This is
// explicitly NOT an image prompt request.
function buildAssignmentRequest(scriptText, plan, beat) {
  const ordered = sortPlanBeats(plan.beats || []);
  const idx = ordered.findIndex((b) => b.beat_id === beat.beat_id);
  const prev = idx > 0 ? ordered[idx - 1] : null;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;
  const system = 'You are a visual director for a short-form video channel. You write VISUAL '
    + 'ASSIGNMENTS: what job a visual must perform in the argument. You never write image '
    + 'prompts — no lens, no render engine, no cinematic style padding, no model syntax. '
    + 'Return ONLY strict JSON matching the schema.';
  const user = [
    'SCRIPT BEAT:',
    JSON.stringify(beat.script_text),
    '',
    prev ? `PREVIOUS BEAT:\n${JSON.stringify(prev.script_text)}\n` : '',
    next ? `NEXT BEAT:\n${JSON.stringify(next.script_text)}\n` : '',
    'CHANNEL FORMAT:',
    'Vertical 9:16 explainer. Each visual is a complete full-screen 9:16 image that uses the entire frame to serve the argument.',
    'Do not reserve space for a presenter; a presenter overlay, if added later, is handled in editing and is outside this assignment.',
    '',
    'TASK:',
    'Create ONE visual assignment, not an image prompt.',
    'The assignment describes the visual JOB: what the viewer must understand, and what the visual must show to do that.',
    '',
    'Return strict JSON with exactly these fields:',
    `- viewer_task: one sentence, what the viewer should understand (max ${BOUNDS.viewer_task_max} chars)`,
    `- visual_function: one of ${VISUAL_FUNCTIONS.filter((f) => f !== 'custom').join(' | ')}`,
    `- assignment: what the visual must show, concrete, no camera/style jargon (max ${BOUNDS.assignment_max} chars)`,
    `- acceptance_criteria: 2-4 short checks a human can verify on the finished image (each max ${BOUNDS.criterion_max_chars} chars; include one that the image reads as a complete full-frame 9:16 composition)`,
    `- media_type: one of ${MEDIA_TYPES.join(' | ')}`,
  ].filter(Boolean).join('\n');
  const schema = {
    type: 'object',
    properties: {
      viewer_task: { type: 'string' },
      visual_function: { type: 'string' },
      assignment: { type: 'string' },
      acceptance_criteria: { type: 'array', items: { type: 'string' } },
      media_type: { type: 'string' },
    },
    required: ['viewer_task', 'visual_function', 'assignment', 'acceptance_criteria', 'media_type'],
  };
  return { system, user, schema };
}

// Validate one provider response into assignment content. Throws (statusCode
// 502) on malformed output; the caller persists nothing for that beat.
function parseGeneratedAssignment(raw) {
  let text = String(raw == null ? '' : raw).trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
  text = text.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, '$1').replace(/```/g, '').trim();
  let obj = null;
  try { obj = JSON.parse(text); } catch (_) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { obj = JSON.parse(text.slice(start, end + 1)); } catch (_2) { /* ignore */ }
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    fail('The model did not return a usable visual assignment.', 502);
  }
  try {
    const content = shapeAssignmentContent({
      viewer_task: obj.viewer_task,
      visual_function: normalizeGeneratedEnum(obj.visual_function, VISUAL_FUNCTIONS, 'illustrate'),
      assignment: obj.assignment,
      acceptance_criteria: obj.acceptance_criteria,
      media_type: normalizeGeneratedEnum(obj.media_type, MEDIA_TYPES, 'generated_still'),
    });
    if (!content.assignment) fail('The model returned an empty assignment.', 502);
    return content;
  } catch (e) {
    if (e.statusCode === 502) throw e;
    const err = new Error(`The model returned an invalid visual assignment: ${e.message}`);
    err.statusCode = 502;
    throw err;
  }
}

// Model output tolerance for enums only: near-miss tokens fall back to a safe
// default rather than failing the whole beat (the operator can correct them).
function normalizeGeneratedEnum(value, allowed, fallback) {
  const clean = String(value == null ? '' : value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.indexOf(clean) !== -1 ? clean : fallback;
}

// ── staleness & re-anchoring ─────────────────────────────────────────────────

// Recompute plan-level staleness against the saved script. Non-destructive.
function refreshPlanStaleness(plan, scriptText) {
  if (!plan) return plan;
  const fresh = sha256(String(scriptText == null ? '' : scriptText)) === plan.source_script_hash;
  const out = Object.assign({}, plan, { stale: !fresh });
  if (!fresh) {
    out.stale_reason = 'Script changed after this plan was created. Re-anchor the plan or re-create beats.';
  } else {
    delete out.stale_reason;
  }
  return out;
}

// Re-anchor a stale plan onto the current saved script: each beat's exact text
// is searched in the new script (first unclaimed occurrence, in beat order).
// Matched beats keep everything; unmatched beats are kept but flagged stale.
// Assignments on unmatched beats are flagged for review. Nothing is deleted.
function reanchorPlan(plan, scriptText, options = {}) {
  const text = scriptTextOf(scriptText);
  const ordered = sortPlanBeats(plan.beats || []);
  let cursor = 0;
  const unmatched = new Set();
  const rebased = ordered.map((beat) => {
    const at = text.indexOf(beat.script_text, cursor);
    if (at === -1) {
      unmatched.add(beat.beat_id);
      return Object.assign({}, beat, {
        stale: true,
        stale_reason: 'This beat’s text was not found in the updated script.',
      });
    }
    cursor = at + beat.script_text.length;
    const shaped = shapeBeat(text, Object.assign({}, beat, {
      start_char: at, end_char: at + beat.script_text.length, stale: false, stale_reason: null,
    }));
    delete shaped.stale_reason;
    return shaped;
  });
  // Unmatched beats keep their OLD offsets, which may now collide with matched
  // ones — they are display-only until resolved, so overlap validation is
  // deferred by keeping the plan marked stale when any beat is unmatched.
  const anyUnmatched = unmatched.size > 0;
  const scriptHash = sha256(text);
  const assignments = (plan.assignments || []).map((a) => {
    if (!unmatched.has(a.beat_id)) {
      return Object.assign({}, a, { source_script_hash: scriptHash });
    }
    return Object.assign({}, a, {
      stale: true,
      stale_reason: 'The beat this assignment belongs to no longer matches the script.',
    });
  });
  const out = Object.assign({}, plan, {
    beats: sortPlanBeats(rebased),
    assignments,
    source_script_hash: anyUnmatched ? plan.source_script_hash : scriptHash,
    stale: anyUnmatched,
    updated_at: options.now || nowIso(),
  });
  if (anyUnmatched) {
    out.stale_reason = `${unmatched.size} beat(s) no longer match the script. Review them, or re-create beats.`;
  } else {
    delete out.stale_reason;
  }
  return anyUnmatched ? out : validatePlan(out, text);
}

// ── prompt-creation eligibility (the approval gate) ─────────────────────────

// Which approved assignments may create image prompts right now, and why the
// others may not. Never silent: every considered beat lands in one bucket.
function selectAssignmentsForPromptCreation(plan, imagePromptRows, options = {}) {
  const requested = Array.isArray(options.assignmentIds) ? options.assignmentIds.map(String) : null;
  const rows = Array.isArray(imagePromptRows) ? imagePromptRows : [];
  const byAssignment = {};
  rows.forEach((r) => { if (r && r.assignment_id) byAssignment[r.assignment_id] = r; });
  const eligible = [];
  const skipped = [];
  sortPlanBeats(plan.beats || []).forEach((beat) => {
    const a = assignmentForBeat(plan, beat.beat_id);
    if (requested && (!a || requested.indexOf(a.assignment_id) === -1)) return;
    const skip = (reason) => skipped.push({
      beat_id: beat.beat_id, order: beat.order,
      assignment_id: a ? a.assignment_id : null, reason,
    });
    if (NO_ASSIGNMENT_DISPOSITIONS.indexOf(beat.visual_disposition) !== -1) {
      skip(beat.visual_disposition === 'presenter_only' ? 'Presenter only' : 'Reuses the previous visual');
    } else if (!a) {
      skip('No assignment yet');
    } else if (a.status === 'rejected') {
      skip('Assignment rejected');
    } else if (a.status === 'draft') {
      skip('Assignment not approved yet');
    } else if (a.stale) {
      skip('Assignment changed — review it before creating a prompt');
    } else if (IMAGE_LANE_MEDIA_TYPES.indexOf(a.media_type) === -1) {
      skip(`Media type "${a.media_type.replace(/_/g, ' ')}" is not produced by the image lane`);
    } else if (byAssignment[a.assignment_id]) {
      skip('Prompt already exists for this assignment');
    } else {
      eligible.push({ beat, assignment: a });
    }
  });
  return { eligible, skipped };
}

// Build the image-prompt generation request for one approved assignment. The
// PROMPT is the technical attempt; the assignment is the job it must fulfil.
function buildPromptFromAssignmentRequest(beat, assignment, context = {}) {
  const system = 'You write ONE image generation prompt for a photorealistic, full-screen vertical 9:16 '
    + 'image — a complete standalone composition that uses the entire frame. No readable text in the '
    + 'image, no logos, no watermarks. Do not reserve space for a presenter; a presenter overlay, if '
    + 'added later, is a separate editorial step outside this prompt. Return ONLY the prompt text — '
    + 'no preamble, no quotes, no markdown.';
  const user = [
    'The prompt must fulfil this VISUAL ASSIGNMENT (the job the image performs in the argument):',
    '',
    `SCRIPT BEAT: ${JSON.stringify(beat.script_text)}`,
    `VIEWER TASK: ${assignment.viewer_task || '(not stated)'}`,
    `VISUAL FUNCTION: ${assignment.visual_function}${assignment.visual_function_custom ? ` (${assignment.visual_function_custom})` : ''}`,
    `ASSIGNMENT: ${assignment.assignment}`,
    'ACCEPTANCE CRITERIA:',
    ...(assignment.acceptance_criteria || []).map((c) => `- ${c}`),
    `MEDIA TYPE: ${assignment.media_type}`,
    context.styleNotes ? `PROJECT VISUAL STYLE: ${context.styleNotes}` : '',
    context.previousAssignment ? `PREVIOUS VISUAL (for continuity): ${context.previousAssignment}` : '',
    '',
    'Write one concrete, photorealistic prompt that fulfils the assignment and would pass the acceptance criteria.',
  ].filter(Boolean).join('\n');
  return { system, user };
}

// ── readiness ────────────────────────────────────────────────────────────────

// Explicit blockers, never a misleading percentage (matches the workspace's
// readiness philosophy). presenter_only / reuse_previous beats are excluded
// from the required count.
function computeVisualPlanReadiness(plan, scriptText) {
  if (!plan) {
    return {
      exists: false, ready: false, total_beats: 0, presenter_only: 0,
      assignments_required: 0, assignments_approved: 0, assignments_draft: 0,
      assignments_rejected: 0, uncovered_beats: 0,
      blockers: ['No visual plan yet — create beats from the saved script.'],
      next_action: 'Create beats from the saved script',
    };
  }
  const fresh = typeof scriptText === 'string'
    ? Object.assign({}, refreshPlanStaleness(plan, scriptText)) : plan;
  const beats = sortPlanBeats(fresh.beats || []);
  const blockers = [];
  let presenterOnly = 0;
  let required = 0;
  let approved = 0;
  let draft = 0;
  let rejected = 0;
  let uncovered = 0;
  const draftOrders = [];
  const rejectedOrders = [];
  const uncoveredOrders = [];
  beats.forEach((beat) => {
    if (NO_ASSIGNMENT_DISPOSITIONS.indexOf(beat.visual_disposition) !== -1) {
      presenterOnly += 1;
      return;
    }
    required += 1;
    const a = assignmentForBeat(fresh, beat.beat_id);
    if (!a) { uncovered += 1; uncoveredOrders.push(beat.order); return; }
    if (a.status === 'approved' && !a.stale) { approved += 1; return; }
    if (a.status === 'rejected') { rejected += 1; rejectedOrders.push(beat.order); return; }
    draft += 1; draftOrders.push(beat.order);
  });
  if (fresh.stale) blockers.push(fresh.stale_reason || 'The plan is stale against the saved script.');
  if (uncovered) blockers.push(`Beat${uncovered > 1 ? 's' : ''} ${uncoveredOrders.join(', ')} ${uncovered > 1 ? 'have' : 'has'} no assignment yet`);
  if (rejected) blockers.push(`Beat${rejected > 1 ? 's' : ''} ${rejectedOrders.join(', ')} assignment${rejected > 1 ? 's are' : ' is'} rejected`);
  if (draft) blockers.push(`Beat${draft > 1 ? 's' : ''} ${draftOrders.join(', ')} ${draft > 1 ? 'are' : 'is'} still draft — review and approve`);
  let nextAction = 'Create image prompts from approved assignments';
  if (fresh.stale) nextAction = 'Re-anchor the plan to the saved script';
  else if (uncovered) nextAction = `Generate assignments for ${Math.min(uncovered, DEFAULT_GENERATION_BATCH)} unresolved beat${uncovered > 1 ? 's' : ''}`;
  else if (rejected) nextAction = `Resolve the rejected assignment for beat ${rejectedOrders[0]}`;
  else if (draft) nextAction = `Review ${draft} draft assignment${draft > 1 ? 's' : ''}`;
  return {
    exists: true,
    ready: blockers.length === 0 && required > 0,
    stale: Boolean(fresh.stale),
    total_beats: beats.length,
    presenter_only: presenterOnly,
    assignments_required: required,
    assignments_approved: approved,
    assignments_draft: draft,
    assignments_rejected: rejected,
    uncovered_beats: uncovered,
    blockers,
    next_action: nextAction,
  };
}

module.exports = {
  VISUAL_PLAN_SCHEMA_VERSION,
  VISUAL_DISPOSITIONS,
  VISUAL_FUNCTIONS,
  MEDIA_TYPES,
  ASSIGNMENT_STATUSES,
  IMAGE_LANE_MEDIA_TYPES,
  NO_ASSIGNMENT_DISPOSITIONS,
  BOUNDS,
  DEFAULT_GENERATION_BATCH,
  sha256,
  isSurrogateSafe,
  sentenceSpans,
  segmentScriptIntoSpans,
  estimateDurationSeconds,
  assignmentContentHash,
  shapeAssignmentContent,
  emptyPlan,
  validatePlan,
  createBeats,
  findBeat,
  findAssignment,
  assignmentForBeat,
  setBeatDisposition,
  splitBeat,
  mergeWithNext,
  saveAssignment,
  approveAssignment,
  rejectAssignment,
  revokeAssignment,
  clearAssignment,
  selectBeatsForGeneration,
  buildAssignmentRequest,
  parseGeneratedAssignment,
  refreshPlanStaleness,
  reanchorPlan,
  selectAssignmentsForPromptCreation,
  buildPromptFromAssignmentRequest,
  computeVisualPlanReadiness,
};
