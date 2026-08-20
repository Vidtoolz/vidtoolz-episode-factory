#!/usr/bin/env node
'use strict';

// One-command, human-controlled Earth Studio review launcher. It reuses the
// authenticated Chrome/CDP import harness and stops at READY_TO_PLAY: this
// process never calls playbackManager.play() or clicks Google's Play button.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const ROOT = path.join(__dirname, '..');
const gate = require('./earth-studio-journey-import-gate.js');
const model = require('../earth-studio-visual-review.js');

const DEFAULT_PORT = 37841;
const ES_PORT = Number(process.env.ES_REVIEW_CDP_PORT || 9731);
// --gate <package-run dir> reviews another evaluation package (e.g. the
// directorial evaluation set). Defaults to the v2 journey acceptance gate.
const argv = process.argv.slice(2);
const GATE_ARG = argv.indexOf('--gate') >= 0 ? argv[argv.indexOf('--gate') + 1] : null;
const GATE_DIR = GATE_ARG ? path.resolve(GATE_ARG) : null;
const DEFAULT_SESSION_FILE = path.join(ROOT, 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance-v2/review-session.json');
const SESSION_FILE = GATE_DIR ? path.join(GATE_DIR, 'review-session.json') : DEFAULT_SESSION_FILE;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function closeEarthTab(port) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const target = JSON.parse(body).find((item) => item.type === 'page' && (item.url || '').includes('earth.google.com/studio'));
          if (!target) return resolve(false);
          http.get(`http://127.0.0.1:${port}/json/close/${target.id}`, () => resolve(true)).on('error', () => resolve(false));
        } catch (_) { resolve(false); }
      });
    }).on('error', () => resolve(false));
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function html() {
  return `<!doctype html><meta charset="utf-8"><title>Earth Studio Visual Acceptance v2</title>
<style>body{font:16px system-ui;background:#111;color:#eee;max-width:760px;margin:40px auto;padding:0 24px}button{font:16px system-ui;padding:10px 16px;margin:4px;border:1px solid #777;border-radius:6px;background:#222;color:#fff;cursor:pointer}button:disabled{opacity:.4}.status{padding:14px;background:#1d1d1d;border-left:5px solid #888;margin:18px 0}.ready{border-color:#32c878}.fail{border-color:#e55}.muted{color:#aaa}code{color:#9dd7ff}</style>
<h1>Earth Studio Visual Acceptance v2</h1><div id="app">Loading…</div>
<script>
const app=document.querySelector('#app');
async function act(url){const r=await fetch(url,{method:'POST'});const x=await r.json();render(x);}
function render(x){if(x.error){app.innerHTML='<div class="status fail"><b>'+x.error.code+'</b><br>'+x.error.message+'</div>';return}const r=x.current, s=x.session; if(!r){app.textContent='No project selected';return} const cls=r.state==='READY_TO_PLAY'?'ready':(r.state==='IMPORT_FAILED'?'fail':''); app.innerHTML='<div class="status '+cls+'"><b>'+r.state+'</b><br>'+r.title+'<br><span class="muted">'+(r.category||r.question||'')+' · '+r.duration_seconds+'s · '+r.esp+'</span></div><p><button '+(x.previous?'':'disabled')+' onclick="act(\'/api/previous\')">Previous</button><button onclick="act(\'/api/prepare\')">Prepare/Open</button><button '+(x.next?'':'disabled')+' onclick="act(\'/api/next\')">Next</button></p><p class="muted">When status is READY_TO_PLAY, switch to the Earth Studio tab and click Google's Play button. Playback is never started by this controller.</p><p>Human decision: <button onclick="decision(\'HUMAN_PASS\')">PASS</button><button onclick="decision(\'HUMAN_FAIL\')">FAIL</button></p><textarea id="notes" rows="4" style="width:100%;background:#222;color:#fff" placeholder="Mikko notes (optional)">'+(s.records[r.id].notes||'')+'</textarea>'}
async function decision(d){await fetch('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:d,notes:document.querySelector('#notes').value})});poll()}
async function poll(){const r=await fetch('/api/status');render(await r.json())} poll(); setInterval(poll,2000);
</script>`;
}

function expectedStart(record) {
  const journey = JSON.parse(fs.readFileSync(path.join(ROOT, record.journey_json), 'utf8'));
  if (journey.start && journey.start.source === 'continuation' && journey.start.continuation) return journey.start.continuation.camera;
  const plan = JSON.parse(fs.readFileSync(record.plan_absolute, 'utf8'));
  const first = plan.segments[0];
  return { latitude: first.location.latitude, longitude: first.location.longitude, altitude_m: first.altitude_m, tilt_deg: first.tilt_deg };
}

async function browserReady(cdp, record) {
  // Reset first, then wait for Earth Studio's own model to acknowledge frame 0.
  try { await cdp.waitFor('window.scene && scene.duration > 1', 120000, 500); }
  catch (error) { throw Object.assign(new Error(`Earth Studio did not finish importing: ${error.message}`), { code: 'IMPORT_TIMEOUT' }); }
  // In the authenticated Earth Studio build used here, scene.loading can stay
  // true while the imported scene is already stable (the existing import gate
  // observes the same behavior). Use the authoritative scene model instead:
  // duration, frame count and frame-zero camera must remain stable for three
  // polls. This avoids claiming readiness after only an import click without
  // treating a sticky UI loading flag as a false failure.
  let previous = '';
  let stable = 0;
  for (let i = 0; i < 24 && stable < 3; i += 1) {
    const snapshot = await cdp.eval(`JSON.stringify({duration:scene&&scene.duration,totalFrames:scene&&scene.playbackManager&&scene.playbackManager.totalFrames,frame:scene&&scene.playbackManager&&scene.playbackManager.frameNumber})`);
    if (snapshot === previous && JSON.parse(snapshot).duration > 1) stable += 1; else stable = 0;
    previous = snapshot;
    if (stable < 3) await delay(1000);
  }
  if (stable < 3) throw Object.assign(new Error('Earth Studio scene model did not stabilize'), { code: 'IMPORT_TIMEOUT' });
  await cdp.eval(`(()=>{if(!window.scene||!scene.playbackManager)return false; scene.playbackManager.frameNumber=0; if(scene.onPlaybackFrameChanged_)scene.onPlaybackFrameChanged_(); return true;})()`);
  await delay(1200);
  const info = JSON.parse(await cdp.eval(`(()=>{const v=scene.getCurrentWorldValues(); return JSON.stringify({
    duration:scene.duration,totalFrames:scene.playbackManager.totalFrames,frameRate:scene.playbackManager.frameRate,
    frame:scene.playbackManager.frameNumber,loading:Boolean(scene.loading),playing:Boolean(scene.playbackManager.playing||scene.playbackManager.isPlaying||scene.playbackManager.isTimerPlaying_),
    bodyHasError:/error|failed|could not/i.test(document.body.innerText),
    blockingModal:Boolean(document.querySelector('[role="dialog"] input[type="file"], .modal-error')),
    camera:{latitude:v.latitude,longitude:v.longitude,altitude:v.altitude,tilt_deg:v.rotationY}
  })})()`));
  const expected = expectedStart(record);
  const close = (a, b, tolerance) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
  const identity = info.totalFrames === record.total_frames && close(info.camera.latitude, expected.latitude, 0.03)
    && close(info.camera.longitude, expected.longitude, 0.03)
    && close(info.camera.altitude, expected.altitude_m, Math.max(20, expected.altitude_m * 0.03));
  if (info.bodyHasError) throw Object.assign(new Error('Earth Studio reports an error'), { code: 'EARTH_STUDIO_REPORTED_ERROR' });
  if (info.blockingModal) throw Object.assign(new Error('A blocking Earth Studio dialog remains open'), { code: 'IMPORT_DIALOG_NOT_FOUND' });
  if (!identity) throw Object.assign(new Error(`Loaded project does not match ${record.id} (duration/frame-zero identity mismatch)`), { code: 'WRONG_PROJECT_LOADED' });
  if (info.frame !== 0) throw Object.assign(new Error(`Timeline is at frame ${info.frame}, not frame 0`), { code: 'IMPORT_TIMEOUT' });
  if (info.playing) throw Object.assign(new Error('Playback unexpectedly active'), { code: 'EARTH_STUDIO_REPORTED_ERROR' });
  return { ...info, load_signal: 'stable Earth Studio scene model; scene.loading may remain true during imagery streaming', expected_start: expected, autoplay: false, verified_at: new Date().toISOString() };
}

class ReviewServer {
  constructor(port, gateDir = null) {
    this.port = port; this.manifest = model.loadManifest(ROOT, gateDir); this.session = model.freshSession(this.manifest);
    this.browser = null; this.earth = null; this.controller = null; this.chrome = null; this.server = null;
  }
  current() { return this.manifest.records.find((r) => r.id === this.session.current_id); }
  payload() {
    const current = this.current(); const i = model.indexOf(this.manifest.records, current.id);
    return { current: { ...current, ...this.session.records[current.id] }, previous: this.manifest.records[i - 1] || null,
      next: this.manifest.records[i + 1] || null, session: this.session };
  }
  persist() { fs.writeFileSync(SESSION_FILE, `${JSON.stringify(this.session, null, 2)}\n`); }
  async startBrowser() {
    console.log('Opening authenticated Earth Studio browser context…');
    try { this.chrome = (await gate.launch({ port: ES_PORT, headless: process.env.ES_REVIEW_HEADLESS === '1', display: process.env.DISPLAY || ':1', width: 1600, height: 1000 })).chrome; }
    catch (e) { throw Object.assign(new Error(`Could not start Chrome/Earth Studio: ${e.message}`), { code: 'EARTH_STUDIO_UNAVAILABLE' }); }
    this.earth = await gate.newTab(ES_PORT, 'https://earth.google.com/studio/');
    await delay(13000);
    const auth = await this.earth.eval(`location.href.includes('accounts.google.com') || /sign in|log in|authenticate/i.test(document.body.innerText)`).catch(() => false);
    if (auth) throw Object.assign(new Error('Open Earth Studio and authenticate once, then rerun this command'), { code: 'AUTH_REQUIRED' });
    this.controller = await gate.newTab(ES_PORT, `http://127.0.0.1:${this.port}/`);
    console.log('Earth Studio is open; review controller is available.');
  }
  async replaceEarthTab() {
    await closeEarthTab(ES_PORT);
    try { this.earth && this.earth.close(); } catch (_) {}
    this.earth = await gate.newTab(ES_PORT, 'https://earth.google.com/studio/');
    await delay(13000);
    const auth = await this.earth.eval(`location.href.includes('accounts.google.com') || /sign in|log in|authenticate/i.test(document.body.innerText)`).catch(() => false);
    if (auth) throw Object.assign(new Error('Open Earth Studio and authenticate once, then rerun this command'), { code: 'AUTH_REQUIRED' });
  }
  async prepare(id = this.session.current_id) {
    const record = this.manifest.records.find((r) => r.id === id);
    if (!record) throw Object.assign(new Error(`Unknown evaluation project: ${id}`), { code: 'ARTIFACT_MISSING' });
    if (this.session.current_id === id && this.session.records[id].state === model.STATES.READY_TO_PLAY && this.session.records[id].evidence) {
      if (this.earth) {
        const evidence = await browserReady(this.earth, record);
        this.session.records[id].evidence = evidence;
        this.persist();
        await this.earth.send('Page.bringToFront');
      }
      return this.payload();
    }
    const changingProject = this.session.current_id !== id;
    this.session.current_id = id; this.session.records[id].state = model.STATES.IMPORTING; this.persist();
    try {
      if (!this.earth) await this.startBrowser();
      else if (changingProject) await this.replaceEarthTab();
      console.log(`Preparing ${record.id}…`);
      await gate.importEsp(this.earth, record.esp_absolute);
      console.log('Import reported a loaded scene; verifying project identity and frame 0…');
      const evidence = await browserReady(this.earth, record);
      this.session.records[id] = { ...this.session.records[id], state: model.STATES.READY_TO_PLAY, evidence };
      this.persist();
      await this.earth.send('Page.bringToFront');
      return this.payload();
    } catch (error) {
      const code = error.code || (error.message.includes('timeout') ? 'IMPORT_TIMEOUT' : 'IMPORT_FAILED');
      this.session.records[id] = { ...this.session.records[id], state: model.STATES.IMPORT_FAILED, evidence: { code, message: error.message } };
      this.persist(); throw Object.assign(error, { code });
    }
  }
  async move(delta) { const target = model.adjacent(this.manifest.records, this.session.current_id, delta); if (!target) return this.payload(); return this.prepare(target.id); }
  async handle(req, res) {
    const parsed = new URL(req.url, `http://${req.headers.host}`); const send = (value) => json(res, value.error ? 409 : 200, value);
    try {
      if (req.method === 'GET' && parsed.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html()); return; }
      if (req.method === 'GET' && parsed.pathname === '/api/status') { send(this.payload()); return; }
      if (req.method === 'POST' && parsed.pathname === '/api/prepare') { send(await this.prepare(parsed.searchParams.get('id') || this.session.current_id)); return; }
      if (req.method === 'POST' && parsed.pathname === '/api/next') { send(await this.move(1)); return; }
      if (req.method === 'POST' && parsed.pathname === '/api/previous') { send(await this.move(-1)); return; }
      if (req.method === 'POST' && parsed.pathname === '/api/decision') { let body='';req.on('data',(c)=>body+=c);req.on('end',()=>{const x=JSON.parse(body||'{}');if(![model.STATES.HUMAN_PASS,model.STATES.HUMAN_FAIL].includes(x.decision))return send({error:{code:'INVALID_HUMAN_DECISION',message:'Use HUMAN_PASS or HUMAN_FAIL'}});this.session.records[this.session.current_id]={...this.session.records[this.session.current_id],state:x.decision,human_decision:x.decision,notes:String(x.notes||'')};this.persist();send(this.payload())});return; }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown review route' } });
    } catch (error) { send({ error: { code: error.code || 'IMPORT_FAILED', message: error.message } }); }
  }
  async run() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve) => this.server.listen(this.port, '127.0.0.1', resolve));
    this.persist();
    await this.prepare();
    console.log(`READY_TO_PLAY — ${this.current().id}`);
    console.log(`Review controller: http://127.0.0.1:${this.port}/`);
    console.log('Switch to the Earth Studio window and click Google’s Play button. Playback was not started by the controller.');
  }
  stop() { try { this.server && this.server.close(); } catch (_) {} try { this.chrome && this.chrome.kill('SIGTERM'); } catch (_) {} }
}

async function main() {
  const port = Number(process.env.ES_REVIEW_PORT || DEFAULT_PORT);
  const app = new ReviewServer(port, GATE_DIR);
  process.on('SIGINT', () => { app.stop(); process.exit(0); });
  process.on('SIGTERM', () => { app.stop(); process.exit(0); });
  try { await app.run(); } catch (error) { app.stop(); console.error(`${error.code || 'IMPORT_FAILED'} — ${error.message}`); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { ReviewServer, browserReady, html };
