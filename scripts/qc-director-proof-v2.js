#!/usr/bin/env node
'use strict';

/*
 * QC DIRECTOR V2 — PRODUCTION-PATH PROOF
 *
 * Exercises the CANONICAL dispatch chain end-to-end without touching the live
 * registry: an isolated test root carries a fixture copy of
 * config/agent-registry.json whose qc_director entry is flipped to
 * IMPLEMENTATION_PROVEN, plus a copy of scripts/. The real canonical runner
 * (scripts/agent-run.js -> runRegisteredAgent) is invoked against that root:
 *
 *   resolve -> implementation readiness -> module load + identity ->
 *   action validation -> child-process invocation -> canonical envelope
 *   validation -> result writing -> invocation completion
 *
 * The live production registry state is proven unchanged by hash before and
 * after. This is criterion #4 of docs/implementation-promotion-criteria.md.
 * It is evidence, not promotion.
 *
 * No Earth Studio module is imported or executed anywhere in this proof. The
 * camera cases are driven by synthetic objects in the DURABLE
 * camera-quality.json result shape, which QC consumes read-only.
 *
 * Usage:
 *   node scripts/qc-director-proof-v2.js                 # library
 *   node scripts/qc-director-proof-v2.js --emit <dir>    # one-shot
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const AGENT_ID = 'qc_director';

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function buildIsolatedRoot(options = {}) {
  // Copy scripts/ and a fixture registry into an isolated root. Only the
  // fixture registry is modified (implementation_state flip); no source code
  // changes, no authority changes, no lifecycle changes.
  const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'qc-prodpath-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'package-runs'), { recursive: true });
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
  copyTree(path.join(sourceRoot, 'scripts'), path.join(root, 'scripts'));
  for (const file of ['agent-registry.json', 'agent-contract.json', 'system-registry.json', 'media-routing.json']) {
    const from = path.join(sourceRoot, 'config', file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(root, 'config', file));
  }
  const registryPath = path.join(root, 'config', 'agent-registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const registration = registry.agents.find((agent) => agent.agent_id === AGENT_ID);
  if (!registration) throw new Error('fixture registry lost qc_director');
  const originalState = registration.implementation_state;
  registration.implementation_state = 'IMPLEMENTATION_PROVEN';
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  return { root, fixtureFlippedFrom: originalState };
}

// ── canary production evidence written into the isolated root ─────────────
// Real files on disk, hashed for real, so byte-identity and staleness checks
// exercise the same code path production would.
function seedCanaryEvidence(root, runId) {
  const runDir = path.join('package-runs', runId, 'canary');
  const absoluteRunDir = path.join(root, runDir);
  fs.mkdirSync(absoluteRunDir, { recursive: true });

  const write = (name, content) => {
    const bytes = Buffer.from(content);
    fs.writeFileSync(path.join(absoluteRunDir, name), bytes);
    return { relative: path.join(runDir, name), sha256: sha256(bytes), byte_size: bytes.length };
  };

  const roughCut = write('rough-cut.mp4', 'ROUGH CUT MASTER BYTES v2\n');
  const cameraReport = write('camera-quality.json', `${JSON.stringify({
    schema_version: 1,
    verdict: 'PASS_FOR_HUMAN_REVIEW',
    scope: 'machine continuity and serialization checks; not an aesthetic approval',
    errors: [],
    warnings: [],
  }, null, 2)}\n`);
  const generationReport = write('generation-result.json', `${JSON.stringify({
    schema_version: 1,
    state: 'COMPLETE',
    outputs: [{ path: 'canary/asset-01.png', sha256: sha256('asset-01') }],
    provenance: { generating_agent: 'generation_supervisor', route: { lane: 'text_to_image_generation', engine: 'comfyui' } },
  }, null, 2)}\n`);
  return { runDir, roughCut, cameraReport, generationReport };
}

function cases(runId, seeded) {
  const editHandoff = (overrides = {}) => ({
    artifact_type: 'edit-plan-qc-handoff',
    edit_plan_id: 'canary-edit-1',
    edit_plan_revision: 2,
    edit_plan_digest_sha256: sha256('canary-edit-plan-v2'),
    findings: [],
    rendered_media_ref: {
      path_or_artifact_ref: seeded.roughCut.relative,
      sha256: seeded.roughCut.sha256,
      byte_size: seeded.roughCut.byte_size,
    },
    ...overrides,
  });

  return [
    {
      id: 'A-information-status',
      task: {
        task_id: 'qc-v2-A-status', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'status' },
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'COMPLETE', attention: 'INFORMATION', disposition: 'PASS', next_gate_allowed: false },
    },
    {
      id: 'B-pass-generation',
      // POSITIVE CANARY: a real persisted generation result, real deterministic
      // hash binding, QC PASS, next gate allowed.
      task: {
        task_id: 'qc-v2-B-generation', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'production-plan',
        subject: {
          artifact_id: 'canary-generated-asset', artifact_type: 'GENERATED_IMAGE',
          producing_agent: 'generation_supervisor', version_id: 'gen-v1',
        },
        evidence: [{
          evidence_id: 'generation-result', kind: 'GENERATION_RESULT', evidence_class: 'SPECIALIST',
          produced_by: 'generation_supervisor', path: seeded.generationReport.relative,
          sha256: seeded.generationReport.sha256,
          binds_to: { artifact_id: 'canary-generated-asset', version_id: 'gen-v1' },
        }],
        required_evidence: ['GENERATION_RESULT'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'COMPLETE', attention: 'INFORMATION', disposition: 'PASS', next_gate_allowed: true, next_owner: 'production_operations' },
    },
    {
      id: 'C-fail-camera-defect',
      task: {
        task_id: 'qc-v2-C-camera-fail', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'production-plan',
        subject: {
          artifact_id: 'canary-camera-artifact', artifact_type: 'EARTH_STUDIO_PROJECT',
          producing_agent: 'camera_director', version_id: 'cam-v1',
        },
        evidence: [{
          evidence_id: 'camera-quality', kind: 'CAMERA_QUALITY', evidence_class: 'DETERMINISTIC',
          produced_by: 'earth-studio-camera-quality',
          binds_to: { artifact_id: 'canary-camera-artifact', version_id: 'cam-v1' },
          payload: {
            schema_version: 1, verdict: 'FAIL',
            errors: ['segment 3 (orbit) radius breathes 7.4% — exceeds the 2% tolerance'],
            warnings: ['segment 1 moves only 3.1% closer'],
          },
        }],
        required_evidence: ['CAMERA_QUALITY'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'FAIL', attention: 'REVIEW', disposition: 'FAIL', next_gate_allowed: false, next_owner: 'camera_director' },
    },
    {
      id: 'D-blocked-missing-evidence',
      // NEGATIVE CANARY: required evidence was never produced. QC must not read
      // an empty defect list as quality.
      task: {
        task_id: 'qc-v2-D-missing-evidence', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'production-plan',
        subject: {
          artifact_id: 'canary-camera-artifact', artifact_type: 'EARTH_STUDIO_PROJECT',
          producing_agent: 'camera_director', version_id: 'cam-v1',
        },
        evidence: [],
        required_evidence: ['CAMERA_QUALITY'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'BLOCKED', attention: 'REVIEW', disposition: 'BLOCKED', next_gate_allowed: false, blocker_code: 'QC_REQUIRED_EVIDENCE_MISSING' },
    },
    {
      id: 'E-blocked-stale-evidence',
      // NEGATIVE CANARY: the same bounded artifact, but validation bound to a
      // superseded revision. Hash lineage, not mtime, decides.
      task: {
        task_id: 'qc-v2-E-stale-evidence', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'rough-cut-review',
        subject: {
          artifact_id: 'canary-rough-cut', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor',
          artifact_path: seeded.roughCut.relative, artifact_sha256: seeded.roughCut.sha256, version_id: 'edit-v2',
        },
        evidence: [{
          evidence_id: 'edit-qc-handoff', kind: 'EDIT_QC_HANDOFF', evidence_class: 'SPECIALIST',
          produced_by: 'editor',
          binds_to: { artifact_id: 'canary-rough-cut', artifact_sha256: sha256('ROUGH CUT MASTER BYTES v1\n') },
          payload: editHandoff(),
        }],
        required_evidence: ['EDIT_QC_HANDOFF'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'BLOCKED', attention: 'REVIEW', disposition: 'BLOCKED', next_gate_allowed: false, blocker_code: 'QC_EVIDENCE_STALE' },
    },
    {
      id: 'F-human-review-required',
      // HUMAN-REVIEW CANARY: every technical gate passes, the human creative
      // authority is absent, and QC refuses to stand in for Mikko.
      task: {
        task_id: 'qc-v2-F-human-review', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'rough-cut-review',
        subject: {
          artifact_id: 'canary-rough-cut', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor',
          artifact_path: seeded.roughCut.relative, artifact_sha256: seeded.roughCut.sha256, version_id: 'edit-v2',
        },
        evidence: [{
          evidence_id: 'edit-qc-handoff', kind: 'EDIT_QC_HANDOFF', evidence_class: 'SPECIALIST',
          produced_by: 'editor',
          binds_to: { artifact_id: 'canary-rough-cut', artifact_sha256: seeded.roughCut.sha256, version_id: 'edit-v2' },
          payload: editHandoff(),
        }],
        required_evidence: ['EDIT_QC_HANDOFF'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'HUMAN_REVIEW_REQUIRED', attention: 'REVIEW', disposition: 'HUMAN_REVIEW_REQUIRED', next_gate_allowed: false, next_owner: 'mikko' },
    },
    {
      id: 'G-camera-machine-pass-is-not-aesthetic-pass',
      // The camera-quality artifact states its own scope: machine continuity,
      // explicitly not an aesthetic approval. A machine PASS therefore leaves
      // the visual judgement open rather than promoting the gate.
      task: {
        task_id: 'qc-v2-G-camera-pass', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'production-plan',
        subject: {
          artifact_id: 'canary-camera-artifact', artifact_type: 'EARTH_STUDIO_PROJECT',
          producing_agent: 'camera_director', version_id: 'cam-v1',
        },
        evidence: [{
          evidence_id: 'camera-quality', kind: 'CAMERA_QUALITY', evidence_class: 'DETERMINISTIC',
          produced_by: 'earth-studio-camera-quality', path: seeded.cameraReport.relative,
          sha256: seeded.cameraReport.sha256,
          binds_to: { artifact_id: 'canary-camera-artifact', version_id: 'cam-v1' },
        }],
        required_evidence: ['CAMERA_QUALITY'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'HUMAN_REVIEW_REQUIRED', attention: 'REVIEW', disposition: 'HUMAN_REVIEW_REQUIRED', next_gate_allowed: false, next_owner: 'mikko' },
    },
    {
      id: 'H-blocked-malformed-input',
      // NEGATIVE DISPATCH: malformed input on the live production path must
      // fail closed with a typed blocker, never a permissive default.
      task: {
        task_id: 'qc-v2-H-malformed', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'production-plan',
        subject: {
          artifact_id: 'canary-unsafe', artifact_type: 'EDIT_EXPORT', producing_agent: 'editor',
          artifact_path: '../../../etc/passwd',
        },
        evidence: [], required_evidence: [],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'BLOCKED', attention: 'REVIEW', disposition: 'BLOCKED', next_gate_allowed: false, blocker_code: 'QC_ARTIFACT_PATH_UNSAFE' },
    },
    {
      id: 'I-blocked-wrong-artifact-identity',
      // NEGATIVE DISPATCH: evidence that describes a different artifact must
      // never be silently accepted as describing this one.
      task: {
        task_id: 'qc-v2-I-wrong-identity', package_run_id: runId, requested_by: 'hermes',
        assignment: { action: 'inspect_artifact' }, gate: 'production-plan',
        subject: {
          artifact_id: 'canary-camera-artifact', artifact_type: 'EARTH_STUDIO_PROJECT',
          producing_agent: 'camera_director', version_id: 'cam-v1',
        },
        evidence: [{
          evidence_id: 'camera-quality', kind: 'CAMERA_QUALITY', evidence_class: 'DETERMINISTIC',
          produced_by: 'earth-studio-camera-quality', path: seeded.cameraReport.relative,
          sha256: seeded.cameraReport.sha256,
          binds_to: { artifact_id: 'a-completely-different-artifact' },
        }],
        required_evidence: ['CAMERA_QUALITY'],
      },
      expect: { infrastructure_state: 'COMPLETE', state: 'BLOCKED', attention: 'REVIEW', disposition: 'BLOCKED', next_gate_allowed: false, blocker_code: 'QC_EVIDENCE_ARTIFACT_MISMATCH' },
    },
  ];
}

async function runProductionPath(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'));
  const runner = require(path.join(sourceRoot, 'scripts', 'agent-run.js'));
  const { root, fixtureFlippedFrom } = buildIsolatedRoot({ ...options, sourceRoot });
  const runId = options.runId || 'qc-production-path-canary';
  fs.mkdirSync(path.join(root, 'package-runs', runId), { recursive: true });
  const seeded = seedCanaryEvidence(root, runId);
  const results = [];
  for (const entry of cases(runId, seeded)) {
    const taskPath = path.join(root, 'package-runs', runId, `${entry.id}-task.json`);
    fs.writeFileSync(taskPath, `${JSON.stringify(entry.task, null, 2)}\n`);
    let output = null;
    let error = null;
    try {
      output = await runner.runRegisteredAgent({ repoRoot: root, agentId: AGENT_ID, runId, taskPath });
    } catch (err) { error = { code: err.code, message: err.message }; }
    results.push({ id: entry.id, expect: entry.expect, error, output });
  }
  return { root, runId, fixtureFlippedFrom, seeded, results };
}

function evaluate(results) {
  const failures = [];
  for (const result of results) {
    const expect = result.expect;
    const semantic = result.output?.result;
    if (result.error) { failures.push(`${result.id}: runner error ${result.error.code}`); continue; }
    if (result.output?.infrastructure_state !== expect.infrastructure_state) {
      failures.push(`${result.id}: infrastructure_state ${result.output?.infrastructure_state}`); continue;
    }
    if (!semantic) { failures.push(`${result.id}: no semantic result`); continue; }
    if (expect.state && semantic.state !== expect.state) failures.push(`${result.id}: state ${semantic.state}`);
    if (expect.disposition && semantic.disposition !== expect.disposition) failures.push(`${result.id}: disposition ${semantic.disposition}`);
    if (expect.attention && semantic.attention !== expect.attention) failures.push(`${result.id}: attention ${semantic.attention}`);
    if (expect.next_gate_allowed !== undefined && semantic.next_gate_allowed !== expect.next_gate_allowed) {
      failures.push(`${result.id}: next_gate_allowed ${semantic.next_gate_allowed}`);
    }
    if (expect.next_owner && semantic.handoff?.next_owner !== expect.next_owner) {
      failures.push(`${result.id}: next_owner ${semantic.handoff?.next_owner}`);
    }
    if (expect.blocker_code && !(semantic.blockers || []).some((b) => b.code === expect.blocker_code)) {
      failures.push(`${result.id}: missing blocker ${expect.blocker_code}`);
    }
    if (semantic.aesthetic_authority && semantic.aesthetic_authority.claimed !== false) {
      failures.push(`${result.id}: QC claimed aesthetic authority`);
    }
  }
  return failures;
}

if (require.main === module) {
  const emitIndex = process.argv.indexOf('--emit');
  if (emitIndex < 0) { console.error('usage: qc-director-proof-v2.js --emit <dir>'); process.exit(2); }
  const emitDir = path.resolve(process.argv[emitIndex + 1]);
  fs.mkdirSync(emitDir, { recursive: true });
  (async () => {
    const sourceRoot = path.resolve(__dirname, '..');
    const liveRegistryPath = path.join(sourceRoot, 'config', 'agent-registry.json');
    const liveBefore = fs.readFileSync(liveRegistryPath).toString('utf8');
    const proof = await runProductionPath({ sourceRoot });
    const liveAfter = fs.readFileSync(liveRegistryPath).toString('utf8');
    const liveRegistration = JSON.parse(liveAfter).agents.find((a) => a.agent_id === AGENT_ID);

    const artifacts = {};
    const caseList = cases(proof.runId, proof.seeded);
    for (const result of proof.results) {
      const dir = path.join(emitDir, result.id);
      fs.mkdirSync(dir, { recursive: true });
      const taskId = caseList.find((c) => c.id === result.id)?.task.task_id;
      const src = path.join(proof.root, 'package-runs', proof.runId, 'agents', AGENT_ID, String(taskId || ''));
      for (const file of ['task.json', 'result.json', 'invocation.json']) {
        const from = path.join(src, file);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
      }
      const invocationPath = path.join(src, 'invocation.json');
      const invocation = fs.existsSync(invocationPath) ? JSON.parse(fs.readFileSync(invocationPath, 'utf8')) : null;
      const semantic = result.output?.result || null;
      artifacts[result.id] = {
        runner_error: result.error,
        runner_infrastructure_state: result.output?.infrastructure_state ?? null,
        semantic_state: invocation?.semantic_state ?? semantic?.state ?? null,
        disposition: semantic?.disposition ?? null,
        reason: semantic?.reason ?? null,
        attention: invocation?.handoff_summary?.attention ?? semantic?.attention ?? null,
        next_owner: invocation?.handoff_summary?.next_owner ?? semantic?.handoff?.next_owner ?? null,
        next_gate_allowed: semantic?.next_gate_allowed ?? null,
        blocker_codes: (semantic?.blockers || []).map((b) => b.code),
        defect_codes: (semantic?.defects || []).map((b) => b.code),
        warning_codes: (semantic?.warnings || []).map((b) => b.code),
        aesthetic_authority_claimed: semantic?.aesthetic_authority?.claimed ?? null,
        envelope_valid: invocation ? invocation.envelope_error === null : false,
        task_sha256: invocation?.task_sha256 ?? null,
        result_sha256: invocation?.result_sha256 ?? null,
        qc_result_digest_sha256: semantic?.qc_result_digest_sha256 ?? null,
        module_sha256: invocation?.module_sha256 ?? null,
      };
    }

    // Mutation safety: the canary artifact QC inspected must be byte-identical
    // after the whole proof run.
    const roughCutPath = path.join(proof.root, proof.seeded.roughCut.relative);
    const roughCutAfter = sha256(fs.readFileSync(roughCutPath));

    const failures = evaluate(proof.results);
    const summary = {
      schema_version: 1,
      proof: 'QC_DIRECTOR_PRODUCTION_PATH_PROOF_V2',
      generated_at: new Date().toISOString(),
      promotion_criteria_version: 'v1 (docs/implementation-promotion-criteria.md)',
      live_registry: {
        sha256_before: sha256(liveBefore),
        sha256_after: sha256(liveAfter),
        unchanged: liveBefore === liveAfter,
        implementation_state: liveRegistration.implementation_state,
        lifecycle: liveRegistration.lifecycle,
      },
      isolated_fixture: { registry_flipped_from: proof.fixtureFlippedFrom, to: 'IMPLEMENTATION_PROVEN', root: 'temporary (os.tmpdir)' },
      dispatch_chain_proven: [
        'canonical resolve', 'implementation readiness (fixture PROVEN)',
        'module load + AGENT_ID identity', 'action validation',
        'child-process invocation', 'canonical envelope validation',
        'result writing', 'invocation completion',
      ],
      mutation_safety: {
        inspected_artifact: proof.seeded.roughCut.relative,
        sha256_before: proof.seeded.roughCut.sha256,
        sha256_after: roughCutAfter,
        unchanged: roughCutAfter === proof.seeded.roughCut.sha256,
      },
      earth_studio_isolation: {
        statement: 'no Earth Studio module is imported or executed by this proof; camera evidence is consumed as durable camera-quality.json result data only',
        camera_module_loaded: false,
      },
      cases: artifacts,
      verdict: null,
    };
    summary.verdict = failures.length === 0
      && summary.live_registry.unchanged
      && summary.mutation_safety.unchanged
      ? 'PRODUCTION_PATH_PROOF_PASS'
      : `PRODUCTION_PATH_PROOF_FAIL — ${failures.join('; ') || 'registry or mutation fidelity check failed'}`;

    fs.writeFileSync(path.join(emitDir, 'production-path-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    fs.rmSync(proof.root, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({
      verdict: summary.verdict, cases: Object.keys(artifacts).length,
      live_registry_unchanged: summary.live_registry.unchanged,
      live_implementation_state: summary.live_registry.implementation_state,
    }, null, 2)}\n`);
    process.exitCode = summary.verdict.startsWith('PRODUCTION_PATH_PROOF_PASS') ? 0 : 1;
  })().catch((error) => {
    process.stdout.write(`${JSON.stringify({ verdict: 'PRODUCTION_PATH_PROOF_FAIL', error: error.message, stack: error.stack }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { AGENT_ID, sha256, buildIsolatedRoot, seedCanaryEvidence, cases, runProductionPath, evaluate };
