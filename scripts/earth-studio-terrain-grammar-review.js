#!/usr/bin/env node
'use strict';

// Human terrain-GRAMMAR review controller. It imports one experiment-only ESP
// at a time into the authenticated Earth Studio session and persists Mikko's
// choices. It never edits the production Director or morphology policy.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GATE = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-grammar-review');
const importGate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALLOWED = Object.freeze(['CURRENT_AUTO', 'TERRAIN_FORM', 'NONE_GOOD']);

function bringToFront(cdp) { return cdp.send('Page.bringToFront'); }

async function resetToImportScreen(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 60000);
  await delay(500);
}

function loadPackage(gateDir = DEFAULT_GATE) {
  const manifestPath = path.join(gateDir, 'canary-manifest.json');
  const templatePath = path.join(gateDir, 'review-session-template.json');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(templatePath)) {
    throw new Error(`terrain grammar package incomplete: ${path.relative(ROOT, gateDir)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  if (manifest.production_policy_changed !== false || manifest.canaries.length !== 16) {
    throw new Error('terrain grammar manifest is not the expected 16-case experiment-only package');
  }
  for (const record of manifest.canaries) {
    if (!fs.existsSync(path.join(ROOT, record.esp))) throw new Error(`missing ESP: ${record.esp}`);
  }
  return { manifest, template, gateDir, sessionPath: path.join(gateDir, 'review-session.json') };
}

function freshSession(pkg, now = new Date().toISOString()) {
  return { ...JSON.parse(JSON.stringify(pkg.template)), started_at: now };
}

function normalizeTreatment(value, { nullable = false } = {}) {
  if ((value === null || value === '' || value === undefined) && nullable) return null;
  if (!ALLOWED.includes(value)) throw new Error(`invalid grammar treatment: ${value}`);
  return value;
}

function applyChoice(pkg, session, body, now = new Date().toISOString()) {
  const subject = String(body.subject || '');
  const row = session.choices.find((choice) => choice.subject === subject);
  if (!row) throw new Error(`unknown terrain subject: ${subject}`);
  const winner = normalizeTreatment(body.winner);
  const second = normalizeTreatment(body.second_best, { nullable: true });
  const unacceptable = Array.isArray(body.unacceptable_treatments)
    ? [...new Set(body.unacceptable_treatments.map((value) => normalizeTreatment(value)).filter((value) => value !== 'NONE_GOOD'))]
    : [];
  if (winner !== 'NONE_GOOD' && second === winner) throw new Error('second-best must differ from winner');
  row.winner = winner;
  row.second_best = second;
  row.unacceptable_treatments = unacceptable;
  row.note = String(body.note || '').slice(0, 2000);
  row.reviewed_at = now;
  if (session.choices.every((choice) => choice.winner !== null)) session.completed_at = now;
  return session;
}

function writeSession(pkg, session) {
  fs.writeFileSync(pkg.sessionPath, `${JSON.stringify(session, null, 2)}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; if (data.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

function json(res, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Terrain Grammar Review</title><style>
  body{font:16px system-ui;background:#101418;color:#edf2f4;margin:0}main{max-width:1120px;margin:auto;padding:28px}h1{margin:0 0 8px}.muted{color:#a9b4bd}.subjects,.shots{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button,select,input,textarea{font:inherit}button{padding:10px 14px;border:1px solid #65727c;border-radius:7px;background:#222b31;color:#fff;cursor:pointer}.current{border-color:#d8b04b}.form{border-color:#70b7ff}.card{background:#192127;border:1px solid #35424b;border-radius:10px;padding:18px;margin-top:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:6px}textarea{min-height:80px}.ok{color:#7ee787}.warn{color:#e3b341}code{color:#9cdcfe}.reason{white-space:pre-wrap}</style></head><body><main>
  <h1>Earth Studio terrain-grammar calibration</h1><p class="muted">Experiment only. Production grammar and morphology tilts are unchanged.</p>
  <div class="subjects" id="subjects"></div><div class="card"><h2 id="title">Choose a subject</h2><p id="meta"></p><p id="reason" class="muted reason"></p><div class="shots" id="shots"></div><p id="status" class="muted"></p></div>
  <div class="card"><h2>Record subject choice</h2><div class="grid"><label>Winner<select id="winner"><option value="">—</option><option value="CURRENT_AUTO">CURRENT AUTO</option><option value="TERRAIN_FORM">TERRAIN FORM</option><option value="NONE_GOOD">NONE GOOD</option></select></label><label>Second best<select id="second"><option value="">—</option><option value="CURRENT_AUTO">CURRENT AUTO</option><option value="TERRAIN_FORM">TERRAIN FORM</option></select></label></div><label>Unacceptable treatments<select id="bad" multiple><option value="CURRENT_AUTO">CURRENT AUTO</option><option value="TERRAIN_FORM">TERRAIN FORM</option></select></label><label>Optional note<textarea id="note"></textarea></label><button id="save">Save and next</button></div>
  <script>
  let state, subject;
  const el = (id) => document.getElementById(id);
  const api = (url, body) => fetch(url, {method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);return value;});
  async function init(){state=await api('/api/state');const names=[...new Set(state.manifest.canaries.map(c=>c.subject))];for(const name of names){const b=document.createElement('button');b.textContent=name;b.addEventListener('click',()=>choose(name));el('subjects').appendChild(b);}el('save').addEventListener('click',saveChoice);choose(names[0]);}
  function choose(name){subject=name;const candidates=state.manifest.canaries.filter(c=>c.subject===name).sort((a,b)=>state.manifest.review_display_order.indexOf(a.treatment)-state.manifest.review_display_order.indexOf(b.treatment));const saved=state.session.choices.find(c=>c.subject===name);el('title').textContent=name+' — '+candidates[0].terrain_class;el('meta').textContent='Morphology '+candidates[0].morphology+' · natural scale '+candidates[0].natural_scale;el('reason').textContent=candidates.map(c=>c.candidate_label+': '+c.decision.movement+(c.decision.tilt_deg==null?'':' · '+c.decision.tilt_deg+'°')+' · '+c.feasibility_note).join('\\n');el('shots').replaceChildren();for(const candidate of candidates){const b=document.createElement('button');b.className=candidate.treatment==='CURRENT_AUTO'?'current':'form';b.textContent='Play '+candidate.candidate_label+' · '+candidate.decision.movement+(candidate.decision.tilt_deg==null?'':' · '+candidate.decision.tilt_deg+'°');b.addEventListener('click',()=>prepare(candidate.id));el('shots').appendChild(b);}el('winner').value=saved.winner??'';el('second').value=saved.second_best??'';for(const option of el('bad').options)option.selected=saved.unacceptable_treatments.includes(option.value);el('note').value=saved.note||'';}
  async function prepare(id){el('status').textContent='Importing '+id+'…';try{await api('/api/prepare',{id});el('status').innerHTML='<span class="ok">Ready in Earth Studio: '+id+'</span>';}catch(error){el('status').innerHTML='<span class="warn">'+error.message+'</span>';}}
  async function saveChoice(){try{state.session=(await api('/api/choice',{subject,winner:el('winner').value,second_best:el('second').value,unacceptable_treatments:[...el('bad').selectedOptions].map(o=>o.value),note:el('note').value})).session;const names=[...new Set(state.manifest.canaries.map(c=>c.subject))];choose(names[Math.min(names.indexOf(subject)+1,names.length-1)]);el('status').innerHTML='<span class="ok">Choice saved.</span>';}catch(error){el('status').innerHTML='<span class="warn">'+error.message+'</span>';}}
  init();</script></main></body></html>`;
}

function createController(pkg, { cdp = null } = {}) {
  let session = fs.existsSync(pkg.sessionPath) ? JSON.parse(fs.readFileSync(pkg.sessionPath, 'utf8')) : freshSession(pkg);
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { const body = page(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(body); }
      if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, { manifest: pkg.manifest, session });
      if (req.method === 'POST' && req.url === '/api/prepare') {
        if (!cdp) throw new Error('Earth Studio browser is not attached');
        const body = await readBody(req);
        const candidate = pkg.manifest.canaries.find((item) => item.id === body.id);
        if (!candidate) throw new Error(`unknown candidate: ${body.id}`);
        await resetToImportScreen(cdp);
        await importGate.importEsp(cdp, path.join(ROOT, candidate.esp));
        await bringToFront(cdp);
        return json(res, 200, { ok: true, id: candidate.id });
      }
      if (req.method === 'POST' && req.url === '/api/choice') {
        session = applyChoice(pkg, session, await readBody(req)); writeSession(pkg, session);
        return json(res, 200, { ok: true, session });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  });
}

async function main() {
  const pkg = loadPackage();
  const port = Number(process.env.ES_TERRAIN_GRAMMAR_REVIEW_PORT || 37844);
  const browser = await importGate.launch({ port: 9744, headless: false, display: process.env.DISPLAY || ':1', width: 1600, height: 1000 });
  const es = await importGate.newTab(browser.port, 'https://earth.google.com/studio/');
  const server = createController(pkg, { cdp: es });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const controls = await importGate.newTab(browser.port, `http://127.0.0.1:${port}/`);
  await controls.waitFor(`document.title === 'Terrain Grammar Review'`, 15000);
  await bringToFront(controls);
  console.log(`Terrain grammar review ready: http://127.0.0.1:${port}/`);
  console.log(`Choices: ${path.relative(ROOT, pkg.sessionPath)}`);
  const stop = () => { server.close(); try { controls.close(); } catch (_) {} try { es.close(); } catch (_) {} try { browser.chrome.kill('SIGTERM'); } catch (_) {} };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  DEFAULT_GATE, ALLOWED, loadPackage, freshSession, applyChoice, writeSession,
  createController, resetToImportScreen, bringToFront, page,
};
