'use strict';
// SCREEN CAPTURE V1 — INDEPENDENT QC.
//
// Consumes ONLY finalized artifacts and records (never adapter return values)
// and re-derives every claim: raw/presentation bytes and hashes, finalizer
// receipt signature, PNG structure and rendered pixels (blank/uniform, glyph
// height), safe-area geometry, minimum text size, privacy re-scan, evidence
// facts re-evaluated against the raw, provenance digests. Every check is a
// computed boolean; nothing is hardcoded.
const fs = require('node:fs');
const { SCHEMA, sha256Bytes, sha256File, digest, evaluateFact, provenanceManifestDigest, qcBundleDigest } = require('./contract.js');
const privacy = require('./privacy.js');
const png = require('./png.js');
const store = require('./evidence-store.js');

const REVIEWER = Object.freeze({ id: 'vidtoolz-capture-qc', version: '1.0.0' });

function review({ spec, specDigest, bundleDraft, evidenceRoot, attemptId, evidenceInputs, presentationManifest }) {
  const checks = []; const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail == null ? null : String(detail).slice(0, 300) });
  const b = bundleDraft;
  // artifacts
  let rawBytes = null; let presBytes = null;
  try { rawBytes = fs.readFileSync(b.raw.path); add('raw_bytes_match_record', rawBytes.length === b.raw.bytes && sha256Bytes(rawBytes) === b.raw.sha256, `${rawBytes.length} bytes`); } catch (e) { add('raw_bytes_match_record', false, e.message); }
  try { presBytes = fs.readFileSync(b.presentation.path); add('presentation_bytes_match_record', presBytes.length === b.presentation.bytes && sha256Bytes(presBytes) === b.presentation.sha256, `${presBytes.length} bytes`); } catch (e) { add('presentation_bytes_match_record', false, e.message); }
  add('raw_presentation_separate', b.raw.path !== b.presentation.path && b.raw.sha256 !== b.presentation.sha256);
  const st = fs.existsSync(b.raw.path) ? fs.lstatSync(b.raw.path) : null;
  add('raw_regular_file_read_only', Boolean(st && st.isFile() && !st.isSymbolicLink() && (st.mode & 0o222) === 0), st ? (st.mode & 0o777).toString(8) : 'missing');
  // finalizer receipt
  const verified = store.verifyAttempt(evidenceRoot, spec.output.relative_dir);
  add('finalizer_receipt_verifies', verified.ok, verified.problems.join('; ') || 'signature + manifest + raw bound');
  add('finalizer_receipt_binds_raw', Boolean(verified.receipt && verified.receipt.raw_sha256 === b.raw.sha256));
  // raw format specifics
  if (b.raw.format === 'TEXT') add('raw_text_equals_visible_text', rawBytes && rawBytes.toString('utf8') === b.raw.visible_text);
  if (b.raw.format === 'PNG') { try { const p = png.parse(rawBytes); add('raw_png_structure', p.width === b.raw.width && p.height === b.raw.height, `${p.width}x${p.height}`); } catch (e) { add('raw_png_structure', false, e.message); } }
  // presentation pixels
  let decoded = null;
  try { const p = png.parse(presBytes); add('presentation_png_geometry', p.width === 1080 && p.height === 1920 && p.width === b.presentation.width && p.height === b.presentation.height, `${p.width}x${p.height}`); decoded = png.decode(presBytes); } catch (e) { add('presentation_png_geometry', false, e.message); }
  const sa = spec.presentation.safe_area; const box = (b.presentation.layout || {}).evidence_box;
  add('evidence_box_inside_safe_area', Boolean(box) && box.x >= sa.left && box.y >= sa.top && box.x + box.width <= 1080 - sa.right && box.y + box.height <= 1920 - sa.bottom, JSON.stringify(box));
  add('evidence_box_minimum_size', Boolean(box) && box.width >= 640 && box.height >= 360);
  add('minimum_text_px', (b.presentation.layout || {}).minimum_text_px >= spec.presentation.minimum_text_px, `${(b.presentation.layout || {}).minimum_text_px} px vs ${spec.presentation.minimum_text_px}`);
  if (decoded && box) {
    const stats = png.regionStats(decoded, { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 });
    add('evidence_region_not_blank', stats.stddev > 6, `stddev ${stats.stddev.toFixed(2)}`);
    if (b.raw.format === 'TEXT') add('rendered_glyph_height_pixels', stats.median_glyph_run_px >= Math.floor(spec.presentation.minimum_text_px * 0.5), `median bright-row run ${stats.median_glyph_run_px} px (font ${(b.presentation.layout || {}).minimum_text_px} px)`);
    const outside = png.regionStats(decoded, { x: 0, y: 1920 - sa.bottom + 4, width: 1080, height: sa.bottom - 8 });
    add('bottom_safe_area_clear', outside.stddev < 3, `stddev ${outside.stddev.toFixed(2)}`);
  }
  // transformations
  const forbidden = new Set(['RETYPE', 'REDRAW', 'GENERATIVE_FILL', 'CONTENT_REPLACE']);
  add('no_forbidden_transformations', Array.isArray(b.presentation.transformations) && !b.presentation.transformations.some((t) => forbidden.has(t.type)));
  add('zoom_within_bound', !(b.presentation.transformations || []).some((t) => t.type === 'ZOOM' && !(t.scale >= 1 && t.scale <= spec.presentation.max_zoom)));
  const required = new Set((b.intent.required_context_boxes || []).map((c) => c.id));
  add('required_context_retained', (b.presentation.transformations || []).filter((t) => t.type === 'CROP' || t.type === 'ZOOM').every((t) => [...required].every((id) => (t.retained_context_ids || []).includes(id))));
  add('annotations_do_not_cover_evidence', (b.presentation.transformations || []).filter((t) => ['CALLOUT', 'HIGHLIGHT'].includes(t.type)).every((t) => !(t.covers_context_ids || []).length && (!t.region || !box || t.region.y + t.region.height <= box.y || t.region.y >= box.y + box.height)));
  add('transformation_manifest_binds_raw_and_output', Boolean(presentationManifest) && presentationManifest.raw_sha256 === b.raw.sha256 && presentationManifest.presentation_sha256 === b.presentation.sha256);
  // privacy: independent re-scan
  const rescan = privacy.evaluate([{ id: 'raw', text: b.raw.visible_text }, { id: 'presentation', text: b.presentation.visible_text || '' }, { id: 'tokens', text: [...(b.raw.visible_tokens || []), ...(b.presentation.visible_tokens || [])].join('\n') }], spec.privacy.policy_id);
  add('privacy_rescan_clear', rescan.disposition === 'ALLOW' && b.privacy.disposition === 'ALLOW' && !b.privacy.raw_findings.length && !b.privacy.presentation_findings.length, `${rescan.findings.length} findings`);
  // evidence intent: facts re-evaluated from the raw + snapshot
  const facts = spec.evidence_target.required_facts.map((f) => ({ fact: f, result: evaluateFact(f, evidenceInputs) }));
  add('all_required_facts_proven', facts.every((f) => f.result === true), facts.filter((f) => f.result !== true).map((f) => f.fact).join(', ') || 'all facts observed');
  add('intent_states_consistent', b.intent.technical_state === 'CAPTURE_TECHNICALLY_VALID' && b.intent.evidence_state === 'EVIDENCE_INTENT_SATISFIED' && spec.evidence_target.required_facts.every((f) => b.intent.observed_facts.includes(f)));
  // source snapshot sanity
  const snap = b.source_snapshot;
  add('snapshot_current_for_this_capture', snap.capture_id === spec.capture_id && snap.cache_state !== 'STALE' && Date.parse(snap.observed_at) >= Date.parse(spec.capture.action_completed_at) && Date.parse(snap.observed_at) >= Date.parse(spec.requested_at));
  if (spec.source.type === 'TERMINAL') add('terminal_receipt_binds_transcript', snap.process_receipt && snap.process_receipt.exit_code === 0 && snap.raw_stdout_sha256 === snap.process_receipt.stdout_sha256 && snap.process_receipt.shell === false && b.raw.format === 'TEXT' && b.raw.sha256 === snap.process_receipt.stdout_sha256);
  if (spec.source.type === 'BROWSER') add('browser_state_bound', snap.final_url && snap.auth_state === 'READY' && snap.selector && snap.selector.visible && (b.raw.visible_tokens || []).includes(spec.source.expected_state_nonce));
  if (spec.source.type === 'FILE_OR_CODE') add('file_text_bound', snap.captured_text_sha256 === sha256Bytes(b.raw.visible_text) && snap.source_sha256 === spec.source.source_sha256);
  // provenance
  add('provenance_digest_valid', b.provenance.manifest_digest_sha256 === provenanceManifestDigest(b.provenance) && b.provenance.raw_sha256 === b.raw.sha256 && b.provenance.presentation_sha256 === b.presentation.sha256 && b.provenance.spec_digest_sha256 === specDigest);
  add('motion_not_claimed', spec.capture.mode === 'STATIC_FRAME', 'V1 renders static frames only');
  const verdict = checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  const record = { schema: SCHEMA.qc, qc_id: `qc-${spec.capture_id}-${attemptId}`, reviewer: REVIEWER.id, reviewer_version: REVIEWER.version, independent_of_adapter: true, capture_id: spec.capture_id, spec_digest_sha256: specDigest, verdict, checks, checked_at: new Date().toISOString() };
  record.qc_digest_sha256 = digest(record);
  const oracleQc = { qc_id: record.qc_id, reviewer: REVIEWER.id, independent_of_adapter: true, verdict, bundle_digest_sha256: qcBundleDigest(b), checked_at: record.checked_at };
  return { record, oracleQc, verdict };
}

module.exports = { REVIEWER, review };
