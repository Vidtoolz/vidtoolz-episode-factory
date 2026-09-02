#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const gate = require('./earth-studio-journey-import-gate.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PACKAGE = path.join(ROOT,
  'package-runs/2026-08-25-earth-studio-travel-altitude-height-aware-smooth-tilt');
const SOURCE_PACKAGE = path.join(ROOT, 'package-runs/2026-08-25-earth-studio-position-trajectory');
const DEFAULT_PORT = 37844;
const DEFAULT_CDP_PORT = 9748;
const CANDIDATES = Object.freeze(['CURRENT', 'HIGHER_A', 'HIGHER_B', 'HIGHER_C']);
const VERDICTS = Object.freeze([...CANDIDATES, 'NONE_GOOD']);
const REVIEWER = Object.freeze({ name: 'Mikko', authority: 'canonical human visual reviewer' });
const GUIDANCE = Object.freeze([
  'ground moving too fast or camera feeling too low',
  'destination becoming tiny or losing geographic context',
  'movement becoming sluggish or showing too much empty geography',
  'excessive climb/descent or an unnatural arrival',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  return {
    packageDir: path.resolve(value('--package') || DEFAULT_PACKAGE),
    sessionFile: value('--session') ? path.resolve(value('--session')) : null,
    port: Number(value('--port') || DEFAULT_PORT),
    cdpPort: Number(value('--cdp-port') || DEFAULT_CDP_PORT),
    noBrowser: argv.includes('--no-browser'),
    headless: argv.includes('--headless') || process.env.ES_REVIEW_HEADLESS === '1',
  };
}

function resolveArtifact(relative, packageDir) {
  if (!relative || typeof relative !== 'string') throw new Error('candidate artifact path is missing');
  const absolute = path.resolve(ROOT, relative);
  const roots = [path.join(packageDir, 'projects'), path.join(SOURCE_PACKAGE, 'projects')];
  if (!roots.some((root) => absolute.startsWith(`${root}${path.sep}`))) throw new Error(`candidate artifact escapes review evidence: ${relative}`);
  if (!fs.existsSync(absolute)) throw new Error(`required altitude candidate is missing: ${relative}`);
  return { relative, absolute };
}

function loadReviewPackage(packageDir = DEFAULT_PACKAGE, manifestOverride = null) {
  const manifestPath = path.join(packageDir, 'calibration-manifest.json');
  if (!manifestOverride && !fs.existsSync(manifestPath)) throw new Error(`altitude calibration manifest is missing: ${manifestPath}`);
  const manifest = manifestOverride || JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 4) throw new Error('altitude review requires exactly four calibration cases');
  const cases = manifest.cases.map((item) => ({
    id: item.id,
    name: item.name,
    purpose: item.purpose || '',
    candidates: Object.fromEntries(CANDIDATES.map((id) => {
      const candidate = item.candidates && item.candidates[id];
      if (!candidate) throw new Error(`${item.id}: missing ${id}`);
      return [id, { ...candidate, ...resolveArtifact(candidate.artifact, packageDir) }];
    })),
  }));
  return { packageDir, manifestPath, manifest, cases, sessionPath: path.join(packageDir, 'review-session.json') };
}

function freshSession(pkg) {
  return {
    schema_version: 1,
    review_type: 'travel_altitude_envelope_calibration',
    reviewer: { ...REVIEWER },
    blind_order_used: false,
    candidate_usability_authority: null,
    current_case_id: pkg.cases[0].id,
    records: Object.fromEntries(pkg.cases.map((item) => [item.id, {
      case_id: item.id,
      case_name: item.name,
      artifacts: Object.fromEntries(CANDIDATES.map((id) => [id, item.candidates[id].relative])),
      verdict: null,
      note: '',
      recorded_at: null,
      reviewer: { ...REVIEWER },
      blind_order_used: false,
      candidate_mapping: null,
      last_prepared: null,
      prepared_at: null,
    }])),
  };
}

function loadSession(pkg, file = pkg.sessionPath) {
  const base = freshSession(pkg);
  if (!fs.existsSync(file)) return base;
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (stored.review_type !== base.review_type) throw new Error(`incompatible altitude review session: ${file}`);
  if (stored.candidate_usability_authority && typeof stored.candidate_usability_authority === 'object') {
    base.candidate_usability_authority = stored.candidate_usability_authority;
  }
  for (const item of pkg.cases) {
    if (!stored.records || !stored.records[item.id]) throw new Error(`review session is missing ${item.id}`);
    const record = stored.records[item.id];
    if (record.verdict !== null && !VERDICTS.includes(record.verdict)) throw new Error(`${item.id}: invalid stored verdict`);
    base.records[item.id] = { ...base.records[item.id], ...record, reviewer: { ...REVIEWER }, blind_order_used: false, candidate_mapping: null };
  }
  if (pkg.cases.some((item) => item.id === stored.current_case_id)) base.current_case_id = stored.current_case_id;
  return base;
}

function persistSession(file, session) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
}

function recordVerdict(session, caseId, verdict, note, now = () => new Date().toISOString()) {
  if (!VERDICTS.includes(verdict)) throw new Error(`invalid altitude verdict: ${verdict}`);
  if (!session.records[caseId]) throw new Error(`unknown altitude case: ${caseId}`);
  session.records[caseId] = { ...session.records[caseId], verdict, note: String(note || '').slice(0, 1000), recorded_at: now(), reviewer: { ...REVIEWER } };
  return session;
}

function aggregate(session) {
  const counts = Object.fromEntries(VERDICTS.map((id) => [id, 0]));
  for (const row of Object.values(session.records)) if (VERDICTS.includes(row.verdict)) counts[row.verdict] += 1;
  return { counts, completed: Object.values(counts).reduce((sum, value) => sum + value, 0), total: 4 };
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { value += chunk; if (value.length > 16384) reject(new Error('request body too large')); });
    req.on('end', () => resolve(value)); req.on('error', reject);
  });
}

function pageHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Travel Altitude Calibration</title>
<style>body{font:16px system-ui;background:#111;color:#eee;max-width:940px;margin:30px auto;padding:0 24px}button{font:15px system-ui;padding:10px 14px;margin:4px;border:1px solid #666;border-radius:6px;background:#242424;color:#fff;cursor:pointer}button:disabled{opacity:.35}.card{padding:16px;background:#1d1d1d;border-left:5px solid #555;margin:14px 0}.ready{border-color:#32c878}.muted{color:#aaa}.variants{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}textarea{box-sizing:border-box;width:100%;background:#222;color:#fff;border:1px solid #666;padding:10px}@media(max-width:760px){.variants{grid-template-columns:1fr 1fr}}</style></head><body>
<h1>Travel Altitude — Human Calibration</h1><p class="muted">Choose the complete altitude envelope that feels calm and readable without becoming unnecessarily distant. This does not change production.</p><div id="app">Loading…</div>
<script>
const app=document.querySelector('#app');const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error&&j.error.message||'request failed');return j}
async function act(url,body){try{render(await api(url,body||{}))}catch(e){document.querySelector('#status').innerHTML='<b>'+esc(e.message)+'</b>'}}
async function save(v){await act('/api/verdict',{verdict:v,note:document.querySelector('#note').value})}
function render(x){const r=x.record,a=x.aggregate;app.innerHTML="<div class='card'><b>"+esc(x.index+1)+' / '+esc(x.count)+' — '+esc(x.case.name)+"</b><p>"+esc(x.reviewQuestion)+"</p>"+(x.case.purpose?'<p class=muted>'+esc(x.case.purpose)+'</p>':'')+"</div><div id='status' class='card "+(r.last_prepared?'ready':'')+"'>"+(r.last_prepared?'Ready in Earth Studio: '+esc(r.last_prepared):'Choose a candidate to prepare.')+"</div><div class='variants'>"+x.candidates.map(v=>"<button class='prepare' data-candidate='"+v+"'>Prepare / Play "+v+"</button>").join('')+"</div><p class='muted'>Use Google's Play button in Earth Studio, then return here. Review the complete climb → cruise → descent envelope.</p><div class='card'><b>Watch for</b><ul>"+x.guidance.map(v=>'<li>'+esc(v)+'</li>').join('')+"</ul></div><textarea id='note' rows='3' placeholder='Optional short note'>"+esc(r.note)+"</textarea><p>"+x.verdicts.map(v=>"<button class='verdict' data-verdict='"+v+"'>"+v+"</button>").join('')+"</p><p>Current verdict: <b>"+esc(r.verdict||'PENDING')+"</b></p><p><button id='previous' "+(x.index?'':'disabled')+">Previous</button><button id='next' "+(x.index+1<x.count?'':'disabled')+">Next</button></p><div class='card'><b>Completion "+a.completed+' / '+a.total+"</b><p>"+x.summary.map(v=>esc(v.name)+' <b>'+esc(v.verdict||'PENDING')+'</b>').join('<br>')+"</p></div>";document.querySelectorAll('.prepare').forEach(b=>{b.onclick=()=>act('/api/prepare',{candidate:b.dataset.candidate})});document.querySelectorAll('.verdict').forEach(b=>{b.onclick=()=>save(b.dataset.verdict)});document.querySelector('#previous').onclick=()=>act('/api/previous');document.querySelector('#next').onclick=()=>act('/api/next')}
api('/api/status').then(render).catch(e=>app.textContent=e.message);
</script></body></html>`;
}

class TravelAltitudeReviewServer {
  constructor(options = {}) {
    this.options = { ...parseArgs([]), ...options };
    this.pkg = loadReviewPackage(this.options.packageDir);
    this.sessionPath = this.options.sessionFile || this.pkg.sessionPath;
    this.session = loadSession(this.pkg, this.sessionPath);
    this.server = null; this.chrome = null; this.controller = null; this.earth = null; this.hasPrepared = false;
  }
  currentCase() { return this.pkg.cases.find((item) => item.id === this.session.current_case_id); }
  payload() {
    const item = this.currentCase(); const index = this.pkg.cases.findIndex((row) => row.id === item.id);
    return { case: { id: item.id, name: item.name, purpose: item.purpose }, candidates: CANDIDATES, verdicts: VERDICTS,
      reviewQuestion: this.pkg.manifest.review_question || 'Which altitude envelope feels calm and readable?',
      guidance: Array.isArray(this.pkg.manifest.review_guidance) ? this.pkg.manifest.review_guidance : GUIDANCE,
      record: this.session.records[item.id], index, count: this.pkg.cases.length, aggregate: aggregate(this.session),
      summary: this.pkg.cases.map((row) => ({ name: row.name, verdict: this.session.records[row.id].verdict })) };
  }
  persist() { persistSession(this.sessionPath, this.session); }
  move(delta) { const i = this.pkg.cases.findIndex((row) => row.id === this.session.current_case_id); const target = this.pkg.cases[i + delta]; if (target) { this.session.current_case_id = target.id; this.persist(); } return this.payload(); }
  saveVerdict(verdict, note) { recordVerdict(this.session, this.session.current_case_id, verdict, note); this.persist(); return this.payload(); }
  async prepare(candidateId) {
    if (!CANDIDATES.includes(candidateId)) throw new Error(`invalid altitude candidate: ${candidateId}`);
    if (!this.earth) throw new Error('Earth Studio browser is not attached');
    const importCardReady = `Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`;
    if (this.hasPrepared) {
      await this.earth.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
      await this.earth.waitFor(importCardReady, 120000);
    } else {
      // The controller opens immediately while Earth Studio keeps loading in
      // the background. A quick first click used to race that load and fail.
      await this.earth.waitFor(importCardReady, 120000);
    }
    const item = this.currentCase();
    await gate.importEsp(this.earth, item.candidates[candidateId].absolute);
    const info = await gate.projectInfo(this.earth);
    this.hasPrepared = true;
    this.session.records[item.id].last_prepared = candidateId;
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
      const body = req.method === 'POST' ? JSON.parse(await readBody(req) || '{}') : {};
      if (req.method === 'POST' && url.pathname === '/api/prepare') return sendJson(res, 200, await this.prepare(body.candidate));
      if (req.method === 'POST' && url.pathname === '/api/verdict') return sendJson(res, 200, this.saveVerdict(body.verdict, body.note));
      return sendJson(res, 404, { error: { message: `unknown route: ${url.pathname}` } });
    } catch (error) { return sendJson(res, 400, { error: { message: error.message } }); }
  }
  async run() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.options.port, '127.0.0.1', resolve); });
    if (!this.options.noBrowser) {
      const launched = await gate.launch({ port: this.options.cdpPort, headless: this.options.headless, display: process.env.DISPLAY || ':1', width: 1920, height: 1080 });
      this.chrome = launched.chrome;
      this.controller = await gate.newTab(this.options.cdpPort, `http://127.0.0.1:${this.options.port}/`);
      this.earth = await gate.newTab(this.options.cdpPort, 'https://earth.google.com/studio/');
      await this.controller.send('Page.bringToFront');
    }
    return this;
  }
  async stop() { await new Promise((resolve) => this.server ? this.server.close(resolve) : resolve()); try { this.chrome && this.chrome.kill('SIGTERM'); } catch (_) {} }
}

async function main() {
  const options = parseArgs(); const app = new TravelAltitudeReviewServer(options);
  const stop = async () => { await app.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try { await app.run(); console.log(`Travel-altitude review: http://127.0.0.1:${options.port}/`); console.log(`Review session: ${app.sessionPath}`); }
  catch (error) { await app.stop(); console.error(`ALTITUDE_REVIEW_LAUNCH_FAILED — ${error.message}`); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { ROOT, DEFAULT_PACKAGE, CANDIDATES, VERDICTS, REVIEWER, GUIDANCE, parseArgs, resolveArtifact,
  loadReviewPackage, freshSession, loadSession, persistSession, recordVerdict, aggregate, pageHtml, TravelAltitudeReviewServer };
