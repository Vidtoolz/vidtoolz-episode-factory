'use strict';
// Fake Earth Studio export runner for tests and the browser smoke.
// Reproduces the REAL native export convention observed 2026-09-04
// (frames first..last inclusive, `<render name>_<zero-padded frame>.jpeg`, the
// padding = digits of the last frame number) without launching Chrome. Frames
// are real JPEGs produced by ffmpeg's test source so the encode + ffprobe path
// is exercised for real.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function fail(code, message) { const e = new Error(message); e.code = code; return e; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generate `count` JPEG frames (size WxH) into dir named prefix + padded index from `first`.
function writeJpegFrames(dir, { prefix = 'earth-studio_', first = 0, last, width = 320, height = 180, fps = 30, onlyUpTo = null }) {
  fs.mkdirSync(dir, { recursive: true });
  const digits = String(last).length;
  const stop = onlyUpTo == null ? last : Math.min(last, onlyUpTo);
  const count = stop - first + 1;
  const tmpPattern = path.join(dir, `.gen_%0${digits}d.jpeg`);
  const r = childProcess.spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}`, '-frames:v', String(count), '-start_number', String(first), '-q:v', '5', tmpPattern], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not write synthetic frames: ${r.stderr.slice(-300)}`);
  const names = [];
  for (let f = first; f <= stop; f += 1) {
    const src = path.join(dir, `.gen_${String(f).padStart(digits, '0')}.jpeg`);
    const name = `${prefix}${String(f).padStart(digits, '0')}.jpeg`;
    fs.renameSync(src, path.join(dir, name));
    names.push(name);
  }
  return names;
}

// mode: 'complete' (default) | 'auth' | 'stall' | 'hang' | 'incomplete' | 'chrome_exit' | 'mismatch'
// frameDelayMs: pace of frame arrival (0 = burst)
// stallAfter: frames written before a stall/hang
function fakeExportRunner(config = {}) {
  const cfg = { mode: 'complete', frameDelayMs: 0, stallAfter: 3, stallRejectMs: 200, renderName: 'earth-studio', width: 320, height: 180, ...config };
  const calls = [];
  const run = async (params) => {
    calls.push({ at: new Date().toISOString(), jobId: params.jobId, framesDir: params.framesDir, expected: params.expected });
    const emit = (evt) => { if (params.onEvent) params.onEvent({ at: new Date().toISOString(), ...evt }); };
    emit({ type: 'launching', gl: 'fake' });
    await sleep(cfg.launchDelayMs || 0);
    if (cfg.mode === 'auth') { emit({ type: 'auth_required', url: 'https://accounts.google.com/signin' }); throw fail('AUTH_REQUIRED', 'Earth Studio needs a Google sign-in in the automation browser profile'); }
    if (cfg.mode === 'chrome_exit') throw fail('CHROME_EXITED', 'the Earth Studio browser exited during the export');
    emit({ type: 'app_ready', url: 'https://earth.google.com/studio/' });
    emit({ type: 'importing', esp: params.espPath });
    const { first, last } = params.expected;
    if (cfg.mode === 'mismatch') throw fail('PROJECT_MISMATCH', `Earth Studio project duration ${last + 5} ≠ planned ${last} frames`);
    emit({ type: 'imported', project: { duration: last - first, totalFrames: last - first, frameRate: params.expected.frame_rate } });
    emit({ type: 'export_started', render_name: cfg.renderName, destination: 'opfs:fake', first, last, expected_count: last - first + 1 });
    const digits = String(last).length;
    const limit = cfg.mode === 'stall' || cfg.mode === 'hang' ? Math.min(last, first + cfg.stallAfter - 1) : (cfg.mode === 'incomplete' ? last - 2 : last);
    // burst-generate then reveal one by one (atomic rename from a hidden staging dir)
    const staging = path.join(path.dirname(params.framesDir), `.staging-${path.basename(params.framesDir)}`);
    const names = writeJpegFrames(staging, { prefix: `${cfg.renderName}_`, first, last, width: cfg.width, height: cfg.height, fps: params.expected.frame_rate || 30, onlyUpTo: limit });
    let files = 0;
    for (const name of names) {
      if (cfg.frameDelayMs) await sleep(cfg.frameDelayMs);
      fs.renameSync(path.join(staging, name), path.join(params.framesDir, name));
      files += 1;
      const frame = Number(name.slice(cfg.renderName.length + 1, cfg.renderName.length + 1 + digits));
      const remainingFrames = last - frame;
      emit({ type: 'frame', name, files, bytes: fs.statSync(path.join(params.framesDir, name)).size, rendered_reported: files, total_reported: last - first + 1, remaining_text: cfg.frameDelayMs ? `${String(Math.floor(remainingFrames * cfg.frameDelayMs / 60000)).padStart(2, '0')}:${String(Math.floor((remainingFrames * cfg.frameDelayMs / 1000) % 60)).padStart(2, '0')}` : '00:00' });
    }
    fs.rmSync(staging, { recursive: true, force: true });
    if (cfg.mode === 'stall') { await sleep(cfg.stallRejectMs); throw fail('EXPORT_STALLED', `no Earth Studio progress for ${cfg.stallRejectMs} ms (${files} of ${last - first + 1} frames on disk)`); }
    if (cfg.mode === 'hang') { await new Promise(() => {}); }
    if (cfg.mode === 'incomplete') throw fail('EXPORT_INCOMPLETE', `Earth Studio finished with ${files} of ${last - first + 1} frames`);
    if (params.metaDir) fs.writeFileSync(path.join(params.metaDir, 'ImagerySources.txt'), 'Fake imagery sources (test)\n');
    emit({ type: 'export_finished', files, bytes: 0, elapsed_s: 0.5, rendered_reported: files });
    return { ok: true, files, bytes: 0, elapsed_s: 0.5, first_name: names[0], last_name: names[names.length - 1], rendered_reported: files, total_reported: last - first + 1, gl: 'fake', chrome_pid: null, imagery_sources: 'Fake imagery sources (test)', meta_files: ['ImagerySources.txt'] };
  };
  run.calls = calls;
  return run;
}

module.exports = { fakeExportRunner, writeJpegFrames };
