#!/usr/bin/env node
'use strict';

// scripts/earth-studio-opening-ab-review.js
//
// Human visual review controller for the opening-composition A/B set.
//
// Flow per case:  open -> Play A -> Play B -> judge (A BETTER / B BETTER /
// SAME / BOTH BAD) + optional note. The controller imports the selected
// variant into a real Earth Studio tab; playback itself is always started by
// the operator clicking Google's Play button (never by this controller).
//
// Decisions persist to <gate>/review-session.json.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const gate = require('./earth-studio-journey-import-gate.js');

const DEFAULT_PORT = 37842;
const ES_PORT = Number(process.env.ES_REVIEW_CDP_PORT || 9731);
const argv = process.argv.slice(2);
const GATE_ARG = argv.indexOf('--gate') >= 0 ? argv[argv.indexOf('--gate') + 1] : null;
const GATE_DIR = GATE_ARG ? path.resolve(GATE_ARG) : path.join(ROOT, 'package-runs/2026-08-20-earth-studio-opening-composition-ab');
const SESSION_FILE = path.join(GATE_DIR, 'review-session.json');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function html() {
  return `<!doctype html><meta charset="utf-8"><title>Opening Composition A/B Review</title>
<style>body{font:16px system-ui;background:#111;color:#eee;max-width:820px;margin:36px auto;padding:0 24px}button{font:16px system-ui;padding:10px 16px;margin:4px;border:1px solid #777;border-radius:6px;background:#222;color:#fff;cursor:pointer}button:disabled{opacity:.4}.status{padding:14px;background:#1d1d1d;border-left:5px solid #888;margin:16px 0}.ready{border-color:#32c878}.muted{color:#aaa}.a{color:#ffb454}.b{color:#7ee0a3}</style>
<h1>Opening Composition — A/B Review</h1>
<p class="muted">A = old/default opening · B = subject-aware opening. Everything else is identical. When a variant is READY, switch to the Earth Studio tab and click Google's Play button.</p>
<div id="app">Loading…</div>
<script>
const app=document.querySelector('#app');
async function act(url,opts){const r=await fetch(url,opts||{method:'POST'});return render(await r.json());}
async function decision(d){await fetch('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:d,notes:document.querySelector('#notes').value})});poll();}
function render(x){if(x.error){app.innerHTML='<div class="status"><b>'+x.error.code+'</b><br>'+x.error.message+'</div>';return;}
 const p=x.pair,s=x.session;
 app.innerHTML='<div class="status ready"><b>'+p.id+'</b> — '+p.kind+'<br><span class="muted">strategy: '+p.strategy+' · changed: '+p.changed+'</span><br><span class="muted">'+p.reason+'</span><br><span class="muted">Judge: '+p.judge+'</span></div>'
 +'<p><button class="a" onclick="act(\\'/api/prepare?variant=A\\')">Prepare/Play A (default)</button>'
 +'<button class="b" onclick="act(\\'/api/prepare?variant=B\\')">Prepare/Play B (composed)</button></p>'
 +'<p><button '+(x.previous?'':'disabled')+' onclick="act(\\'/api/previous\\')">Previous case</button><button '+(x.next?'':'disabled')+' onclick="act(\\'/api/next\\')">Next case</button></p>'
 +'<p>Verdict: <button onclick="decision(\\'A_BETTER\\')">A BETTER</button><button onclick="decision(\\'B_BETTER\\')">B BETTER</button><button onclick="decision(\\'SAME\\')">SAME</button><button onclick="decision(\\'BOTH_BAD\\')">BOTH BAD</button></p>'
 +'<p class="muted">current verdict: '+(s.records[p.id]&&s.records[p.id].human_decision||'none')+'</p>'
 +'<textarea id="notes" rows="3" style="width:100%;background:#222;color:#fff" placeholder="Mikko notes (optional)">'+((s.records[p.id]&&s.records[p.id].notes)||'')+'</textarea>';
}
async function poll(){render(await (await fetch('/api/status')).json());}
poll(); setInterval(poll,2000);
</script>`;
}

class AbReviewServer {
  constructor(port, gateDir) {
    this.port = port;
    this.gateDir = gateDir;
    const manifest = JSON.parse(fs.readFileSync(path.join(gateDir, 'generation-manifest.json'), 'utf8'));
    this.records = manifest.records || [];
    this.pairs = [];
    const seen = new Map();
    for (const r of this.records) {
      if (!seen.has(r.pair)) { seen.set(r.pair, { A: null, B: null, meta: r }); }
      seen.get(r.pair)[r.variant] = r;
    }
    for (const [id, v] of seen) this.pairs.push({ id, kind: v.meta.kind, judge: v.meta.question, strategy: v.meta.strategy, confidence: v.meta.confidence, reason: v.meta.reason, changed: v.meta.changed, A: v.A, B: v.B });
    this.session = this.loadSession();
  }
  loadSession() {
    if (fs.existsSync(SESSION_FILE)) { try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (_) {} }
    // NOTE: keyed as `records` — prepare/decision read this.session.records;
    // the original `pairs` key crashed the first prepare of a fresh session.
    return { schema_version: 1, records: Object.fromEntries(this.pairs.map((p) => [p.id, { state: 'NOT_PREPARED', human_decision: null, notes: '' }])), current_id: this.pairs[0] ? this.pairs[0].id : null };
  }
  persist() { fs.writeFileSync(SESSION_FILE, `${JSON.stringify(this.session, null, 2)}\n`); }
  currentPair() { return this.pairs.find((p) => p.id === this.session.current_id) || this.pairs[0]; }
  async prepare(variant) {
    const pair = this.currentPair();
    const record = variant === 'B' ? pair.B : pair.A;
    if (!record) throw Object.assign(new Error('variant missing'), { code: 'VARIANT_MISSING' });
    await gate.importEsp(this.earth, path.join(ROOT, record.esp));
    this.session.records[pair.id].state = 'READY_TO_PLAY';
    this.session.records[pair.id].last_variant = variant;
    this.persist();
    return this.payload();
  }
  move(delta) {
    const i = this.pairs.findIndex((p) => p.id === this.session.current_id);
    const target = this.pairs[i + delta];
    if (target) { this.session.current_id = target.id; this.persist(); }
    return this.payload();
  }
  payload() {
    const i = this.pairs.findIndex((p) => p.id === this.session.current_id);
    return { pair: this.currentPair(), session: this.session, previous: i > 0, next: i >= 0 && i < this.pairs.length - 1 };
  }
  async run() {
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const send = (v, s = 200) => json(res, s, v);
      if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html()); return; }
      if (req.method === 'GET' && u.pathname === '/api/status') { send(this.payload()); return; }
      if (req.method === 'POST' && u.pathname === '/api/prepare') { this.prepare(u.searchParams.get('variant') || 'A').then(send).catch((e) => send({ error: { code: e.code || 'PREPARE_FAILED', message: e.message } }, 500)); return; }
      if (req.method === 'POST' && u.pathname === '/api/next') { send(this.move(1)); return; }
      if (req.method === 'POST' && u.pathname === '/api/previous') { send(this.move(-1)); return; }
      if (req.method === 'POST' && u.pathname === '/api/decision') {
        let body = ''; req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const x = JSON.parse(body || '{}');
          if (!['A_BETTER', 'B_BETTER', 'SAME', 'BOTH_BAD'].includes(x.decision)) { send({ error: { code: 'INVALID_DECISION', message: 'Use A_BETTER / B_BETTER / SAME / BOTH_BAD' } }, 400); return; }
          const rec = this.session.records[this.session.current_id];
          rec.human_decision = x.decision; rec.notes = String(x.notes || '');
          this.persist(); send(this.payload());
        });
        return;
      }
      send({ error: { code: 'NOT_FOUND', message: u.pathname } }, 404);
    });
    await new Promise((resolve) => this.server.listen(this.port, '127.0.0.1', resolve));
    console.log(`A/B review controller: http://127.0.0.1:${this.port}/  (gate: ${path.relative(ROOT, this.gateDir)})`);
    const launched = await gate.launch({ port: ES_PORT, headless: process.env.ES_REVIEW_HEADLESS === '1', display: process.env.DISPLAY || ':1', width: 1920, height: 1080 });
    this.chrome = launched.chrome;
    this.controller = await gate.newTab(ES_PORT, `http://127.0.0.1:${this.port}/`);
    this.earth = await gate.newTab(ES_PORT, 'https://earth.google.com/studio/');
    await delay(1500);
    await this.prepare('A');
    console.log('Ready. Play each variant in the Earth Studio tab, then record a verdict in the controller.');
  }
  stop() { try { this.server && this.server.close(); } catch (_) {} try { this.chrome && this.chrome.kill('SIGKILL'); } catch (_) {} }
}

async function main() {
  const port = Number(process.env.ES_AB_PORT || DEFAULT_PORT);
  const app = new AbReviewServer(port, GATE_DIR);
  process.on('SIGINT', () => { app.stop(); process.exit(0); });
  process.on('SIGTERM', () => { app.stop(); process.exit(0); });
  try { await app.run(); } catch (error) { app.stop(); console.error(`${error.code || 'REVIEW_FAILED'} — ${error.message}`); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { AbReviewServer };
