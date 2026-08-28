'use strict';

/*
 * creative-direction.js
 *
 * Deterministic validation library for vidtoolz.creativeDirection.v2 — the
 * Creative Director's single output artifact. RECOMMENDATION ONLY.
 *
 * v2 (2026-08-28 authority repair, closes the Codex-proven escapes):
 *   - ACKNOWLEDGEMENT IS NOT COMPLIANCE. Human constraints derive typed
 *     PROTECTED DOMAINS (module-side, never model-side); every
 *     production-affecting recommendation must appear as a structured
 *     ACTION CLAIM; claims are checked deterministically against protected
 *     domains; and ALL model-authored prose is scanned with bounded
 *     verb/object proximity guards for contradictions of protected domains.
 *   - PROSE IS NEVER EXECUTABLE. The artifact carries an execution contract:
 *     downstream agents may act only on the structured surface; every prose
 *     field is NON_EXECUTABLE_CREATIVE_RATIONALE.
 *   - SPECIALIST BOUNDARY IS SEMANTIC. Content-shape detectors (paths,
 *     filenames, asset ids, coordinates, timestamps, frame numbers, render
 *     parameters, exact geometry) reject specialist execution details hidden
 *     in any model prose — not just forbidden key names.
 *   - NO SELF-APPROVAL, ANYWHERE. Approval-claim language in any model string
 *     is rejected; requires_human stays structurally forced.
 *   - CUSTOM constraints must carry a machine-verifiable protected scope; an
 *     unstructured CUSTOM is HUMAN_CONSTRAINT_REQUIRES_SEMANTIC_VALIDATION
 *     and must fail safely before any downstream consumption.
 *   - A bounded semantic adjudicator hook may REJECT or ESCALATE ambiguity
 *     (HUMAN_CONSTRAINT_AMBIGUITY); it can never approve past a
 *     deterministic failure.
 *
 * Library only: no CLI, no AGENT_ID, no side effects, no network.
 */

const crypto = require('node:crypto');

const SCHEMA = 'vidtoolz.creativeDirection.v2';
const ARTIFACT_TYPE = 'creative-direction';

const HUMOR_MODES = Object.freeze(['NONE', 'DRY', 'LIGHT', 'COMIC']);
const DENSITY_GROUPS = Object.freeze(['QUIET', 'READABLE', 'DENSE']);
const PRESENTER_MODES = Object.freeze(['PRESENTER_FREE', 'PROXY', 'LIVE']);
const ENDING_MODES = Object.freeze(['SYNTHESIS_CARD', 'JOKE_PUNCTUATION', 'EXPLICIT_DEVIATION']);
const VISUAL_FUNCTIONS = Object.freeze(['EXPLANATION', 'PROOF', 'COMPARISON', 'MOOD', 'HUMOR', 'PUNCTUATION']);
const MODE_WEIGHTS = Object.freeze(['DOMINANT', 'PRESENT', 'MINIMAL', 'ABSENT']);
const CARD_PATTERNS = Object.freeze(['COMPARISON_TWO_COLUMN', 'NUMBERED_LIST', 'LABELLED_CONCEPT', 'TAKEAWAY_FOOTER', 'SYNTHESIS_CARD']);
const ESCALATION_TYPES = Object.freeze(['HUMAN_TASTE_REQUIRED', 'HUMOR_DIRECTION_AMBIGUOUS', 'HOUSE_STYLE_DEVIATION_REQUIRES_HUMAN', 'ENDING_TONE_REQUIRES_HUMAN', 'HUMAN_CONSTRAINT_AMBIGUITY']);
const CONSTRAINT_TYPES = Object.freeze(['KEEP_MEDIA', 'MUSIC_LOCK', 'PRESENTER_FREE_DRAFT', 'PRESENTER_REQUIRED', 'TONE_SERIOUS', 'TONE_MORE_HUMOR', 'NO_CARDS_SECTION', 'CUSTOM']);
const PROVENANCES = Object.freeze(['HUMAN_DIRECTION', 'SCRIPT_EVIDENCE', 'STYLE_REFERENCE', 'CD_JUDGMENT']);
const CONFIDENCE_LEVELS = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
const SCRIPT_IDENTITY_KINDS = Object.freeze(['CANONICAL_STORY', 'CANDIDATE_SCRIPT']);
const LIFECYCLE_STATES = Object.freeze(['AWAITING_HUMAN_REVIEW', 'PREVIEW_ONLY']);
const MAX_ESCALATIONS = 4;
const MAX_PROSE_CHARS = 2000;

/* ---- semantic contract vocabularies (v2) --------------------------------- */

const PROTECTED_DOMAIN_NAMES = Object.freeze(['MEDIA', 'MUSIC', 'PRESENTER', 'CARDS', 'HUMOR', 'TONE', 'ENDING', 'SECTION_CONTENT', 'TYPOGRAPHY', 'MOTION', 'DENSITY', 'VISUAL_MODE']);
const OPERATIONS = Object.freeze(['KEEP', 'ADD', 'REMOVE', 'REPLACE', 'REGENERATE', 'SWAP', 'RESELECT', 'MATERIALLY_ALTER', 'CHANGE', 'CHANGE_TRACK', 'CHANGE_DIRECTION', 'CHANGE_SELECTION', 'INCREASE', 'SUPPRESS', 'ADJUST_STRATEGY', 'EMPHASIZE', 'REDUCE']);
// Operations that never conflict with anything: pure preservation/strategy.
const ALWAYS_LEGAL_OPERATIONS = Object.freeze(['KEEP']);

const VIOLATION_CODES = Object.freeze({
  KEEP_MEDIA: 'HUMAN_KEEP_MEDIA_CONTRADICTION',
  MUSIC_LOCK: 'HUMAN_MUSIC_LOCK_CONTRADICTION',
  CUSTOM: 'HUMAN_CUSTOM_CONSTRAINT_CONTRADICTION',
  PRESENTER_FREE_DRAFT: 'HUMAN_PRESENTER_CONSTRAINT_CONTRADICTION',
  PRESENTER_REQUIRED: 'HUMAN_PRESENTER_CONSTRAINT_CONTRADICTION',
  TONE_SERIOUS: 'HUMAN_TONE_CONSTRAINT_CONTRADICTION',
  TONE_MORE_HUMOR: 'HUMAN_TONE_CONSTRAINT_CONTRADICTION',
  NO_CARDS_SECTION: 'HUMAN_CARDS_CONSTRAINT_CONTRADICTION',
  SPECIALIST: 'SPECIALIST_EXECUTION_BOUNDARY_VIOLATION',
  SELF_APPROVAL: 'HOUSE_STYLE_SELF_APPROVAL_FORBIDDEN',
  STORY: 'STORY_AUTHORITY_INVALID',
  CUSTOM_UNENFORCEABLE: 'HUMAN_CONSTRAINT_REQUIRES_SEMANTIC_VALIDATION',
});

// Vocabulary the Creative Director may never emit as KEYS (kept from v1).
const FORBIDDEN_KEYS = new Set([
  'shot_brief', 'camera_intent', 'media_type', 'generation_mode', 'subject', 'shots', 'shot_id',
  'plan_id', 'prompt_id', 'prompt', 'selected', 'selected_asset_id', 'final_asset', 'approved_asset',
  'dialogue', 'script_text', 'rewritten_dialogue', 'rewritten_script', 'claim_text', 'central_claim_edit',
  'timing_s', 'duration_s', 'cut_list', 'transition_list', 'keyframes', 'coordinates',
  'route', 'routing', 'backend', 'host', 'model', 'engine', 'workflow',
  'approval', 'approved_by', 'greenlight', 'publish',
]);

const PATTERN_REF_RE = /^(PAT-\d{2}|P-\d{2})$/;
const DIRECTION_ID_RE = /^creative-direction-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

const norm = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
// Model output is hostile: an array-typed field returned as a scalar or object
// must produce a rejection, never a thrown iterator error (a crash could be a
// bypass). asArr coerces for iteration; the paired schema check records the
// type violation so the artifact is rejected, not silently tolerated.
const asArr = (v) => (Array.isArray(v) ? v : []);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newDirectionId(now = Date.now()) {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now;
  let ts = '';
  for (let i = 0; i < 10; i += 1) { ts = CROCKFORD[time % 32] + ts; time = Math.floor(time / 32); }
  let rand = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i += 1) rand += CROCKFORD[bytes[i] % 32];
  return `creative-direction-${ts}${rand}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function directionDigest(direction) {
  return sha256(canonicalize({ ...direction, direction_digest_sha256: '' }));
}

function forbiddenKeyHits(value, pathName = '$', hits = []) {
  if (!value || typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(`${pathName}.${key}`);
    forbiddenKeyHits(child, `${pathName}.${key}`, hits);
  }
  return hits;
}

function proseTooLong(value, pathName = '$', hits = []) {
  if (typeof value === 'string' && value.length > MAX_PROSE_CHARS) hits.push(pathName);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) proseTooLong(child, `${pathName}.${key}`, hits);
  }
  return hits;
}

/* ---- protected-domain derivation (module authority, never model) ---------- */

function deriveProtectedDomains(constraints) {
  const domains = [];
  const unenforceable = [];
  for (const c of constraints || []) {
    switch (c.type) {
      case 'KEEP_MEDIA':
        domains.push({ constraint_id: c.constraint_id, domain: 'MEDIA', scope: c.scope || 'GLOBAL', forbidden_operations: ['REPLACE', 'REGENERATE', 'SWAP', 'RESELECT', 'REMOVE', 'MATERIALLY_ALTER', 'CHANGE', 'CHANGE_SELECTION'], violation: VIOLATION_CODES.KEEP_MEDIA });
        break;
      case 'MUSIC_LOCK':
        domains.push({ constraint_id: c.constraint_id, domain: 'MUSIC', scope: c.scope || 'GLOBAL', forbidden_operations: ['REPLACE', 'REGENERATE', 'SWAP', 'RESELECT', 'REMOVE', 'CHANGE', 'CHANGE_TRACK', 'CHANGE_DIRECTION', 'CHANGE_SELECTION', 'MATERIALLY_ALTER'], violation: VIOLATION_CODES.MUSIC_LOCK });
        break;
      case 'PRESENTER_FREE_DRAFT':
        domains.push({ constraint_id: c.constraint_id, domain: 'PRESENTER', scope: 'GLOBAL', forbidden_operations: ['ADD', 'REPLACE', 'CHANGE'], violation: VIOLATION_CODES.PRESENTER_FREE_DRAFT });
        break;
      case 'PRESENTER_REQUIRED':
        domains.push({ constraint_id: c.constraint_id, domain: 'PRESENTER', scope: 'GLOBAL', forbidden_operations: ['REMOVE', 'SUPPRESS'], violation: VIOLATION_CODES.PRESENTER_REQUIRED });
        break;
      case 'TONE_SERIOUS':
        domains.push({ constraint_id: c.constraint_id, domain: 'HUMOR', scope: 'GLOBAL', forbidden_operations: ['ADD', 'INCREASE'], violation: VIOLATION_CODES.TONE_SERIOUS });
        break;
      case 'TONE_MORE_HUMOR':
        domains.push({ constraint_id: c.constraint_id, domain: 'HUMOR', scope: 'GLOBAL', forbidden_operations: ['REMOVE', 'SUPPRESS'], violation: VIOLATION_CODES.TONE_MORE_HUMOR });
        break;
      case 'NO_CARDS_SECTION':
        domains.push({ constraint_id: c.constraint_id, domain: 'CARDS', scope: c.scope, forbidden_operations: ['ADD', 'INCREASE'], violation: VIOLATION_CODES.NO_CARDS_SECTION });
        break;
      case 'CUSTOM': {
        const p = c.protected;
        const structured = p && typeof p === 'object' && PROTECTED_DOMAIN_NAMES.includes(p.domain)
          && (Array.isArray(p.forbidden_operations) || Array.isArray(p.required_field_values))
          && (p.forbidden_operations || []).every((op) => OPERATIONS.includes(op))
          && (p.required_field_values || []).every((r) => r && typeof r.path === 'string' && Array.isArray(r.one_of) && r.one_of.length > 0);
        if (!structured) {
          unenforceable.push({ constraint_id: c.constraint_id, code: VIOLATION_CODES.CUSTOM_UNENFORCEABLE, detail: 'CUSTOM constraint carries no machine-verifiable protected scope; it must fail safely before downstream consumption' });
          break;
        }
        domains.push({ constraint_id: c.constraint_id, domain: p.domain, scope: p.scope || 'GLOBAL', forbidden_operations: [...(p.forbidden_operations || [])], required_field_values: structuredClone(p.required_field_values || []), violation: VIOLATION_CODES.CUSTOM });
        break;
      }
      default:
        unenforceable.push({ constraint_id: c.constraint_id, code: VIOLATION_CODES.CUSTOM_UNENFORCEABLE, detail: `unknown constraint type ${c.type}` });
    }
  }
  return { domains, unenforceable };
}

function scopesIntersect(a, b) {
  if (!a || !b) return true;
  if (a === 'GLOBAL' || b === 'GLOBAL') return true;
  return norm(a) === norm(b);
}

/* ---- prose collection (model-authored strings only) ------------------------ */

const PROSE_SKIP_PATHS = [
  /^\$\.human_directions_received\[\d+\]\.text$/, // human echo, not model prose
  /^\$\.human_directions_received\[\d+\]\.scope$/, // human-supplied scope reference
  /^\$\.script_identity\./,
  /^\$\.style_reference_binding\./,
  /^\$\.episode\.title$/, // carried from the bound script source
  /^\$\.episode\.package_run_id$/,
  // Artifact identity/metadata written by the MODULE, never by the model:
  /^\$\.(?:schema|artifact_type|direction_id|revision|supersedes|created_at|created_by|lifecycle_state|direction_digest_sha256)$/,
  /^\$\.execution_contract\./,
  // Structural REFERENCE surfaces (section ids, scopes, citation ids): these
  // are enum/ref fields validated by their own rules, not prose — canonical
  // Story section ids are ULIDs and must not trip the id-shape detector.
  /\.section_ref$/,
  /\.constraint_id$/,
  /\.claim_id$/,
  /\.pattern_ref$/,
  /^\$\.card_strategy\.argument_sections_needing_cards\[\d+\]$/,
  /^\$\.action_claims\[\d+\]\.scope$/,
  /^\$\.protected_domains\[\d+\]\./,
  /^\$\.style_patterns_cited\[\d+\]$/,
];

function collectModelProse(value, pathName = '$', out = []) {
  if (typeof value === 'string') {
    if (!PROSE_SKIP_PATHS.some((re) => re.test(pathName)) && norm(value)) out.push({ path: pathName, text: value });
    return out;
  }
  if (Array.isArray(value)) { value.forEach((child, i) => collectModelProse(child, `${pathName}[${i}]`, out)); return out; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectModelProse(child, `${pathName}.${key}`, out);
  }
  return out;
}

/* ---- layered prose guards --------------------------------------------------
 * Layer 3 of the enforcement stack: bounded verb/object PROXIMITY families per
 * protected domain (never bare keyword bans — "music" or "cut" alone is legal).
 */

// Successor repair: two intent tiers.
//  - MUTATION_VERBS: identity/selection change (replace, regenerate, retire,
//    substitute, ...) → hard CONTRADICTION of the protected domain.
//  - ALTERATION_TERMS: softer change/alternative intent (adjust, minimal,
//    different, selection, pivot, ...) → HUMAN_CONSTRAINT_AMBIGUITY escalation.
// Both are authority violations that escalate (never silent PREVIEW_ONLY).
const MUTATION_VERBS = '(?:replace|replaces|replacing|swap|swaps|swapping|regenerat\\w*|re-?generat\\w*|re-?render\\w*|re-?select\\w*|reselect\\w*|remove|removes|removing|delete|deletes|deleting|discard\\w*|drop|drops|dropping|redo|re-?shoot\\w*|re-?score|re-?scoring|re-?arrang\\w*|substitut\\w*|retire|retires|retiring|switch\\w*|produce|producing|source|sourcing|generate|generating|recreat\\w*|remak\\w*|rebuild\\w*)';
// Deliberately EXCLUDES common creative words (new/another/fresh) so legitimate
// Level-B language ("a new visual relationship") is not over-escalated; only
// change-of-identity/selection intent is treated as ambiguous.
const ALTERATION_TERMS = '(?:change\\w*|alter\\w*|adjust\\w*|modif\\w*|revis\\w*|rework\\w*|tweak\\w*|minimal|minimi[sz]\\w*|strip\\w*|pivot\\w*|different|alternativ\\w*|alternate|reselection|in\\s+favor\\s+of|instead\\s+of)';
// Proximity is evaluated WITHIN one sentence (guards split on sentence
// boundaries), so the window can be generous without crossing statements.
const NEAR = '\\W+(?:[\\w,;:\'"-]+\\W+){0,14}?';
const DOMAIN_OBJECTS = Object.freeze({
  MEDIA: '(?:image|images|imagery|media|plate|plates|footage|asset|assets|still|stills|visual|visuals|picture|pictures|graphic|graphics|photo|photos|clip|clips)',
  MUSIC: '(?:music|track|soundtrack|score|scoring|bed|cue|cues|audio\\s+bed|arrangement|composition)',
  PRESENTER: '(?:presenter|talking\\s*head|host|face|on-?camera)',
  CARDS: '(?:card|cards|infographic|infographics)',
  ENDING: '(?:ending|outro|close|closing|finale)',
});

// A negator IMMEDIATELY before the intent term marks compliance language
// ("without changing it", "never replace").
const IMMEDIATE_NEGATION_RE = /(?:\bwithout|\bnever|\bnot|\bno|\bavoid(?:ing)?|don'?t|do\s+not)\s+(?:\w+\s+)?$/i;

function negatedAt(text, index) {
  return IMMEDIATE_NEGATION_RE.test(text.slice(Math.max(0, index - 24), index));
}

function splitSentences(text) {
  return String(text).split(/(?<=[.!?;])\s+/);
}

// A domain-specific scope token (e.g. "S03", "beat-03") is also a protected
// object: "KEEP S03" + "Replace S03" targets the scope, not a media noun.
function scopeObjectPattern(scope) {
  const s = String(scope || '').trim();
  if (!s || s === 'GLOBAL') return null;
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanIntent(prose, objectPattern, verbGroup) {
  const forward = new RegExp(`\\b(${verbGroup})${NEAR}${objectPattern}\\b`, 'ig');
  const backward = new RegExp(`\\b${objectPattern}${NEAR}(${verbGroup})\\b`, 'ig');
  for (const item of prose) {
    for (const sentence of splitSentences(item.text)) {
      let match;
      forward.lastIndex = 0;
      while ((match = forward.exec(sentence)) !== null) {
        if (!negatedAt(sentence, match.index)) return { path: item.path, excerpt: match[0].slice(0, 120) };
      }
      backward.lastIndex = 0;
      while ((match = backward.exec(sentence)) !== null) {
        const verbOffset = match[0].search(new RegExp(verbGroup, 'i'));
        if (!(verbOffset > 0 && negatedAt(sentence, match.index + verbOffset))) return { path: item.path, excerpt: match[0].slice(0, 120) };
      }
    }
  }
  return null;
}

function proseGuardHits(prose, protectedDomains) {
  const hits = [];
  for (const domain of protectedDomains) {
    const nounObject = DOMAIN_OBJECTS[domain.domain];
    const scopeObject = scopeObjectPattern(domain.scope);
    // Objects for THIS domain: the domain nouns and/or the specific scope token.
    const objects = [nounObject, scopeObject].filter(Boolean);
    if (!objects.length) continue; // structural/claims/semantic layers cover the rest
    const objectPattern = `(?:${objects.join('|')})`;
    // Tier 1 — mutation intent → hard contradiction.
    const mutation = scanIntent(prose, objectPattern, MUTATION_VERBS);
    if (mutation) { hits.push({ code: domain.violation, tier: 'CONTRADICTION', constraint_id: domain.constraint_id, domain: domain.domain, path: mutation.path, excerpt: mutation.excerpt }); continue; }
    // Tier 2 — softer alteration/alternative intent → ambiguity escalation.
    const alteration = scanIntent(prose, objectPattern, ALTERATION_TERMS);
    if (alteration) hits.push({ code: 'HUMAN_CONSTRAINT_AMBIGUITY', tier: 'AMBIGUITY', constraint_id: domain.constraint_id, domain: domain.domain, path: alteration.path, excerpt: alteration.excerpt });
  }
  return hits;
}

/* ---- specialist execution boundary (content shapes, not key names) --------- */

const SPECIALIST_DETECTORS = Object.freeze([
  { name: 'filesystem_path', re: /(?:^|[\s"'(])\/(?:[\w.-]+\/)+[\w.-]+/ },
  { name: 'media_filename', re: /\b[\w-]{2,}\.(?:png|jpe?g|mp4|mov|wav|webm|gif|tiff?|exr|svg|onnx|gguf)\b/i },
  { name: 'asset_id_shape', re: /\b(?:img|asset|plate|shot|clip|take|cue)[-_][\w-]*\d[\w-]*\b/i },
  { name: 'ulid_or_hash', re: /\b(?:[0-9A-HJKMNP-TV-Z]{26}|[a-f0-9]{16,64})\b/ },
  { name: 'degree_coordinates', re: /-?\d{1,3}(?:\.\d+)?\s*°/ },
  { name: 'latlon_pair', re: /\b-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}\b/ },
  { name: 'camera_parameter', re: /\b(?:lat|latitude|lon|longitude|heading|pitch|yaw|tilt|fov|focal)\s*[:=]\s*-?\d/i },
  // Worded coordinates: "latitude 61.200 and longitude 24.900".
  { name: 'worded_coordinate', re: /\b(?:lat(?:itude)?|lon(?:g|gitude)?)\s+(?:of\s+)?-?\d{1,3}(?:\.\d+)?/i },
  // Render command / codec / encoder parameters.
  { name: 'render_command_or_codec', re: /\b(?:ffmpeg|ffprobe|libx26[45]|libvpx|x26[45]|h\.?26[45]|hevc|yuv4[0-9]{2}p|prores|nvenc|vaapi|aac|libmp3lame|vcodec|acodec|-c:v|-c:a|pix_fmt|bitrate)\b/i },
  { name: 'timestamp_seconds', re: /\b(?:at|from|until|to|around)\s+\d+(?:\.\d+)?\s*s(?:ec(?:ond)?s?)?\b/i },
  // minutes:seconds timecodes; common aspect-ratio idioms (9:16, 16:9, 4:3,
  // 21:9, 1:1, 3:4) are legal conceptual language, not execution timing.
  { name: 'timecode', re: /\b(?!(?:16:9|9:16|4:3|3:4|21:9|1:1)\b)\d{1,2}:\d{2}(?:\.\d+)?\b/ },
  { name: 'frame_number', re: /\bframe\s*#?\s*\d+\b/i },
  { name: 'millisecond_value', re: /\b\d+(?:\.\d+)?\s*(?:ms|millisecond)/i },
  { name: 'pixel_value', re: /\b\d+\s*px\b|\b[xy]\s*=\s*\d+\b/i },
  { name: 'scale_percent', re: /\b(?:scale|zoom|crop|resize|enlarge|shrink|opacity)\w*\s+(?:\w+\s+){0,3}?(?:to|by|at)?\s*\d+(?:\.\d+)?\s*%/i },
  { name: 'render_parameter', re: /\b(?:crf\s*\d+|\d+\s*fps\b|fps\s*\d+|f\/\d+(?:\.\d+)?|\d+\s*mm\b|iso\s*\d+)/i },
  { name: 'seconds_duration_execution', re: /\b(?:cut|hold|dissolve|transition|push(?:-|\s)?in|pan|zoom)\w*\s+(?:\w+\s+){0,4}?(?:of|for|at|lasting)\s+\d+(?:\.\d+)?\s*s(?:ec(?:ond)?s?)?\b/i },
  // Spelled-out execution timing: "at thirty-seven seconds" is as executable
  // as "at 37s".
  { name: 'spelled_timestamp', re: /\b(?:at|around|by|near|for|lasting)\s+(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|one|two|three|four|five|six|seven|eight|nine|half\s+a|a\s+quarter)\s+(?:of\s+a\s+)?second(?:s)?\b/i },
  // Spelled-out media filenames: "final dash plate dot png".
  { name: 'spelled_filename', re: /\bdot\s+(?:png|jpe?g|mp4|mov|wav|webm|gif|svg)\b/i },
  // Spelled-out fractional-second transition timing: "a quarter second",
  // "half a second", "let the dissolve last a quarter second".
  { name: 'spelled_fraction_second', re: /\b(?:a\s+|one\s+)?(?:quarter|half|third|two[-\s]thirds|three[-\s]quarters)\s+(?:of\s+a\s+)?seconds?\b/i },
]);

function specialistBoundaryHits(prose) {
  const hits = [];
  for (const item of prose) {
    for (const detector of SPECIALIST_DETECTORS) {
      const match = detector.re.exec(item.text);
      if (match) hits.push({ code: VIOLATION_CODES.SPECIALIST, detector: detector.name, path: item.path, excerpt: match[0].slice(0, 120) });
    }
  }
  return hits;
}

/* ---- self-approval guard ---------------------------------------------------- */

// Approval-claim language has NO legitimate place in creative-direction prose:
// approval exists only as a recorded human decision with provenance, never as
// something the model asserts. This matches the approval-claim family broadly.
const SELF_APPROVAL_RES = [
  // approval nouns/verbs that are out of place in creative prose
  /\b(?:pre[-\s]?)?approv(?:e|es|ed|al)\b/i,
  /\bexempt(?:ion|ed|ions)?\b/i,
  /\bsanction(?:ed|s)?\b/i,
  /\bsign[-\s]?off\b/i,
  // "the user/human/... approved", "human approval: true"
  /\b(?:user|human|mikko|operator|reviewer)\s+(?:approv\w*|granted|authoriz\w*|permitt\w*|clear\w*|sign)/i,
  /\b(?:human|user)\s+approval\s*[:=]?\s*(?:true|yes|granted)\b/i,
  // "granted following an exemption/exception/approval/permission"
  /\bgrant(?:ed|s)?\b(?:\W+\w+){0,6}?\W+(?:exemption|exception|approval|permission|deviation)/i,
  /\b(?:consider|treat|deem)\w*(?:\W+\w+){0,3}?\W+approv/i,
  /\bi\s+(?:hereby\s+)?approve\b/i,
];

function selfApprovalHits(prose) {
  const hits = [];
  for (const item of prose) {
    for (const re of SELF_APPROVAL_RES) {
      const match = re.exec(item.text);
      if (match) { hits.push({ code: VIOLATION_CODES.SELF_APPROVAL, path: item.path, excerpt: match[0].slice(0, 120) }); break; }
    }
  }
  return hits;
}

/* ---- structural helpers ------------------------------------------------------ */

function validateScriptIdentity(identity, errors, label = 'script_identity') {
  if (!identity || typeof identity !== 'object') { errors.push(`${label} required`); return; }
  if (!SCRIPT_IDENTITY_KINDS.includes(identity.kind)) { errors.push(`${label}.kind invalid`); return; }
  // SHAPE only. Authority is NOT a boolean here: it is guaranteed by (a) the
  // module preflight re-resolving the task identity through the pinned store,
  // and (b) SCRIPT_IDENTITY_DRIFT requiring the direction identity to equal the
  // re-verified task identity. A copied/forged identity fails those, not a flag.
  if (identity.kind === 'CANONICAL_STORY') {
    if (!norm(identity.project_id) || !norm(identity.version_id) || !SHA256_RE.test(identity.content_hash || '')) {
      errors.push(`${label} canonical Story identity incomplete`);
    }
  } else {
    if (identity.source !== 'DISCOVERY_PACKAGE') errors.push(`${label}.source unsupported`);
    if (!norm(identity.canonical_idea_id) || !SHA256_RE.test(identity.source_fingerprint || '')
      || !SHA256_RE.test(identity.datasheet_fingerprint || '') || !norm(identity.script_variant)
      || !SHA256_RE.test(identity.script_sha256 || '')) {
      errors.push(`${label} candidate-script identity incomplete`);
    }
  }
}

function readPath(value, dotted) {
  return dotted.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), value);
}

function structuralConstraintErrors(direction, constraint) {
  const errors = [];
  const id = constraint.constraint_id;
  const fail = (msg) => errors.push(`CONSTRAINT_CONTRADICTION ${id}: ${msg}`);
  const humorMode = direction.humor?.mode;
  const humorWeight = (direction.visual_mode_mix || []).find((m) => m.mode === 'HUMOR')?.weight;
  switch (constraint.type) {
    case 'TONE_SERIOUS':
      if (!['NONE', 'DRY'].includes(humorMode)) fail(`humor.mode ${humorMode} contradicts TONE_SERIOUS`);
      if (!['ABSENT', 'MINIMAL'].includes(humorWeight)) fail(`HUMOR visual weight ${humorWeight} contradicts TONE_SERIOUS`);
      break;
    case 'TONE_MORE_HUMOR':
      if (!['LIGHT', 'COMIC'].includes(humorMode)) fail(`humor.mode ${humorMode} contradicts TONE_MORE_HUMOR`);
      break;
    case 'PRESENTER_FREE_DRAFT':
      if (direction.presenter_policy?.draft_mode !== 'PRESENTER_FREE') fail('draft_mode must be PRESENTER_FREE');
      break;
    case 'PRESENTER_REQUIRED':
      if (!['LIVE', 'PROXY'].includes(direction.presenter_policy?.draft_mode)) fail('draft_mode must be LIVE or PROXY');
      break;
    case 'NO_CARDS_SECTION': {
      const scoped = (direction.card_strategy?.argument_sections_needing_cards || []).includes(constraint.scope);
      if (scoped) fail(`card_strategy targets constrained section ${constraint.scope}`);
      break;
    }
    case 'KEEP_MEDIA': {
      const locked = direction.media_strategy?.locked_scopes || [];
      if (!locked.includes(constraint.scope)) fail(`media_strategy.locked_scopes must echo ${constraint.scope}`);
      const requests = direction.media_strategy?.replacement_requests || [];
      if (requests.includes(constraint.scope)) fail(`replacement requested for locked scope ${constraint.scope}`);
      break;
    }
    case 'MUSIC_LOCK':
      if (direction.coherence?.music_locked !== true) fail('coherence.music_locked must be true');
      break;
    case 'CUSTOM':
      break; // handled through the derived protected domain
    default:
      errors.push(`constraint ${id} has unknown type ${constraint.type}`);
  }
  return errors;
}

/* ---- the layered validator ---------------------------------------------------
 * Layer 1: structural fields + action-claim validation against protected domains.
 * Layer 2: required-field-values from structured CUSTOM constraints.
 * Layer 3: deterministic prose guards (constraint contradiction, specialist
 *          boundary, self-approval).
 * Layer 4: optional bounded semantic adjudicator — REJECT/AMBIGUOUS only; a
 *          PASS is advisory and can never override layers 1-3.
 * Violations are returned typed so callers can escalate without retry roulette.
 */
function validateDirection(direction, context = {}) {
  const errors = [];
  const violations = [];
  const task = context.task || {};
  if (!direction || typeof direction !== 'object') return { ok: false, errors: ['direction required'], violations };

  if (direction.schema !== SCHEMA) errors.push('schema invalid');
  if (direction.artifact_type !== ARTIFACT_TYPE) errors.push('artifact_type invalid');
  if (!DIRECTION_ID_RE.test(direction.direction_id || '')) errors.push('direction_id invalid');
  if (!Number.isInteger(direction.revision) || direction.revision < 1) errors.push('revision invalid');
  if (direction.created_by !== 'creative_director') errors.push('created_by must be creative_director');
  if (!LIFECYCLE_STATES.includes(direction.lifecycle_state)) errors.push('lifecycle_state invalid');
  if (!norm(direction.episode?.title)) errors.push('episode.title required');

  validateScriptIdentity(direction.script_identity, errors);
  if (task.script_identity && canonicalize(direction.script_identity) !== canonicalize(task.script_identity)) {
    errors.push('SCRIPT_IDENTITY_DRIFT: direction does not bind the task script identity exactly');
  }
  const srb = direction.style_reference_binding;
  if (!srb || typeof srb !== 'object') errors.push('style_reference_binding required');
  else if (srb.status === 'ACTIVE_ADVISORY') {
    if (!norm(srb.reference_id) || !SHA256_RE.test(srb.sha256 || '')) errors.push('style_reference_binding incomplete');
    if (task.style_reference && (srb.reference_id !== task.style_reference.reference_id || srb.sha256 !== task.style_reference.sha256)) {
      errors.push('STYLE_REFERENCE_DRIFT: binding does not match the task style reference');
    }
    if (task.style_reference === null) errors.push('STYLE_AUTHORITY_FABRICATED: task carried no active style reference');
  } else if (srb.status === 'ABSENT') {
    if (task.style_reference) errors.push('style reference active in task but direction declares ABSENT');
  } else errors.push('style_reference_binding.status invalid');

  // Protected domains: derived here, deterministically, from the task's human
  // constraints — the artifact's own protected_domains must match exactly so a
  // model cannot narrow them.
  const derived = deriveProtectedDomains(task.human_constraints || []);
  for (const item of derived.unenforceable) {
    violations.push(item);
    errors.push(`${item.code}: ${item.constraint_id} — ${item.detail}`);
  }
  if (task.human_constraints && canonicalize(direction.protected_domains || []) !== canonicalize(derived.domains)) {
    errors.push('protected_domains must equal the module-derived domains for the task constraints (model may not narrow human protection)');
  }

  // Echo integrity + structural per-constraint checks (kept from v1).
  const echoed = new Map(asArr(direction.human_directions_received).map((c) => [c.constraint_id, c]));
  for (const constraint of task.human_constraints || []) {
    const echo = echoed.get(constraint.constraint_id);
    if (!echo) { errors.push(`human constraint ${constraint.constraint_id} not echoed`); continue; }
    if (echo.type !== constraint.type || norm(echo.text) !== norm(constraint.text)) {
      errors.push(`human constraint ${constraint.constraint_id} echo altered`);
    }
    if (!norm(echo.compliance)) errors.push(`human constraint ${constraint.constraint_id} lacks a compliance statement`);
    for (const err of structuralConstraintErrors(direction, constraint)) {
      errors.push(err);
      const code = VIOLATION_CODES[constraint.type];
      if (code) violations.push({ code, constraint_id: constraint.constraint_id, path: 'structural', excerpt: err.slice(0, 120) });
    }
  }

  // Layer 1: action claims. Every production-affecting recommendation must be
  // a typed claim; claims are checked against protected domains.
  const claims = direction.action_claims;
  if (!Array.isArray(claims)) errors.push('action_claims must be an array (the ONLY executable recommendation surface)');
  const claimIds = new Set();
  for (const [i, claim] of asArr(claims).entries()) {
    if (!norm(claim?.claim_id) || claimIds.has(claim.claim_id)) errors.push(`action_claims[${i}] claim_id missing or duplicate`);
    claimIds.add(claim?.claim_id);
    if (!PROTECTED_DOMAIN_NAMES.includes(claim?.domain)) errors.push(`action_claims[${i}] domain invalid`);
    if (!OPERATIONS.includes(claim?.operation)) errors.push(`action_claims[${i}] operation invalid`);
    if (!norm(claim?.summary)) errors.push(`action_claims[${i}] summary required`);
    for (const domain of derived.domains) {
      if (claim?.domain !== domain.domain) continue;
      if (!scopesIntersect(claim?.scope || 'GLOBAL', domain.scope)) continue;
      if (ALWAYS_LEGAL_OPERATIONS.includes(claim?.operation)) continue;
      if ((domain.forbidden_operations || []).includes(claim?.operation)) {
        errors.push(`${domain.violation}: action claim ${claim.claim_id} recommends ${claim.operation} on protected ${domain.domain} (${domain.constraint_id})`);
        violations.push({ code: domain.violation, constraint_id: domain.constraint_id, path: `$.action_claims[${i}]`, excerpt: `${claim.operation} ${claim.domain} ${claim.scope || 'GLOBAL'}` });
      }
    }
  }

  // Layer 2: required field values from structured CUSTOM constraints.
  // A structured CUSTOM whose domain has NO deterministic prose coverage and
  // NO required field values cannot be verified deterministically: without a
  // configured semantic adjudicator it must escalate, never silently pass.
  for (const domain of derived.domains) {
    if (domain.violation === VIOLATION_CODES.CUSTOM
      && !DOMAIN_OBJECTS[domain.domain]
      && !(domain.required_field_values || []).length
      && typeof context.semanticAdjudicator !== 'function') {
      errors.push(`${VIOLATION_CODES.CUSTOM_UNENFORCEABLE}: ${domain.constraint_id} protects ${domain.domain} with no deterministic prose coverage, no required field values, and no semantic adjudicator — compliance cannot be verified`);
      violations.push({ code: VIOLATION_CODES.CUSTOM_UNENFORCEABLE, constraint_id: domain.constraint_id, path: 'semantic', excerpt: domain.domain });
    }
    for (const requirement of domain.required_field_values || []) {
      const actual = readPath(direction, requirement.path);
      if (!requirement.one_of.includes(actual)) {
        errors.push(`${domain.violation}: ${requirement.path} is ${JSON.stringify(actual)} but the human constraint ${domain.constraint_id} requires one of ${JSON.stringify(requirement.one_of)}`);
        violations.push({ code: domain.violation, constraint_id: domain.constraint_id, path: requirement.path, excerpt: String(actual).slice(0, 120) });
      }
    }
  }

  // Layer 3: deterministic prose guards over model-authored strings.
  const prose = collectModelProse(direction);
  for (const hit of proseGuardHits(prose, derived.domains)) {
    errors.push(`${hit.code}: prose at ${hit.path} contradicts protected ${hit.domain} (${hit.constraint_id}): "${hit.excerpt}"`);
    violations.push(hit);
  }
  for (const hit of specialistBoundaryHits(prose)) {
    errors.push(`${hit.code}: ${hit.detector} in prose at ${hit.path}: "${hit.excerpt}" — specialist execution detail may not appear in creative direction`);
    violations.push(hit);
  }
  for (const hit of selfApprovalHits(prose)) {
    errors.push(`${hit.code}: approval claim in prose at ${hit.path}: "${hit.excerpt}" — model text can never carry approval authority`);
    violations.push(hit);
  }

  // Execution contract: prose is never executable.
  const contract = direction.execution_contract;
  if (!contract || contract.executable_surface !== 'action_claims'
    || contract.prose_classification !== 'NON_EXECUTABLE_CREATIVE_RATIONALE') {
    errors.push('execution_contract must declare action_claims as the sole executable surface and all prose as NON_EXECUTABLE_CREATIVE_RATIONALE');
  }

  // Taste fields (kept from v1).
  if (!norm(direction.creative_thesis?.statement) || !norm(direction.creative_thesis?.experience_goal)) errors.push('creative_thesis incomplete');
  if (!norm(direction.tone?.register) || !norm(direction.tone?.energy_arc)) errors.push('tone incomplete');
  if (!HUMOR_MODES.includes(direction.humor?.mode)) errors.push('humor.mode invalid');
  if (direction.humor && !PROVENANCES.includes(direction.humor.provenance)) errors.push('humor.provenance invalid');

  const mix = asArr(direction.visual_mode_mix);
  const mixModes = mix.map((m) => m.mode);
  if (mixModes.length !== VISUAL_FUNCTIONS.length || VISUAL_FUNCTIONS.some((f) => !mixModes.includes(f))) {
    errors.push('visual_mode_mix must weigh all six visual functions exactly once');
  }
  for (const m of mix) {
    if (!MODE_WEIGHTS.includes(m.weight)) errors.push(`visual_mode_mix ${m.mode} weight invalid`);
    if (m.weight !== 'ABSENT' && !norm(m.rationale)) errors.push(`visual_mode_mix ${m.mode} rationale required`);
  }

  const movements = asArr(direction.density_arc?.movements);
  if (!norm(direction.density_arc?.shape) || movements.length === 0) errors.push('density_arc incomplete');
  const sectionRefs = new Set(task.section_refs || []);
  for (const mv of movements) {
    if (!DENSITY_GROUPS.includes(mv.density_group)) errors.push(`density movement group invalid: ${mv.density_group}`);
    if (sectionRefs.size && !sectionRefs.has(mv.section_ref)) errors.push(`density movement references unknown section ${mv.section_ref}`);
  }

  for (const key of ['level_a_strategy', 'level_b_strategy', 'level_c_strategy', 'motion_character', 'typography_mode']) {
    if (!direction[key] || !Object.values(direction[key]).some((v) => norm(typeof v === 'string' ? v : ''))) errors.push(`${key} incomplete`);
  }

  const pp = direction.presenter_policy || {};
  if (!PRESENTER_MODES.includes(pp.draft_mode)) errors.push('presenter_policy.draft_mode invalid');
  if (pp.draft_mode === 'PRESENTER_FREE' && !norm(pp.compensation_directive)) {
    errors.push('PRESENTER_FREE requires a compensation_directive (P-02 continuous-visual-life equivalence)');
  }
  if (pp.provenance && !PROVENANCES.includes(pp.provenance)) errors.push('presenter_policy.provenance invalid');

  const cs = direction.card_strategy || {};
  if (!norm(cs.role)) errors.push('card_strategy.role required');
  for (const pat of asArr(cs.patterns_suggested)) if (!CARD_PATTERNS.includes(pat)) errors.push(`card pattern invalid: ${pat}`);
  for (const ref of asArr(cs.argument_sections_needing_cards)) {
    if (sectionRefs.size && !sectionRefs.has(ref)) errors.push(`card_strategy references unknown section ${ref}`);
  }

  if (!norm(direction.media_strategy?.generation_philosophy)) errors.push('media_strategy incomplete');
  if (!ENDING_MODES.includes(direction.ending_strategy?.mode)) errors.push('ending_strategy.mode invalid');
  if (direction.ending_strategy?.mode === 'EXPLICIT_DEVIATION'
    && !(direction.intentional_deviations || []).some((d) => d.pattern_ref === 'P-12')) {
    errors.push('ending EXPLICIT_DEVIATION requires an intentional_deviations entry citing P-12');
  }
  if (!norm(direction.coherence?.sound_music_intent) || !norm(direction.coherence?.packaging_intent)) errors.push('coherence intent incomplete');

  for (const d of asArr(direction.intentional_deviations)) {
    if (!PATTERN_REF_RE.test(d.pattern_ref || '')) errors.push(`deviation pattern_ref invalid: ${d.pattern_ref}`);
    if (!norm(d.deviation) || !norm(d.creative_reason)) errors.push('deviation requires statement and creative_reason');
    if (d.requires_human !== true) errors.push('deviations always require human approval (requires_human must be true)');
  }

  const escalations = asArr(direction.human_decisions_required);
  if (escalations.length > MAX_ESCALATIONS) errors.push(`over-escalation: at most ${MAX_ESCALATIONS} consequential human decisions`);
  for (const e of escalations) {
    if (!ESCALATION_TYPES.includes(e.type)) errors.push(`escalation type invalid: ${e.type}`);
    if (!norm(e.question) || !norm(e.why_consequential)) errors.push('escalation requires question and why_consequential');
  }

  for (const c of asArr(direction.confidence)) {
    if (!CONFIDENCE_LEVELS.includes(c.level) || !PROVENANCES.includes(c.basis) || !norm(c.aspect)) errors.push('confidence entry invalid');
  }
  for (const ref of asArr(direction.style_patterns_cited)) {
    if (!PATTERN_REF_RE.test(ref)) errors.push(`style pattern citation invalid: ${ref}`);
  }

  for (const arrField of ['visual_mode_mix', 'intentional_deviations', 'human_decisions_required', 'confidence', 'style_patterns_cited', 'action_claims', 'human_directions_received']) {
    if (direction[arrField] !== undefined && !Array.isArray(direction[arrField])) errors.push(`${arrField} must be an array`);
  }
  if (direction.density_arc && direction.density_arc.movements !== undefined && !Array.isArray(direction.density_arc.movements)) errors.push('density_arc.movements must be an array');
  if (direction.card_strategy && direction.card_strategy.argument_sections_needing_cards !== undefined && !Array.isArray(direction.card_strategy.argument_sections_needing_cards)) errors.push('card_strategy.argument_sections_needing_cards must be an array');
  errors.push(...forbiddenKeyHits(direction).map((p) => `forbidden key ${p} (specialist/human domain)`));
  errors.push(...proseTooLong(direction).map((p) => `prose too long at ${p}`));

  if (!SHA256_RE.test(direction.direction_digest_sha256 || '')) errors.push('direction_digest_sha256 missing');
  else if (directionDigest(direction) !== direction.direction_digest_sha256) errors.push('direction digest mismatch');

  // Layer 4: bounded semantic adjudicator — consulted ONLY when layers 1-3
  // passed; it may reject or declare ambiguity, never approve past a failure.
  if (errors.length === 0 && typeof context.semanticAdjudicator === 'function') {
    const verdict = context.semanticAdjudicator({ direction, protected_domains: derived.domains, prose });
    if (verdict?.verdict === 'REJECT') {
      const code = verdict.code && String(verdict.code).startsWith('HUMAN_') ? verdict.code : VIOLATION_CODES.CUSTOM;
      errors.push(`${code}: semantic adjudicator rejected: ${norm(verdict.reason) || 'no reason given'}`);
      violations.push({ code, path: 'semantic', excerpt: norm(verdict.reason).slice(0, 120) });
    } else if (verdict?.verdict === 'AMBIGUOUS' || (verdict && verdict.verdict !== 'PASS')) {
      errors.push(`HUMAN_CONSTRAINT_AMBIGUITY: semantic adjudicator could not establish compliance: ${norm(verdict.reason) || 'unspecified'}`);
      violations.push({ code: 'HUMAN_CONSTRAINT_AMBIGUITY', path: 'semantic', excerpt: norm(verdict.reason).slice(0, 120) });
    }
  }

  const ok = errors.length === 0;
  // Capability receipt: a fully-validated direction object is registered in a
  // module-private WeakSet. Downstream projection requires this membership, so
  // an arbitrary hand-built object (not produced by successful validation)
  // cannot be projected. Non-forgeable: the WeakSet is unreachable to callers.
  if (ok) VALIDATED_ARTIFACTS.add(direction);
  return { ok, errors, violations };
}

// Non-forgeable validated-artifact registry (see validateDirection).
const VALIDATED_ARTIFACTS = new WeakSet();
function isValidated(direction) { return VALIDATED_ARTIFACTS.has(direction); }

module.exports = {
  SCHEMA, ARTIFACT_TYPE,
  HUMOR_MODES, DENSITY_GROUPS, PRESENTER_MODES, ENDING_MODES, VISUAL_FUNCTIONS, MODE_WEIGHTS,
  CARD_PATTERNS, ESCALATION_TYPES, CONSTRAINT_TYPES, PROVENANCES, CONFIDENCE_LEVELS,
  SCRIPT_IDENTITY_KINDS, LIFECYCLE_STATES, MAX_ESCALATIONS, FORBIDDEN_KEYS,
  PROTECTED_DOMAIN_NAMES, OPERATIONS, VIOLATION_CODES, SPECIALIST_DETECTORS,
  sha256, newDirectionId, canonicalize, directionDigest, forbiddenKeyHits,
  deriveProtectedDomains, collectModelProse, proseGuardHits, specialistBoundaryHits, selfApprovalHits,
  validateDirection, isValidated,
};
