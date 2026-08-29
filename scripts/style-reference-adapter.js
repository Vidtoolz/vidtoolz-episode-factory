'use strict';

/*
 * style-reference-adapter.js
 *
 * Read-only consumption adapter for the human-approved VIDTOOLZ style
 * reference (schema vidtoolz.styleReference.v1, e.g. VIDTOOLZ_STYLE_REFERENCE_V1).
 *
 * Authority model (config/style-reference-contract.json is the contract):
 *   - The style reference is HUMAN_STYLE_REFERENCE authority (rank 3):
 *     an ENVELOPE, never a template. It sits BELOW live human decisions
 *     (rank 1) and episode-specific direction (rank 2), ABOVE agent taste.
 *   - Everything this module produces is ADVISORY. Findings are evidence
 *     (REFERENCE_MATCH / REFERENCE_WARNING / REFERENCE_OUTLIER, action
 *     "review" at most). Output never carries a disposition, a gate
 *     verdict, or any blocking field, and no caller may branch production
 *     behavior on it (ADVISORY FIREWALL).
 *   - All envelope numbers are READ from the reference artifact at load
 *     time. This module hard-codes no band values; evaluator tuning
 *     parameters live in the contract file with provenance.
 *
 * This module deliberately has no CLI and no AGENT_ID: it is a library,
 * never a 13th agent (config/agent-contract.json lifecycle_classification
 * forbids validator-shaped registry entries).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADAPTER_SCHEMA = 'vidtoolz.styleReferenceContext.v1';
const REFERENCE_SCHEMA = 'vidtoolz.styleReference.v1';
const CONTRACT_PATH = path.join(__dirname, '..', 'config', 'style-reference-contract.json');

const AUTHORITY_TIER = 'HUMAN_STYLE_REFERENCE';
const AUTHORITY_RANK = 3;

const ADVISORY_PREAMBLE =
  'STYLE REFERENCE (ADVISORY, rank 3 HUMAN_STYLE_REFERENCE): envelope, not template. ' +
  'Episode-specific direction and recorded human KEEP/CHANGE decisions outrank this reference. ' +
  'Deviation with an explicitly stated creative reason is always legal (P-01). ' +
  'Never restate this reference as your own output; cite principle/pattern ids.';

const VERDICTS = Object.freeze(['REFERENCE_MATCH', 'REFERENCE_WARNING', 'REFERENCE_OUTLIER']);
const FINDING_STATUSES = Object.freeze(['ACTIVE', 'DEVIATION_ACKNOWLEDGED', 'INFORMATIONAL_ONLY']);

// Level-C treatment classes considered "alive". STATIC is legal only with a
// reading-work justification or an explicit creative reason.
const ACTIVE_LEVEL_C_CLASSES = Object.freeze([
  'SLOW_SCALE', 'SLOW_PAN', 'PUSH_IN', 'DRIFT', 'PROXY_MOTION', 'GRAPHIC_EVOLUTION', 'LIVE_PRESENTER',
]);

/*
 * LEVEL-B EVENT CONTRACT (2026-08-28 authority repair).
 * LEVEL B means MEANINGFUL VISUAL EVENT — a semantic state change — never a
 * bare frame difference, never a cut for its own sake, never codec noise.
 * Events are admitted ONLY through these classes; a HARD_CUT is meaningful
 * ONLY when it declares semantic_change: true; measurement noise classes are
 * NEVER admissible; an unknown kind fails closed instead of counting.
 */
const MEANINGFUL_EVENT_CLASSES = Object.freeze([
  'NEW_EXPLANATORY_ELEMENT', 'COMPOSITION_CHANGE', 'CARD_STATE_CHANGE', 'LABEL_REVEAL',
  'REFRAME', 'MEANINGFUL_REFRAME', 'PUSH_IN_ONSET', 'NEW_VISUAL_RELATIONSHIP', 'GRAPHIC_ACCUMULATION',
  'SEMANTIC_TRANSITION', 'PRESENTER_TIER_CHANGE', 'HARD_CUT',
  'COMPARISON_COLUMN_REVEAL', 'NUMBERED_ITEM_REVEAL',
]);
const EVENT_KIND_ALIASES = Object.freeze({
  card_evolution: 'CARD_STATE_CHANGE',
  reframe: 'REFRAME',
  meaningful_reframe: 'MEANINGFUL_REFRAME',
  push_in: 'PUSH_IN_ONSET',
  push_in_onset: 'PUSH_IN_ONSET',
  beat_transition: 'SEMANTIC_TRANSITION',
  cut: 'HARD_CUT',
  hard_cut: 'HARD_CUT',
  label_reveal: 'LABEL_REVEAL',
  comparison_column_reveal: 'COMPARISON_COLUMN_REVEAL',
  numbered_item_reveal: 'NUMBERED_ITEM_REVEAL',
  presenter_tier_change: 'PRESENTER_TIER_CHANGE',
});

/*
 * BOUNDARY REDESIGN (mission §15-18) — LEVEL-B EVENT TYPE → EVIDENCE CONTRACT.
 * A planned Level-B event is a SEMANTIC claim; confirming it requires evidence
 * of the EXPECTED SEMANTIC MANIFESTATION, never mere pixel activity near its
 * timestamp. Each type declares the manifestation kind that would prove it, and
 * whether that manifestation is targeted (must name the same label/column/item).
 */
const LEVEL_B_EVENT_TYPES = Object.freeze({
  LABEL_REVEAL: { expected_manifestation: 'LABEL_PRESENT', targeted: true, target_key: 'label' },
  COMPARISON_COLUMN_REVEAL: { expected_manifestation: 'COLUMN_PRESENT', targeted: true, target_key: 'column' },
  NUMBERED_ITEM_REVEAL: { expected_manifestation: 'ITEM_PRESENT', targeted: true, target_key: 'item' },
  CARD_STATE_CHANGE: { expected_manifestation: 'CARD_STATE_PRESENT', targeted: true, target_key: 'state' },
  NEW_EXPLANATORY_ELEMENT: { expected_manifestation: 'ELEMENT_PRESENT', targeted: true, target_key: 'element' },
  GRAPHIC_ACCUMULATION: { expected_manifestation: 'ELEMENT_PRESENT', targeted: false },
  NEW_VISUAL_RELATIONSHIP: { expected_manifestation: 'RELATIONSHIP_PRESENT', targeted: false },
  REFRAME: { expected_manifestation: 'REFRAMED_TARGET_VISIBLE', targeted: true, target_key: 'target' },
  MEANINGFUL_REFRAME: { expected_manifestation: 'REFRAMED_TARGET_VISIBLE', targeted: true, target_key: 'target' },
  PUSH_IN_ONSET: { expected_manifestation: 'PUSH_IN_ONSET_VISIBLE', targeted: false },
  COMPOSITION_CHANGE: { expected_manifestation: 'COMPOSITION_CHANGED', targeted: false },
  SEMANTIC_TRANSITION: { expected_manifestation: 'SEMANTIC_STATE_CHANGED', targeted: false },
  PRESENTER_TIER_CHANGE: { expected_manifestation: 'PRESENTER_TIER_CHANGED', targeted: false },
  HARD_CUT: { expected_manifestation: 'SEMANTIC_STATE_CHANGED', targeted: false },
});

function manifestationMatches(plan, manifestation) {
  const type = LEVEL_B_EVENT_TYPES[plan.kind];
  if (!type || !manifestation || typeof manifestation !== 'object') return false;
  if (String(manifestation.kind || '').toUpperCase() !== type.expected_manifestation) return false;
  if (type.targeted) {
    const want = plan[type.target_key] ?? plan.target ?? null;
    const got = manifestation.target ?? manifestation[type.target_key] ?? null;
    if (want != null && String(got) !== String(want)) return false;
  }
  return true;
}
const NEVER_MEANINGFUL_EVENT_CLASSES = Object.freeze([
  'ENCODER_DRIFT', 'ENCODER_NOISE', 'COMPRESSION_NOISE', 'FRAME_NOISE', 'CODEC_NOISE', 'MEASUREMENT_CANDIDATE',
]);
// Legitimate declarations of continuous motion: these belong to LEVEL C and
// are silently non-counting as Level-B events (not an error — the caller is
// stating a fact about motion, not claiming a meaningful event).
const CONTINUOUS_MOTION_NON_EVENT_CLASSES = Object.freeze([
  'DRIFT', 'CONTINUOUS_MOTION', 'SLOW_PAN', 'SLOW_SCALE', 'PAN', 'ZOOM', 'PUSH_IN_CONTINUATION',
]);

function normalizeEventKind(kind) {
  const upper = String(kind || '').toUpperCase();
  if (MEANINGFUL_EVENT_CLASSES.includes(upper)) return upper;
  const alias = EVENT_KIND_ALIASES[String(kind || '').toLowerCase()];
  return alias || null;
}

/*
 * Admit semantic Level-B events from a caller-supplied list. Fail-closed:
 * unknown kinds and never-meaningful classes are ERRORS, not silent counts;
 * HARD_CUT admits only with semantic_change === true; an explicit
 * meaningful:false demotes any event to non-counting.
 */
function admitSemanticEvents(events) {
  const admitted = [];
  const errors = [];
  for (const [index, event] of (events || []).entries()) {
    const rawKind = String(event?.kind ?? '');
    if (NEVER_MEANINGFUL_EVENT_CLASSES.includes(rawKind.toUpperCase())) {
      if (event?.meaningful === true) errors.push(`STYLE_EVENT_CLASS_INADMISSIBLE: b_events[${index}] claims ${rawKind} as meaningful — measurement noise is never a Level-B event`);
      continue; // never counted, with or without the claim
    }
    if (CONTINUOUS_MOTION_NON_EVENT_CLASSES.includes(rawKind.toUpperCase())) {
      if (event?.semantic_change === true) { admitted.push({ ...event, kind: 'SEMANTIC_TRANSITION' }); }
      continue; // continuous motion is Level C unless it crosses a semantic boundary
    }
    const kind = normalizeEventKind(rawKind);
    if (!kind) { errors.push(`STYLE_EVENT_CLASS_UNKNOWN: b_events[${index}] kind ${rawKind || '(missing)'} is not an admissible meaningful-event class`); continue; }
    if (event?.meaningful === false) continue;
    if (kind === 'HARD_CUT' && event?.semantic_change !== true) continue; // a cut is only Level B when it changes the visual state meaningfully
    admitted.push({ ...event, kind });
  }
  return { admitted, errors };
}

// A PIXEL_SIGNAL candidate that represents a real, non-noise visual change and
// could therefore support a planned semantic manifestation. Noise classes and
// pure continuous motion can NEVER support a Level-B confirmation.
const CONFIRMING_SIGNAL_CLASSES = Object.freeze([
  'VISUAL_CHANGE', 'FRAME_CHANGE', 'COMPOSITION_CHANGE', 'HARD_CUT', 'CONTENT_CHANGE', 'REVEAL', 'STATE_CHANGE',
]);
function isConfirmingSignal(candidate) {
  const kind = String(candidate?.kind || '').toUpperCase();
  if (NEVER_MEANINGFUL_EVENT_CLASSES.includes(kind)) return false; // encoder/compression/frame noise never confirms
  if (CONTINUOUS_MOTION_NON_EVENT_CLASSES.includes(kind)) return false; // motion is Level C, cannot alone confirm B
  if (CONFIRMING_SIGNAL_CLASSES.includes(kind)) return true;
  // A candidate carrying an admissible semantic class is also a valid support.
  return normalizeEventKind(kind) !== null;
}

/*
 * REFERENCE-ONLY SEMANTIC EVIDENCE (mission §23-27). Semantic Level-B evidence
 * is NOT a caller-supplied object. QC passes render_run_id / classifier_run_id
 * (opaque ids); this module RESOLVES the append-only records from the PINNED
 * renderer/classifier evidence stores. A caller cannot fabricate a manifestation,
 * a renderer receipt, or a classifier verdict — pixel candidates are MEASUREMENT
 * ONLY and can never mint semantic meaning.
 */
const PINNED_RENDERER_EVENT_STORE = '/home/vidtoolz/vidtoolz-episode-factory/renderer-event-store';
const PINNED_CLASSIFIER_EVIDENCE_STORE = '/home/vidtoolz/vidtoolz-episode-factory/classifier-evidence-store';
const RUN_ID_RE = /^[A-Za-z0-9_.-]{3,120}$/;
const HEX64_RE = /^[a-f0-9]{64}$/i;

// GAP REPAIR (Codex EVIDENCE-WRITE-AUTHORITY + RUN-ID-CROSS-PROCESS):
// Semantic-evidence authority is created ONLY by a trusted writer, and is bound
// DURABLY on disk (cross-process) — not by a self-asserted identity string and
// not by whatever a process happened to read first.
//   - The trusted writer (recordRendererEvidence / recordClassifierEvidence) is
//     the only path that creates a run's authority. It writes the evidence AND an
//     append-only <run_id>.manifest.json binding run_id -> evidence_digest at
//     WRITE time, refusing to rebind an existing run id.
//   - A reader REQUIRES the durable manifest (a caller-written raw file has none
//     -> no authority), and on EVERY read recomputes the evidence digest and
//     requires exact equality with the manifest (a rewrite under the same id, in
//     any process, is rejected). Producer identity/media are taken from the
//     manifest, so copying an approved name into a raw file grants nothing.
const EVIDENCE_MANIFEST_SCHEMA = 'vidtoolz.semanticEvidenceManifest.v1';

function canonicalizeJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function evidenceDigest(doc) {
  return sha256(canonicalizeJson({ identity: doc?.renderer_identity ?? doc?.classifier_identity ?? null, media_sha256: doc?.media_sha256 ?? null, records: doc?.records ?? [] }));
}
function atomicWriteJson(filePath, obj) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, filePath);
}
function evidenceRoot(envVar, pinnedDefault) {
  const raw = (process.env[envVar] && process.env[envVar].trim()) ? process.env[envVar].trim() : pinnedDefault;
  return path.resolve(raw);
}

/*
 * INTERNAL TRUSTED EVIDENCE WRITER (Codex 58847dc Finding 2 closure).
 * MODULE-PRIVATE and NOT EXPORTED: there is no public function that accepts a
 * caller-selected producer identity (or caller-composed records) and writes
 * canonical semantic evidence. The ONLY invokers are the canonical execution
 * runtimes below (requestRendererExecution / requestClassifierExecution), which
 * derive identity, media hash, and records from the execution THEY perform —
 * never from caller assertions. It stamps producer identity + media binding and
 * records a durable append-only manifest. A second write to the same run id is
 * refused (RUN_ID_ALREADY_BOUND) — authority history is append-only.
 */
function writeEvidence(kind, envVar, pinnedDefault, runId, execution) {
  const id = String(runId || '').trim();
  if (!RUN_ID_RE.test(id)) throw new StyleReferenceError('SEMANTIC_EVIDENCE_ID_INVALID', `${kind} run id is malformed: ${id}`);
  const identity = String(execution?.identity || '').trim();
  if (!identity) throw new StyleReferenceError('SEMANTIC_EVIDENCE_WRITER_IDENTITY_REQUIRED', `${kind} internal writer invariant: execution identity missing`);
  const media = String(execution?.media || '').trim().toLowerCase();
  if (!HEX64_RE.test(media)) throw new StyleReferenceError('SEMANTIC_EVIDENCE_WRITER_MEDIA_REQUIRED', `${kind} internal writer invariant: media digest missing`);
  const records = Array.isArray(execution?.records) ? execution.records : null;
  if (!records || !records.length) throw new StyleReferenceError('SEMANTIC_EVIDENCE_WRITER_RECORDS_REQUIRED', `${kind} internal writer invariant: execution records missing`);
  const root = evidenceRoot(envVar, pinnedDefault);
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  const file = path.join(realRoot, `${id}.json`);
  const manifestFile = path.join(realRoot, `${id}.manifest.json`);
  if (path.dirname(file) !== realRoot) throw new StyleReferenceError('SEMANTIC_EVIDENCE_PATH_ESCAPE', `${kind} evidence path escapes the pinned store`);
  if (fs.existsSync(manifestFile)) throw new StyleReferenceError('SEMANTIC_EVIDENCE_RUN_ID_ALREADY_BOUND', `${kind} run ${id} is already bound; authority evidence is append-only (use a new run id)`);
  const idKey = kind === 'renderer' ? 'renderer_identity' : 'classifier_identity';
  const doc = { [idKey]: identity, media_sha256: media, records };
  const digest = evidenceDigest(doc);
  // Evidence first (no authority without the manifest), then the manifest gate.
  atomicWriteJson(file, doc);
  atomicWriteJson(manifestFile, { schema: EVIDENCE_MANIFEST_SCHEMA, kind, run_id: id, evidence_digest: digest, media_sha256: media, producer_execution_identity: identity, created_at: new Date().toISOString() });
  return { run_id: id, evidence_digest: digest, manifest_path: manifestFile };
}

/*
 * TRUSTED PRODUCER IDENTITY (mission §18): producer/classifier identity is
 * DERIVED from the execution runtime's own trusted deployment configuration —
 * NEVER accepted as a caller argument. A deployment that hosts no renderer or
 * classifier execution leaves the identity unconfigured, and that deployment
 * therefore CANNOT create semantic evidence authority at all (fail closed).
 */
function executionIdentity(kind, envVar) {
  const raw = process.env[envVar];
  if (!raw || !raw.trim()) {
    throw new StyleReferenceError('SEMANTIC_EVIDENCE_EXECUTION_IDENTITY_UNCONFIGURED',
      `${kind} execution identity is not configured in this deployment (${envVar}); this process hosts no trusted ${kind} execution and cannot create ${kind} evidence authority`);
  }
  return raw.trim();
}

// Caller-supplied authority assertions are refused loudly, never absorbed: a
// request may name WHAT to execute, never what the execution's evidence says.
const AUTHORITY_ASSERTION_KEYS = Object.freeze([
  'producer_execution_identity', 'renderer_identity', 'classifier_identity', 'producer', 'identity',
  'media_sha256', 'records', 'manifested', 'confirmed', 'manifestation', 'evidence_digest',
]);
function rejectAuthorityAssertions(kind, label, value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (AUTHORITY_ASSERTION_KEYS.includes(key)) {
      throw new StyleReferenceError('SEMANTIC_EVIDENCE_AUTHORITY_FIELD_REJECTED',
        `${kind} execution request ${label} carries authority field '${key}' — producer identity, media hashes, verdicts, and evidence records are derived by the trusted execution, never accepted from a caller`);
    }
  }
}

const HERMETIC_ARTIFACT_SCHEMA = 'vidtoolz.hermeticRenderArtifact.v1';

/*
 * PUBLIC REQUEST — requestRendererExecution(runId, renderPlan, options).
 * The canonical (hermetic, bounded) renderer runtime. The caller REQUESTS a
 * render of typed semantic events; the runtime EXECUTES it: renders the
 * deterministic artifact itself, hashes the bytes IT produced, derives the
 * semantic event records from what IT rendered, stamps its OWN configured
 * execution identity (VIDTOOLZ_RENDERER_EXECUTION_IDENTITY), and writes
 * evidence through the module-private trusted writer. The caller cannot pass a
 * producer identity, a media hash, a manifested flag, or an evidence record —
 * such fields are rejected, not ignored. Evidence created here binds ONLY the
 * artifact this runtime actually produced (its media_sha256), so it can never
 * confirm events on any other media.
 */
function requestRendererExecution(runId, renderPlan, options = {}) {
  const identity = executionIdentity('renderer', 'VIDTOOLZ_RENDERER_EXECUTION_IDENTITY');
  rejectAuthorityAssertions('renderer', 'plan', renderPlan);
  const events = Array.isArray(renderPlan?.events) ? renderPlan.events : null;
  if (!events || !events.length) throw new StyleReferenceError('HERMETIC_RENDER_PLAN_INVALID', 'renderPlan.events must be a non-empty array of typed semantic events');
  const rendered = [];
  for (const [index, event] of events.entries()) {
    rejectAuthorityAssertions('renderer', `plan.events[${index}]`, event);
    const eventId = String(event?.event_id || '').trim();
    if (!eventId) throw new StyleReferenceError('HERMETIC_RENDER_PLAN_INVALID', `plan.events[${index}] lacks event_id`);
    const kind = normalizeEventKind(event?.kind);
    const type = kind ? LEVEL_B_EVENT_TYPES[kind] : null;
    if (!type) throw new StyleReferenceError('HERMETIC_RENDER_UNSUPPORTED_EVENT', `plan.events[${index}] kind ${event?.kind || '(missing)'} is not a renderable semantic event type`);
    const manifestation = { kind: type.expected_manifestation };
    if (type.targeted) {
      const target = event[type.target_key] ?? event.target ?? null;
      if (target == null || String(target).trim() === '') throw new StyleReferenceError('HERMETIC_RENDER_UNSUPPORTED_EVENT', `plan.events[${index}] (${kind}) is targeted but names no ${type.target_key}`);
      manifestation.target = String(target);
    }
    rendered.push({ event_id: eventId, event_type: kind, manifestation });
  }
  // EXECUTE: the runtime renders the deterministic artifact and hashes the
  // bytes it wrote — the media binding is a fact about ITS output.
  const artifact = { schema: HERMETIC_ARTIFACT_SCHEMA, run_id: String(runId || '').trim(), rendered_events: rendered };
  const bytes = Buffer.from(canonicalizeJson(artifact));
  const workDir = options.workDir ? path.resolve(options.workDir) : fs.mkdtempSync(path.join(os.tmpdir(), 'vidtoolz-hermetic-render-'));
  fs.mkdirSync(workDir, { recursive: true });
  const artifactPath = path.join(workDir, `${artifact.run_id || 'render'}.render.json`);
  fs.writeFileSync(artifactPath, bytes);
  const media = sha256(bytes);
  const records = rendered.map((r) => ({ event_id: r.event_id, event_type: r.event_type, manifested: true, manifestation: r.manifestation }));
  const receipt = writeEvidence('renderer', 'VIDTOOLZ_RENDERER_EVENT_STORE', PINNED_RENDERER_EVENT_STORE, runId, { identity, media, records });
  // Metadata REPORTS the derived identity; the caller never chose it.
  return { ...receipt, media_sha256: media, artifact_path: artifactPath, producer_execution_identity: identity };
}

/*
 * PUBLIC REQUEST — requestClassifierExecution(runId, request, options).
 * The approved (hermetic, bounded) classifier runtime. The caller REQUESTS a
 * classification of planned semantic events against a media file; the runtime
 * EXAMINES the media itself: reads and hashes the bytes, and confirms a planned
 * event ONLY when the media (a hermetic render artifact it can actually
 * understand) contains the expected semantic manifestation. Verdicts, identity
 * (VIDTOOLZ_CLASSIFIER_EXECUTION_IDENTITY), and the media hash are all derived
 * by the runtime; caller-supplied verdict/identity/hash fields are rejected.
 * Media this bounded classifier cannot understand fails closed — it never
 * guesses and it never takes the caller's word.
 */
function requestClassifierExecution(runId, request, options = {}) {
  void options;
  const identity = executionIdentity('classifier', 'VIDTOOLZ_CLASSIFIER_EXECUTION_IDENTITY');
  rejectAuthorityAssertions('classifier', 'request', request);
  const mediaPath = String(request?.mediaPath || '').trim();
  if (!mediaPath) throw new StyleReferenceError('HERMETIC_CLASSIFIER_MEDIA_REQUIRED', 'classifier execution requires request.mediaPath (the media to examine)');
  let bytes;
  try { bytes = fs.readFileSync(mediaPath); } catch (e) { throw new StyleReferenceError('HERMETIC_CLASSIFIER_MEDIA_UNREADABLE', e.message); }
  const media = sha256(bytes);
  const plannedEvents = Array.isArray(request?.plannedEvents) ? request.plannedEvents : null;
  if (!plannedEvents || !plannedEvents.length) throw new StyleReferenceError('HERMETIC_CLASSIFIER_PLAN_INVALID', 'classifier execution requires request.plannedEvents (the semantic claims to examine)');
  let artifact = null;
  try { artifact = JSON.parse(bytes.toString('utf8')); } catch { artifact = null; }
  if (!artifact || artifact.schema !== HERMETIC_ARTIFACT_SCHEMA || !Array.isArray(artifact.rendered_events)) {
    throw new StyleReferenceError('HERMETIC_CLASSIFIER_UNSUPPORTED_MEDIA',
      'this bounded classifier can only classify hermetic render artifacts; classifying arbitrary media requires an approved classifier integration with its own trusted execution — it never confirms what it cannot examine');
  }
  const records = plannedEvents.map((planned, index) => {
    rejectAuthorityAssertions('classifier', `request.plannedEvents[${index}]`, planned);
    const eventId = String(planned?.event_id || '').trim();
    if (!eventId) throw new StyleReferenceError('HERMETIC_CLASSIFIER_PLAN_INVALID', `request.plannedEvents[${index}] lacks event_id`);
    const kind = normalizeEventKind(planned?.kind);
    if (!kind || !LEVEL_B_EVENT_TYPES[kind]) throw new StyleReferenceError('HERMETIC_CLASSIFIER_PLAN_INVALID', `request.plannedEvents[${index}] kind ${planned?.kind || '(missing)'} is not a classifiable semantic event type`);
    const plan = { ...planned, kind };
    const found = artifact.rendered_events.find((r) => r && r.event_id === eventId
      && String(r.event_type || '').toUpperCase() === kind && manifestationMatches(plan, r.manifestation));
    return found
      ? { event_id: eventId, event_type: kind, confirmed: true, manifestation: structuredClone(found.manifestation) }
      : { event_id: eventId, event_type: kind, confirmed: false };
  });
  const receipt = writeEvidence('classifier', 'VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE', PINNED_CLASSIFIER_EVIDENCE_STORE, runId, { identity, media, records });
  return { ...receipt, media_sha256: media, producer_execution_identity: identity, confirmed_count: records.filter((r) => r.confirmed).length };
}

function readEvidenceStore(kind, envVar, pinnedDefault, runId) {
  const id = String(runId || '').trim();
  if (!RUN_ID_RE.test(id)) throw new StyleReferenceError('SEMANTIC_EVIDENCE_ID_INVALID', `${kind} run id is malformed: ${id}`);
  const root = evidenceRoot(envVar, pinnedDefault);
  const file = path.join(root, `${id}.json`);
  const manifestFile = path.join(root, `${id}.manifest.json`);
  if (path.dirname(path.resolve(file)) !== root) throw new StyleReferenceError('SEMANTIC_EVIDENCE_PATH_ESCAPE', `${kind} evidence path escapes the pinned store`);
  // Durable authority: without a manifest written by the trusted writer there is
  // NO authority (a caller-written raw file is inert).
  if (!fs.existsSync(manifestFile)) throw new StyleReferenceError('SEMANTIC_EVIDENCE_UNAUTHORIZED_WRITE', `${kind} run ${id} has no trusted-writer manifest; a self-created evidence file carries no authority`);
  if (!fs.existsSync(file)) throw new StyleReferenceError('SEMANTIC_EVIDENCE_NOT_FOUND', `${kind} run ${id} evidence file is missing`);
  // Symlink-confined: real paths must remain directly inside the real store.
  let realRoot; let realFile; let realManifest;
  try { realRoot = fs.realpathSync(root); } catch (e) { throw new StyleReferenceError('SEMANTIC_EVIDENCE_STORE_UNRESOLVABLE', e.message); }
  try { realFile = fs.realpathSync(file); } catch (e) { throw new StyleReferenceError('SEMANTIC_EVIDENCE_UNRESOLVABLE', e.message); }
  try { realManifest = fs.realpathSync(manifestFile); } catch (e) { throw new StyleReferenceError('SEMANTIC_EVIDENCE_UNRESOLVABLE', e.message); }
  if (path.dirname(realFile) !== realRoot || path.basename(realFile) !== `${id}.json`
    || path.dirname(realManifest) !== realRoot || path.basename(realManifest) !== `${id}.manifest.json`) {
    throw new StyleReferenceError('SEMANTIC_EVIDENCE_SYMLINK_ESCAPE', `${kind} evidence resolves (via symlink) outside the pinned store`);
  }
  let doc; let manifest;
  try { manifest = JSON.parse(fs.readFileSync(realManifest, 'utf8')); } catch (e) { throw new StyleReferenceError('SEMANTIC_EVIDENCE_UNREADABLE', e.message); }
  try { doc = JSON.parse(fs.readFileSync(realFile, 'utf8')); } catch (e) { throw new StyleReferenceError('SEMANTIC_EVIDENCE_UNREADABLE', e.message); }
  // The manifest must be the one the trusted writer bound to THIS run id and
  // kind — a manifest file copied under another run's name grants nothing.
  if (manifest.schema !== EVIDENCE_MANIFEST_SCHEMA || manifest.run_id !== id || manifest.kind !== kind) {
    throw new StyleReferenceError('SEMANTIC_EVIDENCE_MANIFEST_MISMATCH', `${kind} run ${id} manifest does not bind this run id/kind`);
  }
  // Durable integrity: recompute the digest every read (cross-process) and
  // require exact equality with the manifest bound at trusted-write time.
  if (evidenceDigest(doc) !== manifest.evidence_digest) {
    throw new StyleReferenceError('SEMANTIC_EVIDENCE_INTEGRITY', `${kind} run ${id} bytes changed beneath the bound run id`);
  }
  // Provenance/media come from the MANIFEST (trusted), not from the record text.
  return { records: Array.isArray(doc?.records) ? doc.records : [], identity: manifest.producer_execution_identity || null, media_sha256: manifest.media_sha256 || null, integrity_ok: true };
}
function resolveRendererRun(renderRunId) { const r = readEvidenceStore('renderer', 'VIDTOOLZ_RENDERER_EVENT_STORE', PINNED_RENDERER_EVENT_STORE, renderRunId); return { records: r.records, identity: r.identity, media_sha256: r.media_sha256 }; }
function resolveClassifierRun(classifierRunId) { const r = readEvidenceStore('classifier', 'VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE', PINNED_CLASSIFIER_EVIDENCE_STORE, classifierRunId); return { records: r.records, identity: r.identity, media_sha256: r.media_sha256 }; }

// Approved-producer allowlist (deployment authority, never caller input). When
// configured, an evidence record's producer identity must be on the list.
function approvedIdentities(envVar) {
  const raw = process.env[envVar];
  if (!raw || !raw.trim()) return null; // not configured -> a present identity is sufficient
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

// Provenance/media/integrity gate for an evidence store document. Returns a typed
// error string when the document is not authoritative, else null.
function evidenceAuthorityError(kind, store, allowlistEnv, options) {
  if (!store.integrity_ok) return `SEMANTIC_EVIDENCE_INTEGRITY: ${kind} evidence content changed beneath the run id`;
  if (!store.identity || !String(store.identity).trim()) return `SEMANTIC_EVIDENCE_NO_PROVENANCE: ${kind} record has no producer identity`;
  const allow = approvedIdentities(allowlistEnv);
  if (allow && !allow.has(String(store.identity))) return `SEMANTIC_EVIDENCE_UNAPPROVED_PRODUCER: ${kind} identity ${store.identity} is not approved`;
  if (!HEX64_RE.test(String(store.media_sha256 || ''))) return `SEMANTIC_EVIDENCE_NO_MEDIA_BINDING: ${kind} record does not bind an output media hash`;
  if (options.mediaSha256 && String(store.media_sha256).toLowerCase() !== String(options.mediaSha256).toLowerCase()) return `SEMANTIC_EVIDENCE_WRONG_MEDIA: ${kind} evidence is bound to a different media`;
  return null;
}

/*
 * EVENT AUTHORITY PIPELINE (reference-only). Confirmation of a planned Level-B
 * event requires a matching SEMANTIC MANIFESTATION resolved from a TRUSTED store
 * by id — either a renderer execution record (deterministic graphics) or an
 * approved classifier verdict (nondeterministic media). Pixel candidates are
 * measurement only: they can flag adjudication or an unplanned change, but they
 * NEVER confirm. Noise/motion is discarded. Provenance ids are preserved.
 *
 * options: { renderRunId?, classifierRunId?, toleranceS? }
 * Caller-supplied evidence objects (candidate.manifestation, inline renderer
 * records, inline classifier functions) are IGNORED — they carry no authority.
 */
function admitMeasuredEvents(candidates, plannedEvents, options = {}) {
  const tolerance = options.toleranceS ?? 0.5;
  const planned = admitSemanticEvents(plannedEvents);
  const remaining = planned.admitted.map((p, i) => ({ ...p, event_id: p.event_id ?? `planned-${i + 1}` }));
  const confirmed = [];
  const unplanned = [];
  const discarded_noise = [];
  const unverified = [];
  const errors = [...planned.errors];

  // Resolve TRUSTED semantic evidence from the pinned stores by id, then enforce
  // PROVENANCE + MEDIA BINDING + INTEGRITY before any record may confirm.
  let rendererStore = { records: [], integrity_ok: true };
  if (options.renderRunId) {
    try { rendererStore = readEvidenceStore('renderer', 'VIDTOOLZ_RENDERER_EVENT_STORE', PINNED_RENDERER_EVENT_STORE, options.renderRunId); } catch (e) { errors.push(`RENDERER_EVIDENCE_UNRESOLVED: ${e.message}`); }
  }
  let classifierStore = { records: [], integrity_ok: true };
  if (options.classifierRunId) {
    try { classifierStore = readEvidenceStore('classifier', 'VIDTOOLZ_CLASSIFIER_EVIDENCE_STORE', PINNED_CLASSIFIER_EVIDENCE_STORE, options.classifierRunId); } catch (e) { errors.push(`CLASSIFIER_EVIDENCE_UNRESOLVED: ${e.message}`); }
  }

  // (1) Renderer manifestation — strongest authority, resolved from the store.
  // The store document must carry producer provenance, an output-media hash
  // (matching the evaluated media when supplied), and unchanged bytes; each
  // record must declare the SAME event type as the planned event.
  if (options.renderRunId) {
    const provError = evidenceAuthorityError('renderer', rendererStore, 'VIDTOOLZ_APPROVED_RENDERER_IDENTITIES', options);
    if (provError) { errors.push(provError); } else {
      for (const rec of rendererStore.records) {
        const idx = remaining.findIndex((p) => p.event_id === rec.event_id);
        if (idx < 0) continue;
        const plan = remaining[idx];
        if (String(rec.event_type || '').toUpperCase() !== String(plan.kind).toUpperCase()) { errors.push(`SEMANTIC_EVIDENCE_EVENT_TYPE_MISMATCH: renderer record for ${plan.event_id} declares ${rec.event_type || '(none)'} not ${plan.kind}`); continue; }
        if (rec.manifested !== false && manifestationMatches(plan, rec.manifestation)) {
          remaining.splice(idx, 1);
          confirmed.push({ event_id: plan.event_id, t_s: plan.t_s, kind: plan.kind, authority: 'RENDERER_MANIFESTATION_CONFIRMED', manifestation: rec.manifestation, evidence_source: `renderer-run:${options.renderRunId}`, renderer_identity: rendererStore.identity, media_sha256: rendererStore.media_sha256 });
        }
      }
    }
  }
  // (2) Approved classifier verdict — resolved from the store, provenance/media/
  // integrity bound, event-type matched.
  if (options.classifierRunId) {
    const provError = evidenceAuthorityError('classifier', classifierStore, 'VIDTOOLZ_APPROVED_CLASSIFIER_IDENTITIES', options);
    if (provError) { errors.push(provError); } else {
      for (const rec of classifierStore.records) {
        const idx = remaining.findIndex((p) => p.event_id === rec.event_id);
        if (idx < 0) continue;
        const plan = remaining[idx];
        if (String(rec.event_type || '').toUpperCase() !== String(plan.kind).toUpperCase()) { errors.push(`SEMANTIC_EVIDENCE_EVENT_TYPE_MISMATCH: classifier record for ${plan.event_id} declares ${rec.event_type || '(none)'} not ${plan.kind}`); continue; }
        if (rec.confirmed === true && manifestationMatches(plan, rec.manifestation)) {
          remaining.splice(idx, 1);
          confirmed.push({ event_id: plan.event_id, t_s: plan.t_s, kind: plan.kind, authority: 'APPROVED_CLASSIFIER_CONFIRMED', manifestation: rec.manifestation, evidence_source: `classifier-run:${options.classifierRunId}`, classifier_identity: classifierStore.identity, media_sha256: classifierStore.media_sha256 });
        }
      }
    }
  }

  // (3) Pixel candidates: MEASUREMENT ONLY. They never confirm. A confirming
  // (non-noise) signal near a still-unconfirmed planned event marks it as
  // requiring semantic adjudication; a signal with no planned counterpart is an
  // unplanned candidate; noise/motion is discarded.
  (candidates || []).forEach((candidate, i) => {
    const candidateId = candidate?.candidate_id ?? `signal-${i + 1}`;
    if (!isConfirmingSignal(candidate)) {
      discarded_noise.push({ candidate_id: candidateId, t_s: candidate?.t_s, kind: candidate?.kind, reason: 'non-confirming signal class (noise or continuous motion)' });
      return;
    }
    const idx = remaining.findIndex((p) => Math.abs((p.t_s ?? NaN) - (candidate?.t_s ?? NaN)) <= tolerance);
    if (idx < 0) {
      unplanned.push({ candidate_id: candidateId, t_s: candidate?.t_s, kind: candidate?.kind, authority: 'UNPLANNED_EVENT_CANDIDATE', meaningful: false, requires_semantic_adjudication: true });
      return;
    }
    const plan = remaining.splice(idx, 1)[0];
    unverified.push({ event_id: plan.event_id, candidate_id: candidateId, t_s: plan.t_s, kind: plan.kind, authority: 'LEVEL_B_SEMANTIC_ADJUDICATION_REQUIRED', measured_t_s: candidate?.t_s, supporting_signal_kind: candidate?.kind, reason: 'pixel signal is measurement only; no trusted semantic manifestation resolved for this event' });
  });

  const unconfirmed_planned = remaining.map((p) => ({ event_id: p.event_id, t_s: p.t_s, kind: p.kind, authority: 'LEVEL_B_UNVERIFIED', reason: 'no trusted semantic manifestation (renderer/classifier store) for this event' }));
  return { confirmed, unverified, unplanned_candidates: unplanned, discarded_noise, unconfirmed_planned, errors };
}

/*
 * Explicit LEVEL-A macro-state counter. A macro state is a backdrop/composition
 * state; it changes only at declared macro boundaries, NOT at every beat and
 * NOT from pixel signal. Consecutive spans that declare the same macro_state_id
 * (or same plate/backdrop identity) are ONE state.
 */
function countMacroStates(spans) {
  let count = 0;
  let prev = null;
  for (const span of spans || []) {
    const id = span.macro_state_id ?? span.backdrop_id ?? span.plate ?? span.state ?? null;
    const isBoundary = span.macro_boundary === true || id == null || id !== prev;
    if (isBoundary) count += 1;
    prev = id;
  }
  return count;
}

/*
 * Explicit A/B/C classification for regression certification. Level B counts
 * ONLY admitted semantic events; Level C is active-motion coverage; Level A is
 * the macro-state count. The three are never conflated.
 */
function classifyProgrammeLevels(programme) {
  const bAdmission = admitSemanticEvents(programme.b_events || []);
  const activeC = (programme.spans || []).some((s) => ACTIVE_LEVEL_C_CLASSES.includes((s.level_c || {}).class));
  return {
    level_a_macro_states: countMacroStates(programme.spans || []),
    level_b_meaningful_events: bAdmission.admitted.length,
    level_b_errors: bAdmission.errors,
    level_c_active: activeC,
  };
}

const DENSITY_GROUPS = Object.freeze({
  D0: 'QUIET', D1: 'QUIET', D2: 'READABLE', D3: 'READABLE', D4: 'DENSE', D5: 'DENSE',
  QUIET: 'QUIET', READABLE: 'READABLE', DENSE: 'DENSE',
});

class StyleReferenceError extends Error {
  constructor(code, message, details) {
    super(`${code}: ${message}`);
    this.name = 'StyleReferenceError';
    this.code = code;
    this.details = details || {};
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function loadContract(contractPath) {
  const raw = fs.readFileSync(contractPath || CONTRACT_PATH, 'utf8');
  return JSON.parse(raw);
}

/*
 * Load and verify a style reference against an expected binding.
 * Fail-closed: any identity, hash, schema, supersession, or approval gap is
 * an error, never a silent degrade.
 *
 * expectedBinding: { reference_id, sha256 }
 */
function loadStyleReference(options) {
  const { referencePath, expectedBinding } = options || {};
  if (!referencePath) {
    throw new StyleReferenceError('STYLE_REFERENCE_PATH_REQUIRED', 'referencePath is required');
  }
  if (!expectedBinding || !expectedBinding.reference_id || !/^[a-f0-9]{64}$/.test(String(expectedBinding.sha256 || ''))) {
    throw new StyleReferenceError('STYLE_REFERENCE_BINDING_REQUIRED',
      'expectedBinding {reference_id, sha256 (64 hex)} is required; unbound style consumption is forbidden');
  }

  let bytes;
  try {
    bytes = fs.readFileSync(referencePath);
  } catch (err) {
    throw new StyleReferenceError('STYLE_REFERENCE_UNREADABLE', `cannot read ${referencePath}`, { cause: String(err) });
  }

  const observed = sha256(bytes);
  if (observed !== expectedBinding.sha256) {
    throw new StyleReferenceError('STYLE_REFERENCE_BINDING_MISMATCH',
      'reference bytes do not match the pinned binding; refusing to consume (possible successor or tampering — re-resolve the ACTIVE reference and re-bind)',
      { expected_sha256: expectedBinding.sha256, observed_sha256: observed, path: referencePath });
  }

  let reference;
  try {
    reference = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new StyleReferenceError('STYLE_REFERENCE_INVALID_JSON', `${referencePath} is not valid JSON`, { cause: String(err) });
  }

  if (reference.schema !== REFERENCE_SCHEMA) {
    throw new StyleReferenceError('STYLE_REFERENCE_SCHEMA_UNSUPPORTED',
      `expected schema ${REFERENCE_SCHEMA}`, { observed_schema: reference.schema });
  }
  if (reference.id !== expectedBinding.reference_id) {
    throw new StyleReferenceError('STYLE_REFERENCE_BINDING_MISMATCH',
      'reference id does not match the pinned binding', { expected_id: expectedBinding.reference_id, observed_id: reference.id });
  }
  if (reference.status !== 'ACTIVE') {
    throw new StyleReferenceError('STYLE_REFERENCE_STALE_BINDING',
      `reference status is ${reference.status}; a superseded reference has no authority — re-resolve the ACTIVE successor and re-bind`,
      { reference_id: reference.id, status: reference.status });
  }

  // Human approval is load-bearing: an unapproved reference is not authority.
  const approvalGaps = [];
  if (!reference.approved_by) approvalGaps.push('approved_by');
  if (!reference.approved_at) approvalGaps.push('approved_at');
  if (!reference.decision_record) approvalGaps.push('decision_record');
  if (!reference.authority_scope || !Array.isArray(reference.authority_scope.is_not)) approvalGaps.push('authority_scope.is_not');
  if (approvalGaps.length > 0) {
    throw new StyleReferenceError('STYLE_REFERENCE_NOT_HUMAN_APPROVED',
      'reference lacks explicit human-approval fields; refusing to treat it as authority', { missing: approvalGaps });
  }
  if (!reference.event_model || !Array.isArray(reference.principles)) {
    throw new StyleReferenceError('STYLE_REFERENCE_INCOMPLETE', 'reference is missing event_model or principles');
  }

  return deepFreeze({
    reference,
    binding: {
      reference_id: reference.id,
      sha256: observed,
      approved_by: reference.approved_by,
      approved_at: reference.approved_at,
      authority_tier: AUTHORITY_TIER,
      authority_rank: AUTHORITY_RANK,
    },
  });
}

/*
 * Confidence-class powers: what a pattern of a given class is ALLOWED to do.
 * This is the anti-overfitting gate: only STRONG patterns shape defaults or
 * warn on envelope exit; nothing ever warns on ABSENCE of a non-required
 * pattern; a single-video device is never a rule.
 */
function patternPowers(patternClass) {
  switch (patternClass) {
    case 'STRONG_REFERENCE_PATTERN':
      return deepFreeze({ is_rule: false, may_shape_defaults: true, may_warn_on_exit: true, warn_on_absence: false });
    case 'LIKELY_REFERENCE_PATTERN':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false, suggestion: true });
    case 'OPTIONAL':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false });
    case 'SINGLE_VIDEO_PATTERN':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false, inspiration_only: true });
    case 'UNCERTAIN':
      return deepFreeze({ is_rule: false, may_shape_defaults: false, may_warn_on_exit: false, warn_on_absence: false, context_only: true });
    default:
      throw new StyleReferenceError('STYLE_REFERENCE_UNKNOWN_PATTERN_CLASS', `unknown pattern class ${patternClass}`);
  }
}

const ROLE_PRINCIPLE_SELECTION = Object.freeze({
  // Creative Director reasons over tendencies; numeric bands are withheld so
  // taste is never planned to metrics (they belong to visual planning and QC).
  creative_director: { principles: 'ALL', include_event_bands: false },
  visual_planning_director: { principles: 'ALL', include_event_bands: true },
  editor: {
    principles: ['P-01', 'P-03', 'P-08', 'P-09', 'P-10', 'P-12', 'P-15', 'P-16', 'P-17'],
    include_event_bands: true,
  },
  qc_director: { principles: ['P-01', 'P-02', 'P-03', 'P-15', 'P-17', 'P-20', 'P-21'], include_event_bands: true },
});

function projectForRole(loaded, role) {
  if (!loaded || !loaded.reference || !loaded.binding) {
    throw new StyleReferenceError('STYLE_REFERENCE_LOAD_REQUIRED', 'projectForRole requires the result of loadStyleReference');
  }
  const selection = ROLE_PRINCIPLE_SELECTION[role];
  if (!selection) {
    throw new StyleReferenceError('STYLE_REFERENCE_UNKNOWN_ROLE', `no projection defined for role ${role}`, {
      known_roles: Object.keys(ROLE_PRINCIPLE_SELECTION),
    });
  }
  const { reference, binding } = loaded;
  const principles = selection.principles === 'ALL'
    ? reference.principles
    : reference.principles.filter((p) => selection.principles.includes(p.id));

  const projection = {
    schema: ADAPTER_SCHEMA,
    role,
    identity: binding,
    advisory_preamble: ADVISORY_PREAMBLE,
    nature: reference.nature,
    authority_scope: reference.authority_scope,
    doctrine: reference.doctrine,
    principles,
    succession: reference.source_basis ? reference.source_basis.succession : undefined,
  };
  if (selection.include_event_bands) {
    projection.event_model = reference.event_model;
  } else {
    projection.event_model_note =
      'Numeric Level A/B/C bands are deliberately withheld from this role: reason over tendencies, never plan taste to metrics.';
  }
  return deepFreeze(projection);
}

function densityGroup(density) {
  const group = DENSITY_GROUPS[String(density || '').toUpperCase()];
  return group || 'UNKNOWN';
}

function spanIsAlive(span) {
  // Presenter PRESENCE alone never proves Level-C adequacy (Codex escape):
  // presenter motion counts only when explicitly claimed as the span's
  // Level-C treatment (LIVE_PRESENTER / PROXY_MOTION class).
  const levelC = span.level_c || {};
  if (ACTIVE_LEVEL_C_CLASSES.includes(levelC.class)) return true;
  return false;
}

function spanReadingJustified(span) {
  const levelC = span.level_c || {};
  return levelC.class === 'STATIC'
    && levelC.reason === 'reading_work'
    && span.text_bearing === true
    && densityGroup(span.density) === 'DENSE';
}

function resolveStatus(dimension, context) {
  const ctx = context || {};
  const keeps = ctx.human_keeps || [];
  if (keeps.some((k) => k && k.dimension === dimension)) return 'INFORMATIONAL_ONLY';
  const deviations = ctx.deviations || [];
  if (deviations.some((d) => d && d.dimension === dimension)) return 'DEVIATION_ACKNOWLEDGED';
  return 'ACTIVE';
}

function finding(context, fields) {
  const status = resolveStatus(fields.dimension, context);
  return {
    metric: fields.metric,
    warning_id: fields.warning_id || null,
    level: fields.level,
    dimension: fields.dimension,
    verdict: fields.verdict,
    action: fields.verdict === 'REFERENCE_MATCH' ? 'none' : 'review',
    status,
    measured: fields.measured,
    band: fields.band === undefined ? null : fields.band,
    evidence: fields.evidence,
  };
}

/*
 * Evaluate a neutral programme summary against the reference envelope.
 * ADVISORY ONLY: the result carries findings and evidence, never a
 * disposition, gate verdict, score, or blocking field.
 *
 * programme:
 *   duration_s            total runtime
 *   spans[]               { start_s, end_s, presenter: LIVE|PROXY|ABSENT,
 *                           level_c: {class, reason?}, density, text_bearing }
 *   b_events[]            { t_s, kind, asset_id?, meaningful (default true), reason? }
 *   ending?               { designed_card, generic_cta, text_only_close }
 *
 * context:
 *   deviations[]          rank-2 episode direction: { dimension, reason }
 *   human_keeps[]         rank-1 recorded decisions: { dimension, decision }
 */
function evaluateAdvisory(loaded, programme, context, params) {
  if (!loaded || !loaded.reference) {
    throw new StyleReferenceError('STYLE_REFERENCE_LOAD_REQUIRED', 'evaluateAdvisory requires the result of loadStyleReference');
  }
  if (!programme || !(programme.duration_s > 0)) {
    throw new StyleReferenceError('STYLE_PROGRAMME_INVALID', 'programme.duration_s must be > 0');
  }
  const contract = params && params.contract ? params.contract : loadContract(params && params.contractPath);
  const evalParams = contract.evaluator_parameters || {};
  const denseMinReadS = evalParams.dense_min_read_s;
  const noEventReviewS = evalParams.no_event_review_s;
  if (!(denseMinReadS > 0) || !(noEventReviewS > 0)) {
    throw new StyleReferenceError('STYLE_REFERENCE_CONTRACT_INCOMPLETE',
      'contract evaluator_parameters must define dense_min_read_s and no_event_review_s');
  }

  const eventModel = loaded.reference.event_model;
  const levelB = eventModel.LEVEL_B_MEANINGFUL_VISUAL_EVENT || {};
  const bBand = levelB.advisory_band_per_min;
  if (!Array.isArray(bBand) || bBand.length !== 2) {
    throw new StyleReferenceError('STYLE_REFERENCE_INCOMPLETE', 'reference lacks LEVEL_B advisory_band_per_min');
  }

  const spans = (programme.spans || []).slice().sort((a, b) => a.start_s - b.start_s);
  // LEVEL-B CONTRACT: only admissible semantic event classes count; noise
  // classes and unknown kinds fail closed rather than inflating density.
  const admission = admitSemanticEvents(programme.b_events || []);
  if (admission.errors.length) {
    throw new StyleReferenceError('STYLE_EVENT_CONTRACT_VIOLATION', admission.errors.join('; '));
  }
  const meaningfulEvents = admission.admitted.slice().sort((a, b) => a.t_s - b.t_s);

  const findings = [];

  // LEVEL_B density. Every treatment transition of one asset counts on its
  // own (P-09): counting is by event, never deduplicated by asset_id.
  const perMin = meaningfulEvents.length / (programme.duration_s / 60);
  if (perMin < bBand[0]) {
    findings.push(finding(context, {
      metric: 'LEVEL_B_EVENT_DENSITY', warning_id: 'W-02', level: 'B', dimension: 'b_density',
      verdict: 'REFERENCE_WARNING', measured: Number(perMin.toFixed(2)), band: bBand,
      evidence: `meaningful events ${meaningfulEvents.length} over ${programme.duration_s}s => ${perMin.toFixed(2)}/min, below advisory band`,
    }));
  } else if (perMin > bBand[1]) {
    findings.push(finding(context, {
      metric: 'LEVEL_B_EVENT_DENSITY', level: 'B', dimension: 'b_density',
      verdict: 'REFERENCE_OUTLIER', measured: Number(perMin.toFixed(2)), band: bBand,
      evidence: 'above advisory band; normal variation is not failure — review pacing intent',
    }));
  } else {
    findings.push(finding(context, {
      metric: 'LEVEL_B_EVENT_DENSITY', level: 'B', dimension: 'b_density',
      verdict: 'REFERENCE_MATCH', measured: Number(perMin.toFixed(2)), band: bBand,
      evidence: 'within advisory band',
    }));
  }

  // W-01: >10s with no Level-B event and no Level-C / reading justification.
  // A long macro state whose interior keeps producing B events or stays
  // alive at Level C is explicitly legal (P-17).
  const timestamps = [0, ...meaningfulEvents.map((e) => e.t_s), programme.duration_s];
  for (let i = 0; i + 1 < timestamps.length; i += 1) {
    const gapStart = timestamps[i];
    const gapEnd = timestamps[i + 1];
    if (gapEnd - gapStart <= noEventReviewS) continue;
    const covering = spans.filter((s) => s.end_s > gapStart && s.start_s < gapEnd);
    const justified = covering.length > 0 && covering.every((s) => spanIsAlive(s) || spanReadingJustified(s));
    if (!justified) {
      findings.push(finding(context, {
        metric: 'LONGEST_NO_MEANINGFUL_EVENT_SPAN', warning_id: 'W-01', level: 'B', dimension: 'no_event_span',
        verdict: 'REFERENCE_WARNING', measured: Number((gapEnd - gapStart).toFixed(2)), band: { review_over_s: noEventReviewS },
        evidence: `no meaningful visual evolution ${gapStart}s-${gapEnd}s and no Level-C or reading-work justification in the covering span(s)`,
      }));
    }
  }

  // W-08: presenter-free span with no compensating visual life (P-02).
  // Presenter absence ALONE never fires; the equivalence principle only asks
  // that something carries the life the presenter would have carried.
  for (const span of spans) {
    if (span.presenter !== 'ABSENT') continue;
    if (spanIsAlive(span) || spanReadingJustified(span)) continue;
    const levelC = span.level_c || {};
    if (levelC.class === 'STATIC' && levelC.reason === 'explicit_creative_choice') continue;
    findings.push(finding(context, {
      metric: 'PRESENTER_OR_CONTINUOUS_VISUAL_LIFE_COVERAGE', warning_id: 'W-08', level: 'C',
      dimension: 'presenter_free_compensation',
      verdict: 'REFERENCE_WARNING', measured: `uncovered span ${span.start_s}s-${span.end_s}s`, band: null,
      evidence: 'presenter absent (legal) but span has no active Level-C treatment and no reading-work justification',
    }));
  }

  // W-09: high density replaced faster than reading time.
  for (const span of spans) {
    if (densityGroup(span.density) !== 'DENSE') continue;
    const duration = span.end_s - span.start_s;
    if (duration >= denseMinReadS) continue;
    findings.push(finding(context, {
      metric: 'DENSITY_FAST_CUT_COMBINATION', warning_id: 'W-09', level: 'A', dimension: 'density_pace',
      verdict: 'REFERENCE_WARNING', measured: Number(duration.toFixed(2)), band: { dense_min_read_s: denseMinReadS },
      evidence: `dense card (${span.density}) held ${duration}s at ${span.start_s}s — shorter than reading time; the forbidden combination unless deliberately reasoned`,
    }));
  }

  // W-07: ending grammar (only when the caller supplies ending facts).
  if (programme.ending) {
    const e = programme.ending;
    if (e.generic_cta === true || e.text_only_close === true) {
      findings.push(finding(context, {
        metric: 'ENDING_SYNTHESIS_CARD_PRESENCE', warning_id: 'W-07', level: 'GRAMMAR', dimension: 'ending',
        verdict: 'REFERENCE_WARNING', measured: e.generic_cta ? 'generic CTA/outro close' : 'plain text-only close', band: null,
        evidence: 'references end on designed cards with a footer takeaway and a hard stop; generic or text-only closes are the negative tendency (0/3)',
      }));
    } else if (e.designed_card === true) {
      findings.push(finding(context, {
        metric: 'ENDING_SYNTHESIS_CARD_PRESENCE', level: 'GRAMMAR', dimension: 'ending',
        verdict: 'REFERENCE_MATCH', measured: 'designed ending card', band: null, evidence: 'matches the designed-ending tendency',
      }));
    }
  }

  return deepFreeze({
    schema: 'vidtoolz.styleReferenceAdvisoryReport.v1',
    tier: 'ADVISORY_ONLY',
    style_binding: loaded.binding,
    no_aggregate_score: true,
    findings,
  });
}

module.exports = {
  ADAPTER_SCHEMA,
  REFERENCE_SCHEMA,
  ADVISORY_PREAMBLE,
  AUTHORITY_TIER,
  AUTHORITY_RANK,
  VERDICTS,
  FINDING_STATUSES,
  ACTIVE_LEVEL_C_CLASSES,
  MEANINGFUL_EVENT_CLASSES,
  NEVER_MEANINGFUL_EVENT_CLASSES,
  CONTINUOUS_MOTION_NON_EVENT_CLASSES,
  EVENT_KIND_ALIASES,
  LEVEL_B_EVENT_TYPES,
  manifestationMatches,
  normalizeEventKind,
  admitSemanticEvents,
  admitMeasuredEvents,
  // PUBLIC REQUEST surface (start an execution; the runtime writes its own
  // evidence). There is NO public authority writer: recordRendererEvidence /
  // recordClassifierEvidence were removed (Codex 58847dc Finding 2) — the
  // trusted writer is module-private and reachable only through these runtimes.
  HERMETIC_ARTIFACT_SCHEMA,
  requestRendererExecution,
  requestClassifierExecution,
  // PUBLIC READ surface.
  resolveRendererRun,
  resolveClassifierRun,
  countMacroStates,
  classifyProgrammeLevels,
  CONFIRMING_SIGNAL_CLASSES,
  StyleReferenceError,
  sha256,
  loadContract,
  loadStyleReference,
  patternPowers,
  projectForRole,
  densityGroup,
  evaluateAdvisory,
};
