#!/usr/bin/env node
'use strict';

// Human-only rhythm review controller. It reuses the established Earth Studio
// import harness. It never changes production plans or director policy.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const gate = require('./earth-studio-journey-import-gate.js');

const ROOT = path.resolve(__dirname, '..');
const packageArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const root = path.resolve(packageArg || 'package-runs/2026-08-20-earth-studio-directorial-rhythm-ab');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'review-manifest.json'), 'utf8'));
const decisionsFile = path.join(root, manifest.decisions_file || 'review-decisions.json');
const choices = ['PREFER_A', 'PREFER_B', 'PREFER_C', 'NO_MEANINGFUL_DIFFERENCE', 'BOTH_BAD', 'REPLAY_UNDECIDED'];
const port = Number(process.env.ES_RHYTHM_REVIEW_PORT || 37843);
const cdpPort = Number(process.env.ES_REVIEW_CDP_PORT || 9731);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sendJson(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); }); }

class RhythmReview {
  constructor() { this.groups = manifest.groups; this.index = 0; this.session = readJson(decisionsFile); this.session.decisions = this.session.decisions || []; this.server = null; this.chrome = null; this.earth = null; }
  group() { return this.groups[this.index]; }
  payload() { return { group: this.group(), index: this.index, count: this.groups.length, decisions: this.session.decisions }; }
  async prepare(variant) {
    const selected = this.group().variants.find((v) => v.variant === variant);
    if (!selected) throw new Error(`unknown variant ${variant}`);
    if (selected.import_status !== 'IMPORT_VERIFIED') throw new Error(`${selected.label}: import is not verified`);
    await gate.importEsp(this.earth, path.join(ROOT, selected.path, 'earth-studio.esp'));
    return { ...this.payload(), prepared: selected.variant, prepared_duration: selected.duration_seconds };
  }
  record(verdict, comment) {
    if (!choices.includes(verdict)) throw new Error(`invalid verdict ${verdict}`);
    const group = this.group().group;
    this.session.decisions = this.session.decisions.filter((d) => d.group !== group);
    this.session.decisions.push({ group, verdict, comment: String(comment || ''), recorded_at: new Date().toISOString() });
    this.session.decisions.sort((a, b) => a.group.localeCompare(b.group));
    fs.writeFileSync(decisionsFile, `${JSON.stringify(this.session, null, 2)}\n`);
    return this.payload();
  }
  html() {
    const labels = JSON.stringify(choices);
    return `<!doctype html><meta charset="utf-8"><title>Earth Studio Rhythm Review</title>
<style>body{font:16px system-ui;background:#111;color:#eee;max-width:900px;margin:32px auto;padding:0 24px}button{font:16px system-ui;padding:9px 12px;margin:4px;border:1px solid #777;border-radius:6px;background:#222;color:#fff;cursor:pointer}.card{padding:16px;background:#1d1d1d;border-left:5px solid #32c878;margin:16px 0}.muted{color:#aaa}.a{color:#ffbd66}.b{color:#8ce5ac}.c{color:#90c8ff}textarea{width:100%;background:#222;color:#fff}</style>
<h1>Earth Studio Directorial Rhythm Review</h1><p class="muted">Select a labeled variant to import it automatically, then click Google's Play button in the Earth Studio tab. Verdicts never change production policy.</p><div id="app">Loading…</div>
<script>
const app=document.querySelector('#app');
async function act(url,opts){const r=await fetch(url,opts||{method:'POST'});const x=await r.json();if(x.error)alert(x.error.message);render(x)}
function render(x){if(x.error){app.innerHTML='<div class="card">'+x.error.message+'</div>';return}const g=x.group,d=x.decisions.find(v=>v.group===g.group);let h='<div class="card"><b>'+g.group+'</b><br><span class="muted">'+g.variants[0].hypothesis+'</span></div><p><button '+(x.index?'':'disabled')+' onclick="act(\'/api/prev\')">Previous</button><button '+(x.index+1<x.count?'':'disabled')+' onclick="act(\'/api/next\')">Next</button></p>';for(const v of g.variants){const cls=v.variant.startsWith('A')?'a':v.variant.startsWith('B')?'b':'c';h+='<div class="card"><b class="'+cls+'">'+v.label+'</b><br>'+v.duration_seconds+'s total · '+v.import_status+'<br><span class="muted">'+v.hypothesis+'</span><br><button onclick="act(\'/api/prepare?variant='+encodeURIComponent(v.variant)+'\')">Prepare '+v.label+'</button></div>}h+='<p class="muted">After watching the prepared variant, record one judgment.</p><p>'+${labels}.map(c=>'<button onclick="verdict(\''+c+'\')">'+c+'</button>').join('')+'</p><textarea id="comment" rows="3" placeholder="Optional comment">'+(d&&d.comment||'')+'</textarea><p class="muted">Current verdict: '+(d&&d.verdict||'none')+'</p>';app.innerHTML=h}
async function verdict(v){await act('/api/verdict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({verdict:v,comment:document.querySelector('#comment').value})})}fetch('/api/status').then(r=>r.json()).then(render)
</script>`;
  }
  async run() {
    if (this.groups.some((g) => g.variants.some((v) => v.import_status !== 'IMPORT_VERIFIED'))) throw new Error('rhythm imports are not all verified');
    this.server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      try {
        if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(this.html()); return; }
        if (req.method === 'GET' && u.pathname === '/api/status') { sendJson(res, 200, this.payload()); return; }
        if (req.method === 'POST' && u.pathname === '/api/next') { this.index = Math.min(this.groups.length - 1, this.index + 1); sendJson(res, 200, this.payload()); return; }
        if (req.method === 'POST' && u.pathname === '/api/prev') { this.index = Math.max(0, this.index - 1); sendJson(res, 200, this.payload()); return; }
        if (req.method === 'POST' && u.pathname === '/api/prepare') { sendJson(res, 200, await this.prepare(u.searchParams.get('variant'))); return; }
        if (req.method === 'POST' && u.pathname === '/api/verdict') { const b = JSON.parse(await readBody(req) || '{}'); sendJson(res, 200, this.record(b.verdict, b.comment)); return; }
        sendJson(res, 404, { error: { message: 'not found' } });
      } catch (e) { sendJson(res, 400, { error: { message: e.message } }); }
    });
    await new Promise((resolve) => this.server.listen(port, '127.0.0.1', resolve));
    const launched = await gate.launch({ port: cdpPort, headless: process.env.ES_REVIEW_HEADLESS === '1', display: process.env.DISPLAY || ':1', width: 1920, height: 1080 });
    this.chrome = launched.chrome;
    await gate.newTab(cdpPort, `http://127.0.0.1:${port}/`);
    this.earth = await gate.newTab(cdpPort, 'https://earth.google.com/studio/');
    await delay(1200);
    console.log(`Rhythm review ready: http://127.0.0.1:${port}/`);
    console.log('Use the controller tab to prepare A/B/C; click Play in Earth Studio; record the human verdict.');
  }
  stop() { try { this.server && this.server.close(); } catch (_) {} try { this.chrome && this.chrome.kill('SIGTERM'); } catch (_) {} }
}
if (require.main === module) {
  if (process.argv.includes('--help')) { console.log('usage: node scripts/earth-studio-directorial-rhythm-review-launch.js [review-package]'); process.exit(0); }
  const app = new RhythmReview();
  process.on('SIGINT', () => { app.stop(); process.exit(0); });
  process.on('SIGTERM', () => { app.stop(); process.exit(0); });
  app.run().catch((e) => { app.stop(); console.error(`RHYTHM_REVIEW_BLOCKED — ${e.message}`); process.exitCode = 1; });
}
module.exports = { RhythmReview };
