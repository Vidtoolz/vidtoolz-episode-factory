#!/usr/bin/env node
'use strict';
// Headless-Chrome smoke for the Earth Studio CAMERA JOURNEY builder.
//
// Drives the real project-earth-studio.html against a real package-engine
// server: builds a journey through the UI (start, opening movement, travel,
// destination, extra destination, reorder), checks the live estimate/summary,
// generates through the real /api/earth-studio/plan route, then starts a
// continuation from the exported ending state. No network, no VIDNAS writes,
// no renders.
//
// Run: node scripts/earth-studio-journey-browser-smoke.js
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const CHROME_BIN = process.env.CHROME_BIN || findChrome();
const PROJECT_ID = 'es-journey-browser-smoke';

function findChrome() {
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = childProcess.spawnSync('sh', ['-lc', `command -v ${c}`], { encoding: 'utf8' });
    if (r.stdout.trim()) return r.stdout.trim();
  }
  return '';
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (v) => JSON.stringify(v);

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map();
    socket.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (!m.id) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error)));
      else p.resolve(m.result || {});
    });
  }
  send(method, params = {}) {
    const id = this.nextId; this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result ? r.result.value : undefined;
  }
  async waitFor(expression, timeoutMs = 15000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      try { if (await this.evaluate(`Boolean(${expression})`)) return; }
      catch (e) { last = e; }
      await delay(120);
    }
    throw new Error(`Timed out waiting for: ${expression}${last ? ' (last error: ' + last.message + ')' : ''}`);
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function openChrome(tempRoot, port) {
  if (!CHROME_BIN) throw new Error('No Chrome or Chromium binary found.');
  const chrome = childProcess.spawn(CHROME_BIN, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tempRoot, 'chrome-profile')}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.setEncoding('utf8');
  let stderr = '';
  chrome.stderr.on('data', (c) => { stderr += c; });
  for (let i = 0; i < 100; i += 1) {
    try { await requestJson(`http://127.0.0.1:${port}/json/version`); return chrome; }
    catch (_) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited early: ${stderr}`);
      await delay(100);
    }
  }
  throw new Error(`Chrome did not expose DevTools: ${stderr}`);
}

async function connect(port) {
  const targets = await requestJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true });
    socket.addEventListener('error', rej, { once: true });
  });
  return new Cdp(socket);
}

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${label}${ok || !detail ? '' : ` :: ${detail}`}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'es-journey-smoke-'));
  const pkgDir = path.join(tempRoot, 'aigen', 'script-packages', PROJECT_ID);
  fs.mkdirSync(pkgDir, { recursive: true });
  const port = 9222 + Math.floor(Math.random() * 1000);
  let chrome = null; let cdp = null; let server = null;
  try {
    // The aigen lane paths come from env (aigenPaths), exactly as the
    // earth-studio route tests configure them.
    process.env.AIGEN_VIDNAS_ROOT = path.join(tempRoot, 'aigen');
    process.env.AIGEN_SCRIPT_PACKAGES = path.join(tempRoot, 'aigen', 'script-packages');
    // The nonce-gated write routes only accept a Host matching the server's
    // configured PORT, which the module reads at load time — so set it first.
    const serverPort = await freePort();
    process.env.PORT = String(serverPort);
    const { createServer } = require('../package-engine-server.js');
    server = createServer({ root: ROOT });
    server.listen(serverPort, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${serverPort}`;
    chrome = await openChrome(tempRoot, port);
    cdp = await connect(port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const errors = [];
    await cdp.send('Log.enable').catch(() => {});
    await cdp.send('Page.navigate', { url: `${base}/project-earth-studio.html?id=${PROJECT_ID}` });
    await cdp.waitFor(`document.querySelector('#es-journey .jb-flow')`);
    await cdp.evaluate(`window.__errs = []; window.addEventListener('error', (e)=>window.__errs.push(String(e.message)));`);

    // ── the journey builder is the default view, with the whole sequence visible
    check('journey builder is the default mode',
      await cdp.evaluate(`MODE === 'journey' && document.getElementById('es-journey').style.display !== 'none'`));
    const kickers = await cdp.evaluate(`Array.from(document.querySelectorAll('#es-journey .jb-kicker')).map(e=>e.textContent.replace(/\\s+/g,' ').trim())`);
    check('start location block present', kickers.some((k) => /Start location/i.test(k)), JSON.stringify(kickers.slice(0, 3)));
    check('movement-at-start block present', kickers.some((k) => /Movement at start/i.test(k)));
    check('travel block present', kickers.some((k) => /Travel to destination 1/i.test(k)));
    check('destination block present', kickers.some((k) => /^\d?\s*Destination 1/i.test(k)), JSON.stringify(kickers));
    check('movement-at-destination block present', kickers.some((k) => /Movement at destination 1/i.test(k)));
    check('add-destination control present', await cdp.evaluate(`Boolean(document.querySelector('[data-addleg]'))`));
    check('movements are visible cards, not a dropdown',
      await cdp.evaluate(`document.querySelectorAll('#es-journey .jb-opt').length >= 10`));

    // ── set the start location and read the auto-framing back
    await cdp.evaluate(`(()=>{const i=document.querySelector('[data-place="start"]'); i.value='Helsinki'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(250);
    const framingText = await cdp.evaluate(`document.querySelector('#es-journey .jb-frame') ? document.querySelector('#es-journey .jb-frame').textContent.replace(/\\s+/g,' ').trim() : ''`);
    check('auto framing is shown for the start location', /Camera distance/.test(framingText) && /City/.test(framingText), framingText);

    // ── a small landmark must frame closer than a country, through the UI
    const altFor = async (place) => {
      await cdp.evaluate(`(()=>{const i=document.querySelector('[data-place="start"]'); i.value=${JSON.stringify(place)}; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await delay(220);
      return cdp.evaluate(`JB.compileJourney(JOURNEY).steps[0].altitude_m`);
    };
    const landmarkAlt = await altFor('Eiffel Tower');
    const countryAlt = await altFor('Finland');
    check('a landmark is framed far closer than a country', landmarkAlt < countryAlt / 100, `landmark ${landmarkAlt}m vs country ${countryAlt}m`);
    await altFor('Helsinki');

    // ── estimated length is live
    const clockBefore = await cdp.evaluate(`document.querySelector('#es-journey .jb-total .big').textContent`);
    check('estimated video length is displayed', /^\d\d:\d\d$/.test(clockBefore), clockBefore);

    // ── add a second destination and name it
    await cdp.evaluate(`document.querySelector('[data-addleg]').click()`);
    await delay(250);
    check('a second destination block appeared', await cdp.evaluate(`JOURNEY.legs.length === 2`));
    await cdp.evaluate(`(()=>{const els=document.querySelectorAll('[data-place="legs"]'); const i=els[els.length-1]; i.value='Copenhagen'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(250);
    const clockAfter = await cdp.evaluate(`document.querySelector('#es-journey .jb-total .big').textContent`);
    check('the estimate grew when a destination was added', clockAfter !== clockBefore, `${clockBefore} -> ${clockAfter}`);

    // ── plain-language summary and route timeline
    const prose = await cdp.evaluate(`Array.from(document.querySelectorAll('#es-journey .jb-prose p')).map(p=>p.textContent).join(' ')`);
    check('journey summary reads as plain language',
      /Start over Helsinki/.test(prose) && /Stockholm/.test(prose) && /Copenhagen/.test(prose) && /Estimated duration/.test(prose),
      prose.slice(0, 140));
    const timeline = await cdp.evaluate(`document.querySelector('#es-journey .jb-tl').textContent`);
    check('route timeline lists all three stops in order',
      timeline.indexOf('HELSINKI') >= 0 && timeline.indexOf('STOCKHOLM') > timeline.indexOf('HELSINKI')
      && timeline.indexOf('COPENHAGEN') > timeline.indexOf('STOCKHOLM'), timeline.replace(/\n/g, ' | '));

    // ── reorder destinations
    await cdp.evaluate(`document.querySelector('[data-mvleg="1"][data-dir="-1"]').click()`);
    await delay(250);
    check('destinations reorder from the UI',
      await cdp.evaluate(`JOURNEY.legs.map(l=>l.destination.location).join(',') === 'Copenhagen,Stockholm'`),
      await cdp.evaluate(`JOURNEY.legs.map(l=>l.destination.location).join(',')`));
    await cdp.evaluate(`document.querySelector('[data-mvleg="0"][data-dir="1"]').click()`);
    await delay(250);

    // ── choose a movement card and a pace
    await cdp.evaluate(`(()=>{const b=document.querySelector('[data-mstep="start_movements"][data-mtype="orbit_twice"]'); b.click();})()`);
    await delay(250);
    check('picking a movement card changes the journey',
      await cdp.evaluate(`JOURNEY.start_movements[0].type === 'orbit_twice'`));
    await cdp.evaluate(`document.querySelector('[data-pace="quick"]').click()`);
    await delay(250);
    const quickTotal = await cdp.evaluate(`JB.summarizeJourney(JOURNEY).total_duration_seconds`);
    await cdp.evaluate(`document.querySelector('[data-pace="calm"]').click()`);
    await delay(250);
    const calmTotal = await cdp.evaluate(`JB.summarizeJourney(JOURNEY).total_duration_seconds`);
    check('calm pacing produces a longer journey than quick', calmTotal > quickTotal, `calm ${calmTotal}s vs quick ${quickTotal}s`);

    // ── an invalid journey blocks Generate with a readable reason
    await cdp.evaluate(`(()=>{const i=document.querySelector('[data-place="start"]'); i.value='Narnia'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(300);
    check('an unknown place blocks Generate', await cdp.evaluate(`document.getElementById('es-generate').disabled === true`));
    check('and explains why in plain words',
      await cdp.evaluate(`/not a place the generator knows/.test(document.querySelector('#es-journey .jb-err') ? document.querySelector('#es-journey .jb-err').textContent : '')`));
    await cdp.evaluate(`(()=>{const i=document.querySelector('[data-place="start"]'); i.value='Helsinki'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(300);
    check('fixing the place re-enables Generate', await cdp.evaluate(`document.getElementById('es-generate').disabled === false`));

    // ── generate for real, through the real route
    await cdp.evaluate(`(()=>{const i=document.getElementById('es-job'); i.value='Browser Smoke Journey';})()`);
    const expectedTotal = await cdp.evaluate(`JB.summarizeJourney(JOURNEY).total_duration_seconds`);
    await cdp.evaluate(`document.getElementById('es-generate').click()`);
    try {
      await cdp.waitFor(`ST && ST.has_plan === true`, 20000);
    } catch (error) {
      const why = await cdp.evaluate(`document.getElementById('es-gen-status').textContent`);
      throw new Error(`${error.message} :: generate status said: ${why}`);
    }
    const laneDir = path.join(pkgDir, 'earth-studio');
    const job = JSON.parse(fs.readFileSync(path.join(laneDir, 'job.json'), 'utf8'));
    check('generate wrote a real plan through the API', fs.existsSync(path.join(laneDir, 'earth-studio.esp')));
    check('job.json records the journey', job.journey && job.journey.journey_version === 1 && job.journey.stop_count === 3,
      JSON.stringify(job.journey && { v: job.journey.journey_version, stops: job.journey.stop_count }));
    check('the generated length matches what the UI promised', job.total_duration_seconds === expectedTotal,
      `${job.total_duration_seconds}s vs UI ${expectedTotal}s`);
    check('journey.json + continuation-state.json were written',
      fs.existsSync(path.join(laneDir, 'journey.json')) && fs.existsSync(path.join(laneDir, 'continuation-state.json')));

    // ── continuation: the UI can start a new journey from the ending state
    await cdp.waitFor(`ST && ST.continuation && ST.continuation.camera`, 15000);
    const contDiag = await cdp.evaluate(`JSON.stringify({
      hasCont: Boolean(ST && ST.continuation),
      stepsHasSix: /6 . Continue/.test(document.getElementById('es-steps').innerHTML),
      btn: Boolean(document.getElementById('es-create-cont')),
      tail: document.getElementById('es-steps').innerHTML.slice(-400)
    })`);
    check('the ending camera state is shown in the UI',
      await cdp.evaluate(`Boolean(document.getElementById('es-create-cont')) && /Ends at/.test(document.body.textContent)`), contDiag);
    const stateA = JSON.parse(fs.readFileSync(path.join(laneDir, 'continuation-state.json'), 'utf8'));
    await cdp.evaluate(`document.getElementById('es-create-cont').click()`);
    await delay(400);
    check('create continuation seeds the journey with the exact ending camera',
      await cdp.evaluate(`JOURNEY.start.source === 'continuation'
        && JSON.stringify(JB.compileJourney(JOURNEY).initial_camera) === JSON.stringify({
          latitude: ${stateA.camera.latitude}, longitude: ${stateA.camera.longitude},
          altitude_m: ${stateA.camera.altitude_m}, pan_deg: ${stateA.camera.pan_deg}, tilt_deg: ${stateA.camera.tilt_deg} })`),
      JSON.stringify(await cdp.evaluate(`JB.compileJourney(JOURNEY).initial_camera`)));
    check('the continuation journey opens with a Hold, which joins seamlessly',
      await cdp.evaluate(`JOURNEY.start_movements[0].type === 'hold'`));

    // ── regression: reopening the page for a project that ALREADY has a job
    // must render the steps on first load. Before the fix, the refresh()
    // dirty-check tripped on the placeholder job name and the page sat on
    // "Loading…" forever whenever a job existed.
    await cdp.send('Page.navigate', { url: `${base}/project-earth-studio.html?id=${PROJECT_ID}` });
    await cdp.waitFor(`document.querySelectorAll('#es-steps .step').length === 6`);
    check('reopening a project WITH an existing job renders immediately (no stuck Loading…)',
      await cdp.evaluate(`!/^Loading/.test(document.getElementById('es-meta').textContent) && document.querySelectorAll('#es-steps .step').length === 6`),
      await cdp.evaluate(`document.getElementById('es-meta').textContent.slice(0, 80)`));

    // ── the freeform description path is still available and still works
    await cdp.evaluate(`document.querySelector('[data-mode="freeform"]').click()`);
    await delay(300);
    check('freeform description mode is still reachable',
      await cdp.evaluate(`MODE === 'freeform' && document.getElementById('es-freeform').style.display !== 'none' && Boolean(document.getElementById('es-desc'))`));
    await cdp.evaluate(`(()=>{const t=document.getElementById('es-desc'); t.value='fly to Paris for 5 seconds then orbit Paris for 12 seconds'; t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(500);
    check('the freeform live parse preview still renders',
      await cdp.evaluate(`/orbit/.test(document.getElementById('es-preview').textContent) && /Total: 17s/.test(document.getElementById('es-preview').textContent)`),
      await cdp.evaluate(`document.getElementById('es-preview').textContent.slice(0,120)`));

    // ── directorial layer ──
    await cdp.evaluate(`document.querySelector('[data-mode="journey"]').click()`);
    await delay(400);
    check('story-intent layer asks what the location is doing in the story',
      await cdp.evaluate(`/What is this location doing in the story/.test(document.getElementById('es-journey').textContent)`));
    check('narrative role cards are shown',
      await cdp.evaluate(`document.querySelectorAll('[data-dirrole]').length >= 8`),
      String(await cdp.evaluate(`document.querySelectorAll('[data-dirrole]').length`)));
    check('viewer-understanding (purpose) cards are shown',
      await cdp.evaluate(`document.querySelectorAll('[data-dirpurpose]').length >= 8`));

    // choose a role on the start location and read the recommendation
    await cdp.evaluate(`(()=>{const b=document.querySelector('[data-dirrole="start"][data-val="PRIMARY_SUBJECT"]'); b.click();})()`);
    await delay(500);
    check('picking a role produces a recommendation with a stated reason',
      await cdp.evaluate(`(()=>{const t=document.getElementById('es-journey').textContent;
        return /Recommended camera treatment/.test(t) && /Why:/.test(t) && /Communicates:/.test(t);})()`));
    check('the recommendation names a purpose and what the viewer should understand',
      await cdp.evaluate(`/Purpose:/.test(document.getElementById('es-journey').textContent)`));
    const recBefore = await cdp.evaluate(`document.querySelector('.dir-rec-name') ? document.querySelector('.dir-rec-name').textContent : ''`);
    check('a landmark-ish primary subject is recommended an inspection move', /Orbit|Spiral|Push In/.test(recBefore), recBefore);

    // apply it
    const useBtn = await cdp.evaluate(`Boolean(document.querySelector('[data-diruse]'))`);
    if (useBtn) {
      const wanted = await cdp.evaluate(`document.querySelector('[data-diruse]').dataset.mv`);
      await cdp.evaluate(`document.querySelector('[data-diruse]').click()`);
      await delay(500);
      check('Use recommendation applies the recommended movement',
        await cdp.evaluate(`JOURNEY.start_movements[0].type === ${js(wanted)}`),
        await cdp.evaluate(`JOURNEY.start_movements[0].type`));
      check('applying it also carries the directorial screen-time emphasis',
        await cdp.evaluate(`Number.isFinite(JOURNEY.start_movements[0].emphasis)`));
    } else {
      check('Use recommendation applies the recommended movement', false, 'no [data-diruse] button rendered');
    }

    // deliberately override with something the Director would not pick
    await cdp.evaluate(`(()=>{const b=document.querySelector('[data-mstep="start_movements"][data-mtype="hold"]'); b.click();})()`);
    await delay(500);
    check('overriding the recommendation is allowed but flagged',
      await cdp.evaluate(`JOURNEY.start_movements[0].type === 'hold' && /not what the Director would pick/.test(document.getElementById('es-journey').textContent)`));

    check('movement cards carry directorial teaching on hover',
      await cdp.evaluate(`(()=>{const b=document.querySelector('[data-mtype="spiral_in"]');
        return Boolean(b) && /rarity: special/i.test(b.title) && /Avoid when:/.test(b.title);})()`));
    check('the whole-globe rule is explained in the UI',
      await cdp.evaluate(`/distance alone|without adding useful information|genuinely global/i.test(document.getElementById('es-journey').textContent)`));

    // ── Auto-Direct ──
    const intentLines = [
      'Start in Helsinki.',
      'Show where Stockholm is relative to Helsinki.',
      'Stockholm is the main destination.',
      'Then continue to Copenhagen as a secondary waypoint.',
    ];
    await cdp.evaluate(`(()=>{const t=document.getElementById('dir-intent');
      t.value = ${js(intentLines.join('\n'))};
      t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await cdp.evaluate(`document.getElementById('dir-run').click()`);
    await delay(1200);
    check('Auto-Direct builds a journey from plain text',
      await cdp.evaluate(`JOURNEY.legs.length === 2 && JOURNEY.legs[1].destination.location === 'Copenhagen'`),
      await cdp.evaluate(`JSON.stringify([JOURNEY.start.location].concat(JOURNEY.legs.map(l=>l.destination.location)))`));
    check('Auto-Direct assigns the roles it read from the text',
      await cdp.evaluate(`JOURNEY.legs[0].destination.story.role === 'PRIMARY_SUBJECT' && JOURNEY.legs[1].destination.story.role === 'WAYPOINT'`),
      await cdp.evaluate(`JSON.stringify(JOURNEY.legs.map(l=>l.destination.story.role))`));
    check('Auto-Direct explains why the camera does what it does',
      await cdp.evaluate(`(()=>{const t=document.getElementById('es-journey').textContent;
        return /Why the camera does this/.test(t) && /Flourish budget/.test(t) && /globe/i.test(t);})()`));
    check('a regional journey is directed WITHOUT a globe shot',
      await cdp.evaluate(`!JOURNEY.legs.some(l=>l.destination.framing==='globe')`));
    check('the directed journey is valid and generatable',
      await cdp.evaluate(`JB.summarizeJourney(JOURNEY).ok === true`),
      await cdp.evaluate(`JSON.stringify(JB.summarizeJourney(JOURNEY).errors)`));

    const jsErrors = await cdp.evaluate(`window.__errs || []`);
    check('no uncaught JavaScript errors on the page', jsErrors.length === 0, JSON.stringify(jsErrors));
  } finally {
    if (cdp) cdp.close();
    if (chrome) { try { chrome.kill('SIGKILL'); } catch (_) {} }
    if (server) { server.close(); }
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — ${checks.length - failed.length}/${checks.length} browser checks`);
  if (failed.length) { process.exitCode = 1; }
}

main().catch((error) => { console.error('SMOKE ERROR:', error.message); process.exitCode = 1; });
