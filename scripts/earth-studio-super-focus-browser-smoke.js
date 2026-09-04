#!/usr/bin/env node
'use strict';
// Headless-Chrome smoke for EARTH STUDIO SUPER FOCUS one-shot (2026-09-04, terminal repair).
//
// Drives the real earth-studio-super-focus.html against a real package-engine
// server with Mikko's exact instruction. The Earth Studio export is FAKED
// through the server's injectable runner (tests/_earth-studio-fake-export.js,
// real naming convention, real JPEGs) so the smoke needs no Google session;
// ffmpeg and ffprobe are real. Proves: no Director planning controls, one
// button, real stage progress, honest ETA (not measurable → measured), Play
// disabled until READY, no manual Earth Studio instructions, one active job
// (409 surfaced, nothing replaced), reload resumes the same job, and a second
// project completes export → verified frames → encode → ffprobe → READY → Play.
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
const PROJECT_A = 'es-super-focus-smoke-helsinki';
const PROJECT_B = 'es-super-focus-smoke-short';
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
    const req = http.request(url, { method: 'GET' }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; }); res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`)); try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end();
  });
}
class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map();
    socket.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (!m.id) return; const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error))); else p.resolve(m.result || {}); });
  }
  send(method, params = {}) { const id = this.nextId; this.nextId += 1; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '')); return r.result ? r.result.value : undefined; }
  async waitFor(expression, timeoutMs = 15000) { const t0 = Date.now(); let last = null; while (Date.now() - t0 < timeoutMs) { try { if (await this.evaluate(`Boolean(${expression})`)) return; } catch (e) { last = e; } await delay(120); } throw new Error(`Timed out waiting for: ${expression}${last ? ' (last error: ' + last.message + ')' : ''}`); }
  async screenshot(file) { if (!SCREENSHOT_DIR) return; fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, file), Buffer.from(r.data, 'base64')); }
  close() { try { this.socket.close(); } catch (_) {} }
}
async function openChrome(tempRoot, port) {
  if (!CHROME_BIN) throw new Error('No Chrome or Chromium binary found.');
  const chrome = childProcess.spawn(CHROME_BIN, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1100,1500', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tempRoot, 'chrome-profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'es-super-focus-smoke-'));
  const pkgA = path.join(tempRoot, 'aigen', 'script-packages', PROJECT_A); const pkgB = path.join(tempRoot, 'aigen', 'script-packages', PROJECT_B);
  fs.mkdirSync(pkgA, { recursive: true }); fs.mkdirSync(pkgB, { recursive: true });
  const port = 9222 + Math.floor(Math.random() * 1000);
  let chrome = null; let cdp = null; let server = null;
  try {
    process.env.AIGEN_VIDNAS_ROOT = path.join(tempRoot, 'aigen');
    process.env.AIGEN_SCRIPT_PACKAGES = path.join(tempRoot, 'aigen', 'script-packages');
    const serverPort = await freePort();
    process.env.PORT = String(serverPort);
    const { createServer } = require('../package-engine-server.js');
    const sf = require('../earth-studio-super-focus.js');
    const { fakeExportRunner } = require('../tests/_earth-studio-fake-export.js');
    // the Helsinki job (11 251 frames) arrives slowly and never finishes inside
    // the smoke; the short job completes: dispatch on the planned length
    const slow = fakeExportRunner({ mode: 'hang', stallAfter: 40, frameDelayMs: 350, launchDelayMs: 600 });
    const fast = fakeExportRunner({ mode: 'complete', frameDelayMs: 60, launchDelayMs: 300 });
    const exportRunner = (params) => (params.expected.last > 1000 ? slow(params) : fast(params));
    server = createServer({ root: ROOT, earthStudio: { exportRunner, pollIntervalMs: 500, renderPollMs: 300 } });
    server.listen(serverPort, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${serverPort}`;
    chrome = await openChrome(tempRoot, port); cdp = await connect(port);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; window.addEventListener('error', (e)=>window.__errs.push(String(e.message)));` });

    // ── 1. initial surface
    await cdp.send('Page.navigate', { url: `${base}/earth-studio-super-focus.html?id=${PROJECT_A}` });
    await cdp.waitFor(`document.querySelector('[data-sf="create"]') && !document.getElementById('sf-compose').hidden`);
    await delay(300); await cdp.screenshot('01-initial-surface.png');
    check('instruction textarea and ONE Create map animation button are the visible controls',
      await cdp.evaluate(`document.querySelector('[data-sf="instruction"]') && document.querySelector('[data-sf="create"]').textContent.trim() === 'Create map animation' && document.querySelectorAll('#sf-compose button').length === 1 && document.getElementById('sf-job').hidden`));
    const visibleText = await cdp.evaluate(`(()=>{const walk=(n)=>{if(n.nodeType===3)return n.textContent;if(n.nodeType!==1)return '';const s=getComputedStyle(n);if(s.display==='none'||n.hidden||n.closest('details:not([open])')&&n.tagName!=='SUMMARY')return '';return Array.from(n.childNodes).map(walk).join(' ');};return walk(document.querySelector('main')).replace(/\\s+/g,' ');})()`);
    check('no mandatory role / purpose / treatment / movement selection is presented', !/(PRIMARY_SUBJECT|WAYPOINT|Recommended camera treatment|Choose a role|purpose card|Movement at start|Travel style)/i.test(visibleText), visibleText.slice(0, 300));
    check('no role/purpose/treatment/movement/grammar form controls exist in the Super Focus DOM',
      await cdp.evaluate(`document.querySelectorAll('[data-role],[data-purpose],[data-grammar],[data-movement],[data-travel],.jb-opt,.jb-mode,#dirPurposeCards,#dirRoleCards,select[name*=role],select[name*=purpose],select[name*=treatment],select[name*=movement]').length === 0`));
    check('Advanced settings are collapsed by default and contain only the aspect ratio', await cdp.evaluate(`!document.getElementById('sf-advanced').open && document.querySelectorAll('#sf-advanced select').length === 1 && document.querySelector('#sf-advanced select').id === 'sf-aspect'`));
    check('the expert workspace stays reachable (normal mode intact)', await cdp.evaluate(`document.getElementById('sf-expert-link').getAttribute('href') === 'project-earth-studio.html?id=${PROJECT_A}'`));

    // ── 2. one instruction, one button (exact Helsinki instruction)
    await cdp.evaluate(`(()=>{const t=document.querySelector('[data-sf="instruction"]'); t.value=${JSON.stringify(INSTRUCTION)}; t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const tClick = Date.now();
    await cdp.evaluate(`document.querySelector('[data-sf="create"]').click()`);
    await cdp.waitFor(`!document.getElementById('sf-job').hidden`);
    check('the job view appears without waiting for planning (< 1.5 s)', Date.now() - tClick < 1500, `${Date.now() - tClick} ms`);
    await cdp.waitFor(`['LAUNCHING_EARTH_STUDIO','IMPORTING_PROJECT','EXPORTING_EARTH_STUDIO_FRAMES'].includes(document.querySelector('[data-sf="status"]').dataset.state)`, 20000);
    const st = await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_A}`); const job = st.data.job;
    check('backend job is durable and Earth Studio automation started by itself', ['LAUNCHING_EARTH_STUDIO', 'IMPORTING_PROJECT', 'EXPORTING_EARTH_STUDIO_FRAMES'].includes(job.status) && fs.existsSync(path.join(pkgA, 'earth-studio', 'super-focus-job.json')), job.status);
    check('instruction stored verbatim', job.instruction === INSTRUCTION);
    check('parsed journey = Korkeasaari → Linnanmäki → Jätkäsaari with 180/180/4 s', JSON.stringify(job.parsed.stops.map((s) => [s.location, s.explicit_duration_seconds])) === JSON.stringify([['Korkeasaari', 180], ['Linnanmäki', 180], ['Jätkäsaari', 4]]), JSON.stringify(job.parsed.stops.map((s) => [s.location, s.explicit_duration_seconds])));
    check('375 s plan → 11 250 frames, 11 251 expected from Earth Studio (0..11250 inclusive)', job.parsed.total_duration_seconds === 375 && job.progress.frames_total === 11250 && job.progress.frames_expected === 11251);
    check('real Earth Studio project exists (.esp)', fs.existsSync(path.join(pkgA, 'earth-studio', 'earth-studio.esp')));
    check('ETA is honest before the first frame: not yet measurable', await cdp.evaluate(`/not yet measurable/i.test(document.querySelector('[data-sf="eta"]').textContent)`), await cdp.evaluate(`document.querySelector('[data-sf="eta"]').textContent`));
    check('Play button exists and is DISABLED while no playable result exists', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === true`));
    check('no manual Earth Studio instructions are shown (no import/render/export/copy steps for the user)', !/(import the|Render all|export folder|copy the frames|Choose folder)/i.test(await cdp.evaluate(`document.querySelector('main').innerText`)));
    await cdp.waitFor(`document.querySelector('[data-sf="status"]').dataset.state === 'EXPORTING_EARTH_STUDIO_FRAMES' && /\\b[1-9]\\d* \\/ 11251 frames/.test(document.querySelector('[data-stage="EXPORTING_EARTH_STUDIO_FRAMES"]').textContent)`, 25000);
    check('real Earth Studio frame acquisition is reflected as progress (x / 11251 frames)', true);
    check('the automation card says Earth Studio is running automatically', await cdp.evaluate(`/running automatically/.test(document.getElementById('sf-auto').textContent)`));
    await cdp.waitFor(`/observed earth studio export rate/i.test(document.querySelector('[data-sf="eta"]').textContent)`, 30000);
    const etaText = await cdp.evaluate(`document.querySelector('[data-sf="eta"]').textContent`);
    check('ETA becomes measurable from the observed acquisition rate, labelled', /observed earth studio export rate/i.test(etaText), etaText);
    await cdp.screenshot('02-helsinki-exporting.png');
    check('Play still disabled during acquisition', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === true`));
    await cdp.evaluate(`document.querySelector('[data-sf="view-plan"]').click()`);
    check('View plan lists the three orbits and the two travel legs', await cdp.evaluate(`(()=>{const t=document.getElementById('sf-plan-table').textContent;return /Korkeasaari/.test(t)&&/Linnanmäki/.test(t)&&/Jätkäsaari/.test(t)&&(t.match(/travel/g)||[]).length===2&&/3 min/.test(t)&&/4 s/.test(t);})()`));
    check('Create another and Retry are not shown while a job is running (one active job; computed style, not just the attribute)', await cdp.evaluate(`getComputedStyle(document.getElementById('sf-another')).display === 'none' && getComputedStyle(document.getElementById('sf-retry')).display === 'none'`));

    // ── 3. reload resumes the same job; a second Create is refused (409), nothing replaced
    await cdp.send('Page.reload');
    await cdp.waitFor(`document.querySelector('[data-sf="status"]') && !document.getElementById('sf-job').hidden`);
    const afterReload = (await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_A}`)).data.job;
    check('reload shows the same running job (same job_id, same attempt, no duplicate Earth Studio session)', afterReload.job_id === job.job_id && afterReload.export.attempt === 1 && slow.calls.length === 1, `calls ${slow.calls.length}`);
    const nonceInfo = await requestJson(`${base}/api/package-engine/status`);
    const nonce = nonceInfo.data ? nonceInfo.data.localWriteNonce : nonceInfo.localWriteNonce; const nonceHeader = (nonceInfo.data ? nonceInfo.data.nonceHeader : nonceInfo.nonceHeader) || 'x-vidtoolz-local-write-nonce';
    const dupStatus = await cdp.evaluate(`fetch('/api/earth-studio/super-focus/create',{method:'POST',headers:{'Content-Type':'application/json','${nonceHeader}':${JSON.stringify(nonce)}},body:JSON.stringify({id:${JSON.stringify(PROJECT_A)},instruction:${JSON.stringify(SHORT_INSTRUCTION)},replace:true})}).then(r=>r.status)`);
    const stillSame = (await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_A}`)).data.job;
    check('a second Create (even with replace:true) is 409 and the running job is untouched', dupStatus === 409 && stillSame.job_id === job.job_id && stillSame.instruction === INSTRUCTION, `status ${dupStatus}`);

    // ── 4. a second project completes the whole automated path to Play
    await cdp.send('Page.navigate', { url: `${base}/earth-studio-super-focus.html?id=${PROJECT_B}` });
    await cdp.waitFor(`document.querySelector('[data-sf="create"]') && !document.getElementById('sf-compose').hidden`);
    await cdp.evaluate(`(()=>{const t=document.querySelector('[data-sf="instruction"]'); t.value=${JSON.stringify(SHORT_INSTRUCTION)};})()`);
    await cdp.evaluate(`document.querySelector('[data-sf="create"]').click()`);
    await cdp.waitFor(`document.querySelector('[data-sf="status"]').dataset.state === 'EXPORTING_EARTH_STUDIO_FRAMES'`, 20000);
    await cdp.waitFor(`/\\b(1[0-9]|[2-5][0-9]) \\/ 61 frames/.test(document.querySelector('[data-stage="EXPORTING_EARTH_STUDIO_FRAMES"]').textContent)`, 15000);
    check('short job: frames arrive one by one (x / 61, inclusive convention) with Play disabled', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === true`));
    await cdp.screenshot('03-short-exporting.png');
    await cdp.waitFor(`document.querySelector('[data-sf="status"]').dataset.state === 'READY'`, 90000);
    await delay(400); await cdp.screenshot('04-ready-play-enabled.png');
    const ready = (await requestJson(`${base}/api/earth-studio/super-focus/status?id=${PROJECT_B}`)).data.job;
    check('export complete → manifest verified → encode → ffprobe → READY without any button', ready.status === 'READY' && ready.render.state === 'validated' && ready.render.validation.ok && /verified/.test(ready.stages.find((s) => s.name === 'EXPORTING_EARTH_STUDIO_FRAMES').note || ''));
    check('READY carries ffprobe facts: h264, 60 frames, 2.0 s', ready.result.codec === 'h264' && ready.result.total_frames === 60 && Math.abs(ready.result.duration_seconds - 2) < 0.05, JSON.stringify(ready.result));
    check('Play button becomes ENABLED only now', await cdp.evaluate(`document.querySelector('[data-sf="play"]').disabled === false`));
    const mp4 = path.join(pkgB, ready.result.mp4);
    const probe = childProcess.spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,codec_name', '-of', 'csv=p=0', mp4], { encoding: 'utf8' });
    check('the MP4 on disk decodes with exactly 60 h264 frames', /h264/.test(probe.stdout) && /\b60\b/.test(probe.stdout), probe.stdout.trim());
    await cdp.evaluate(`document.querySelector('[data-sf="play"]').click()`);
    await cdp.waitFor(`(()=>{const v=document.querySelector('[data-sf="video"]');return v && v.readyState >= 1;})()`, 15000);
    check('<video> loads the rendered MP4 from the served asset URL', await cdp.evaluate(`(()=>{const v=document.querySelector('[data-sf="video"]');return v.readyState>=1 && v.duration>0 && v.currentSrc.includes('/aigen-assets/script-packages/${PROJECT_B}/earth-studio/renders/');})()`));
    check('result line states validation and imagery attribution', await cdp.evaluate(`/validated with ffprobe/.test(document.getElementById('sf-result-meta').textContent) && /imagery:/.test(document.getElementById('sf-result-meta').textContent)`));
    check('durations visible per stage in the human acceptance view', await cdp.evaluate(`Array.from(document.querySelectorAll('#sf-stages li')).filter(l=>/\\d+(\\.\\d+)? (s|min)/.test(l.textContent)).length >= 6`));
    check('Create another is offered once the job is terminal', await cdp.evaluate(`getComputedStyle(document.getElementById('sf-another')).display !== 'none' && getComputedStyle(document.getElementById('sf-retry')).display === 'none'`));
    const jsErrors = await cdp.evaluate(`window.__errs || []`);
    check('no uncaught JavaScript errors on the page', jsErrors.length === 0, JSON.stringify(jsErrors));
    sf.stopWatcher(pkgA); sf.stopWatcher(pkgB);
  } finally {
    if (cdp) cdp.close();
    if (chrome) { try { chrome.kill('SIGKILL'); } catch (_) {} }
    if (server) server.close();
    if (!process.env.SF_SMOKE_KEEP) fs.rmSync(tempRoot, { recursive: true, force: true }); else console.log(`kept ${tempRoot}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — ${checks.length - failed.length}/${checks.length} browser checks`);
  if (failed.length) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode || 0), 200).unref();
}
main().catch((error) => { console.error('SMOKE ERROR:', error.message); process.exitCode = 1; setTimeout(() => process.exit(1), 200); });
