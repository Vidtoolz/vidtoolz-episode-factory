#!/usr/bin/env node
'use strict';

// Focused human review for the two rejected terrain motion primitives. This
// controller imports experiment-only ESPs and records Mikko's choices. It does
// not modify production code or accepted byte contracts.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-motion-calibration');
const gate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const terrainImport = require(path.join(ROOT, 'scripts/earth-studio-terrain-tilt-import.js'));

function loadPackage(out = OUT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'candidates/manifest.json'), 'utf8'));
  const template = JSON.parse(fs.readFileSync(path.join(out, 'human-review/review-session-template.json'), 'utf8'));
  if (manifest.production_motion_changed !== false || manifest.candidates.length !== 20) throw new Error('unexpected terrain motion package');
  for (const candidate of manifest.candidates) {
    if (!fs.existsSync(path.join(ROOT, candidate.esp))) throw new Error(`missing ESP: ${candidate.esp}`);
  }
  return { out, manifest, template, sessionPath: path.join(out, 'human-review/review-session.json') };
}

function freshSession(pkg, now = new Date().toISOString()) {
  return { ...JSON.parse(JSON.stringify(pkg.template)), started_at: now };
}

function applyChoice(pkg, session, body, now = new Date().toISOString()) {
  const family = String(body.family || '').toUpperCase();
  const subject = String(body.subject || '');
  const row = session.choices.find((choice) => choice.family === family && choice.subject === subject);
  if (!row) throw new Error(`unknown review case: ${family}/${subject}`);
  const allowed = pkg.manifest.candidates.filter((candidate) => candidate.family === family && candidate.subject === subject)
    .map((candidate) => candidate.variant);
  const winner = String(body.winner || '');
  if (winner !== 'NONE_GOOD' && !allowed.includes(winner)) throw new Error(`invalid ${family} candidate: ${winner}`);
  row.winner = winner;
  row.note = String(body.note || '').slice(0, 2000);
  row.reviewed_at = now;
  if (session.choices.every((choice) => choice.winner)) session.completed_at = now;
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>Terrain Motion Review</title><style>
  body{font:16px system-ui;background:#101418;color:#edf2f4;margin:0}main{max-width:1080px;margin:auto;padding:28px}button,select,textarea{font:inherit}button{padding:10px 14px;border:1px solid #65727c;border-radius:7px;background:#222b31;color:#fff;cursor:pointer}.tabs,.cases,.shots{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.active{border-color:#70b7ff}.card{background:#192127;border:1px solid #35424b;border-radius:10px;padding:18px;margin-top:16px}.muted{color:#a9b4bd}.ok{color:#7ee787}.warn{color:#e3b341}label{display:grid;gap:6px;margin:12px 0}textarea{min-height:80px}</style></head><body><main>
  <h1>Earth Studio terrain motion calibration</h1><p class="muted">Review orbit stability and reveal launch separately. Production remains unchanged.</p>
  <div class="tabs"><button id="orbit">ORBIT STABILITY</button><button id="reveal">REVEAL LAUNCH</button></div><div id="cases" class="cases"></div>
  <div class="card"><h2 id="title"></h2><p id="question"></p><div id="shots" class="shots"></div><p id="status" class="muted"></p></div>
  <div class="card"><label>Winner<select id="winner"></select></label><label>Optional note<textarea id="note"></textarea></label><button id="save">Save and next</button></div>
  <script>
  let state,family='ORBIT',subject;const el=id=>document.getElementById(id);const api=(url,body)=>fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v});
  function familySubjects(){return [...new Set(state.manifest.candidates.filter(c=>c.family===family).map(c=>c.subject))]}
  function showFamily(value){family=value;el('orbit').className=family==='ORBIT'?'active':'';el('reveal').className=family==='REVEAL'?'active':'';el('cases').replaceChildren();for(const name of familySubjects()){const b=document.createElement('button');b.textContent=name;b.onclick=()=>choose(name);el('cases').appendChild(b)}choose(familySubjects()[0])}
  function choose(name){subject=name;const rows=state.manifest.candidates.filter(c=>c.family===family&&c.subject===name);const saved=state.session.choices.find(c=>c.family===family&&c.subject===name);el('title').textContent=family+' — '+name;el('question').textContent=family==='ORBIT'?'Which orbit feels most stable, without pumping or mechanical jitter?':'Which launch feels calm and deliberate without making the reveal sluggish or causing a later rush?';el('shots').replaceChildren();el('winner').replaceChildren(new Option('—',''),...rows.map(r=>new Option(r.label,r.variant)),new Option('NONE GOOD','NONE_GOOD'));for(const row of rows){const b=document.createElement('button');b.textContent='Play '+row.label;b.onclick=()=>prepare(row.id);el('shots').appendChild(b)}el('winner').value=saved.winner||'';el('note').value=saved.note||''}
  async function prepare(id){el('status').textContent='Importing '+id+'…';try{await api('/api/prepare',{id});el('status').innerHTML='<span class="ok">Ready in Earth Studio: '+id+'</span>'}catch(e){el('status').innerHTML='<span class="warn">'+e.message+'</span>'}}
  async function save(){try{state.session=(await api('/api/choice',{family,subject,winner:el('winner').value,note:el('note').value})).session;const names=familySubjects(),i=names.indexOf(subject);if(i+1<names.length)choose(names[i+1]);else if(family==='ORBIT')showFamily('REVEAL');el('status').innerHTML='<span class="ok">Choice saved.</span>'}catch(e){el('status').innerHTML='<span class="warn">'+e.message+'</span>'}}
  async function init(){state=await api('/api/state');el('orbit').onclick=()=>showFamily('ORBIT');el('reveal').onclick=()=>showFamily('REVEAL');el('save').onclick=save;showFamily('ORBIT')}init();
  </script></main></body></html>`;
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
        const candidate = pkg.manifest.candidates.find((row) => row.id === body.id);
        if (!candidate) throw new Error(`unknown candidate: ${body.id}`);
        await terrainImport.resetToImportScreen(cdp);
        await gate.importEsp(cdp, path.join(ROOT, candidate.esp));
        await cdp.send('Page.bringToFront');
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
  const port = Number(process.env.ES_TERRAIN_MOTION_REVIEW_PORT || 37846);
  const browser = await gate.launch({ port: 9746, headless: false, display: process.env.DISPLAY || ':1', width: 1600, height: 1000 });
  const es = await gate.newTab(browser.port, 'https://earth.google.com/studio/');
  const server = createController(pkg, { cdp: es });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const controls = await gate.newTab(browser.port, `http://127.0.0.1:${port}/`);
  await controls.waitFor(`document.title === 'Terrain Motion Review'`, 15000);
  await controls.send('Page.bringToFront');
  console.log(`Terrain motion review ready: http://127.0.0.1:${port}/`);
  console.log(`Choices: ${path.relative(ROOT, pkg.sessionPath)}`);
  const stop = () => { server.close(); try { controls.close(); } catch (_) {} try { es.close(); } catch (_) {} try { browser.chrome.kill('SIGTERM'); } catch (_) {} };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { OUT, loadPackage, freshSession, applyChoice, writeSession, page, createController };
