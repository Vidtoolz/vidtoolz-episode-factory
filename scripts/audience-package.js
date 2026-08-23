'use strict';
// CANONICAL AUDIENCE PACKAGE V1 — deterministic contract/helper for viewer-facing
// packaging (title candidates, thumbnail concepts, title-thumbnail pairs,
// viewer promise, description draft). Analogous in discipline to Visual Plan
// V1 but scoped to packaging.
//
// It is NOT: media generation authority (Generation Supervisor), visual spec
// authority (Visual Planning Director), final selection/approval authority
// (Mikko via publish-gate), Story authority, Research verdict authority.
//
// No LLM. Pure deterministic schema + validation + projections.

const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'audience-package';

function ulid(now = Date.now()) {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now, out = '';
  for (let i = 0; i < 10; i++) { out = ENCODING[time % 32] + out; time = Math.floor(time / 32); }
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) out += ENCODING[bytes[i] % 32];
  return out;
}

const TITLE_STRATEGIES = Object.freeze(['DIRECT_CLAIM', 'TENSION_QUESTION', 'CONTRAST_FRAME', 'SPECIFIC_NUMBER', 'MISTAKE_FRAME', 'REVELATION']);
const SYNERGY_CLASSES = Object.freeze(['STRONG_PAIR', 'DUPLICATIVE', 'CONTRADICTORY', 'DECEPTIVE_ASYMMETRY', 'UNRELATED']);
const PACKAGE_STATES = Object.freeze(['PREVIEW_ONLY', 'AWAITING_HUMAN_REVIEW', 'RETURN_TO_STORY', 'RETURN_TO_RESEARCH', 'NEEDS_HUMAN_DECISION', 'STALE']);
const PRESENTER_NEEDS = Object.freeze(['NONE', 'FACE_OPTIONAL', 'FACE_REQUIRED', 'EXPRESSION_REQUIRED']);

// Absolute-claim floor — reuses the doctrine from episode-model buildPackagingReview.
const ABSOLUTE_WORD_RE = /\b(best|only|always|never|guarantee|proven|official|newest|latest|fastest|cheapest|first|everyone|nobody|free)\b/i;
const THUMBNAIL_TEXT_MAX_CHARS = 24;

function findForbidden(value, forbidden, pathName = '$', hits = []) {
  if (!value || typeof value !== 'object') return hits;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) hits.push(`${pathName}.${key}`);
    findForbidden(child, forbidden, `${pathName}.${key}`, hits);
  }
  return hits;
}

function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}
function packageDigest(pkg) {
  const copy = { ...pkg };
  delete copy.package_digest_sha256;
  return sha256(canonicalize(copy));
}

// ── validation ───────────────────────────────────────────────────────────────
// options:
//   currentStory { project_id, version_id, content_hash } → drift check
//   researchAuthorityByBinding { bindingId → { result_state, recommendation, authorization_ok } }
//   finalContentRefCheck { artifact_id, digest_sha256 }    → final revalidation
const FORBIDDEN_MODEL_FIELDS = new Set(['selected', 'final_title', 'final_thumbnail', 'approved', 'approval',
  'route', 'routing', 'backend', 'host', 'model', 'endpoint', 'engine', 'workflow',
  'heading', 'pitch', 'tilt', 'orbit', 'easing', 'keyframes', 'trajectory', 'path',
  'image_prompt', 'generation_prompt', 'episode_identity', 'master_metaphor', 'global_style']);

function validatePackage(pkg, options = {}) {
  const errors = [];
  const add = (e) => errors.push(e);
  if (!pkg || typeof pkg !== 'object') return { ok: false, stale: false, errors: ['package is not an object'] };

  if (pkg.schema_version !== SCHEMA_VERSION) add(`schema_version must be ${SCHEMA_VERSION}`);
  if (pkg.artifact_type !== ARTIFACT_TYPE) add(`artifact_type must be "${ARTIFACT_TYPE}"`);
  if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(pkg.package_plan_id || '')) add('package_plan_id malformed (ULID expected)');
  if (!Number.isInteger(pkg.package_revision) || pkg.package_revision < 1) add('package_revision must be positive integer');
  if (!pkg.created_at || Number.isNaN(Date.parse(pkg.created_at))) add('created_at invalid');
  if (!pkg.created_by) add('created_by missing');
  if (!PACKAGE_STATES.includes(pkg.state)) add(`state must be one of ${PACKAGE_STATES.join('|')}`);
  if (pkg.package_digest_sha256 && !/^[a-f0-9]{64}$/.test(pkg.package_digest_sha256)) add('package_digest_sha256 must be sha256');
  if (pkg.supersedes != null && !/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(pkg.supersedes)) add('supersedes malformed');

  // source binding
  const story = pkg.source?.story_ref || {};
  if (!story.project_id || !story.version_id || !/^[a-f0-9]{64}$/.test(story.content_hash || '')) add('source.story_ref incomplete');
  if (story.approval_state != null && !['draft', 'approved'].includes(story.approval_state)) add('source.story_ref.approval_state invalid');
  if (pkg.source?.final_content_ref) {
    const fc = pkg.source.final_content_ref;
    if (!fc.artifact_id || !/^[a-f0-9]{64}$/.test(fc.digest_sha256 || '')) add('source.final_content_ref requires artifact_id + digest_sha256');
  }

  // boundary enforcement — no authority-bearing fields anywhere
  for (const hit of findForbidden(pkg, FORBIDDEN_MODEL_FIELDS)) add(`forbidden field owned by another authority: ${hit}`);

  // audience + promise
  const audience = pkg.audience || {};
  if (!String(audience.target_viewer || '').trim()) add('audience.target_viewer required');
  if (!String(audience.viewer_problem || '').trim()) add('audience.viewer_problem required');
  const promise = pkg.viewer_promise || {};
  if (!String(promise.statement || '').trim()) add('viewer_promise.statement required');
  if (!promise.curiosity_gap || !String(promise.curiosity_gap).trim()) add('viewer_promise.curiosity_gap required');
  if (!promise.expected_payoff || !String(promise.expected_payoff).trim()) add('viewer_promise.expected_payoff required');

  // title candidates
  const titles = Array.isArray(pkg.title_candidates) ? pkg.title_candidates : [];
  if (titles.length < 3) add('at least 3 title_candidates required (packaging-gate doctrine)');
  const seenTitleIds = new Set(); const seenTexts = new Set();
  for (const [i, t] of titles.entries()) {
    const w = `title_candidates[${i}]`;
    if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(t.title_candidate_id || '')) add(`${w}.title_candidate_id malformed`);
    else if (seenTitleIds.has(t.title_candidate_id)) add(`${w}: duplicate title_candidate_id`);
    seenTitleIds.add(t.title_candidate_id);
    if (!t.text || !String(t.text).trim()) add(`${w}.text empty`);
    else {
      if (seenTexts.has(t.text.toLowerCase())) add(`${w}: duplicate title text`);
      seenTexts.add(t.text.toLowerCase());
      if (String(t.text).length > 100) add(`${w}.text exceeds 100 chars`);
    }
    if (!TITLE_STRATEGIES.includes(t.strategy)) add(`${w}.strategy invalid`);
    if (!t.promise || !String(t.promise).trim()) add(`${w}.promise required`);
    for (const ref of t.research_refs || []) {
      if (!ref.binding_id || !ref.claim_ref?.canonical_id) add(`${w}: research_ref requires binding_id + claim_ref.canonical_id`);
    }
  }

  // thumbnail candidates
  const thumbs = Array.isArray(pkg.thumbnail_candidates) ? pkg.thumbnail_candidates : [];
  if (thumbs.length < 2) add('at least 2 thumbnail_candidates required');
  const seenThumbIds = new Set();
  for (const [i, c] of thumbs.entries()) {
    const w = `thumbnail_candidates[${i}]`;
    if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(c.thumbnail_candidate_id || '')) add(`${w}.thumbnail_candidate_id malformed`);
    else if (seenThumbIds.has(c.thumbnail_candidate_id)) add(`${w}: duplicate thumbnail_candidate_id`);
    seenThumbIds.add(c.thumbnail_candidate_id);
    if (!c.communication_goal || !String(c.communication_goal).trim()) add(`${w}.communication_goal required`);
    if (!c.primary_subject || !String(c.primary_subject).trim()) add(`${w}.primary_subject required`);
    if (!PRESENTER_NEEDS.includes(c.presenter_need)) add(`${w}.presenter_need invalid`);
    if (c.optional_text != null) {
      if (typeof c.optional_text !== 'string') add(`${w}.optional_text must be string`);
      else if (c.optional_text.length > THUMBNAIL_TEXT_MAX_CHARS) add(`${w}.optional_text exceeds ${THUMBNAIL_TEXT_MAX_CHARS} chars`);
      else if (ABSOLUTE_WORD_RE.test(c.optional_text) && !(c.research_sensitive && Array.isArray(c.research_binding_ids) && c.research_binding_ids.length))
        add(`${w}.optional_text contains factual/absolute wording without Research authorization`);
    }
    // thumbnail concepts must not contain executable prompts
    for (const key of Object.keys(c)) {
      if (/prompt/i.test(key)) add(`${w}.${key} is Visual Planning authority — packaging carries concepts only`);
    }
  }

  // pair candidates
  const pairs = Array.isArray(pkg.pair_candidates) ? pkg.pair_candidates : [];
  if (!pairs.length) add('at least 1 pair_candidate required');
  const seenPairIds = new Set();
  for (const [i, p] of pairs.entries()) {
    const w = `pair_candidates[${i}]`;
    if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(p.pair_candidate_id || '')) add(`${w}.pair_candidate_id malformed`);
    else if (seenPairIds.has(p.pair_candidate_id)) add(`${w}: duplicate pair_candidate_id`);
    seenPairIds.add(p.pair_candidate_id);
    if (!seenTitleIds.has(p.title_candidate_id)) add(`${w}: title ref unknown`);
    if (!seenThumbIds.has(p.thumbnail_candidate_id)) add(`${w}: thumbnail ref unknown`);
    if (!SYNERGY_CLASSES.includes(p.synergy)) add(`${w}.synergy invalid`);
    if (!Number.isInteger(p.recommendation_rank) || p.recommendation_rank < 1) add(`${w}.recommendation_rank invalid`);
  }
  const ranks = pairs.map((p) => p.recommendation_rank);
  if (new Set(ranks).size !== ranks.length) add('duplicate recommendation_rank values');

  // description draft bounds
  if (pkg.description_draft != null && (typeof pkg.description_draft !== 'string' || pkg.description_draft.length > 2000)) {
    add('description_draft must be a string ≤2000 chars');
  }

  // research authority
  const authorities = options.researchAuthorityByBinding || {};
  const usedBindings = new Set();
  for (const c of [...titles, ...thumbs]) for (const r of c.research_refs || []) usedBindings.add(r.binding_id);
  for (const bindingId of usedBindings) {
    const a = authorities[bindingId];
    if (!a) continue; // authority not supplied at this stage — structural refs already validated
    if (a.result_state !== 'VALID') add(`research binding ${bindingId}: result_state ${a.result_state}`);
    else if (a.authorization_ok !== true) add(`research binding ${bindingId}: not authorized (${a.recommendation || 'UNAUTHORIZED'})`);
  }

  // drift
  let stale = false;
  if (options.currentStory) {
    const cs = options.currentStory;
    if (story.version_id !== cs.version_id) { add(`plan bound to version ${story.version_id}, current is ${cs.version_id}`); stale = true; }
    else if (story.content_hash !== cs.content_hash) { add('Story content hash changed since package creation'); stale = true; }
  }

  // final-content revalidation
  if (options.finalContentRefCheck && pkg.source?.final_content_ref) {
    const want = options.finalContentRefCheck;
    const got = pkg.source.final_content_ref;
    if (got.artifact_id !== want.artifact_id || got.digest_sha256 !== want.digest_sha256) {
      add('FINAL_CONTENT_CHANGED: final content identity differs from packaged identity');
    }
  }

  return { ok: errors.length === 0, stale, errors };
}

// ── review projection ────────────────────────────────────────────────────────
function buildReviewBundle(pkg, validation = {}) {
  const titles = pkg.title_candidates || [];
  const thumbs = pkg.thumbnail_candidates || [];
  const topPair = [...(pkg.pair_candidates || [])].sort((a, b) => a.recommendation_rank - b.recommendation_rank)[0] || null;
  const byId = (arr, idField) => new Map(arr.map((x) => [x[idField], x]));
  const tm = byId(titles, 'title_candidate_id'); const cm = byId(thumbs, 'thumbnail_candidate_id');
  return {
    artifact_type: ARTIFACT_TYPE, package_plan_id: pkg.package_plan_id,
    package_revision: pkg.package_revision, state: pkg.state,
    source: pkg.source, audience: pkg.audience, viewer_promise: pkg.viewer_promise,
    totals: {
      titles: titles.length, thumbnails: thumbs.length, pairs: (pkg.pair_candidates || []).length,
      research_sensitive_titles: titles.filter((t) => t.research_sensitive).length,
      research_sensitive_thumbnails: thumbs.filter((c) => c.research_sensitive).length,
    },
    top_recommendation: topPair ? {
      pair_candidate_id: topPair.pair_candidate_id, synergy: topPair.synergy,
      rank: topPair.recommendation_rank,
      title: tm.get(topPair.title_candidate_id)?.text || null,
      thumbnail_goal: cm.get(topPair.thumbnail_candidate_id)?.communication_goal || null,
      rationale: topPair.rationale || null,
    } : null,
    pairs: (pkg.pair_candidates || []).map((p) => ({
      rank: p.recommendation_rank, synergy: p.synergy,
      title_text: tm.get(p.title_candidate_id)?.text || null,
      thumbnail_goal: cm.get(p.thumbnail_candidate_id)?.communication_goal || null,
      duplication_risk: p.duplication_risk || null, contradiction_risk: p.contradiction_risk || null,
    })),
    human_attention: {
      items: pkg.human_attention || [],
      note: 'Final title, thumbnail and pairing selection belong to Mikko. Ranking is advisory only.',
    },
    description_draft: pkg.description_draft || null,
    validation: { ok: validation.ok, stale: validation.stale, errors: (validation.errors || []).slice(0, 10) },
  };
}

function renderMarkdown(bundle) {
  const lines = [`# Audience Package Review — ${bundle.package_plan_id} (rev ${bundle.package_revision})`, '',
    `- State: ${bundle.state}`, `- Viewer: ${bundle.audience?.target_viewer || '?'}`, `- Promise: ${bundle.viewer_promise?.statement || '?'}`, '',
    `Titles: ${bundle.totals.titles}; thumbnails: ${bundle.totals.thumbnails}; pairs: ${bundle.totals.pairs}; Research-sensitive: ${bundle.totals.research_sensitive_titles + bundle.totals.research_sensitive_thumbnails}`, '',
    '| Rank | Synergy | Title | Thumbnail goal |', '|---|---|---|---|'];
  for (const p of bundle.pairs) lines.push(`| ${p.rank} | ${p.synergy} | ${p.title_text || ''} | ${p.thumbnail_goal || ''} |`);
  lines.push('', '_Ranking is advisory. Final selection: Mikko._');
  return lines.join('\n');
}

module.exports = {
  SCHEMA_VERSION, ARTIFACT_TYPE, TITLE_STRATEGIES, SYNERGY_CLASSES, PACKAGE_STATES,
  PRESENTER_NEEDS, ABSOLUTE_WORD_RE, THUMBNAIL_TEXT_MAX_CHARS, FORBIDDEN_MODEL_FIELDS,
  ulid, sha256, canonicalize, packageDigest, validatePackage, buildReviewBundle, renderMarkdown,
  newPackageId: () => ulid(), newCandidateId: () => ulid(),
};
