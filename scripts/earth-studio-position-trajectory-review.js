#!/usr/bin/env node
'use strict';

// Human-only CURRENT vs SMOOTH review controller for the frozen position-
// trajectory experiment. It imports existing ESPs read-only. Playback remains
// under Google's Play button and verdicts never change production policy.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const importGate = require('./earth-studio-journey-import-gate.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PACKAGE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory');
const DEFAULT_PORT = 37843;
const DEFAULT_CDP_PORT = 9747;
const VERDICTS = Object.freeze(['SMOOTH_BETTER', 'CURRENT_BETTER', 'SAME', 'BOTH_BAD']);
const REVIEWER = Object.freeze({ name: 'Mikko', authority: 'canonical human visual reviewer' });
const CASE_SPECS = Object.freeze([
  { id: 'MEDIUM-DIAGONAL', name: 'Medium diagonal', purpose: 'Look for small directional corrections as latitude and longitude change together.' },
  { id: 'LONG-DIAGONAL', name: 'Long diagonal', purpose: 'Look for micro-turns and uneven travel direction over the long movement.' },
  { id: 'HIGH-LATITUDE', name: 'High latitude', purpose: 'Look for heading/path instability caused by large longitude effects at high latitude.' },
  { id: 'MULTI-POINT-SEGMENT', name: 'Multi-point', purpose: 'Look for repeated local corrections or speed pulses at intermediate path samples.' },
]);
const PRIMARY_GUIDANCE = Object.freeze([
  'visible tiny directional steps or staircase motion',
  'lateral wobble or micro-turns',
  'repeated speed-up / slow-down pulses',
  'whether the camera feels like one continuous curve',
]);
const SECONDARY_GUIDANCE = Object.freeze([
  'unnatural bending or excessive smoothing',
  'unexpected path shape',
  'any new artifact introduced by SMOOTH',
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseArgs(argv = process.argv.slice(2)) {
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  return {
    packageDir: path.resolve(value('--package') || DEFAULT_PACKAGE),
    sessionFile: value('--session') ? path.resolve(value('--session')) : null,
    port: Number(value('--port') || process.env.ES_POSITION_REVIEW_PORT || DEFAULT_PORT),
    cdpPort: Number(value('--cdp-port') || process.env.ES_REVIEW_CDP_PORT || DEFAULT_CDP_PORT),
    noBrowser: argv.includes('--no-browser'),
    headless: argv.includes('--headless') || process.env.ES_REVIEW_HEADLESS === '1',
  };
}

function resolveArtifact(relative, packageDir) {
  if (!relative || typeof relative !== 'string') throw new Error('artifact path is missing from experiment manifest');
  const absolute = path.resolve(ROOT, relative);
  const projectsRoot = path.join(packageDir, 'projects') + path.sep;
  if (!absolute.startsWith(projectsRoot)) throw new Error(`artifact escapes experiment package: ${relative}`);
  if (!fs.existsSync(absolute)) throw new Error(`required review artifact is missing: ${relative}`);
  return { relative, absolute, sha256: sha256(absolute) };
}

function loadReviewPackage(packageDir = DEFAULT_PACKAGE, manifestOverride = null) {
  const manifestPath = path.join(packageDir, 'real-earth-studio-ab.json');
  if (!manifestOverride && !fs.existsSync(manifestPath)) throw new Error(`position-trajectory manifest is missing: ${manifestPath}`);
  const manifest = manifestOverride || JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const byId = new Map((manifest.cases || []).map((row) => [row.id, row]));
  const cases = CASE_SPECS.map((spec) => {
    const source = byId.get(spec.id);
    if (!source) throw new Error(`required review case is missing from manifest: ${spec.id}`);
    const current = resolveArtifact(source.versions && source.versions.CURRENT && source.versions.CURRENT.esp, packageDir);
    const smooth = resolveArtifact(source.versions && source.versions.SMOOTH && source.versions.SMOOTH.esp, packageDir);
    return { ...spec, current, smooth };
  });
  return { packageDir, manifestPath, manifest, cases, sessionPath: path.join(packageDir, 'review-session.json') };
}

function freshSession(reviewPackage) {
  return {
    schema_version: 1,
    review_type: 'position_trajectory_current_vs_smooth',
    reviewer: { ...REVIEWER },
    blind_order_used: false,
    current_case_id: reviewPackage.cases[0].id,
    records: Object.fromEntries(reviewPackage.cases.map((item) => [item.id, {
      case_id: item.id,
      case_name: item.name,
      current_artifact: item.current.relative,
      smooth_artifact: item.smooth.relative,
      verdict: null,
      note: '',
      recorded_at: null,
      reviewer: { ...REVIEWER },
      blind_order_used: false,
      ab_mapping: null,
      last_prepared: null,
      prepared_at: null,
    }])),
  };
}

function loadSession(reviewPackage, sessionPath = reviewPackage.sessionPath) {
  const base = freshSession(reviewPackage);
  if (!fs.existsSync(sessionPath)) return base;
  const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  if (stored.review_type !== base.review_type) throw new Error(`incompatible review session: ${sessionPath}`);
  if (reviewPackage.cases.some((item) => !stored.records || !stored.records[item.id])) {
    throw new Error(`review session does not contain all four required cases: ${sessionPath}`);
  }
  for (const item of reviewPackage.cases) {
    const record = stored.records[item.id];
    if (record.verdict !== null && !VERDICTS.includes(record.verdict)) throw new Error(`invalid stored verdict for ${item.id}`);
    base.records[item.id] = { ...base.records[item.id], ...record, reviewer: { ...REVIEWER }, blind_order_used: false, ab_mapping: null };
  }
  if (reviewPackage.cases.some((item) => item.id === stored.current_case_id)) base.current_case_id = stored.current_case_id;
  return base;
}

function persistSession(sessionPath, session) {
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
}

function recordVerdict(session, caseId, verdict, note, now = () => new Date().toISOString()) {
  if (!VERDICTS.includes(verdict)) throw new Error(`invalid verdict: ${verdict}`);
  if (!session.records[caseId]) throw new Error(`unknown review case: ${caseId}`);
  session.records[caseId] = {
    ...session.records[caseId],
    verdict,
    note: String(note || '').slice(0, 1000),
    recorded_at: now(),
    reviewer: { ...REVIEWER },
    blind_order_used: false,
    ab_mapping: null,
  };
  return session;
}

function aggregate(session) {
  const counts = Object.fromEntries(VERDICTS.map((value) => [value, 0]));
  for (const record of Object.values(session.records)) if (VERDICTS.includes(record.verdict)) counts[record.verdict] += 1;
  return { counts, completed: Object.values(counts).reduce((sum, value) => sum + value, 0), total: CASE_SPECS.length };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; if (body.length > 16384) reject(new Error('request body too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function pageHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Position Trajectory A/B Review</title>
<style>body{font:16px system-ui;background:#111;color:#eee;max-width:900px;margin:32px auto;padding:0 24px}button{font:15px system-ui;padding:10px 14px;margin:4px;border:1px solid #666;border-radius:6px;background:#242424;color:#fff;cursor:pointer}button:disabled{opacity:.35}.card{padding:16px;background:#1d1d1d;border-left:5px solid #555;margin:14px 0}.ready{border-color:#32c878}.muted{color:#aaa}.current{color:#ffbd67}.smooth{color:#75dda2}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}textarea{box-sizing:border-box;width:100%;background:#222;color:#fff;border:1px solid #666;padding:10px}li{margin:5px 0}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body>
<h1>Position Trajectory — CURRENT vs SMOOTH</h1><p class="muted">Visual judgment only. This controller does not accept or productionize the trajectory candidate. Google Earth Studio's Play button is the playback authority.</p><div id="app">Loading…</div>
<script>
const app=document.querySelector('#app');const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error&&j.error.message||'request failed');return j}
async function act(url,body){try{render(await api(url,body||{}))}catch(e){document.querySelector('#status').innerHTML='<b>'+esc(e.message)+'</b>'}}
async function save(v){await act('/api/verdict',{verdict:v,note:document.querySelector('#note').value})}
function render(x){const c=x.case,r=x.record,a=x.aggregate;const summary=x.summary.map(v=>'<div>'+esc(v.name)+' <b>'+esc(v.verdict||'PENDING')+'</b></div>').join('');app.innerHTML="<div class='card'><b>"+esc(x.index+1)+' / '+esc(x.count)+' — '+esc(c.name)+"</b><p>"+esc(c.purpose)+"</p></div><div id='status' class='card "+(r.last_prepared?'ready':'')+"'>"+(r.last_prepared?'Ready in Earth Studio: '+esc(r.last_prepared):'Choose a variant to prepare.')+"</div><div class='grid'><button id='prepare-current' class='current'>Prepare / Play CURRENT</button><button id='prepare-smooth' class='smooth'>Prepare / Play SMOOTH</button></div><p class='muted'>After preparation, switch to Earth Studio and click Google's Play button. Return here for the other variant and verdict.</p><div class='grid'><div class='card'><b>Primary</b><ul>"+x.primary.map(v=>'<li>'+esc(v)+'</li>').join('')+"</ul></div><div class='card'><b>Secondary</b><ul>"+x.secondary.map(v=>'<li>'+esc(v)+'</li>').join('')+"</ul></div></div><textarea id='note' rows='3' placeholder='Optional short note'>"+esc(r.note)+"</textarea><p>"+['SMOOTH_BETTER','CURRENT_BETTER','SAME','BOTH_BAD'].map(v=>"<button class='verdict' data-verdict='"+v+"'>"+v+"</button>").join('')+"</p><p>Current verdict: <b>"+esc(r.verdict||'PENDING')+"</b></p><p><button id='previous' "+(x.index?'':'disabled')+">Previous</button><button id='next' "+(x.index+1<x.count?'':'disabled')+">Next</button></p><div class='card'><b>Completion "+a.completed+' / '+a.total+"</b><p>Smooth better: "+a.counts.SMOOTH_BETTER+' · Current better: '+a.counts.CURRENT_BETTER+' · Same: '+a.counts.SAME+' · Both bad: '+a.counts.BOTH_BAD+"</p>"+summary+'</div>';
document.querySelector('#prepare-current').onclick=()=>act('/api/prepare',{variant:'CURRENT'});document.querySelector('#prepare-smooth').onclick=()=>act('/api/prepare',{variant:'SMOOTH'});document.querySelector('#previous').onclick=()=>act('/api/previous');document.querySelector('#next').onclick=()=>act('/api/next');document.querySelectorAll('.verdict').forEach(b=>{b.onclick=()=>save(b.dataset.verdict)})}
api('/api/status').then(render).catch(e=>app.textContent=e.message);
</script></body></html>`;
}

class PositionTrajectoryReviewServer {
  constructor(options = {}) {
    this.options = { ...parseArgs([]), ...options };
    this.reviewPackage = loadReviewPackage(this.options.packageDir);
    this.sessionPath = this.options.sessionFile || this.reviewPackage.sessionPath;
    this.session = loadSession(this.reviewPackage, this.sessionPath);
    this.server = null; this.chrome = null; this.controller = null; this.earth = null; this.hasPrepared = false;
  }
  currentCase() { return this.reviewPackage.cases.find((item) => item.id === this.session.current_case_id); }
  payload() {
    const item = this.currentCase();
    const index = this.reviewPackage.cases.findIndex((row) => row.id === item.id);
    return { case: item, record: this.session.records[item.id], index, count: this.reviewPackage.cases.length,
      primary: PRIMARY_GUIDANCE, secondary: SECONDARY_GUIDANCE, aggregate: aggregate(this.session),
      summary: this.reviewPackage.cases.map((row) => ({ id: row.id, name: row.name, verdict: this.session.records[row.id].verdict })) };
  }
  persist() { persistSession(this.sessionPath, this.session); }
  move(delta) {
    const index = this.reviewPackage.cases.findIndex((row) => row.id === this.session.current_case_id);
    const target = this.reviewPackage.cases[index + delta];
    if (target) { this.session.current_case_id = target.id; this.persist(); }
    return this.payload();
  }
  saveVerdict(verdict, note) { recordVerdict(this.session, this.session.current_case_id, verdict, note); this.persist(); return this.payload(); }
  async prepare(variant) {
    if (!['CURRENT', 'SMOOTH'].includes(variant)) throw new Error(`invalid variant: ${variant}`);
    if (!this.earth) throw new Error('Earth Studio browser is not attached');
    const item = this.currentCase(); const artifact = variant === 'CURRENT' ? item.current : item.smooth;
    // Earth Studio's loaded-project File > Import menu does not consistently
    // recreate its file input. Return to its authenticated start screen before
    // every replacement import so CURRENT -> SMOOTH remains a one-click flow.
    if (this.hasPrepared) {
      await this.earth.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
      await this.earth.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 120000);
    }
    await importGate.importEsp(this.earth, artifact.absolute);
    const info = await importGate.projectInfo(this.earth);
    this.hasPrepared = true;
    this.session.records[item.id].last_prepared = variant;
    this.session.records[item.id].prepared_at = new Date().toISOString();
    this.persist();
    await this.earth.send('Page.bringToFront');
    return { ...this.payload(), import: info };
  }
  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(pageHtml()); return; }
      if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, this.payload());
      if (req.method === 'POST' && url.pathname === '/api/previous') return sendJson(res, 200, this.move(-1));
      if (req.method === 'POST' && url.pathname === '/api/next') return sendJson(res, 200, this.move(1));
      if (req.method === 'POST' && url.pathname === '/api/prepare') { const body = JSON.parse(await readBody(req) || '{}'); return sendJson(res, 200, await this.prepare(body.variant)); }
      if (req.method === 'POST' && url.pathname === '/api/verdict') { const body = JSON.parse(await readBody(req) || '{}'); return sendJson(res, 200, this.saveVerdict(body.verdict, body.note)); }
      return sendJson(res, 404, { error: { message: `unknown route: ${url.pathname}` } });
    } catch (error) { return sendJson(res, 400, { error: { message: error.message } }); }
  }
  async listen() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.options.port, '127.0.0.1', resolve); });
    return this;
  }
  async startBrowser() {
    const launched = await importGate.launch({ port: this.options.cdpPort, headless: this.options.headless,
      display: process.env.DISPLAY || ':1', width: 1920, height: 1080 });
    this.chrome = launched.chrome;
    this.controller = await importGate.newTab(this.options.cdpPort, `http://127.0.0.1:${this.options.port}/`);
    this.earth = await importGate.newTab(this.options.cdpPort, 'https://earth.google.com/studio/');
    await this.controller.send('Page.bringToFront');
    return this;
  }
  async run() { await this.listen(); if (!this.options.noBrowser) await this.startBrowser(); return this; }
  async stop() {
    await new Promise((resolve) => this.server ? this.server.close(resolve) : resolve());
    try { this.chrome && this.chrome.kill('SIGTERM'); } catch (_) {}
  }
}

async function main() {
  const options = parseArgs();
  const app = new PositionTrajectoryReviewServer(options);
  const stop = async () => { await app.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await app.run();
    console.log(`Position-trajectory review: http://127.0.0.1:${options.port}/`);
    console.log(`Review session: ${app.sessionPath}`);
    console.log(options.noBrowser ? 'No-browser smoke mode.' : 'Prepare a variant, then use Google Earth Studio\'s Play button.');
  } catch (error) { await app.stop(); console.error(`REVIEW_LAUNCH_FAILED — ${error.message}`); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { ROOT, DEFAULT_PACKAGE, VERDICTS, REVIEWER, CASE_SPECS, PRIMARY_GUIDANCE, SECONDARY_GUIDANCE,
  parseArgs, loadReviewPackage, freshSession, loadSession, persistSession, recordVerdict, aggregate, pageHtml,
  PositionTrajectoryReviewServer, sha256 };
