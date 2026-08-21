#!/usr/bin/env node
'use strict';

// Human micro-review for the technically filtered DIRN17 handoff. The tangent
// candidate is intentionally absent: real playback coupled its dense position
// keys into a severe altitude spike.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate');
const terrainImport = require('./earth-studio-terrain-tilt-import');
const tool = require('./earth-studio-orbit-travel-handoff');

const SESSION = path.join(tool.OUT, 'human-review.json');
const ALLOWED = ['BASELINE_BETTER', 'SETTLE_THEN_LAUNCH', 'NONE_GOOD'];

function json(res, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}
function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Orbit Travel Handoff Review</title><style>
  body{font:16px system-ui;background:#101418;color:#edf2f4;margin:0}main{max-width:900px;margin:auto;padding:30px}.card{background:#192127;border:1px solid #35424b;border-radius:10px;padding:20px;margin:16px 0}button,select,textarea{font:inherit}button{padding:10px 14px;margin:5px;border:1px solid #65727c;border-radius:7px;background:#222b31;color:#fff;cursor:pointer}label{display:grid;gap:7px;margin:14px 0}textarea{min-height:90px}.ok{color:#7ee787}.warn{color:#e3b341}.muted{color:#a9b4bd}</style></head><body><main>
  <h1>Stockholm orbit → Scandinavia travel</h1><p>Can you see a directional snap or camera correction at the handoff?</p>
  <div class="card"><button onclick="play('DIRN17-BASELINE')">Play baseline</button><button onclick="play('DIRN17-SETTLE-THEN-LAUNCH')">Play settle then launch</button><p id="status" class="muted"></p></div>
  <div class="card"><label>Verdict<select id="verdict"><option value="">—</option><option>BASELINE_BETTER</option><option>SETTLE_THEN_LAUNCH</option><option>NONE_GOOD</option></select></label>
  <label>Optional note<textarea id="note" placeholder="Natural release? Pan correction? Altitude bump? Unnecessarily paused?"></textarea></label><button onclick="save()">Save verdict</button></div>
  <script>const s=document.getElementById('status');async function api(url,value){const r=await fetch(url,{method:value?'POST':'GET',headers:{'content-type':'application/json'},body:value?JSON.stringify(value):undefined});const j=await r.json();if(!r.ok)throw Error(j.error);return j}async function play(id){s.textContent='Importing '+id+'…';try{await api('/api/play',{id});s.innerHTML='<span class="ok">Ready in Earth Studio: '+id+'</span>'}catch(e){s.innerHTML='<span class="warn">'+e.message+'</span>'}}async function save(){try{await api('/api/verdict',{verdict:document.getElementById('verdict').value,note:document.getElementById('note').value});s.innerHTML='<span class="ok">Verdict saved.</span>'}catch(e){s.innerHTML='<span class="warn">'+e.message+'</span>'}}api('/api/state').then(x=>{document.getElementById('verdict').value=x.verdict||'';document.getElementById('note').value=x.note||''})</script></main></body></html>`;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(tool.OUT, 'candidate-manifest.json'), 'utf8'));
  const allowedCandidates = manifest.candidates.filter((row) => ['BASELINE', 'SETTLE_THEN_LAUNCH'].includes(row.variant));
  const browser = await gate.launch({ port: 9866, headless: false, display: process.env.DISPLAY || ':1', width: 1600, height: 1000 });
  const earth = await gate.newTab(browser.port, 'https://earth.google.com/studio/');
  const port = Number(process.env.ES_ORBIT_TRAVEL_REVIEW_PORT || 37849);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') return res.end(page());
      if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, fs.existsSync(SESSION) ? JSON.parse(fs.readFileSync(SESSION, 'utf8')) : {});
      if (req.method === 'POST' && req.url === '/api/play') {
        const input = await body(req);
        const candidate = allowedCandidates.find((row) => row.id === input.id);
        if (!candidate) throw new Error('candidate was rejected by technical filtering');
        await terrainImport.resetToImportScreen(earth);
        await gate.importEsp(earth, path.join(tool.ROOT, candidate.esp));
        await earth.send('Page.bringToFront');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && req.url === '/api/verdict') {
        const input = await body(req);
        if (!ALLOWED.includes(input.verdict)) throw new Error('choose a verdict first');
        const record = { schema_version: 1, operator: 'Mikko', authority: 'human visual review', verdict: input.verdict,
          note: String(input.note || '').slice(0, 2000), reviewed_at: new Date().toISOString() };
        fs.writeFileSync(SESSION, `${JSON.stringify(record, null, 2)}\n`);
        return json(res, 200, record);
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const controls = await gate.newTab(browser.port, `http://127.0.0.1:${port}/`);
  await controls.waitFor(`document.title === 'Orbit Travel Handoff Review'`, 15000);
  await controls.send('Page.bringToFront');
  console.log(`Orbit→travel review ready: http://127.0.0.1:${port}/`);
  console.log(`Verdict: ${path.relative(tool.ROOT, SESSION)}`);
  const stop = () => { server.close(); try { controls.close(); } catch (_) {} try { earth.close(); } catch (_) {} try { browser.chrome.kill('SIGTERM'); } catch (_) {} };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { SESSION, ALLOWED, page };
