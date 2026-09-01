'use strict';

/*
 * Final Music Production authority.
 *
 * Turns the lock-bound Final Music Brief into a publication-stage soundtrack
 * decision without ever making the creative choice on Mikko's behalf:
 *
 *   FINAL_PRODUCTION_LOCK
 *     → Final Music Brief (already built by the Final Production Package)
 *     → PATH A  generateFinalCandidates()  fresh Final-stage renders
 *       PATH B  ingestMusic()              manual / externally produced track
 *     → immutable candidate registration + technical QC + coherence diagnostics
 *     → Mikko explicitly selects                        FINAL_MUSIC_AUTHORITY
 *     → projectResolveMusic()                           derived Resolve view
 *
 * Three authority rules are absolute:
 *
 *   DRAFT MUSIC NEVER BECOMES FINAL MUSIC. A Draft track is INSPIRATION_ONLY.
 *   Its bytes may be re-ingested as a *new* Final-stage candidate, but no Draft
 *   selection, verdict or ranking is ever inherited as Final authority.
 *
 *   A CANDIDATE IS NOT A SELECTION. Generation and ingest both land on
 *   disposition CANDIDATE with selected:false. Machine diagnostics rank and
 *   recommend; they never select.
 *
 *   ONLY A NAMED HUMAN CREATES FINAL AUTHORITY. Machine-shaped authorities are
 *   refused outright, and no score, order or recency implies a decision.
 *
 * Both entry paths converge on ONE candidate registry, ONE selection mechanism
 * and ONE FINAL_MUSIC_AUTHORITY. There is no separate "manual music" subsystem.
 *
 * Reused rather than reinvented: the MusicRenderBrief contract, the Draft
 * music prompt architecture, the Draft music technical QC (ffprobe/ffmpeg
 * probe, clipping measurement, ending classification) and the human-calibrated
 * coherence analyser. What is new here is only the Final *stage* authority:
 * candidate identity, human selection, completion and the Resolve projection.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const lockAuthority = require('./final-production-lock.js');
const pkgAuthority = require('./final-production-package.js');
const qc = require('./draft-music-qc.js');
const coherenceAuthority = require('./draft-music-coherence.js');
const prompts = require('./draft-music-prompts.js');
const analysis = require('./draft-music-analysis.js');
const briefContract = require('../score-engine/music-render-brief.js');

const CANDIDATE_SCHEMA = 'vidtoolz.finalMusicCandidate.v1';
const REGISTRY_SCHEMA = 'vidtoolz.finalMusicRegistry.v1';
const SELECTION_SCHEMA = 'vidtoolz.finalMusicSelection.v1';
const PROJECTION_SCHEMA = 'vidtoolz.finalResolveMusicProjection.v1';
const RENDER_BRIEF_SCHEMA = 'vidtoolz.finalMusicRenderBrief.v1';

const MUSIC_DIR = 'music';

/* Final-stage acceptance. Deliberately NOT the Draft ladder: DRAFT_MUSIC_USABLE
 * is a "good enough to evaluate the video" standard and is never sufficient for
 * publication. AUDITIONABLE_FINAL_CANDIDATE is the recommend-for-audition tier;
 * TECHNICALLY_VALID is playable and selectable but not recommended. */
const ACCEPTANCE = Object.freeze([
  'AUDITIONABLE_FINAL_CANDIDATE', 'TECHNICALLY_VALID', 'REJECT_COHERENCE', 'REJECT_TECHNICAL',
]);
const DISPOSITIONS = Object.freeze(['CANDIDATE', 'KEEP_AS_ALTERNATE', 'REJECTED', 'SELECTED', 'SUPERSEDED']);
const SOURCE_TYPES = Object.freeze(['GENERATED', 'MANUAL_EXTERNAL']);

/* Container/codec support comes from the existing ffmpeg probe layer; no new
 * codec handling is introduced here. */
const AUDIO_CODECS = Object.freeze([
  'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_s16be', 'pcm_s24be',
  'flac', 'mp3', 'aac', 'alac', 'vorbis', 'opus',
]);
const EXTENSIONS = Object.freeze({
  pcm_s16le: '.wav', pcm_s24le: '.wav', pcm_s32le: '.wav', pcm_f32le: '.wav',
  pcm_s16be: '.aiff', pcm_s24be: '.aiff',
  flac: '.flac', mp3: '.mp3', aac: '.m4a', alac: '.m4a', vorbis: '.ogg', opus: '.opus',
});

/* Draft QC failure codes partitioned for the Final stage. Duration drift is a
 * WARNING, not a rejection: an externally produced track legitimately runs
 * long or short and the edit trims it — refusing Mikko's finished music on
 * arithmetic would be the tool overruling the human. A truncated ending is a
 * hard failure because the media itself is incomplete. */
const HARD_TECHNICAL = Object.freeze([
  'DRAFT_MUSIC_FILE_MISSING_OR_EMPTY', 'DRAFT_MUSIC_UNREADABLE', 'DRAFT_MUSIC_NO_AUDIO_STREAM',
  'DRAFT_MUSIC_DECODE_FAILED', 'DRAFT_MUSIC_FEATURE_DECODE_FAILED', 'DRAFT_MUSIC_CLIPPING',
  'DRAFT_MUSIC_TRUNCATED_ENDING',
]);
const DURATION_WARNINGS = Object.freeze(['DRAFT_MUSIC_TOO_SHORT', 'DRAFT_MUSIC_TOO_LONG']);
/* The reused QC layer speaks in DRAFT_* codes. Those must not leak into Final
 * candidate records or operator output: a DRAFT_ prefix inside Final authority
 * data reads as if Draft music were involved, which is exactly the stage
 * conflation this authority exists to prevent. */
const FINAL_WARNING_NAMES = Object.freeze({
  DRAFT_MUSIC_TOO_SHORT: 'FINAL_MUSIC_SHORTER_THAN_PROGRAMME',
  DRAFT_MUSIC_TOO_LONG: 'FINAL_MUSIC_LONGER_THAN_PROGRAMME',
});
function finalWarningName(code) { return FINAL_WARNING_NAMES[code] || code; }
const MIN_DURATION_S = 5;
const DURATION_TOLERANCE_S = 15;
/* Endings recommended for a publication soundtrack. ABRUPT_END stays
 * selectable — strongly penalised, never vetoed. */
const RECOMMENDED_ENDINGS = Object.freeze(['CLEAN_END', 'FADE_ACCEPTABLE']);

class FinalMusicError extends Error {
  constructor(code, message) { super(message); this.name = 'FinalMusicError'; this.code = code; }
}
function fail(code, message) { throw new FinalMusicError(code, message); }
function digest(value) { return lockAuthority.digest(value); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file, code = 'FINAL_MUSIC_JSON_INVALID') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(code, `${file}: ${error.message}`); }
}
function jsonBytes(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writeImmutable(file, value) {
  const payload = jsonBytes(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== payload) fail('FINAL_MUSIC_IMMUTABLE_CONFLICT', file);
    return false;
  }
  fs.writeFileSync(file, payload, { flag: 'wx' });
  return true;
}
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, jsonBytes(value));
  fs.renameSync(tmp, file);
}
function nowIso(options = {}) { return options.now || new Date().toISOString(); }

function musicPaths(runDir) {
  const base = path.join(pkgAuthority.packagePaths(runDir).base, MUSIC_DIR);
  return {
    base,
    registry: path.join(base, 'final-music-registry.json'),
    selection: path.join(base, 'final-music-selection.json'),
    projection: path.join(base, 'final-resolve-music-projection.json'),
    candidates: path.join(base, 'candidates'),
    media: path.join(base, 'media'),
    renders: path.join(base, 'renders'),
  };
}

/* ---------------------------------------------------------------------------
 * Canonical context. Everything authoritative is resolved from the run id:
 * the caller never supplies a lock, a brief, a path or a hash.
 * ------------------------------------------------------------------------- */
function context(runDirInput, options = {}) {
  let runDir;
  try { runDir = fs.realpathSync(runDirInput); } catch { fail('FINAL_MUSIC_RUN_MISSING', `no such run directory: ${runDirInput}`); }

  let lock;
  try { ({ lock } = lockAuthority.loadFinalProductionLock(runDir)); } catch (error) {
    fail('FINAL_MUSIC_LOCK_MISSING', `no current Final Production Lock for this run (${error.message})`);
  }
  try { lockAuthority.verifyLockCurrent(runDir, lock, options); } catch (error) {
    fail('FINAL_MUSIC_LOCK_STALE', `the Final Production Lock is no longer current (${error.message}); Final music authority is stale and must not be reinterpreted`);
  }

  const pkgPaths = pkgAuthority.packagePaths(runDir);
  if (!fs.existsSync(pkgPaths.package)) fail('FINAL_MUSIC_PACKAGE_MISSING', 'no Final Production Package exists for this run');
  const pkg = readJson(pkgPaths.package, 'FINAL_MUSIC_PACKAGE_INVALID');
  if (pkg.lock_digest_sha256 !== lock.lock_digest_sha256) {
    fail('FINAL_MUSIC_PACKAGE_STALE', 'the Final Production Package belongs to a different lock');
  }

  const component = pkg.components?.final_music_brief;
  if (!component) fail('FINAL_MUSIC_BRIEF_MISSING', 'the package declares no Final Music Brief');
  const briefFile = path.resolve(runDir, component.path);
  if (!fs.existsSync(briefFile)) fail('FINAL_MUSIC_BRIEF_MISSING', `the Final Music Brief is absent at ${component.path}`);
  if (sha256File(briefFile) !== component.sha256) {
    fail('FINAL_MUSIC_BRIEF_STALE', 'the Final Music Brief bytes changed after packaging; Final music direction is stale');
  }
  const brief = readJson(briefFile, 'FINAL_MUSIC_BRIEF_INVALID');
  if (brief.schema !== pkgAuthority.MUSIC_SCHEMA) {
    fail('FINAL_MUSIC_BRIEF_INVALID', `expected ${pkgAuthority.MUSIC_SCHEMA}, found ${brief.schema}`);
  }
  if (brief.lock_digest_sha256 !== lock.lock_digest_sha256) {
    fail('FINAL_MUSIC_BRIEF_STALE', 'the Final Music Brief is bound to a different lock');
  }

  /* The locked script is the timing spine the music has to fit. */
  const scriptComponent = pkg.components?.final_script;
  if (scriptComponent) {
    const scriptFile = path.resolve(runDir, scriptComponent.path);
    if (!fs.existsSync(scriptFile) || sha256File(scriptFile) !== scriptComponent.sha256) {
      fail('FINAL_MUSIC_SCRIPT_DRIFT', 'the locked script bytes changed after packaging; Final music must not be bound to a changed script');
    }
  }

  return {
    runDir,
    lock,
    pkg,
    brief,
    briefSha256: component.sha256,
    scriptSha256: scriptComponent?.sha256 ?? null,
    paths: musicPaths(runDir),
    pkgPaths,
  };
}

/* ---------------------------------------------------------------------------
 * Final Music Brief → MusicRenderBrief (the shared generation primitive).
 * ------------------------------------------------------------------------- */
function energyCurveFor(brief) {
  const progression = brief.emotional_progression || [];
  if (progression.includes('REFRAME') && progression.includes('RESOLUTION')) return 'build-release';
  if (progression.length <= 2) return 'flat-low';
  if (progression.filter((item) => item === 'HUMOR').length >= 2) return 'two-peak';
  return 'slow-build';
}

function renderBriefFor(ctx) {
  const brief = ctx.brief;
  const targetS = brief.target_duration_ms ? Math.round(brief.target_duration_ms / 1000) : null;
  if (!targetS || targetS <= 0) fail('FINAL_MUSIC_BRIEF_INVALID', 'the Final Music Brief carries no usable target duration');
  const map = brief.music_function_map || [];
  const sections = map.length
    ? map.map((item, index) => ({
      name: `${index + 1}-${String(item.music_function || 'section').toLowerCase()}`.slice(0, 40),
      start_s: Math.max(0, Math.round((item.start_ms ?? 0) / 1000)),
      end_s: Math.max(1, Math.round((item.end_ms ?? (index + 1) * 1000) / 1000)),
      notes: String(item.narrative_purpose || item.music_function || 'section').slice(0, 200),
    }))
    : [{ name: '1-whole', start_s: 0, end_s: targetS, notes: 'single continuous underlay' }];
  /* The contract forbids overlapping sections; the locked beat map is already
   * ordered, but clamp defensively rather than emit an invalid brief. */
  let cursor = 0;
  for (const section of sections) {
    if (section.start_s < cursor) section.start_s = cursor;
    if (section.end_s <= section.start_s) section.end_s = section.start_s + 1;
    cursor = section.end_s;
  }
  const last = sections[sections.length - 1];
  if (last.end_s < targetS) last.end_s = targetS;

  const slug = String(ctx.lock.run_id || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const renderBrief = {
    brief_id: `final-music-${slug}`.slice(0, 80).replace(/-+$/, ''),
    brief_version: 1,
    purpose: `Publication-stage instrumental underlay for the locked VIDTOOLZ programme; ${brief.style_guidance?.role || 'underlay beneath continuous narration'}.`.slice(0, 400),
    target_duration_s: targetS,
    tempo: 'free',
    energy_curve: energyCurveFor(brief),
    sections: sections.slice(0, 12),
    ending: 'clear-button',
    mix_role: 'underlay',
    avoid: (brief.style_guidance?.narration_compatibility || ['lead vocals'])
      .map((item) => String(item).slice(0, 60)),
  };
  const errors = briefContract.validateMusicRenderBrief(renderBrief);
  if (errors.length) fail('FINAL_MUSIC_RENDER_BRIEF_INVALID', errors[0]);
  return renderBrief;
}

/* Three Final-stage concepts that differ on at least DIVERSITY_MIN_MAJOR_DIFF
 * major axes, so the candidate set is genuinely distinct rather than three
 * seeds of one idea. Fixed rather than sampled: Final generation must be
 * reproducible from the lock. */
const FINAL_CONCEPTS = Object.freeze([
  {
    candidate_slot: 'A', concept_label: 'warm-analog-underlay',
    character: 'A warm, patient analog bed: one recurring motif on soft keys, brushed low percussion, unhurried and confident under speech.',
    diversity_vector: {
      genre_family: 'acoustic_organic', tempo_feel: 'slow', instrumentation_family: 'piano_keys',
      acoustic_electronic_balance: 'leaning_acoustic', pulse_style: 'sparse_pulse', percussion_style: 'soft_brushed',
      rhythmic_density: 'restrained', melodic_density: 'sparse_motif', harmonic_tension: 'warm',
      tonal_brightness: 'dusky', textural_density: 'restrained', spatial_character: 'intimate',
      emotional_valence: 'warm', intensity_curve: 'slow-build', structural_form: 'through_composed',
      motif_strategy: 'single_recurring_motif', production_aesthetic: 'warm_analog', ending_style: 'clear-button',
      texture: 'sustained', development: 'gradual_build', opening: 'sparse_entry', climax: 'harmonic_lift',
      timbre: 'warm_tonal',
    },
  },
  {
    candidate_slot: 'B', concept_label: 'cinematic-restraint',
    character: 'Restrained cinematic strings and low sustained texture: wide but never grand, one long line that lifts once and resolves deliberately.',
    diversity_vector: {
      genre_family: 'orchestral_cinematic', tempo_feel: 'moderate', instrumentation_family: 'strings_orchestral',
      acoustic_electronic_balance: 'balanced', pulse_style: 'no_pulse', percussion_style: 'none',
      rhythmic_density: 'very_sparse', melodic_density: 'long_tones', harmonic_tension: 'evolving',
      tonal_brightness: 'neutral', textural_density: 'moderate', spatial_character: 'wide_cinematic',
      emotional_valence: 'neutral', intensity_curve: 'build-release', structural_form: 'build_release_arc',
      motif_strategy: 'fragmentary_motifs', production_aesthetic: 'cinematic_polished', ending_style: 'fade',
      texture: 'atmospheric', development: 'restrained_then_lift', opening: 'ambient_intro', climax: 'new_layer',
      timbre: 'percussive_cinematic',
    },
  },
  {
    candidate_slot: 'C', concept_label: 'modern-electronic-pulse',
    character: 'Clean modern electronic underlay: a quiet regular pulse and one synth motif that evolves in layers, forward-moving without competing with speech.',
    diversity_vector: {
      genre_family: 'electronic', tempo_feel: 'driving', instrumentation_family: 'synths',
      acoustic_electronic_balance: 'electronic', pulse_style: 'regular_pulse', percussion_style: 'electronic_kit',
      rhythmic_density: 'moderate', melodic_density: 'rhythmic_motif', harmonic_tension: 'stable',
      tonal_brightness: 'bright', textural_density: 'layered', spatial_character: 'dry_close',
      emotional_valence: 'uplifting', intensity_curve: 'two-peak', structural_form: 'layered_loop_evolution',
      motif_strategy: 'rhythmic_motif', production_aesthetic: 'clean_modern', ending_style: 'clear-button',
      texture: 'pulsing', development: 'waves', opening: 'rhythmic_start', climax: 'density',
      timbre: 'restrained_electronic',
    },
  },
]);

function finalConcepts(count = 3) {
  if (!Number.isInteger(count) || count < 1 || count > FINAL_CONCEPTS.length) {
    fail('FINAL_MUSIC_CANDIDATE_COUNT_INVALID', `candidate count must be an integer 1-${FINAL_CONCEPTS.length}`);
  }
  const errors = [];
  /* interpretation_axes are DERIVED from the diversity vector by the canonical
   * analysis module — the MiniMax prompt builder requires them, and deriving
   * keeps one source of truth for the concept. */
  const chosen = FINAL_CONCEPTS.slice(0, count).map((concept) => ({
    ...concept,
    interpretation_axes: analysis.interpretationAxesFor(concept.diversity_vector),
  }));
  chosen.forEach((concept, index) => analysis.validateVector(concept.diversity_vector, `final_concept[${index}]`, errors));
  if (errors.length) fail('FINAL_MUSIC_CONCEPT_INVALID', errors[0]);
  for (let i = 0; i < chosen.length; i += 1) {
    for (let j = i + 1; j < chosen.length; j += 1) {
      const diff = analysis.majorAxisDifference(chosen[i].diversity_vector, chosen[j].diversity_vector);
      if (diff < analysis.DIVERSITY_MIN_MAJOR_DIFF) {
        fail('FINAL_MUSIC_CONCEPTS_TOO_SIMILAR', `${chosen[i].candidate_slot}/${chosen[j].candidate_slot} differ on only ${diff} major axes`);
      }
    }
  }
  return chosen;
}

/* ---------------------------------------------------------------------------
 * Technical validation + advisory assessment.
 * ------------------------------------------------------------------------- */
function inspectAudio(file, targetDurationS) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail('FINAL_MUSIC_FILE_MISSING', `no such audio file: ${file}`);
  }
  if (fs.statSync(file).size === 0) fail('FINAL_MUSIC_FILE_EMPTY', `${file} is zero bytes`);
  const inspection = qc.inspectTrack(file, {
    requestedDurationS: targetDurationS,
    durationToleranceS: DURATION_TOLERANCE_S,
  });
  if (inspection.failures?.includes('DRAFT_MUSIC_UNREADABLE')) {
    fail('FINAL_MUSIC_UNREADABLE', `${file} is not readable as media`);
  }
  if (inspection.failures?.includes('DRAFT_MUSIC_NO_AUDIO_STREAM')) {
    fail('FINAL_MUSIC_NO_AUDIO_STREAM', `${file} carries no decodable audio stream`);
  }
  if (inspection.failures?.includes('DRAFT_MUSIC_FILE_MISSING_OR_EMPTY')) {
    fail('FINAL_MUSIC_FILE_EMPTY', `${file} is missing or empty`);
  }
  if (!Number.isFinite(inspection.duration_s) || inspection.duration_s < MIN_DURATION_S) {
    fail('FINAL_MUSIC_DURATION_UNUSABLE', `${file} is ${inspection.duration_s}s; a Final music candidate must be at least ${MIN_DURATION_S}s`);
  }
  if (!AUDIO_CODECS.includes(inspection.codec)) {
    fail('FINAL_MUSIC_UNSUPPORTED_CODEC', `${inspection.codec} is not a supported music codec (${AUDIO_CODECS.join(', ')})`);
  }
  /* The Draft classifier calls a track TRUNCATED whenever it is shorter than
   * the requested duration, which would quietly turn duration drift into a
   * hard failure — the opposite of the stated Final policy. Judge the ending
   * on the track's OWN length (does the music finish deliberately?) and let
   * length-vs-programme stay a warning. */
  const ownLengthEnding = Array.isArray(inspection.features) && inspection.features.length
    ? qc.classifyEnding(inspection.features, inspection.duration_s, inspection.duration_s, DURATION_TOLERANCE_S)
    : 'TRUNCATED';
  const failures = (inspection.failures || []).filter((code) => code !== 'DRAFT_MUSIC_TRUNCATED_ENDING');
  if (ownLengthEnding === 'TRUNCATED') failures.push('DRAFT_MUSIC_TRUNCATED_ENDING');
  return {
    ...inspection,
    failures,
    ending_class: ownLengthEnding,
    programme_target_duration_s: targetDurationS,
    ending_basis: 'classified against the track\'s own duration, not the programme length',
  };
}

function assessCandidate(inspection, coherence) {
  const hard = (inspection.failures || []).filter((code) => HARD_TECHNICAL.includes(code));
  const warnings = (inspection.failures || [])
    .filter((code) => DURATION_WARNINGS.includes(code))
    .map(finalWarningName);
  if (inspection.headroom_warning) warnings.push('FINAL_MUSIC_LOW_HEADROOM');

  if (hard.length) {
    return {
      acceptance: 'REJECT_TECHNICAL', technically_valid: false, auditionable: false,
      hard_failures: hard, warnings, machine_recommendation_only: true,
    };
  }
  if (coherence && (coherence.catastrophic || coherence.coherence_class === 'REJECT_COHERENCE')) {
    return {
      acceptance: 'REJECT_COHERENCE', technically_valid: true, auditionable: false,
      hard_failures: [], warnings, machine_recommendation_only: true,
      coherence_basis: coherence.floor_failures || [],
    };
  }
  const endingRecommended = RECOMMENDED_ENDINGS.includes(inspection.ending_class);
  if (!endingRecommended) warnings.push(`FINAL_MUSIC_ENDING_${inspection.ending_class}`);
  const coherentEnough = !coherence || coherence.solid_song || coherence.coherence_class === 'SOLID_SONG';
  if (endingRecommended && coherentEnough) {
    return {
      acceptance: 'AUDITIONABLE_FINAL_CANDIDATE', technically_valid: true, auditionable: true,
      hard_failures: [], warnings, machine_recommendation_only: true,
    };
  }
  return {
    acceptance: 'TECHNICALLY_VALID', technically_valid: true, auditionable: false,
    hard_failures: [], warnings, machine_recommendation_only: true,
    note: 'playable and selectable, but the machine does not recommend it for a publication soundtrack',
  };
}

function coherenceFor(file, inspection, options = {}) {
  if (options.skipCoherence) return null;
  try {
    return coherenceAuthority.coherenceReport(file, { endingClass: inspection.ending_class });
  } catch {
    /* Coherence is advisory: an unanalysable track is not a technical failure. */
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Registry.
 * ------------------------------------------------------------------------- */
function emptyRegistry(ctx, options = {}) {
  return {
    schema: REGISTRY_SCHEMA,
    artifact_type: 'final-music-registry',
    run_id: ctx.lock.run_id,
    lock_id: ctx.lock.lock_id,
    lock_digest_sha256: ctx.lock.lock_digest_sha256,
    final_music_brief_sha256: ctx.briefSha256,
    locked_script_sha256: ctx.scriptSha256,
    candidates: [],
    selected_candidate_id: null,
    selection_history: [],
    created_at: nowIso(options),
  };
}

function loadRegistry(ctx, options = {}) {
  if (!fs.existsSync(ctx.paths.registry)) return emptyRegistry(ctx, options);
  const registry = readJson(ctx.paths.registry, 'FINAL_MUSIC_REGISTRY_INVALID');
  if (registry.schema !== REGISTRY_SCHEMA) fail('FINAL_MUSIC_REGISTRY_INVALID', `expected ${REGISTRY_SCHEMA}`);
  if (registry.lock_digest_sha256 !== ctx.lock.lock_digest_sha256) {
    fail('FINAL_MUSIC_REGISTRY_STALE', 'the Final music registry belongs to a different Final Production Lock');
  }
  if (registry.final_music_brief_sha256 !== ctx.briefSha256) {
    fail('FINAL_MUSIC_REGISTRY_STALE', 'the Final music registry was built against a different Final Music Brief');
  }
  return registry;
}

function saveRegistry(ctx, registry) { atomicJson(ctx.paths.registry, registry); }

function resolveCandidate(registry, token) {
  if (typeof token !== 'string' || !token.trim()) {
    fail('FINAL_MUSIC_CANDIDATE_REQUIRED', 'name a candidate by id, full sha256 or an unambiguous sha prefix of 8+ characters');
  }
  const needle = token.trim().toLowerCase();
  const byId = registry.candidates.filter((item) => item.candidate_id.toLowerCase() === needle);
  if (byId.length === 1) return byId[0];
  const bySlot = registry.candidates.filter((item) => String(item.candidate_slot || '').toLowerCase() === needle);
  if (bySlot.length === 1) return bySlot[0];
  const exact = registry.candidates.filter((item) => item.sha256 === needle);
  if (exact.length === 1) return exact[0];
  if (needle.length >= 8) {
    const prefixed = registry.candidates.filter((item) => item.sha256.startsWith(needle));
    if (prefixed.length === 1) return prefixed[0];
    if (prefixed.length > 1) fail('FINAL_MUSIC_CANDIDATE_AMBIGUOUS', `${token} matches ${prefixed.length} candidates`);
  }
  fail('FINAL_MUSIC_CANDIDATE_UNREGISTERED', `${token} is not a registered Final music candidate for this run`);
}

function requireHuman(options, what) {
  const authority = options.authority;
  if (typeof authority !== 'string' || !authority.trim()) {
    fail('FINAL_MUSIC_HUMAN_AUTHORITY_REQUIRED', `${what} is a human decision and must name its authority`);
  }
  const trimmed = authority.trim();
  if (/^machine|^auto|^tool|^agent|^model|^bot|^system|MACHINE_SELECTOR/i.test(trimmed)) {
    fail('FINAL_MUSIC_HUMAN_AUTHORITY_REQUIRED', `${what} requires a HUMAN authority; ${JSON.stringify(trimmed)} is not one`);
  }
  return trimmed;
}

/* ---------------------------------------------------------------------------
 * Ingest — the single convergence point for both entry paths.
 * ------------------------------------------------------------------------- */
function ingestMusic(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const file = options.file;
  if (typeof file !== 'string' || !file.trim()) fail('FINAL_MUSIC_FILE_REQUIRED', 'name the audio file to ingest');
  const sourceType = options.sourceType || 'MANUAL_EXTERNAL';
  if (!SOURCE_TYPES.includes(sourceType)) fail('FINAL_MUSIC_SOURCE_TYPE_INVALID', `source type must be one of ${SOURCE_TYPES.join(', ')}`);

  /* The caller may not assert authority over identity. */
  for (const forbidden of ['sha256', 'lock_digest_sha256', 'lock_id', 'brief_sha256', 'selected', 'final_music_authority', 'acceptance', 'disposition']) {
    if (options[forbidden] !== undefined) {
      fail('FINAL_MUSIC_CALLER_AUTHORITY_REFUSED', `${forbidden} is resolved canonically and may not be supplied by the caller`);
    }
  }

  const resolved = path.resolve(file);
  const sha256 = (() => {
    try { return sha256File(resolved); } catch { return fail('FINAL_MUSIC_FILE_MISSING', `no such audio file: ${file}`); }
  })();

  const registry = loadRegistry(ctx, options);
  const existing = registry.candidates.find((item) => item.sha256 === sha256);
  if (existing) {
    return { state: 'ALREADY_REGISTERED', candidate: existing, registry, path: ctx.paths.registry };
  }

  const targetS = ctx.brief.target_duration_ms ? Math.round(ctx.brief.target_duration_ms / 1000) : 180;
  const inspection = inspectAudio(resolved, targetS);
  const coherence = coherenceFor(resolved, inspection, options);
  const assessment = assessCandidate(inspection, coherence);

  const slot = options.slot || String.fromCharCode(65 + registry.candidates.length);
  const candidateId = `final-music-${slot.toLowerCase()}-${sha256.slice(0, 8)}`;
  const extension = EXTENSIONS[inspection.codec] || path.extname(resolved) || '.wav';
  const stored = path.join(ctx.paths.media, `${sha256.slice(0, 16)}${extension}`);
  fs.mkdirSync(path.dirname(stored), { recursive: true });
  if (!fs.existsSync(stored)) fs.copyFileSync(resolved, stored);
  if (sha256File(stored) !== sha256) fail('FINAL_MUSIC_STORE_HASH_MISMATCH', 'the stored copy does not match the ingested bytes');

  const core = {
    schema: CANDIDATE_SCHEMA,
    artifact_type: 'final-music-candidate',
    candidate_id: candidateId,
    candidate_slot: slot,
    run_id: ctx.lock.run_id,
    lock_id: ctx.lock.lock_id,
    lock_digest_sha256: ctx.lock.lock_digest_sha256,
    final_production_package_digest_sha256: ctx.pkg.package_digest_sha256 ?? null,
    final_music_brief_sha256: ctx.briefSha256,
    locked_script_sha256: ctx.scriptSha256,
    story_id: ctx.lock.story?.story_id ?? ctx.lock.approved_draft?.story_id ?? null,
    source_type: sourceType,
    provenance: {
      generated_by: options.generatedBy || (sourceType === 'GENERATED' ? 'FINAL_STAGE_GENERATION' : 'HUMAN_SUPPLIED_FILE'),
      model: options.model || null,
      render_brief_id: options.renderBriefId || null,
      prompt_sha256: options.promptSha256 || null,
      concept_label: options.conceptLabel || null,
      original_filename: path.basename(resolved),
      original_path: resolved,
      ingested_at: nowIso(options),
      /* A Draft track may be re-ingested as a fresh Final candidate. It never
       * inherits Draft selection, verdict or ranking authority. */
      draft_reference: options.draftReference || null,
      inherited_authority: false,
    },
    media: {
      path: path.relative(ctx.runDir, stored),
      sha256,
      size_bytes: inspection.size_bytes,
      codec: inspection.codec,
      sample_rate: inspection.sample_rate,
      channels: inspection.channels,
      duration_s: inspection.duration_s,
      integrated_lufs: inspection.integrated_lufs,
      true_peak_dbfs: inspection.true_peak_dbfs,
      total_silence_s: inspection.total_silence_s,
      full_decode: inspection.full_decode,
    },
    sha256,
    technical_qc: {
      technically_valid: assessment.technically_valid,
      hard_failures: assessment.hard_failures,
      warnings: assessment.warnings,
      clipping: inspection.clipping,
      ending_class: inspection.ending_class,
      target_duration_s: targetS,
      duration_within_tolerance: !(inspection.failures || []).some((code) => DURATION_WARNINGS.includes(code)),
    },
    coherence_diagnostics: coherence
      ? {
        coherence_class: coherence.coherence_class,
        coherence_score: coherence.coherence_score,
        solid_song: coherence.solid_song,
        catastrophic: coherence.catastrophic,
        floor_failures: coherence.floor_failures || [],
        contract: coherence.contract?.version || null,
        note: 'advisory — the human-calibrated Draft coherence analyser reused as a Final diagnostic; it never selects',
      }
      : { coherence_class: 'NOT_ASSESSED', note: 'advisory diagnostic unavailable for this media' },
    acceptance: assessment.acceptance,
    machine_recommendation_only: true,
    disposition: 'CANDIDATE',
    selected: false,
    final_music_authority: false,
    publication_authority: false,
  };
  const candidate = { ...core, candidate_digest_sha256: digest(core) };
  writeImmutable(path.join(ctx.paths.candidates, `${candidateId}.json`), candidate);

  registry.candidates = [...registry.candidates, candidate];
  registry.updated_at = nowIso(options);
  saveRegistry(ctx, registry);
  return { state: 'REGISTERED', candidate, registry, path: path.join(ctx.paths.candidates, `${candidateId}.json`) };
}

/* ---------------------------------------------------------------------------
 * PATH A — fresh Final-stage generation.
 *
 * Reuses the Draft music generation architecture (MusicRenderBrief, prompt
 * construction, transport, QC) but mints Final candidate identities and never
 * touches a Draft attempt. The transport is injected; nothing here dials a
 * model on its own.
 * ------------------------------------------------------------------------- */
async function generateFinalCandidates(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const count = options.count ?? 3;
  const concepts = finalConcepts(count);
  const renderBrief = renderBriefFor(ctx);

  /* STABLE_AUDIO_FIRST, exactly as the Draft department's human-calibrated
   * routing concluded. MiniMax stays available only on explicit request. */
  const model = options.model || 'stable_audio_3_medium';
  if (!['stable_audio_3_medium', 'minimax_music_3'].includes(model)) {
    fail('FINAL_MUSIC_MODEL_UNSUPPORTED', `${model} is not a supported music generator`);
  }
  if (model === 'minimax_music_3' && !options.experimentalMinimax) {
    fail('FINAL_MUSIC_MINIMAX_REQUIRES_OPT_IN', 'MiniMax is an experimental diversity lane; pass experimentalMinimax to use it for Final music');
  }

  const generator = options.generator;
  if (typeof generator !== 'function') {
    fail('FINAL_MUSIC_GENERATOR_REQUIRED', 'no Final music generation transport was supplied; supply one or use ingest for a manually produced track');
  }

  const briefRecord = {
    schema: RENDER_BRIEF_SCHEMA,
    artifact_type: 'final-music-render-brief',
    run_id: ctx.lock.run_id,
    lock_id: ctx.lock.lock_id,
    lock_digest_sha256: ctx.lock.lock_digest_sha256,
    final_music_brief_sha256: ctx.briefSha256,
    routing_policy: 'STABLE_AUDIO_FIRST',
    model,
    music_render_brief: renderBrief,
    concepts: concepts.map((concept) => ({
      candidate_slot: concept.candidate_slot,
      concept_label: concept.concept_label,
      character: concept.character,
      diversity_vector: concept.diversity_vector,
    })),
    created_at: nowIso(options),
  };
  writeImmutable(path.join(ctx.paths.renders, `render-brief-${digest(briefRecord).slice(0, 12)}.json`), briefRecord);

  const produced = [];
  for (const concept of concepts) {
    const promptBundle = prompts.promptFor(model, renderBrief, concept);
    const outputDir = path.join(ctx.paths.renders, `final-music-${concept.candidate_slot.toLowerCase()}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, `${concept.concept_label}.wav`);
    /* eslint-disable no-await-in-loop -- Final renders are dispatched serially on purpose. */
    const result = await generator({
      model,
      concept,
      promptBundle,
      renderBrief,
      durationS: renderBrief.target_duration_s,
      outputFile,
      runId: ctx.lock.run_id,
      lockDigest: ctx.lock.lock_digest_sha256,
    });
    /* eslint-enable no-await-in-loop */
    const file = result?.outputFile || outputFile;
    if (!fs.existsSync(file)) fail('FINAL_MUSIC_GENERATION_NO_OUTPUT', `${concept.candidate_slot}: the generator produced no audio at ${file}`);
    const ingested = ingestMusic(ctx.runDir, {
      ...options,
      file,
      slot: concept.candidate_slot,
      sourceType: 'GENERATED',
      generatedBy: 'FINAL_STAGE_GENERATION',
      model,
      renderBriefId: renderBrief.brief_id,
      promptSha256: promptBundle.prompt_sha256,
      conceptLabel: concept.concept_label,
      authority: undefined,
    });
    produced.push(ingested.candidate);
  }

  const registry = loadRegistry(ctx, options);
  return {
    state: 'CANDIDATES_GENERATED',
    model,
    routing_policy: 'STABLE_AUDIO_FIRST',
    render_brief: renderBrief,
    candidates: produced,
    selected: null,
    final_music_complete: false,
    recommendation: recommend(registry),
    note: 'generation created candidates only; Mikko selects',
  };
}

/* Advisory ranking. Deliberately separate from selection, and never written
 * into any authority field. */
function recommend(registry) {
  const eligible = registry.candidates.filter((item) => item.disposition !== 'REJECTED' && item.disposition !== 'SUPERSEDED');
  if (!eligible.length) return null;
  const scored = [...eligible].sort((a, b) => {
    const rank = (item) => ACCEPTANCE.indexOf(item.acceptance);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const score = (item) => item.coherence_diagnostics?.coherence_score ?? 0;
    return score(b) - score(a);
  });
  return {
    candidate_id: scored[0].candidate_id,
    candidate_slot: scored[0].candidate_slot,
    basis: 'advisory ranking by Final acceptance tier then coherence score',
    is_selection: false,
    note: 'a recommendation is not a selection; only Mikko creates FINAL_MUSIC_AUTHORITY',
  };
}

/* ---------------------------------------------------------------------------
 * Human selection — the only path to FINAL_MUSIC_AUTHORITY.
 * ------------------------------------------------------------------------- */
function selectMusic(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const authority = requireHuman(options, 'Final music selection');
  const registry = loadRegistry(ctx, options);
  if (!registry.candidates.length) fail('FINAL_MUSIC_NO_CANDIDATES', 'no Final music candidate is registered for this run');
  const candidate = resolveCandidate(registry, options.candidate);

  if (candidate.disposition === 'REJECTED') {
    fail('FINAL_MUSIC_CANDIDATE_REJECTED', `${candidate.candidate_id} was rejected and cannot become Final music authority`);
  }
  if (candidate.disposition === 'SUPERSEDED') {
    fail('FINAL_MUSIC_CANDIDATE_SUPERSEDED', `${candidate.candidate_id} was superseded and cannot be selected`);
  }
  const stored = path.resolve(ctx.runDir, candidate.media.path);
  if (!fs.existsSync(stored)) fail('FINAL_MUSIC_CANDIDATE_MEDIA_MISSING', `${candidate.candidate_id}: the registered media is gone`);
  if (sha256File(stored) !== candidate.sha256) {
    fail('FINAL_MUSIC_CANDIDATE_BYTES_CHANGED', `${candidate.candidate_id}: the registered media bytes changed since registration`);
  }
  if (candidate.acceptance === 'REJECT_TECHNICAL' || !candidate.technical_qc.technically_valid) {
    fail('FINAL_MUSIC_CANDIDATE_TECHNICALLY_INVALID', `${candidate.candidate_id} is technically invalid (${candidate.technical_qc.hard_failures.join(', ')}) and cannot be Final music`);
  }
  /* A coherence rejection is a strong machine opinion, not a veto: Mikko can
   * overrule it, but only by saying so explicitly. The Draft-music history is
   * exactly why this is not silent either way. */
  if (candidate.acceptance === 'REJECT_COHERENCE' && !options.acknowledgeCoherenceRejection) {
    fail('FINAL_MUSIC_COHERENCE_REJECTION_UNACKNOWLEDGED', `${candidate.candidate_id} failed the calibrated coherence floors (${(candidate.coherence_diagnostics.floor_failures || []).join(', ')}); re-run with acknowledgeCoherenceRejection to select it anyway`);
  }

  const previous = registry.selected_candidate_id
    ? registry.candidates.find((item) => item.candidate_id === registry.selected_candidate_id) || null
    : null;
  if (previous && previous.candidate_id === candidate.candidate_id) {
    return { state: 'ALREADY_SELECTED', candidate, selection: readJson(ctx.paths.selection, 'FINAL_MUSIC_SELECTION_INVALID'), registry };
  }

  const selectedAt = nowIso(options);
  const historyEntry = {
    selection_index: registry.selection_history.length + 1,
    candidate_id: candidate.candidate_id,
    candidate_slot: candidate.candidate_slot,
    sha256: candidate.sha256,
    authority: { type: 'HUMAN', id: authority },
    selected_at: selectedAt,
    previous_candidate_id: previous?.candidate_id ?? null,
    superseded_candidate_id: previous?.candidate_id ?? null,
    coherence_rejection_acknowledged: candidate.acceptance === 'REJECT_COHERENCE'
      ? Boolean(options.acknowledgeCoherenceRejection) : false,
    warnings_at_selection: candidate.technical_qc.warnings,
  };

  registry.candidates = registry.candidates.map((item) => {
    if (item.candidate_id === candidate.candidate_id) return { ...item, disposition: 'SELECTED', selected: true };
    if (previous && item.candidate_id === previous.candidate_id) {
      return { ...item, disposition: 'SUPERSEDED', selected: false, superseded_reason: `superseded by ${candidate.candidate_id}`, superseded_at: selectedAt };
    }
    return item;
  });
  registry.selected_candidate_id = candidate.candidate_id;
  registry.selection_history = [...registry.selection_history, historyEntry];
  registry.updated_at = selectedAt;
  saveRegistry(ctx, registry);

  const selectedRecord = registry.candidates.find((item) => item.candidate_id === candidate.candidate_id);
  const core = {
    schema: SELECTION_SCHEMA,
    artifact_type: 'final-music-selection',
    run_id: ctx.lock.run_id,
    lock_id: ctx.lock.lock_id,
    lock_digest_sha256: ctx.lock.lock_digest_sha256,
    final_music_brief_sha256: ctx.briefSha256,
    locked_script_sha256: ctx.scriptSha256,
    selection_index: historyEntry.selection_index,
    candidate_id: candidate.candidate_id,
    candidate_slot: candidate.candidate_slot,
    candidate_digest_sha256: candidate.candidate_digest_sha256,
    media: { path: candidate.media.path, sha256: candidate.sha256, duration_s: candidate.media.duration_s, integrated_lufs: candidate.media.integrated_lufs },
    source_type: candidate.source_type,
    acceptance_at_selection: candidate.acceptance,
    warnings_at_selection: candidate.technical_qc.warnings,
    authority: { type: 'HUMAN', id: authority },
    selected_at: selectedAt,
    previous_selection: previous
      ? { candidate_id: previous.candidate_id, sha256: previous.sha256, state: 'SUPERSEDED' }
      : null,
    selection_history: registry.selection_history,
    final_music_authority: true,
    machine_selection: false,
    draft_music_promoted: false,
    publication_authority: false,
    final_qc_pass: false,
    final_edit_complete: false,
  };
  const selection = { ...core, selection_digest_sha256: digest(core) };
  atomicJson(ctx.paths.selection, selection);
  return { state: 'FINAL_MUSIC_SELECTED', candidate: selectedRecord, selection, registry, path: ctx.paths.selection };
}

function setDisposition(runDirInput, options, disposition, what) {
  const ctx = context(runDirInput, options);
  const authority = requireHuman(options, what);
  const registry = loadRegistry(ctx, options);
  const candidate = resolveCandidate(registry, options.candidate);
  if (candidate.candidate_id === registry.selected_candidate_id && disposition === 'REJECTED') {
    fail('FINAL_MUSIC_CANNOT_REJECT_SELECTED', `${candidate.candidate_id} is the current Final music selection; select a different candidate first`);
  }
  const at = nowIso(options);
  registry.candidates = registry.candidates.map((item) => (item.candidate_id === candidate.candidate_id
    ? {
      ...item,
      disposition,
      selected: false,
      disposition_authority: { type: 'HUMAN', id: authority },
      disposition_at: at,
      disposition_note: options.note || null,
    }
    : item));
  registry.updated_at = at;
  saveRegistry(ctx, registry);
  return { state: disposition, candidate: registry.candidates.find((item) => item.candidate_id === candidate.candidate_id), registry };
}

function rejectCandidate(runDirInput, options = {}) {
  return setDisposition(runDirInput, options, 'REJECTED', 'rejecting a Final music candidate');
}
function keepAsAlternate(runDirInput, options = {}) {
  return setDisposition(runDirInput, options, 'KEEP_AS_ALTERNATE', 'keeping a Final music candidate as an alternate');
}

/* An executable statement of the doctrine: there is a named operation for
 * "promote the Draft winner", and it always refuses. */
function promoteDraftSelection(runDirInput, options = {}) {
  context(runDirInput, options);
  fail('FINAL_MUSIC_DRAFT_ESCALATION_REFUSED',
    'DRAFT_SELECTED_MUSIC is provisional and INSPIRATION_ONLY: it never becomes FINAL_MUSIC_AUTHORITY. '
    + 'To use that music for publication, ingest the file as a fresh Final-stage candidate and select it explicitly with a named human authority.');
}

/* ---------------------------------------------------------------------------
 * Completion, status, projection.
 * ------------------------------------------------------------------------- */
function finalMusicComplete(ctx, registry) {
  const reasons = [];
  if (!registry.selected_candidate_id) reasons.push('NO_SELECTION');
  const selected = registry.candidates.find((item) => item.candidate_id === registry.selected_candidate_id) || null;
  if (registry.selected_candidate_id && !selected) reasons.push('SELECTION_NOT_IN_REGISTRY');
  if (selected) {
    if (selected.disposition !== 'SELECTED') reasons.push('SELECTION_NOT_CURRENT');
    if (!selected.technical_qc.technically_valid) reasons.push('SELECTED_CANDIDATE_TECHNICALLY_INVALID');
    const stored = path.resolve(ctx.runDir, selected.media.path);
    if (!fs.existsSync(stored)) reasons.push('SELECTED_MEDIA_MISSING');
    else if (sha256File(stored) !== selected.sha256) reasons.push('SELECTED_MEDIA_BYTES_CHANGED');
  }
  if (!fs.existsSync(ctx.paths.selection)) {
    if (registry.selected_candidate_id) reasons.push('SELECTION_MANIFEST_MISSING');
  } else {
    const selection = readJson(ctx.paths.selection, 'FINAL_MUSIC_SELECTION_INVALID');
    if (selection.lock_digest_sha256 !== ctx.lock.lock_digest_sha256) reasons.push('SELECTION_BELONGS_TO_ANOTHER_LOCK');
    if (selection.final_music_brief_sha256 !== ctx.briefSha256) reasons.push('SELECTION_AGAINST_STALE_BRIEF');
    if (selection.candidate_id !== registry.selected_candidate_id) reasons.push('SELECTION_MANIFEST_STALE');
    if (selection.authority?.type !== 'HUMAN' || !selection.authority?.id) reasons.push('SELECTION_AUTHORITY_NOT_HUMAN');
  }
  return { complete: reasons.length === 0, blocking_reasons: reasons, selected };
}

function musicStatus(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const registry = loadRegistry(ctx, options);
  const completion = finalMusicComplete(ctx, registry);
  const counts = {
    candidates: registry.candidates.length,
    auditionable: registry.candidates.filter((item) => item.acceptance === 'AUDITIONABLE_FINAL_CANDIDATE').length,
    technically_valid: registry.candidates.filter((item) => item.technical_qc.technically_valid).length,
    rejected_technical: registry.candidates.filter((item) => item.acceptance === 'REJECT_TECHNICAL').length,
    rejected_coherence: registry.candidates.filter((item) => item.acceptance === 'REJECT_COHERENCE').length,
    human_rejected: registry.candidates.filter((item) => item.disposition === 'REJECTED').length,
    alternates: registry.candidates.filter((item) => item.disposition === 'KEEP_AS_ALTERNATE').length,
    superseded: registry.candidates.filter((item) => item.disposition === 'SUPERSEDED').length,
    generated: registry.candidates.filter((item) => item.source_type === 'GENERATED').length,
    manual_external: registry.candidates.filter((item) => item.source_type === 'MANUAL_EXTERNAL').length,
    selections_made: registry.selection_history.length,
  };
  return {
    run_id: ctx.lock.run_id,
    lock_id: ctx.lock.lock_id,
    final_music_state: completion.complete ? 'FINAL_MUSIC_SELECTED' : 'REQUIRED',
    final_music_complete: completion.complete,
    blocking_reasons: completion.blocking_reasons,
    brief: {
      state: ctx.brief.state,
      sha256: ctx.briefSha256,
      target_duration_ms: ctx.brief.target_duration_ms,
      sections: (ctx.brief.music_function_map || []).length,
      ending_requirement: ctx.brief.style_guidance?.ending_requirement ?? null,
      draft_reference_use: ctx.brief.draft_music_is_not_promoted?.draft_reference_use ?? 'INSPIRATION_ONLY',
    },
    counts,
    selected: completion.selected
      ? {
        candidate_id: completion.selected.candidate_id,
        candidate_slot: completion.selected.candidate_slot,
        sha256: completion.selected.sha256,
        path: completion.selected.media.path,
        source_type: completion.selected.source_type,
        acceptance: completion.selected.acceptance,
      }
      : null,
    recommendation: recommend(registry),
    draft_music: 'INSPIRATION_ONLY',
    next_action: nextAction(ctx, registry, completion),
    independent_lanes: {
      final_visual_assets: 'independent — Final music does not require any visual beat to be complete',
      final_human_performance: 'independent — Final music does not require a selected performance',
      joined_at: 'the Resolve edit, via derived projections',
    },
    publication_authority: false,
    final_qc_pass: false,
    final_edit_complete: false,
  };
}

function listCandidates(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const registry = loadRegistry(ctx, options);
  return {
    run_id: ctx.lock.run_id,
    candidates: registry.candidates.map((item) => ({
      candidate_id: item.candidate_id,
      slot: item.candidate_slot,
      source_type: item.source_type,
      model: item.provenance.model,
      concept: item.provenance.concept_label,
      audition_path: path.resolve(ctx.runDir, item.media.path),
      sha256: item.sha256,
      sha_short: item.sha256.slice(0, 12),
      duration_s: item.media.duration_s,
      sample_rate: item.media.sample_rate,
      channels: item.media.channels,
      codec: item.media.codec,
      integrated_lufs: item.media.integrated_lufs,
      ending_class: item.technical_qc.ending_class,
      acceptance: item.acceptance,
      coherence_class: item.coherence_diagnostics.coherence_class,
      coherence_score: item.coherence_diagnostics.coherence_score ?? null,
      warnings: item.technical_qc.warnings,
      disposition: item.disposition,
      selected: item.selected,
    })),
    recommendation: recommend(registry),
    selection_is_human_only: true,
  };
}

function nextAction(ctx, registry, completion) {
  if (completion.complete) {
    return {
      task: 'PROJECT_FINAL_MUSIC',
      state: 'READY_NOW',
      detail: 'Final music is selected; project it into the derived Resolve music view',
      command: `final-music project --run-id ${ctx.lock.run_id}`,
    };
  }
  const eligible = registry.candidates.filter((item) => item.disposition !== 'REJECTED' && item.disposition !== 'SUPERSEDED'
    && item.technical_qc.technically_valid);
  if (!eligible.length) {
    return {
      task: 'CREATE_FINAL_MUSIC_CANDIDATE',
      state: 'MIKKO_MANUAL_OR_GENERATION',
      detail: registry.candidates.length
        ? 'every registered candidate is rejected or technically invalid; generate or ingest another'
        : 'no Final music candidate exists yet — generate a fresh Final-stage set, or ingest a track you produced',
      commands: [
        `final-music generate --run-id ${ctx.lock.run_id}`,
        `final-music ingest --run-id ${ctx.lock.run_id} --file <your-track.wav>`,
      ],
    };
  }
  return {
    task: 'SELECT_FINAL_MUSIC',
    state: 'MIKKO_DECISION',
    detail: `${eligible.length} candidate(s) await audition; listen and select one — nothing selects it for you`,
    command: `final-music select --run-id ${ctx.lock.run_id} --candidate <id> --authority "Mikko Pakkala"`,
  };
}

function projectResolveMusic(runDirInput, options = {}) {
  const ctx = context(runDirInput, options);
  const component = ctx.pkg.components?.final_resolve_blueprint;
  if (!component) fail('FINAL_MUSIC_BLUEPRINT_MISSING', 'the package declares no Resolve blueprint');
  const blueprintFile = path.resolve(ctx.runDir, component.path);
  if (sha256File(blueprintFile) !== component.sha256) {
    fail('FINAL_MUSIC_BLUEPRINT_STALE', 'the Resolve blueprint bytes changed after packaging');
  }
  const blueprint = readJson(blueprintFile, 'FINAL_MUSIC_BLUEPRINT_INVALID');
  const registry = loadRegistry(ctx, options);
  const completion = finalMusicComplete(ctx, registry);
  const selected = completion.complete ? completion.selected : null;

  const musicTrack = selected
    ? {
      state: 'FINAL_MUSIC_SELECTED',
      candidate_id: selected.candidate_id,
      path: selected.media.path,
      sha256: selected.sha256,
      duration_s: selected.media.duration_s,
      integrated_lufs: selected.media.integrated_lufs,
      true_peak_dbfs: selected.media.true_peak_dbfs,
      ending_class: selected.technical_qc.ending_class,
      source_type: selected.source_type,
      role: blueprint.audio?.music_track?.role ?? 'DIALOGUE_SUBORDINATE_BED',
      cue: { start_ms: 0, behaviour: 'start at programme head', trim_to_programme: true },
      placeholder: false,
    }
    : {
      state: 'AWAITING_FINAL_MUSIC_SELECTION',
      candidate_id: null,
      sha256: null,
      role: blueprint.audio?.music_track?.role ?? 'DIALOGUE_SUBORDINATE_BED',
      placeholder: true,
    };

  const core = {
    schema: PROJECTION_SCHEMA,
    artifact_type: 'final-resolve-music-projection',
    run_id: ctx.lock.run_id,
    lock_id: ctx.lock.lock_id,
    lock_digest_sha256: ctx.lock.lock_digest_sha256,
    blueprint_sha256: component.sha256,
    blueprint_mutated: false,
    final_music_brief_sha256: ctx.briefSha256,
    music_track: musicTrack,
    /* Blueprint instructions, not a rendered mix. Nothing here premixes audio. */
    mix_guidance: {
      suggested_music_level_db: -22,
      narration_ducking: 'duck the music bed under narration; the voice is never subordinate',
      pause_lift_db: 3,
      pause_lift_note: 'lift the bed in narration pauses, then return to bed level',
      section_transitions: (ctx.brief.music_function_map || []).map((item) => ({
        section_id: item.section_id, order: item.order, music_function: item.music_function,
        start_ms: item.start_ms, end_ms: item.end_ms,
      })),
      ending_handling: selected
        ? `selected ending is ${selected.technical_qc.ending_class}; ${selected.technical_qc.ending_class === 'ABRUPT_END' ? 'shape the tail in the edit' : 'let the track resolve'}`
        : 'unresolved until a Final music candidate is selected',
      destructive_premix_performed: false,
    },
    selection_history: registry.selection_history.map((entry) => ({
      selection_index: entry.selection_index,
      candidate_id: entry.candidate_id,
      selected_at: entry.selected_at,
      state: entry.candidate_id === registry.selected_candidate_id ? 'CURRENT' : 'HISTORICAL',
    })),
    final_music_complete: completion.complete,
    final_edit_complete: false,
    final_qc_pass: false,
    publication_authority: false,
    projected_at: nowIso(options),
  };
  const projection = { ...core, projection_digest_sha256: digest(core) };
  atomicJson(ctx.paths.projection, projection);
  return { projection, path: ctx.paths.projection };
}

module.exports = {
  CANDIDATE_SCHEMA, REGISTRY_SCHEMA, SELECTION_SCHEMA, PROJECTION_SCHEMA, RENDER_BRIEF_SCHEMA,
  ACCEPTANCE, DISPOSITIONS, SOURCE_TYPES, AUDIO_CODECS, HARD_TECHNICAL, DURATION_WARNINGS,
  RECOMMENDED_ENDINGS, MIN_DURATION_S, FINAL_CONCEPTS, FINAL_WARNING_NAMES, finalWarningName,
  FinalMusicError, musicPaths, context, renderBriefFor, finalConcepts, energyCurveFor,
  inspectAudio, assessCandidate, coherenceFor, loadRegistry, resolveCandidate, requireHuman,
  ingestMusic, generateFinalCandidates, recommend, selectMusic, rejectCandidate, keepAsAlternate,
  promoteDraftSelection, finalMusicComplete, musicStatus, listCandidates, nextAction, projectResolveMusic,
};
