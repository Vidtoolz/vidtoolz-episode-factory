#!/usr/bin/env node
'use strict';
// Headless-Chrome smoke for EARTH STUDIO SUPER FOCUS one-shot (2026-09-04).
//
// Drives the real earth-studio-super-focus.html against a real
// package-engine server with Mikko's exact instruction: proves the surface
// carries no Director planning controls, that one button creates the job,
// that real stage progress and an honest ETA are shown, that Play stays
// disabled until the MP4 exists, that a reload resumes the same job, and that
// a completed export (synthetic frames + real ffmpeg) turns into an enabled
// Play button with a loadable <video>. No network, no VIDNAS writes.
//
// Run: node scripts/earth-studio-super-focus-browser-smoke.js
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const CHROME_BIN = process.env.CHROME_BIN || findChrome();
const PROJECT_ID = 'es-super-focus-browser-smoke';
// The mission instruction — verbatim.
const INSTRUCTION = 'start in korkeasaari, Helsinki. circle there for 3 minutes. then move to linnanmäki, helsinki, circle there for 3 minutes. then move to jätkänsaari, Helsinki. circle there for 4 seconds.';
const SHORT_INSTRUCTION = 'orbit Helsinki for 2 seconds';
const SCREENSHOT_DIR = process.env.SF_SMOKE_SCREENSHOTS || '';

function findChrome() {
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = childProcess.spawnSync('sh', ['-lc', `command -v ${c}`], { encoding: 'utf8' });
    if (r.stdout.trim()) return r.stdout.trim();
  }
  return '';
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
      res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`)); try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map();
    socket.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data); if (!m.id) return;
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error))); else p.resolve(m.result || {});
    });
  }
  send(method, params = {}) { const id = this.nextId; this.nextId += 1; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result ? r.result.value : undefined;
  }
  async waitFor(expression, timeoutMs = 15000) {
    const t0 = Date.now(); let last = null;
    while (Date.now() - t0 < timeoutMs) { try { if (await this.evaluate(`Boolean(${expression})`)) return; } catch (e) { last = e; } await delay(120); }
    throw new Error(`Timed out waiting for: ${expression}${last ? ' (last error: ' + last.message + ')' : ''}`);
  }
  async screenshot(file) {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SCREENSHOT_DIR, file), Buffer.from(r.data, 'base64'));
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function openChrome(tempRoot, port) {
  if (!CHROME_BIN) throw new Error('No Chrome or Chromium binary found.');
  const chrome = childProcess.spawn(CHROME_BIN, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1100,1400', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tempRoot, 'chrome-profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.setEncoding('utf8'); let stderr = ''; chrome.stderr.on('data', (c) => { stderr += c; });
  for (let i = 0; i < 100; i += 1) { try { await requestJson(`http://127.0.0.1:${port}/json/version`); return chrome; } catch (_) { if (chrome.exitCode !== null) throw new Error(`Chrome exited early: ${stderr}`); await delay(100); } }
  throw new Error(`Chrome did not expose DevTools: ${stderr}`);
}
async function connect(port) {
  const targets = await requestJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((t) => t.type === 'page'); if (!page) throw new Error('no page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
  return new Cdp(socket);
}
const checks = [];
function check(label, ok, detail) { checks.push({ label, ok: !!ok, detail: detail || '' }); console.log(`${ok ? 'ok  ' : 'FAIL'} - ${label}${ok || !detail ? '' : ` :: ${detail}`}`); }
function freePort() { return new Promise((resolve, reject) => { const probe = net.createServer(); probe.on('error', reject); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); }); }

// Synthetic Earth Studio export: N tiny PNG frames written by ffmpeg itself
// (so the render stage exercises the real encoder end to end).
function writeSyntheticFrames(dir, count, fps) {
  fs.mkdirSync(dir, { recursive: true });
  const r = childProcess.spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=${fps}`, '-frames:v', String(count), path.join(dir, 'frame_%04d.png')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not write synthetic frames: ${r.stderr.slice(-400)}`);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'es-super-focus-smoke-'));
  const pkgDir = path.join(tempRoot, 'aigen', 'script-packages', PROJECT_ID);
  fs.mkdirSync(pkgDir, { recursive: true });
  const port = 9222 + Math.floor(Math.random() * 1000);
  let chrome = null; let cdp = null; let server = null;
  try {
    process.env.AIGEN_VIDNAS_ROOT = path.join(tempRoot, 'aigen');
    process.env.AIGEN_SCRIPT_PACKAGES = path.join(tempRoot, 'aigen', 'script-packages');
    const serverPort = await freePort();
    process.env.PORT = String(serverPort);
    const { createServer } = require('../package-engine-server.js');
    const sf = require('../earth-studio-super-focus.js');
    // fast watcher so the smoke does not wait 5 s per observation; render polls every 300 ms
    server = createServer({ root: ROOT, earthStudio: { pollIntervalMs: 400, renderPollMs: 300, stableMs: 20000 } });
    server.listen(serverPort, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${serverPort}`;
    chrome = await openChrome(tempRoot, port); cdp = await connect(port);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; window.addEventListener('error', (e)=>window.__errs.push(String(e.message)));` });

    // ── 1. initial surface: instruction + one button, no Director planning controls
    await cdp.send('Page.navigate', { url: `${base}/earth-studio-super-focus.html?id=${PROJECT_ID}` });
    await cdp.waitFor(`document.querySelector('[data-sf="create"]') && !document.getElementById('sf-compose').hidden`);
    await delay(300);
    await cdp.screenshot('01-initial-surface.png');
    check('instruction textarea and ONE Create map animation button are the visible controls',
      await cdp.evaluate(`document.querySelector('[data-sf="instruction"]') && document.querySelector('[data-sf="create"]').textContent.trim() === 'Create map animation' && document.querySelectorAll('#sf-compose button').length === 1 && document.getElementById('sf-job').hidden`),
      await cdp.evaluate(`Array.from(document.querySelectorAll('#sf-compose button, #sf-compose select, #sf-compose textarea')).map(b=>b.tagName+':'+(b.textContent.trim()||b.id)).join(' | ')`));
    const visibleText = await cdp.evaluate(`(()=>{const walk=(n)=>{if(n.nodeType===3)return n.textContent;if(n.nodeType!==1)return '';const s=getComputedStyle(n);if(s.display==='none'||n.hidden||n.closest('details:not([open])')&&n.tagName!=='SUMMARY')return '';return Array.from(n.childNodes).map(walk).join(' ');};return walk(document.querySelector('main')).replace(/\\s+/g,' ');})()`);
    check('no mandatory role / purpose / treatment / movement selection is presented',
      !/(PRIMARY_SUBJECT|WAYPOINT|Recommended camera treatment|Choose a role|purpose card|Movement at start|Travel style)/i.test(visibleText), visibleText.slice(0, 300));
    check('no role/purpose/treatment/movement/grammar form controls exist in the Super Focus DOM',
      await cdp.evaluate(`document.querySelectorAll('[data-role],[data-purpose],[data-grammar],[data-movement],[data-travel],.jb-opt,.jb-mode,#dirPurposeCards,#dirRoleCards,select[name*=role],select[name*=purpose],select[name*=treatment],select[name*=movement]').length === 0`));
    check('Advanced settings are collapsed by default and contain only the aspect ratio',
      await cdp.evaluate(`!document.getElementById('sf-advanced').open && document.querySelectorAll('#sf-advanced select').length === 1 && document.querySelector('#sf-advanced select').id === 'sf-aspect'`));
    check('the expert workspace stays reachable (normal mode intact)',
      await cdp.evaluate(`document.getElementById('sf-expert-link').getAttribute('href') === 'project-earth-studio.html?id=${PROJECT_ID}'`));

    // ── 2. one instruction, one button
    await cdp.evaluate(`(()=>{const t=document.querySelector('[data-sf="instruction"]'); t.value=${JSON.stringify(INSTRUCTION)}; t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const tClick = Date.now();
    await cdp.evaluate(`document.querySelector('[data-sf="create"]').click()`);
    await cdp.waitFor(`!document.getElementById('sf-job').hidden`);
    const tShown = Date.now() - tClick;
    check('the job view appears without waiting for planning (< 1.5 s)', tShown < 1500, `${tShown} ms`);
    await cdp.waitFor(`document.querySelector('[data-sf="status"]').dataset.state === 'WAITING_FOR_EARTH_STUDIO_EXPORT'`, 20000);
    await delay(300);
    await cdp.screenshot('02-job-waiting-for-earth-studio.png');
    const st = await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_ID}`);
    const job = st.data.job;
    check('backend job is durable and reached WAITING_FOR_EARTH_STUDIO_EXPORT', job.status === 'WAITING_FOR_EARTH_STUDIO_EXPORT' && fs.existsSync(path.join(pkgDir, 'earth-studio', 'super-focus-job.json')));
    check('instruction stored verbatim', job.instruction === INSTRUCTION);
    check('parsed journey = Korkeasaari → Linnanmäki → Jätkäsaari with 180/180/4 s',
      JSON.stringify(job.parsed.stops.map((s) => [s.location, s.explicit_duration_seconds])) === JSON.stringify([['Korkeasaari', 180], ['Linnanmäki', 180], ['Jätkäsaari', 4]]),
      JSON.stringify(job.parsed.stops.map((s) => [s.location, s.explicit_duration_seconds])));
    check('two automatic travel transitions', job.parsed.sequence.filter((e) => e.kind === 'travel').length === 2);
    check('real Earth Studio project exists (.esp)', fs.existsSync(path.join(pkgDir, 'earth-studio', 'earth-studio.esp')));
    check('stages Planning/Validating/Creating project are shown done, Waiting is active',
      await cdp.evaluate(`['PLANNING','VALIDATING','GENERATING_PROJECT'].every(n=>document.querySelector('[data-stage="'+n+'"]').classList.contains('stage-done')) && document.querySelector('[data-stage="WAITING_FOR_EARTH_STUDIO_EXPORT"]').classList.contains('stage-active')`),
      await cdp.evaluate(`Array.from(document.querySelectorAll('#sf-stages li')).map(l=>l.dataset.stage+':'+l.className).join(', ')`));
    check('ETA is honest: "not yet measurable" before any Earth Studio frame exists (no fabricated number)',
      await cdp.evaluate(`/not yet measurable/i.test(document.querySelector('[data-sf="eta"]').textContent)`), await cdp.evaluate(`document.querySelector('[data-sf="eta"]').textContent`));
    check('frame counter shows 0 / total planned frames', await cdp.evaluate(`/0 \\/ ${job.progress.frames_total} frames/.test(document.querySelector('[data-stage="WAITING_FOR_EARTH_STUDIO_EXPORT"]').textContent)`));
    check('Play button exists and is DISABLED while no playable result exists', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === true`));
    check('the manual Earth Studio step is explained (the one step no API can automate)', await cdp.evaluate(`/Earth Studio renders the frames/.test(document.getElementById('sf-manual').textContent) && /earth\\.google\\.com\\/studio/.test(document.getElementById('sf-manual').innerHTML)`));
    await cdp.evaluate(`document.querySelector('[data-sf="view-plan"]').click()`);
    check('View plan lists the three orbits and the two travel legs with their durations',
      await cdp.evaluate(`(()=>{const t=document.getElementById('sf-plan-table').textContent;return /Korkeasaari/.test(t)&&/Linnanmäki/.test(t)&&/Jätkäsaari/.test(t)&&(t.match(/travel/g)||[]).length===2&&/3 min/.test(t)&&/4 s/.test(t);})()`),
      await cdp.evaluate(`document.getElementById('sf-plan-table').textContent.replace(/\\s+/g,' ').slice(0,400)`));
    await cdp.screenshot('03-view-plan.png');

    // ── 3. reload resumes the same job
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.querySelector('[data-sf="status"]') && !document.getElementById('sf-job').hidden`);
    const jobIdAfterReload = await cdp.evaluate(`fetch('/api/earth-studio/super-focus/status?id=${PROJECT_ID}').then(r=>r.json()).then(j=>j.data.job.job_id)`);
    check('reload shows the same running job (no restart, no duplicate)', jobIdAfterReload === job.job_id && await cdp.evaluate(`document.querySelector('[data-sf="status"]').dataset.state === 'WAITING_FOR_EARTH_STUDIO_EXPORT' && document.getElementById('sf-compose').hidden`));

    // ── 4. a second, short job proves the export → render → READY → Play path in-browser.
    // (The 375 s journey would need 11 250 frames; the pipeline is identical.)
    await cdp.evaluate(`document.querySelector('[data-sf="another"]').click()`);
    await cdp.evaluate(`(()=>{const t=document.querySelector('[data-sf="instruction"]'); t.value=${JSON.stringify(SHORT_INSTRUCTION)};})()`);
    // the running job must refuse a second create (409), surfaced as a message
    await cdp.evaluate(`document.querySelector('[data-sf="create"]').click()`);
    await cdp.waitFor(`/already being created/i.test(document.getElementById('sf-compose-note').textContent)`, 8000);
    check('a running job refuses a second Create (409 surfaced, nothing duplicated)', true);
    // replace via the API as the operator would after cancelling (kept minimal: replace=true)
    const nonceInfo = await requestJson(`${base}/api/package-engine/status`);
    const nonce = nonceInfo.data ? nonceInfo.data.localWriteNonce : nonceInfo.localWriteNonce;
    const nonceHeader = (nonceInfo.data ? nonceInfo.data.nonceHeader : nonceInfo.nonceHeader) || 'x-vidtoolz-local-write-nonce';
    await cdp.evaluate(`fetch('/api/earth-studio/super-focus/create',{method:'POST',headers:{'Content-Type':'application/json','${nonceHeader}':${JSON.stringify(nonce)}},body:JSON.stringify({id:${JSON.stringify(PROJECT_ID)},instruction:${JSON.stringify(SHORT_INSTRUCTION)},replace:true})}).then(r=>r.status)`);
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.querySelector('[data-sf="status"]') && document.querySelector('[data-sf="status"]').dataset.state === 'WAITING_FOR_EARTH_STUDIO_EXPORT' && /orbit Helsinki/.test(document.getElementById('sf-job-meta').textContent)`, 15000);
    const shortJob = (await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_ID}`)).data.job;
    const total = shortJob.progress.frames_total; const fps = shortJob.project.frame_rate || 30;
    // export half the frames → progress + measured ETA appear; Play still disabled
    const framesDir = path.join(pkgDir, 'earth-studio', 'frames');
    writeSyntheticFrames(framesDir, Math.floor(total / 2), fps);
    await cdp.waitFor(`/${Math.floor(total / 2)} \\/ ${total} frames/.test(document.querySelector('[data-stage="WAITING_FOR_EARTH_STUDIO_EXPORT"]').textContent)`, 10000);
    check('frame arrival is reflected as real progress', true);
    check('Play still disabled with a partial export', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === true`));
    await delay(5200); // a measured rate needs two samples ≥ 5 s apart → wait for the watcher
    await cdp.waitFor(`/ETA/.test(document.querySelector('[data-sf="eta"]').textContent) || /measuring/.test(document.querySelector('[data-sf="eta"]').textContent)`, 12000);
    await cdp.screenshot('04-frames-arriving.png');
    // complete the export → render starts by itself → READY
    writeSyntheticFrames(framesDir, total, fps);
    await cdp.waitFor(`document.querySelector('[data-sf="status"]').dataset.state === 'READY'`, 60000);
    await delay(400);
    await cdp.screenshot('05-ready-play-enabled.png');
    const ready = (await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_ID}`)).data.job;
    check('export complete → render ran automatically → READY (no render button pressed)', ready.status === 'READY' && ready.stages.find((s) => s.name === 'RENDERING').completed_at);
    check('Play button becomes ENABLED only now', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === false`));
    const mp4 = path.join(pkgDir, ready.result.mp4);
    check('READY artifact is a real MP4 on disk', fs.existsSync(mp4) && fs.statSync(mp4).size > 1000, mp4);
    const probe = childProcess.spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,codec_name', '-of', 'csv=p=0', mp4], { encoding: 'utf8' });
    check(`the MP4 decodes with all ${total} frames (h264)`, /h264/.test(probe.stdout) && new RegExp(`\\b${total}\\b`).test(probe.stdout), probe.stdout.trim() || probe.stderr.slice(-200));
    await cdp.evaluate(`document.querySelector('[data-sf="play"]').click()`);
    await cdp.waitFor(`(()=>{const v=document.querySelector('[data-sf="video"]');return v && v.readyState >= 1;})()`, 15000);
    check('<video> loads the rendered MP4 from the served asset URL', await cdp.evaluate(`(()=>{const v=document.querySelector('[data-sf="video"]');return v.readyState>=1 && v.duration>0 && v.currentSrc.includes('/aigen-assets/script-packages/${PROJECT_ID}/earth-studio/renders/');})()`),
      await cdp.evaluate(`(()=>{const v=document.querySelector('[data-sf="video"]');return v.currentSrc+' readyState='+v.readyState+' duration='+v.duration;})()`));
    check('measured render rate recorded for future ETAs', fs.existsSync(path.join(pkgDir, 'earth-studio', 'super-focus-timing.json')));
    check('durations visible per stage in the human acceptance view', await cdp.evaluate(`Array.from(document.querySelectorAll('#sf-stages li')).filter(l=>/\\d+(\\.\\d+)? (s|min)/.test(l.textContent)).length >= 5`));

    const jsErrors = await cdp.evaluate(`window.__errs || []`);
    check('no uncaught JavaScript errors on the page', jsErrors.length === 0, JSON.stringify(jsErrors));
    sf.stopWatcher(pkgDir);
  } finally {
    if (cdp) cdp.close();
    if (chrome) { try { chrome.kill('SIGKILL'); } catch (_) {} }
    if (server) { server.close(); }
    if (!process.env.SF_SMOKE_KEEP) fs.rmSync(tempRoot, { recursive: true, force: true }); else console.log(`kept ${tempRoot}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — ${checks.length - failed.length}/${checks.length} browser checks`);
  if (failed.length) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
}
main().catch((error) => { console.error('SMOKE ERROR:', error.message); process.exitCode = 1; setTimeout(() => process.exit(1), 200); });
