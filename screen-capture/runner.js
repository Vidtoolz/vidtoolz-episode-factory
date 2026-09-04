'use strict';
// SCREEN CAPTURE V1 — EXECUTION AUTHORITY (Stage 7 runner).
//
//   CaptureSpec V1 → policy gate → concurrency lock → transient spool attempt →
//   bounded source adapter → privacy BLOCK gate → finalizer (protected raw) →
//   presentation derivative → independent QC → oracle-shaped evidence bundle +
//   Episode Factory asset handoff. Every stop is a typed failure record bound to
//   the CaptureSpec; no representation fallback exists anywhere.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./contract.js');
const policyModel = require('./policy.js');
const privacy = require('./privacy.js');
const spool = require('./spool.js');
const store = require('./evidence-store.js');
const presentation = require('./presentation.js');
const qc = require('./qc.js');
const adapters = { TERMINAL: require('./adapters/terminal.js'), FILE_OR_CODE: require('./adapters/file-code.js'), BROWSER: require('./adapters/browser.js'), DAVINCI_RESOLVE: require('./adapters/resolve.js'), DESKTOP_APPLICATION: require('./adapters/desktop.js') };

const RUNNER = Object.freeze({ id: 'vidtoolz-screen-capture-runner', version: '1.0.0' });
const ACTIVE_LOCKS = new Set();
function lockKey(spec) {
  if (spec.source.type === 'DAVINCI_RESOLVE') return `resolve:${spec.machine.session_id}`;
  if (spec.source.type === 'DESKTOP_APPLICATION') return `desktop:${spec.machine.session_id}:${spec.source.application_id}`;
  return `${spec.source.type.toLowerCase()}:${spec.capture_id}`;
}
function writeOnce(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); const fd = fs.openSync(file, 'wx', 0o644); try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } return file; }

function failureOutcome(spec, specDigest, code, stage, detail, ctx, extras = {}) {
  const record = C.failureRecord(spec, specDigest, code, stage, detail);
  const out = { ok: false, state: 'CAPTURE_FAILED', code, stage, detail: record.detail, failure: record, ...extras };
  if (ctx && ctx.receiptsRoot && specDigest) { try { writeOnce(path.join(ctx.receiptsRoot, spec.capture_id, `failure-${Date.now()}-${code}.json`), `${JSON.stringify(record, null, 2)}\n`); } catch (_) {} }
  return out;
}

// Runs one CaptureSpec. options: { policy (object|path), deps (test/injection: resolve provider, lease deps), beat: { beat_id, run_id, episode } }
async function runCapture(spec, options = {}) {
  const policy = typeof options.policy === 'object' && options.policy && options.policy.schema ? policyModel.loadPolicy(options.policy) : policyModel.loadPolicy(options.policy);
  const context = policyModel.contextFromPolicy(policy);
  const ctx = { ...context, limits: policy.limits, idle: policy.idle, browser_profile_root: policy.approved.browser_profile_root || path.join(os.tmpdir(), 'vidtoolz-screen-capture-profiles'), resolve: options.deps && options.deps.resolve, presto: policy.deployment.presto || null, receiptsRoot: policy.stores.receipts_root };
  const validation = C.validateCaptureSpec(spec, context);
  if (!validation.ok) return { ok: false, state: 'SPEC_REJECTED', code: 'SPEC_REJECTED', stage: 'specification', issues: validation.issues, failure: spec && spec.capture_id ? C.failureRecord({ ...spec, failure_policy: spec.failure_policy || {} }, null, 'SPEC_REJECTED', 'specification', validation.issues.map((i) => `${i.code}@${i.field}`).join('; ')) : null };
  const specDigest = validation.spec_digest_sha256;
  const gate = policyModel.gateDecision(policy, spec.source.type);
  if (!gate.allowed) return failureOutcome(spec, specDigest, gate.code, 'policy', gate.detail, ctx);
  if (spec.capture.mode !== 'STATIC_FRAME') return failureOutcome(spec, specDigest, 'SPEC_REJECTED', 'specification', 'SHORT_MOTION is not implemented in V1; static frames only', ctx);
  const key = lockKey(spec);
  if (ACTIVE_LOCKS.has(key)) return failureOutcome(spec, specDigest, 'CONCURRENCY_CONFLICT', 'preflight', `another capture holds ${key}; serialize`, ctx);
  ACTIVE_LOCKS.add(key);
  let attempt = null;
  try {
    // transient spool attempt (never reused)
    try { attempt = spool.openAttempt(policy.stores.spool_root, spec.capture_id); } catch (e) { return failureOutcome(spec, specDigest, e.code || 'TRUST_ANCHOR_UNAVAILABLE', 'spool', e.message, ctx); }
    // bounded source adapter
    let captured;
    try { captured = await adapters[spec.source.type].capture(spec, ctx); } catch (e) { return failureOutcome(spec, specDigest, C.FAILURE_CODES.includes(e.code) ? e.code : 'CAPTURE_FAILED', e.stage || 'capture', e.message, ctx, { attempt_id: attempt.attempt_id }); }
    const rawSpool = spool.writeArtifact(attempt, `raw.${store.RAW_EXT[captured.raw.format]}`, captured.raw.bytes);
    // privacy BLOCK gate — before anything becomes evidence
    const priv = privacy.evaluate([...captured.surfaces, { id: 'visible-tokens', text: (captured.raw.visible_tokens || []).join('\n') }], spec.privacy.policy_id);
    if (priv.disposition !== 'ALLOW') {
      const receipt = privacy.blockedReceipt(spec, specDigest, attempt.attempt_id, priv);
      spool.discardBytes(attempt);
      if (policy.stores.receipts_root) { try { writeOnce(path.join(policy.stores.receipts_root, spec.capture_id, `${attempt.attempt_id}-blocked-receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`); } catch (_) {} }
      return failureOutcome(spec, specDigest, 'PRIVACY_BLOCKED', 'privacy', `CAPTURE_BLOCKED_SENSITIVE_DATA: ${receipt.categories.join(', ')} detected (${receipt.findings.length} finding(s)); no raw finalized, no presentation, no handoff`, ctx, { blocked_receipt: receipt, attempt_id: attempt.attempt_id });
    }
    const privacyRecord = { policy_id: priv.policy_id, scanner_id: priv.scanner_id, scanner_version: priv.scanner_version, raw_findings: [], presentation_findings: [], disposition: 'ALLOW' };
    // finalize protected raw at the exact CaptureSpec destination
    const outputRoot = context.outputRoots[spec.output.root_id];
    let finalized;
    try {
      finalized = store.finalizeRaw({ evidence_root: outputRoot, signing_key_path: policy.stores.signing_key_path, receipts_root: policy.stores.receipts_root }, {
        capture_id: spec.capture_id, attempt_id: attempt.attempt_id, spec_digest_sha256: specDigest, format: captured.raw.format, bytes: captured.raw.bytes, privacy_disposition: 'ALLOW', privacy_receipt_digest: C.digest(privacyRecord),
        destination: { relative_dir: spec.output.relative_dir, raw_name: spec.output.raw_name }, source_receipt: captured.snapshot, machine_id: spec.machine.id, session_id: spec.machine.session_id, adapter: captured.adapter,
      });
    } catch (e) { return failureOutcome(spec, specDigest, e.code === 'TRUST_ANCHOR_UNAVAILABLE' ? 'TRUST_ANCHOR_UNAVAILABLE' : 'FINALIZATION_FAILED', 'finalization', e.message, ctx, { attempt_id: attempt.attempt_id }); }
    // presentation derivative from the finalized raw
    let rendered;
    try {
      rendered = await presentation.render({ spec, rawPath: finalized.raw_path, rawSha256: finalized.raw_sha256, rawFormat: captured.raw.format, rawText: captured.raw.visible_text, rawWidth: captured.raw.width, rawHeight: captured.raw.height, sourceIdentityLine: captured.source_identity_line, requiredContextBoxes: captured.required_context_boxes, lineNumbersFrom: captured.line_numbers_from, targetRect: captured.target_rect, targetFontPx: captured.target_font_px, workDir: attempt.dir, profileRoot: ctx.browser_profile_root });
    } catch (e) { store.sealAttempt({ evidence_root: outputRoot }, spec.output.relative_dir); return failureOutcome(spec, specDigest, 'PRESENTATION_FAILED', 'presentation', e.message, ctx, { attempt_id: attempt.attempt_id, raw_finalized: { path: finalized.raw_path, sha256: finalized.raw_sha256 } }); }
    let presFinal;
    try { presFinal = store.finalizePresentation({ evidence_root: outputRoot, signing_key_path: policy.stores.signing_key_path, receipts_root: policy.stores.receipts_root }, { capture_id: spec.capture_id, attempt_id: attempt.attempt_id, destination: { relative_dir: spec.output.relative_dir, presentation_name: spec.output.presentation_name }, bytes: rendered.png, manifest: rendered.manifest, raw_sha256: finalized.raw_sha256 }); }
    catch (e) { return failureOutcome(spec, specDigest, 'FINALIZATION_FAILED', 'finalization', e.message, ctx, { attempt_id: attempt.attempt_id }); }
    // evidence intent (adapter-side observation; QC re-evaluates independently)
    const evidenceInputs = captured.evidence;
    const factResults = spec.evidence_target.required_facts.map((f) => ({ fact: f, ok: C.evaluateFact(f, evidenceInputs) }));
    const unproven = factResults.filter((f) => f.ok !== true);
    if (unproven.length) return failureOutcome(spec, specDigest, 'EVIDENCE_INSUFFICIENT', 'evidence-intent', `required facts not proven by the capture: ${unproven.map((f) => f.fact).join(', ')}`, ctx, { attempt_id: attempt.attempt_id });
    const intent = { technical_state: 'CAPTURE_TECHNICALLY_VALID', evidence_state: 'EVIDENCE_INTENT_SATISFIED', observed_facts: spec.evidence_target.required_facts.slice(), required_context_boxes: captured.required_context_boxes.map((b) => ({ id: b.id, kind: b.kind, ...(b.rect ? { rect: b.rect } : {}), ...(b.text ? { text: b.text } : {}) })), explanation: `facts checked against the process/source transcript and snapshot: ${factResults.map((f) => f.fact).join('; ')}` };
    const provenance = {
      raw_sha256: finalized.raw_sha256, presentation_sha256: presFinal.sha256, spec_digest_sha256: specDigest, adapter_id: captured.adapter.id, adapter_version: captured.adapter.version,
      machine_id: spec.machine.id, session_id: spec.machine.session_id, capture_started_at: captured.started_at, capture_completed_at: captured.completed_at, operations: captured.operations,
    };
    provenance.manifest_digest_sha256 = C.provenanceManifestDigest(provenance);
    const bundle = {
      schema: C.SCHEMA.bundle, capture_id: spec.capture_id, spec_digest_sha256: specDigest, status: 'COMPLETE', adapter: { id: captured.adapter.id, version: captured.adapter.version },
      source_snapshot: captured.snapshot,
      raw: { path: finalized.raw_path, sha256: finalized.raw_sha256, bytes: captured.raw.bytes.length, format: captured.raw.format, ...(captured.raw.format === 'PNG' ? { width: captured.raw.width, height: captured.raw.height } : {}), visible_text: captured.raw.visible_text, visible_tokens: captured.raw.visible_tokens },
      presentation: { path: presFinal.path, sha256: presFinal.sha256, bytes: rendered.png.length, format: 'PNG', width: 1080, height: 1920, visible_text: captured.raw.visible_text, visible_tokens: captured.raw.visible_tokens, transformations: rendered.transformations, layout: { evidence_box: rendered.layout.evidence_box, minimum_text_px: rendered.layout.minimum_text_px } },
      provenance, privacy: privacyRecord, intent, qc: null, handoff: null,
    };
    // independent QC over finalized artifacts
    const review = qc.review({ spec, specDigest, bundleDraft: bundle, evidenceRoot: outputRoot, attemptId: attempt.attempt_id, evidenceInputs, presentationManifest: rendered.manifest });
    if (policy.stores.receipts_root) { try { writeOnce(path.join(policy.stores.receipts_root, spec.capture_id, `${attempt.attempt_id}-qc.json`), `${JSON.stringify(review.record, null, 2)}\n`); } catch (_) {} }
    if (review.verdict !== 'PASS') return failureOutcome(spec, specDigest, 'QC_BLOCKED', 'qc', `independent QC failed: ${review.record.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`, ctx, { attempt_id: attempt.attempt_id, qc: review.record });
    bundle.qc = review.oracleQc;
    const evidenceDigest = C.evidenceDigest(bundle);
    bundle.handoff = { state: 'READY_FOR_EPISODE_FACTORY', capture_id: spec.capture_id, evidence_digest_sha256: evidenceDigest, visual_source_class: 'AUTHENTIC_UI_PROOF', next_owner: 'editor' };
    const assetHandoff = buildAssetHandoff({ spec, specDigest, bundle, finalized, presFinal, review, rendered, beat: options.beat || {}, attemptId: attempt.attempt_id, protection: finalized.protection });
    if (policy.stores.receipts_root) {
      try { writeOnce(path.join(policy.stores.receipts_root, spec.capture_id, `${attempt.attempt_id}-bundle.json`), `${JSON.stringify(bundle, null, 2)}\n`); writeOnce(path.join(policy.stores.receipts_root, spec.capture_id, `${attempt.attempt_id}-asset-handoff.json`), `${JSON.stringify(assetHandoff, null, 2)}\n`); } catch (_) {}
    }
    spool.discardBytes(attempt);
    return { ok: true, state: 'READY_FOR_EPISODE_FACTORY', spec_digest_sha256: specDigest, attempt_id: attempt.attempt_id, bundle, asset_handoff: assetHandoff, qc: review.record, receipt: finalized.receipt, protection: finalized.protection };
  } finally { ACTIVE_LOCKS.delete(key); }
}

// Episode Factory asset handoff (`vidtoolz.screenCaptureAssetHandoff.v1`): binds
// beat, spec, source receipt, protected raw + finalizer receipt, presentation +
// transformation manifest, privacy, QC and the oracle evidence digest.
function buildAssetHandoff({ spec, specDigest, bundle, finalized, presFinal, review, rendered, beat, attemptId, protection }) {
  const chain = [
    { link: 'capture_spec', digest_sha256: specDigest },
    { link: 'source_snapshot', digest_sha256: C.digest(bundle.source_snapshot) },
    { link: 'privacy', digest_sha256: C.digest(bundle.privacy) },
    { link: 'raw_finalization_manifest', digest_sha256: finalized.manifest.manifest_digest_sha256 },
    { link: 'raw_finalization_receipt_signature', digest_sha256: C.sha256Bytes(finalized.receipt.signature) },
    { link: 'presentation_transformation_manifest', digest_sha256: rendered.manifest.manifest_digest_sha256 },
    { link: 'provenance', digest_sha256: bundle.provenance.manifest_digest_sha256 },
    { link: 'qc', digest_sha256: review.record.qc_digest_sha256 },
    { link: 'evidence', digest_sha256: bundle.handoff.evidence_digest_sha256 },
  ];
  const handoff = {
    schema: C.SCHEMA.handoff, state: 'READY_FOR_EPISODE_FACTORY', beat_id: beat.beat_id || null, episode: beat.episode || null, run_id: beat.run_id || null,
    capture_id: spec.capture_id, attempt_id: attemptId, spec_digest_sha256: specDigest, source_class: spec.source.type, visual_source_class: 'AUTHENTIC_UI_PROOF', evidence_claim: spec.evidence_target.claim,
    source_receipt_digest_sha256: C.digest(bundle.source_snapshot),
    raw: { uri: `file://${finalized.raw_path}`, sha256: finalized.raw_sha256, format: bundle.raw.format, finalizer_receipt: { key_id: finalized.receipt.key_id, manifest_digest_sha256: finalized.manifest.manifest_digest_sha256, signature_sha256: C.sha256Bytes(finalized.receipt.signature) }, protection_class: protection.trust_anchor_class, production_qualified_store: protection.production_qualified },
    presentation: { uri: `file://${presFinal.path}`, sha256: presFinal.sha256, transformation_manifest_digest_sha256: rendered.manifest.manifest_digest_sha256, width: 1080, height: 1920 },
    privacy: { disposition: bundle.privacy.disposition, scanner_id: bundle.privacy.scanner_id, scanner_version: bundle.privacy.scanner_version },
    qc: { verdict: review.verdict, reviewer: review.record.reviewer, qc_digest_sha256: review.record.qc_digest_sha256, checks: review.record.checks.length },
    adapter: bundle.adapter, runner: RUNNER, provenance_chain: chain, evidence_digest_sha256: bundle.handoff.evidence_digest_sha256,
    timestamps: { requested_at: spec.requested_at, capture_started_at: bundle.provenance.capture_started_at, capture_completed_at: bundle.provenance.capture_completed_at, qc_checked_at: review.record.checked_at, handoff_at: new Date().toISOString() },
  };
  handoff.handoff_digest_sha256 = C.digest(handoff);
  return handoff;
}

// Validates an asset handoff against its referenced artifacts (consumer side).
function verifyAssetHandoff(handoff) {
  const problems = [];
  const copy = { ...handoff }; delete copy.handoff_digest_sha256;
  if (C.digest(copy) !== handoff.handoff_digest_sha256) problems.push('handoff digest mismatch');
  for (const key of ['beat_id', 'capture_id', 'spec_digest_sha256', 'source_class', 'source_receipt_digest_sha256', 'raw', 'presentation', 'privacy', 'qc', 'provenance_chain', 'evidence_digest_sha256', 'adapter', 'timestamps']) if (handoff[key] === undefined || handoff[key] === null) problems.push(`missing ${key}`);
  if (handoff.privacy && handoff.privacy.disposition !== 'ALLOW') problems.push('privacy not clear');
  if (handoff.qc && handoff.qc.verdict !== 'PASS') problems.push('QC not PASS');
  for (const art of ['raw', 'presentation']) {
    const a = handoff[art]; if (!a) continue;
    const file = String(a.uri || '').replace(/^file:\/\//, '');
    try { if (C.sha256File(file) !== a.sha256) problems.push(`${art} bytes differ from handoff hash`); } catch (e) { problems.push(`${art} unreadable: ${e.message}`); }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { RUNNER, runCapture, buildAssetHandoff, verifyAssetHandoff, lockKey, _internals: { ACTIVE_LOCKS } };
