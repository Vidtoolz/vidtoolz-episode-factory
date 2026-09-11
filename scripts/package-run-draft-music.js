'use strict';

/*
 * DRAFT music for a package run: canonical script -> THREE gated 180 s songs.
 *
 * Deliberately modelled on scripts/package-run-draft-narration.js, its sibling
 * audio lane, because the problem is identical: a package run needs a stage
 * that (a) is gated by production mode, (b) writes its media where the run's
 * conventions put media, (c) emits typed evidence a QC policy can recognise,
 * and (d) can be asked its status without filesystem archaeology.
 *
 * Two responsibilities, kept distinguishable exactly as narration keeps them:
 *
 *   buildDraftMusic    runs the music department and enforces the PRODUCTION
 *                      music contract at the stage boundary
 *   attestDraftMusic   emits the typed DRAFT_MUSIC_CANDIDATE_SET evidence,
 *                      re-verifying bytes rather than trusting the manifest
 *
 * WHY THIS EXISTS. draft-music-orchestrator already accepted --run-id and
 * already wrote its artifacts into the run directory, but nothing in the
 * package-run layer knew music existed: no production-mode gate, no typed
 * evidence, no status, and no enforcement of the production contract. The
 * result was a lane that worked in a standalone canary and had never run inside
 * a real package run. Zero of ninety runs carried music.
 *
 * WHAT THIS ADDS OVER THE ORCHESTRATOR. The orchestrator answers "what is the
 * best Draft bed for this script?" using DRAFT-usability bands. This stage
 * answers the narrower PRODUCTION question and refuses anything else:
 *
 *   - exactly THREE candidate slots, no more and no fewer;
 *   - every candidate measured at the exact production duration;
 *   - every candidate carrying Gate V2 development measurements AND a
 *     classification, so no candidate can arrive ungated;
 *   - every candidate distinct in concept, prompt, seed AND output bytes.
 *
 * It does NOT re-implement generation, routing, gating, ranking or selection,
 * and it does not touch human authority: the ranked recommendation stays a
 * recommendation. Mikko remains the music authority.
 *
 * What this music IS: three machine-generated DRAFT candidate beds bound to the
 * exact Story version, adequate for a DRAFT rough cut and for audition.
 *
 * What it is NOT, and must never be recorded as: a final mix, an approved
 * score, publish-ready sound, or a human creative decision.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const productionMode = require('./package-run-production-mode.js');
const orchestrator = require('./draft-music-orchestrator.js');
const coherenceAuthority = require('./draft-music-coherence.js');
const qc = require('./draft-music-qc.js');

const MANIFEST_FILE = 'draft-music-package.json';
const EVIDENCE_FILE = 'draft-music-evidence.json';
const EVIDENCE_SCHEMA = 'vidtoolz.draftMusicEvidence.v1';

/* The typed evidence kind. Deliberately NOT AUDIO_RENDER (a production mix) and
 * deliberately NOT the narration lane's DRAFT_SYNTHETIC_NARRATION: attributing
 * generated music to a narration class merely because both are audio is how a
 * draft bed would eventually be mistaken for an approved score. */
const EVIDENCE_KIND = 'DRAFT_MUSIC_CANDIDATE_SET';
const SEMANTIC_PRODUCER = 'sound_music_director';
const ATTESTER = 'package-run-draft-music.js';
const FIDELITY = 'DRAFT_MACHINE_GENERATED_CANDIDATE';

const MEDIA_DIR = path.join('media', 'draft-music');

/* ── the PRODUCTION music contract ────────────────────────────────────────────
 * Cardinality is exact. Three is not a maximum, a default or a target: the
 * audition is a three-way blind comparison and a two-candidate audition is a
 * different (and weaker) instrument. */
const REQUIRED_CANDIDATES = 3;
const REQUIRED_SLOTS = Object.freeze(['A', 'B', 'C']);

/* Exact duration. The Draft QC band is +/-15 s, which is right for "is this
 * usable enough to judge a video with" and wrong for "is this a three-minute
 * song". Production requires the exact length, measured from DECODED media and
 * never from the requested-duration metadata.
 *
 * The tolerance is 50 ms and exists only for container-level rounding: ffprobe
 * reports the format duration as a decimal, and a WAV's true length is
 * sample-exact. Stable Audio 3 Medium sets the latent length directly and has
 * measured exactly 180.000000 s on every observed render, so 50 ms is generous
 * against the real failure modes, which are whole seconds (a 179.x or 181.x
 * track). The measured duration is ALWAYS reported, tolerance or not. */
const PRODUCTION_DURATION_S = 180;
const PRODUCTION_DURATION_TOLERANCE_S = 0.05;

class DraftMusicStageError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftMusicStageError'; this.code = code; }
}
function fail(code, message) { throw new DraftMusicStageError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function atomicWrite(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

function readManifest(runDir) {
  const file = path.join(path.resolve(runDir), MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    return fail('DRAFT_MUSIC_STAGE_MANIFEST_UNREADABLE', `${MANIFEST_FILE} is not valid JSON`);
  }
}

/* ── contract verification ───────────────────────────────────────────────────
 * Pure over a manifest, so it is unit-testable without generating audio and so
 * the same law applies to a freshly built package and to a resumed one. */
function verifyProductionContract(pkg, options = {}) {
  const tolerance = Number.isFinite(Number(options.durationToleranceS))
    ? Number(options.durationToleranceS) : PRODUCTION_DURATION_TOLERANCE_S;
  const expected = Number.isFinite(Number(options.durationS))
    ? Number(options.durationS) : PRODUCTION_DURATION_S;
  const violations = [];
  const candidates = Array.isArray(pkg && pkg.candidates) ? pkg.candidates : [];

  if (candidates.length !== REQUIRED_CANDIDATES) {
    violations.push(`CARDINALITY: ${candidates.length} candidate(s); the production contract requires exactly ${REQUIRED_CANDIDATES}`);
  }
  const slots = candidates.map((item) => item.candidate_slot);
  if (candidates.length === REQUIRED_CANDIDATES && JSON.stringify(slots) !== JSON.stringify(REQUIRED_SLOTS)) {
    violations.push(`SLOTS: ${JSON.stringify(slots)}; expected ${JSON.stringify(REQUIRED_SLOTS)}`);
  }

  const measured = [];
  const seen = { concept: new Map(), prompt: new Map(), seed: new Map(), output: new Map() };
  for (const candidate of candidates) {
    const slot = candidate.candidate_slot || '?';
    const durationS = Number(candidate.qc && candidate.qc.duration_s);
    measured.push({ slot, measured_duration_s: Number.isFinite(durationS) ? durationS : null });
    if (!Number.isFinite(durationS)) {
      violations.push(`DURATION_UNMEASURED: slot ${slot} carries no decoded duration`);
    } else if (Math.abs(durationS - expected) > tolerance) {
      violations.push(`DURATION: slot ${slot} measured ${durationS}s; the production contract requires ${expected}s +/-${tolerance}s`);
    }

    /* Gate V2 must have RUN on every candidate. A missing development
     * measurement is a violation, never a pass: the whole point of the single
     * acceptance door is that a class cannot exist without one. */
    const coherence = candidate.coherence || null;
    // The live SA3M canary produced complete Gate V2 reports for rejected
    // tracks. Evidence of evaluation is not evidence of acceptance.
    if (!coherence || coherence.draft_usable !== true
        || !['SOLID_SONG', 'DRAFT_MUSIC_USABLE'].includes(coherence.coherence_class)) {
      violations.push(`CANDIDATE_NOT_ACCEPTED: slot ${slot} has not passed Gate V2 (${coherence?.coherence_class || 'UNCLASSIFIED'})`);
    }
    if (!coherence || !coherence.coherence_class) {
      violations.push(`UNGATED: slot ${slot} carries no coherence classification`);
    } else if (!coherence.metrics || !coherence.metrics.development) {
      violations.push(`GATE_V2_MISSING: slot ${slot} carries no Gate V2 development measurement`);
    } else {
      for (const axis of ['band_profile_std_mean', 'energy_range_db', 'dissimilarity_max']) {
        if (typeof coherence.metrics.development[axis] !== 'number') {
          violations.push(`GATE_V2_INCOMPLETE: slot ${slot} is missing development axis ${axis}`);
        }
      }
    }

    /* Within-run uniqueness. Four independent identities must all be distinct:
     * three clones with different seeds are not three songs, and neither are
     * three different prompts that happened to render the same bytes. */
    const keys = [
      ['concept', candidate.concept_label],
      ['prompt', candidate.prompt_sha256],
      ['seed', candidate.seed],
      ['output', candidate.output_sha256],
    ];
    for (const [kind, value] of keys) {
      if (value === undefined || value === null || value === '') {
        violations.push(`UNIQUENESS_UNVERIFIABLE: slot ${slot} has no ${kind} identity`);
        continue;
      }
      const key = String(value);
      if (seen[kind].has(key)) {
        violations.push(`DUPLICATE_${kind.toUpperCase()}: slots ${seen[kind].get(key)} and ${slot} share ${kind} ${key}`);
      } else {
        seen[kind].set(key, slot);
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    required_candidates: REQUIRED_CANDIDATES,
    candidate_count: candidates.length,
    production_duration_s: expected,
    production_duration_tolerance_s: tolerance,
    measured_durations: measured,
  };
}

/* ── build ───────────────────────────────────────────────────────────────────
 * Gated by production mode exactly as narration is: a DRAFT lane must not run
 * against a run that has moved past DRAFT, because its output would look like
 * production sound. */
function resolveMusicContext(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  if (!fs.existsSync(runDir)) fail('DRAFT_MUSIC_STAGE_RUN_MISSING', `no such package run: ${runDir}`);
  const mode = productionMode.readProductionMode(runDir);
  if (mode.mode !== productionMode.DRAFT) {
    fail('DRAFT_MUSIC_STAGE_MODE_REFUSED',
      `the Draft music lane runs only in ${productionMode.DRAFT} mode; this run is ${mode.mode}`);
  }
  const resolved = orchestrator.resolveRunScript(runDir, options);
  if (!resolved.scriptText || resolved.scriptText.trim().length < 80) {
    fail('DRAFT_MUSIC_STAGE_SCRIPT_UNUSABLE', 'the bound Story version yields no usable script text for music planning');
  }
  return { runDir, mode, ...resolved };
}

async function buildDraftMusic(runDirInput, options = {}) {
  const ctx = resolveMusicContext(runDirInput, options);
  const runId = options.runId || path.basename(ctx.runDir);
  const durationS = Number.isFinite(Number(options.durationS)) ? Number(options.durationS) : PRODUCTION_DURATION_S;

  const result = await orchestrator.generateDraftMusic({
    scriptText: ctx.scriptText,
    story: ctx.story,
    outRoot: ctx.runDir,
    runId,
    durationS,
    narrationWav: options.narrationWav || null,
    seed: options.seed,
  }, options);

  const pkg = result.package || readManifest(ctx.runDir);
  const contract = verifyProductionContract(pkg, { durationS, durationToleranceS: options.durationToleranceS });

  return {
    state: contract.ok ? result.state : 'PRODUCTION_CONTRACT_FAILED',
    run_id: runId,
    production_mode: productionMode.DRAFT,
    manifest_path: result.package_path || path.join(ctx.runDir, MANIFEST_FILE),
    media_dir: path.join(ctx.runDir, MEDIA_DIR),
    audition_path: result.audition_path || null,
    contract,
    package: pkg,
  };
}

/* ── attest ──────────────────────────────────────────────────────────────────
 * Re-verify the bytes on disk rather than trusting the manifest, then emit
 * self-describing evidence. Same discipline the narration lane uses. */
function attestDraftMusic(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  const pkg = readManifest(runDir);
  if (!pkg) fail('DRAFT_MUSIC_STAGE_MANIFEST_MISSING', `${MANIFEST_FILE} not found in ${runDir}`);

  const contract = verifyProductionContract(pkg, options);
  const drift = [];
  const candidates = [];
  for (const candidate of Array.isArray(pkg.candidates) ? pkg.candidates : []) {
    const slot = candidate.candidate_slot || '?';
    const file = candidate.output_path ? path.resolve(candidate.output_path) : null;
    const present = Boolean(file && fs.existsSync(file));
    let actual = null;
    if (!present) {
      drift.push(`slot ${slot}: candidate audio is missing (${file || 'no path recorded'})`);
    } else {
      actual = sha256File(file);
      if (actual !== candidate.output_sha256) drift.push(`slot ${slot}: candidate bytes changed since generation`);
    }
    const development = candidate.coherence && candidate.coherence.metrics
      ? candidate.coherence.metrics.development || null : null;
    candidates.push({
      candidate_slot: slot,
      candidate_id: candidate.candidate_id || null,
      concept_label: candidate.concept_label || null,
      model: candidate.model || null,
      seed: candidate.seed === undefined ? null : candidate.seed,
      prompt_sha256: candidate.prompt_sha256 || null,
      attempt_count: candidate.attempt_count === undefined ? null : candidate.attempt_count,
      final_attempt_id: candidate.final_attempt_id || null,
      output_path: candidate.output_path || null,
      recorded_sha256: candidate.output_sha256 || null,
      observed_sha256: actual,
      measured_duration_s: candidate.qc ? candidate.qc.duration_s : null,
      requested_duration_s: candidate.qc ? candidate.qc.requested_duration_s : null,
      technical_ok: candidate.qc ? candidate.qc.ok : null,
      technical_failures: candidate.qc ? candidate.qc.failures || [] : null,
      integrated_lufs: candidate.qc ? candidate.qc.integrated_lufs : null,
      true_peak_dbfs: candidate.qc ? candidate.qc.true_peak_dbfs : null,
      ending_class: candidate.qc ? candidate.qc.ending_class : null,
      coherence_class: candidate.coherence ? candidate.coherence.coherence_class : null,
      draft_usable: candidate.coherence ? candidate.coherence.draft_usable : null,
      solid_song: candidate.coherence ? candidate.coherence.solid_song : null,
      development_degenerate: candidate.coherence ? candidate.coherence.development_degenerate === true : null,
      development_axes_below_floor: candidate.coherence ? candidate.coherence.development_axes_below_floor || [] : null,
      gate_v2_development: development,
      publication_authority: false,
      final_music_authority: false,
    });
  }

  const ranking = Array.isArray(pkg.ranking) ? pkg.ranking : [];
  const evidence = {
    schema: EVIDENCE_SCHEMA,
    evidence_kind: EVIDENCE_KIND,
    semantic_producer: SEMANTIC_PRODUCER,
    attester: ATTESTER,
    fidelity: FIDELITY,
    production_mode: productionMode.DRAFT,
    run_id: pkg.run_id || path.basename(runDir),
    state: contract.ok && drift.length === 0 ? 'VERIFIED' : 'INVALID',
    manifest: {
      file: MANIFEST_FILE,
      schema: pkg.schema || null,
      package_digest_sha256: pkg.package_digest_sha256 || null,
      analysis_digest_sha256: pkg.analysis_digest_sha256 || null,
      script_sha256: pkg.script ? pkg.script.sha256 : null,
    },
    routing: {
      policy: pkg.routing_policy || null,
      mode: pkg.routing_mode || null,
      availability_state: pkg.availability_state || null,
      assignments: pkg.routing || null,
    },
    production_contract: contract,
    byte_drift: drift,
    candidates,
    gate_v2: {
      authority: 'scripts/draft-music-coherence.js classifyTrack',
      contract_floors: coherenceAuthority.COHERENCE_CONTRACT.development_floors,
      validation_status: coherenceAuthority.COHERENCE_CONTRACT.v2_validation_status,
      role: coherenceAuthority.COHERENCE_CONTRACT.development_role,
    },
    qc_authority: 'scripts/draft-music-qc.js inspectTrack',
    qc_ending_classes: [...qc.ENDINGS],
    ranking: {
      doctrine: pkg.ranking_doctrine || null,
      entries: ranking,
      recommended_candidate: pkg.recommended_candidate || null,
      selection_mode: pkg.selection_mode || null,
      is_human_decision: false,
      note: 'automated ranking is a RECOMMENDATION; it confers no creative approval and never selects Final music',
    },
    human_authority: {
      music_authority: 'Mikko Pakkala',
      required_for: ['creative selection', 'Final music authority', 'publication'],
      draft_reference_use: 'INSPIRATION_ONLY',
    },
    publication_authority: false,
    final_music_authority: false,
  };

  if (!options.dryRun) {
    atomicWrite(path.join(runDir, EVIDENCE_FILE), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

function readEvidence(runDir) {
  const file = path.join(path.resolve(runDir), EVIDENCE_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    return fail('DRAFT_MUSIC_STAGE_EVIDENCE_UNREADABLE', `${EVIDENCE_FILE} is not valid JSON`);
  }
}

function draftMusicStatus(runDirInput, options = {}) {
  const runDir = path.resolve(runDirInput);
  /* A status probe must REPORT, never throw: a corrupt manifest is one of the
   * states the caller is asking about, and an exception here would make an
   * unreadable package indistinguishable from a crash in the caller. */
  let manifest;
  try { manifest = readManifest(runDir); } catch (error) {
    return { present: true, valid: false, code: error.code || 'DRAFT_MUSIC_INVALID', detail: error.message, evidence: null };
  }
  if (!manifest) {
    return { present: false, valid: false, code: 'DRAFT_MUSIC_ABSENT', detail: `no ${MANIFEST_FILE}`, evidence: null };
  }
  let evidence;
  try { evidence = attestDraftMusic(runDir, { ...options, dryRun: true }); } catch (error) {
    return { present: true, valid: false, code: error.code || 'DRAFT_MUSIC_INVALID', detail: error.message, evidence: null };
  }
  if (evidence.state !== 'VERIFIED') {
    const detail = [...evidence.production_contract.violations, ...evidence.byte_drift].join('; ');
    /* Precedence: a contract violation outranks byte drift. If the candidate
     * set is the wrong shape - two slots, a 179 s track, an ungated candidate -
     * that is the fact the operator needs, whatever any single file's bytes are
     * doing. Byte drift is the code only when the set itself is well formed. */
    return {
      present: true,
      valid: false,
      code: evidence.production_contract.violations.length ? 'DRAFT_MUSIC_CONTRACT_VIOLATION' : 'DRAFT_MUSIC_BYTE_DRIFT',
      detail,
      evidence,
    };
  }
  return { present: true, valid: true, code: null, detail: null, evidence };
}

module.exports = {
  MANIFEST_FILE, EVIDENCE_FILE, EVIDENCE_SCHEMA, EVIDENCE_KIND,
  SEMANTIC_PRODUCER, ATTESTER, FIDELITY, MEDIA_DIR,
  REQUIRED_CANDIDATES, REQUIRED_SLOTS, PRODUCTION_DURATION_S, PRODUCTION_DURATION_TOLERANCE_S,
  DraftMusicStageError,
  verifyProductionContract, resolveMusicContext, buildDraftMusic,
  attestDraftMusic, readEvidence, readManifest, draftMusicStatus,
};
