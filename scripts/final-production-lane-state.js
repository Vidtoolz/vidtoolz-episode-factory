'use strict';

/* One read-only, lane-local derivation used by both Final Production operator
 * resolvers. This is a projection, not a new production-state authority. */
const fs = require('node:fs');
const path = require('node:path');

function deriveFinalProductionLaneStates(runDir, options = {}) {
  const pkg = require('./final-production-package.js');
  const perf = require('./final-performance.js');
  const music = require('./final-music-production.js');
  let tracker = { beats: [] }; let visualError = null;
  try { ({ tracker } = pkg.loadTracker(runDir)); } catch (error) { visualError = error; }
  let performancePackage = { sections: [], total_target_duration_ms: 0 }; let performancePackageError = null;
  try { performancePackage = JSON.parse(fs.readFileSync(pkg.packagePaths(runDir).performance, 'utf8')); } catch (error) { performancePackageError = error; }
  const performanceStatus = performancePackageError
    ? { state: performancePackageError.code || 'FINAL_PACKAGE_PERFORMANCE_INVALID', error: performancePackageError.message }
    : perf.status(runDir, options);
  let musicCompletion = { complete: false }; let musicRegistry = { candidates: [], selection_history: [] }; let musicError = null;
  try {
    const context = music.context(runDir, options);
    musicRegistry = music.loadRegistry(context, options);
    musicCompletion = music.finalMusicComplete(context, musicRegistry);
  } catch (error) { musicError = error; }
  const visualStatus = {
    beats: tracker.beats.length,
    prompt_ready: tracker.beats.filter((beat) => beat.state === 'PROMPT_READY').length,
    generated: tracker.beats.filter((beat) => beat.generated_images?.length || beat.state === 'GENERATED' || beat.state === 'SELECTED_IMAGE' || beat.state === 'I2V_READY' || beat.state === 'VIDEO_GENERATED').length,
    selected: tracker.beats.filter((beat) => beat.state === 'FINAL_ASSET_SELECTED').length,
  };
  const visualComplete = !visualError && visualStatus.beats > 0 && visualStatus.selected === visualStatus.beats;
  const visual = visualError
    ? { state: 'BLOCKED', complete: false, code: visualError.code || 'FINAL_PACKAGE_VISUAL_INVALID', reason: visualError.message, status: visualStatus }
    : { state: visualComplete ? 'COMPLETE' : 'READY', complete: visualComplete, code: null, reason: null, status: { ...visualStatus, complete: visualComplete } };
  const performance = performancePackageError || performanceStatus.state !== 'INCOMPLETE' && performanceStatus.state !== 'COMPLETE'
    ? { state: 'BLOCKED', complete: false, code: performanceStatus.error_code || performanceStatus.state, reason: performanceStatus.error || performanceStatus.state, status: performanceStatus }
    : { state: performanceStatus.state === 'COMPLETE' ? 'COMPLETE' : 'READY', complete: performanceStatus.state === 'COMPLETE', code: null, reason: null, status: performanceStatus };
  const musicStatus = { final_music_complete: musicCompletion.complete, blocking_reasons: musicCompletion.blocking_reasons || [], counts: { candidates: musicRegistry.candidates.length, selected: musicRegistry.selected_candidate_id ? 1 : 0, selections_made: musicRegistry.selection_history.length } };
  const musicLane = musicError
    ? { state: 'BLOCKED', complete: false, code: musicError.code || 'FINAL_MUSIC_AUTHORITY_INVALID', reason: musicError.message, status: null }
    : { state: musicCompletion.complete ? 'COMPLETE' : 'READY', complete: musicCompletion.complete, code: null, reason: null, status: musicStatus };
  return {
    visual: { ...visual, detail: { tracker } },
    performance: { ...performance, detail: { package: performancePackage } },
    music: { ...musicLane, detail: { completion: musicCompletion } },
  };
}

module.exports = { deriveFinalProductionLaneStates };
