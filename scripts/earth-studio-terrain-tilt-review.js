#!/usr/bin/env node
'use strict';

// Human terrain-tilt review controller. It imports one experiment-only ESP at
// a time into the operator's authenticated Earth Studio session and persists
// Mikko's explicit choices. It never edits production camera policy.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GATE = path.join(ROOT, 'package-runs/2026-08-21-earth-studio-terrain-tilt-review');
const importGate = require(path.join(ROOT, 'scripts/earth-studio-journey-import-gate.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bringToFront(cdp) {
  return cdp.send('Page.bringToFront');
}

async function resetToImportScreen(cdp) {
  await cdp.send('Page.navigate', { url: 'https://earth.google.com/studio/' });
  await cdp.waitFor(`Array.from(document.querySelectorAll('div')).some(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim()))`, 60000);
  await delay(500);
}

function loadPackage(gateDir = DEFAULT_GATE) {
  const manifestPath = path.join(gateDir, 'canary-manifest.json');
  const templatePath = path.join(gateDir, 'review-session-template.json');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(templatePath)) {
    throw new Error(`terrain review package incomplete: ${path.relative(ROOT, gateDir)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  if (manifest.production_policy_changed !== false || manifest.canaries.length !== 20) {
    throw new Error('terrain review manifest is not the expected 20-case experiment-only package');
  }
  for (const record of manifest.canaries) {
    if (!fs.existsSync(path.join(ROOT, record.esp))) throw new Error(`missing ESP: ${record.esp}`);
  }
  return { manifest, template, gateDir, sessionPath: path.join(gateDir, 'review-session.json') };
}

function freshSession(pkg, now = new Date().toISOString()) {
  return { ...JSON.parse(JSON.stringify(pkg.template)), started_at: now };
}

function validateTilt(value, allowed, { nullable = false, noneGood = false } = {}) {
  if ((value === null || value === '' || value === undefined) && nullable) return null;
  if (noneGood && value === 'NONE_GOOD') return 'NONE_GOOD';
  const number = Number(value);
  if (!allowed.includes(number)) throw new Error(`invalid candidate tilt: ${value}`);
  return number;
}

function applyChoice(pkg, session, body, now = new Date().toISOString()) {
  const subject = String(body.subject || '');
  const row = session.choices.find((choice) => choice.subject === subject);
  if (!row) throw new Error(`unknown terrain subject: ${subject}`);
  const allowed = pkg.manifest.canaries.filter((candidate) => candidate.subject === subject).map((candidate) => candidate.tilt_deg);
  const chosen = validateTilt(body.chosen_tilt_deg, allowed, { noneGood: true });
  const second = validateTilt(body.second_best_tilt_deg, allowed, { nullable: true });
  const unacceptable = Array.isArray(body.unacceptable_tilts_deg)
    ? [...new Set(body.unacceptable_tilts_deg.map((value) => validateTilt(value, allowed)))]
    : [];
  if (chosen !== 'NONE_GOOD' && second === chosen) throw new Error('second-best must differ from winner');
  row.chosen_tilt_deg = chosen;
  row.second_best_tilt_deg = second;
  row.unacceptable_tilts_deg = unacceptable;
  row.note = String(body.note || '').slice(0, 2000);
  row.reviewed_at = now;
  return session;
}

function applyOverall(pkg, session, body, now = new Date().toISOString()) {
  const verdict = String(body.overall_verdict || '');
  if (!session.allowed_overall_verdicts.includes(verdict)) throw new Error(`invalid overall verdict: ${verdict}`);
  if (session.choices.some((choice) => choice.chosen_tilt_deg === null)) throw new Error('review every subject before recording the overall verdict');
  session.overall_verdict = verdict;
  session.completed_at = now;
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>Terrain Tilt Review</title><style>
  body{font:16px system-ui;background:#101418;color:#edf2f4;margin:0}main{max-width:1100px;margin:auto;padding:28px}h1{margin:0 0 8px}.muted{color:#a9b4bd}.subjects,.angles{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button,select,input,textarea{font:inherit}button{padding:10px 14px;border:1px solid #65727c;border-radius:7px;background:#222b31;color:#fff;cursor:pointer}button.current{border-color:#d8b04b}.card{background:#192127;border:1px solid #35424b;border-radius:10px;padding:18px;margin-top:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:6px}textarea{min-height:80px}.ok{color:#7ee787}.warn{color:#e3b341}code{color:#9cdcfe}</style></head><body><main>
  <h1>Earth Studio terrain-tilt calibration</h1><p class="muted">Experiment only. Production remains 72° until Mikko records authority.</p>
  <div class="subjects" id="subjects"></div><div class="card"><h2 id="title">Choose a subject</h2><p id="meta"></p><div class="angles" id="angles"></div><p id="status" class="muted"></p></div>
  <div class="card"><h2>Record subject choice</h2><div class="grid"><label>Winner<select id="winner"></select></label><label>Second best<select id="second"></select></label></div><label>Unacceptable angles (comma-separated)<input id="bad"></label><label>Optional note<textarea id="note"></textarea></label><button onclick="saveChoice()">Save and next</button></div>
  <div class="card"><h2>Overall authority</h2><select id="overall"><option value="">Choose only after all subjects</option><option>KEEP_72_GLOBAL</option><option>CHANGE_GLOBAL_TERRAIN_TILT</option><option>USE_TERRAIN_CLASS_POLICY</option><option>NO_CANDIDATE_ACCEPTABLE</option></select> <button onclick="saveOverall()">Record overall verdict</button></div>
  <script>
  let state, subject;
  const el = (id) => document.getElementById(id);
  const api = (url, body) => fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    const value = await response.json();
    if (!response.ok) throw Error(value.error);
    return value;
  });
  const option = (value, label) => {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  };
  async function init() {
    state = await api('/api/state');
    const names = [...new Set(state.manifest.canaries.map((candidate) => candidate.subject))];
    for (const name of names) {
      const button = document.createElement('button');
      button.textContent = name;
      button.addEventListener('click', () => choose(name));
      el('subjects').appendChild(button);
    }
    choose(names[0]);
  }
  function choose(name) {
    subject = name;
    const candidates = state.manifest.canaries
      .filter((candidate) => candidate.subject === name)
      .sort((a, b) => state.manifest.review_display_order_deg.indexOf(a.tilt_deg)
        - state.manifest.review_display_order_deg.indexOf(b.tilt_deg));
    const saved = state.session.choices.find((choice) => choice.subject === name);
    el('title').textContent = name + ' — ' + candidates[0].terrain_class;
    el('meta').textContent = 'Fixed ground radius ' + candidates[0].orbit_radius_m.toFixed(1)
      + ' m · 180° clockwise · 30 s · altitude varies with tilt';
    el('angles').replaceChildren();
    for (const candidate of candidates) {
      const button = document.createElement('button');
      if (candidate.current_policy) button.className = 'current';
      button.append('Play ' + candidate.tilt_deg + '°' + (candidate.current_policy ? ' CURRENT' : ''));
      button.appendChild(document.createElement('br'));
      const detail = document.createElement('small');
      detail.textContent = candidate.altitude_m.toFixed(0) + ' m altitude';
      button.appendChild(detail);
      button.addEventListener('click', () => prepare(candidate.id));
      el('angles').appendChild(button);
    }
    el('winner').replaceChildren(option('', '—'), option('NONE_GOOD', 'NONE GOOD'));
    el('second').replaceChildren(option('', '—'));
    for (const candidate of [...candidates].sort((a, b) => a.tilt_deg - b.tilt_deg)) {
      el('winner').appendChild(option(candidate.tilt_deg, candidate.tilt_deg + '°'));
      el('second').appendChild(option(candidate.tilt_deg, candidate.tilt_deg + '°'));
    }
    el('winner').value = saved.chosen_tilt_deg ?? '';
    el('second').value = saved.second_best_tilt_deg ?? '';
    el('bad').value = saved.unacceptable_tilts_deg.join(',');
    el('note').value = saved.note || '';
  }
  async function prepare(id) {
    el('status').textContent = 'Importing ' + id + '…';
    try {
      await api('/api/prepare', { id });
      el('status').innerHTML = '<span class="ok">Ready in Earth Studio: ' + id + '</span>';
    } catch (error) {
      el('status').innerHTML = '<span class="warn">' + error.message + '</span>';
    }
  }
  async function saveChoice() {
    try {
      state.session = (await api('/api/choice', {
        subject,
        chosen_tilt_deg: el('winner').value,
        second_best_tilt_deg: el('second').value,
        unacceptable_tilts_deg: el('bad').value.split(',').map((value) => value.trim()).filter(Boolean),
        note: el('note').value,
      })).session;
      const names = [...new Set(state.manifest.canaries.map((candidate) => candidate.subject))];
      choose(names[Math.min(names.indexOf(subject) + 1, names.length - 1)]);
      el('status').innerHTML = '<span class="ok">Choice saved.</span>';
    } catch (error) {
      el('status').innerHTML = '<span class="warn">' + error.message + '</span>';
    }
  }
  async function saveOverall() {
    try {
      state.session = (await api('/api/overall', { overall_verdict: el('overall').value })).session;
      el('status').innerHTML = '<span class="ok">Human authority recorded.</span>';
    } catch (error) {
      el('status').innerHTML = '<span class="warn">' + error.message + '</span>';
    }
  }
  init();</script></main></body></html>`;
}

function createController(pkg, { cdp = null } = {}) {
  let session = fs.existsSync(pkg.sessionPath)
    ? JSON.parse(fs.readFileSync(pkg.sessionPath, 'utf8'))
    : freshSession(pkg);
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
        // The choice is made in the local controller, but playback happens in
        // Earth Studio. Put the imported project in front once it is ready.
        await bringToFront(cdp);
        return json(res, 200, { ok: true, id: candidate.id });
      }
      if (req.method === 'POST' && req.url === '/api/choice') {
        session = applyChoice(pkg, session, await readBody(req)); writeSession(pkg, session);
        return json(res, 200, { ok: true, session });
      }
      if (req.method === 'POST' && req.url === '/api/overall') {
        session = applyOverall(pkg, session, await readBody(req)); writeSession(pkg, session);
        return json(res, 200, { ok: true, session });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  });
}

async function main() {
  const pkg = loadPackage();
  const port = Number(process.env.ES_TERRAIN_REVIEW_PORT || 37843);
  const browser = await importGate.launch({ port: 9743, headless: false, display: process.env.DISPLAY || ':1', width: 1600, height: 1000 });
  const es = await importGate.newTab(browser.port, 'https://earth.google.com/studio/');
  const server = createController(pkg, { cdp: es });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const controllerTab = await importGate.newTab(browser.port, `http://127.0.0.1:${port}/`);
  await controllerTab.waitFor(`document.title === 'Terrain Tilt Review'`, 15000);
  // DevTools' /json/new endpoint does not guarantee foreground activation.
  // Explicitly foreground the controls so launching the command never strands
  // the operator on Earth Studio's opening page with the controller hidden.
  await bringToFront(controllerTab);
  console.log(`Terrain review ready: http://127.0.0.1:${port}/`);
  console.log(`Choices: ${path.relative(ROOT, pkg.sessionPath)}`);
  const stop = () => {
    server.close();
    try { controllerTab.close(); } catch (_) {}
    try { es.close(); } catch (_) {}
    try { browser.chrome.kill('SIGTERM'); } catch (_) {}
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  DEFAULT_GATE, loadPackage, freshSession, applyChoice, applyOverall,
  writeSession, createController, resetToImportScreen, bringToFront, page,
};
