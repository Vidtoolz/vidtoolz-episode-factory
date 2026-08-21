#!/usr/bin/env node
'use strict';
// Real Google Earth Studio import gate for the CAMERA JOURNEY builder.
//
// Imports journey-generated .esp files into the REAL authenticated Google Earth
// Studio application, verifies the project it produced against the plan, scrubs
// to every movement boundary/midpoint, reads the camera back from Earth Studio's
// OWN scene model, and captures the rendered render-frame region as PNG.
//
// This exists because .esp inspection and parser tests cannot answer "does the
// operator get the map animation they asked for" — only a real import can.
// Established 2026-08-19; the gate it produced is
// package-runs/2026-08-19-earth-studio-journey-visual-acceptance/.
//
//   node scripts/earth-studio-journey-import-gate.js --list
//   node scripts/earth-studio-journey-import-gate.js --canary A-landmark-16x9
//   node scripts/earth-studio-journey-import-gate.js --all
//   node scripts/earth-studio-journey-import-gate.js --continuation-join
//
// Requires: an Earth Studio-authenticated Chrome profile (default
// ~/.chrome-earthstudio-debug, the one the native-template gates established;
// override with ES_PROFILE). Read-only with respect to the Google account apart
// from the import itself, which is how Earth Studio opens a project at all.
// Never renders, never writes to the account, never touches VIDNAS.
// here; import/export live in the gate scripts.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const http = require('node:http');

const PROFILE = process.env.ES_PROFILE || '/home/vidtoolz/.chrome-earthstudio-debug';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((res, rej) => {
    const r = http.request(url, { method: 'GET' }, (s) => {
      let b = ''; s.setEncoding('utf8');
      s.on('data', (c) => { b += c; });
      s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    });
    r.on('error', rej); r.end();
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 1; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method) this.handlers.forEach((h) => h(m));
      if (!m.id) return;
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result || {});
    });
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}) {
    const id = this.id++; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
  async eval(expr, timeoutMs) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('EVAL: ' + (d.text || '') + ' ' + ((d.exception && (d.exception.description || d.exception.value)) || ''));
    }
    return r.result ? r.result.value : undefined;
  }
  async waitFor(expr, timeoutMs = 60000, everyMs = 250) {
    const t0 = Date.now(); let last = '';
    while (Date.now() - t0 < timeoutMs) {
      try { if (await this.eval(`Boolean(${expr})`)) return true; } catch (e) { last = e.message; }
      await delay(everyMs);
    }
    throw new Error(`timeout waiting for ${expr}${last ? ' (last: ' + last + ')' : ''}`);
  }
  async shot(file, opts = {}) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...opts });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function launch({ port = 9222, headless = true, display = ':1', width = 1600, height = 1000 } = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const env = { ...process.env };
  if (!headless) env.DISPLAY = display;
  const chrome = cp.spawn('/usr/bin/google-chrome', args, { stdio: ['ignore', 'ignore', 'pipe'], env, detached: false });
  let err = '';
  chrome.stderr.setEncoding('utf8'); chrome.stderr.on('data', (c) => { err += c; });
  for (let i = 0; i < 150; i += 1) {
    try { await getJson(`http://127.0.0.1:${port}/json/version`); return { chrome, stderr: () => err, port }; }
    catch (_) {
      if (chrome.exitCode !== null) throw new Error('chrome exited: ' + err.slice(-800));
      await delay(200);
    }
  }
  throw new Error('no devtools: ' + err.slice(-800));
}

async function attach(port = 9222, urlMatch = null) {
  const list = await getJson(`http://127.0.0.1:${port}/json/list`);
  const t = list.find((x) => x.type === 'page' && (!urlMatch || (x.url || '').includes(urlMatch))) || list.find((x) => x.type === 'page');
  if (!t) throw new Error('no page target');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  return cdp;
}

async function newTab(port, url) {
  const t = await new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: `/json/new?${encodeURIComponent(url)}`, method: 'PUT' }, (s) => {
      let b = ''; s.setEncoding('utf8'); s.on('data', (c) => { b += c; });
      s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b)); } });
    });
    r.on('error', rej); r.end();
  });
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  return cdp;
}


// ── gate: import, verify, scrub, capture ──────────────────────────────────
async function importEsp(cdp, espPath) {
  await cdp.send('DOM.enable');
  let clicked = await cdp.eval(`(()=>{const el=Array.from(document.querySelectorAll('div')).find(e=>e.children.length===0 && /^Import \\.esp file$/i.test((e.textContent||'').trim())); if(!el) return false; el.click(); return true;})()`);
  // A loaded project hides the start-screen import card. Use Earth Studio's
  // own File menu in that case, so Next/Previous can replace the current
  // evaluation project without a manual reset or duplicate tab.
  if (!clicked) {
    const fileMenu = await cdp.eval(`(()=>{const el=Array.from(document.querySelectorAll('[role="button"]')).find(e=>(e.textContent||'').trim()==='File'); if(!el) return false; for(const t of ['mousedown','mouseup','click'])el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); return true;})()`);
    if (fileMenu) {
      await delay(400);
      clicked = await cdp.eval(`(()=>{const el=Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>/^Import\\s*►$/i.test((e.textContent||'').trim())); if(!el) return false; for(const t of ['mouseover','mouseenter'])el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); return true;})()`);
      if (clicked) {
        await delay(500);
        clicked = await cdp.eval(`(()=>{const el=Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>/Earth Studio Project \\(.esp, .esb\\)/i.test((e.textContent||'').trim())); if(!el) return false; el.click(); return true;})()`);
      }
    }
  }
  if (!clicked) throw new Error('import entry not found');
  await delay(1200);
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!q.nodeId) throw new Error('file input not created');
  await cdp.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [espPath] });
  await cdp.waitFor(`window.scene && window.scene.duration > 1`, 120000);
  await delay(7000);
}

async function projectInfo(cdp) {
  return JSON.parse(await cdp.eval(`JSON.stringify({
    duration: scene.duration,
    totalFrames: scene.playbackManager.totalFrames,
    frameRate: scene.playbackManager.frameRate,
    loading: scene.loading,
    bodyHasError: /error|failed|could not/i.test(document.body.innerText),
    imported: /Project imported/i.test(document.body.innerText)
  })`));
}

async function renderRect(cdp) {
  return JSON.parse(await cdp.eval(`(()=>{const c=document.querySelector('canvas.guides-view');const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)});})()`));
}

async function gotoFrame(cdp, frame, settleMs = 5500) {
  await cdp.eval(`(()=>{scene.playbackManager.frameNumber = ${frame}; if (scene.onPlaybackFrameChanged_) scene.onPlaybackFrameChanged_(); return true;})()`);
  await delay(settleMs);
  // give streaming imagery a chance to finish
  for (let i = 0; i < 12; i += 1) {
    const busy = await cdp.eval(`Boolean(scene.loading)`);
    if (!busy) break;
    await delay(1000);
  }
  return JSON.parse(await cdp.eval(`(()=>{const v=scene.getCurrentWorldValues();return JSON.stringify({
    frame: scene.playbackManager.frameNumber,
    latitude: v.latitude, longitude: v.longitude, altitude: v.altitude,
    pan_deg: v.rotationX, tilt_deg: v.rotationY, roll_deg: v.rotationZ, fov: v.fov });})()`));
}

// Watch frames: the boundary and midpoint of every resolved segment, plus the
// very last frame. Orbit segments also get quarter and three-quarter samples;
// those are the minimum useful checkpoints for exposing chord-induced radial
// breathing in a real Earth Studio readback. Derived from the plan, so they
// line up with real movements.
function watchFrames(plan) {
  const segs = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
  const out = [];
  segs.forEach((s, i) => {
    out.push({ frame: s.start_frame, label: `seg${s.segment_id}-start`, movement: s.action, place: s.location_name });
    if (s.action === 'orbit') {
      out.push({ frame: Math.round(s.start_frame + (s.end_frame - s.start_frame) * 0.25), label: `seg${s.segment_id}-quarter`, movement: s.action, place: s.location_name });
    }
    out.push({ frame: Math.round((s.start_frame + s.end_frame) / 2), label: `seg${s.segment_id}-mid`, movement: s.action, place: s.location_name });
    if (s.action === 'orbit') {
      out.push({ frame: Math.round(s.start_frame + (s.end_frame - s.start_frame) * 0.75), label: `seg${s.segment_id}-three-quarter`, movement: s.action, place: s.location_name });
    }
    if (i === segs.length - 1) out.push({ frame: Math.max(0, s.end_frame - 1), label: `seg${s.segment_id}-end`, movement: s.action, place: s.location_name });
  });
  const seen = new Set();
  return out.filter((w) => (seen.has(w.frame) ? false : (seen.add(w.frame), true))).sort((a, b) => a.frame - b.frame);
}

async function observe(canary, outDir, port) {
  const espPath = path.join(ROOT, canary.esp);
  const plan = JSON.parse(fs.readFileSync(path.join(path.dirname(espPath), 'shot-plan.json'), 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const { chrome, stderr } = await launch({ port, headless: true, width: 2560, height: 1440 });
  const rec = { id: canary.id, aspect: canary.aspect, esp: canary.esp, esp_sha256: canary.esp_sha256,
    expected: { total_frames: canary.total_frames, duration_seconds: canary.duration_seconds, render_dimensions: canary.render_dimensions },
    import: null, render_rect: null, frames: [], errors: [] };
  try {
    const cdp = await newTab(port, 'https://earth.google.com/studio/');
    await delay(13000);
    await importEsp(cdp, espPath);
    rec.import = await projectInfo(cdp);
    rec.render_rect = await renderRect(cdp);
    const clip = { ...rec.render_rect, scale: 1 };
    const frames = watchFrames(plan);
    for (const w of frames) {
      const cam = await gotoFrame(cdp, w.frame);
      const png = path.join(outDir, `${canary.id}_f${String(w.frame).padStart(5, '0')}_${w.label}.png`);
      await cdp.shot(png, { clip });
      const intended = plan.segments.find((s) => s.segment_id === Number(String(w.label).match(/seg(\d+)/)[1]));
      rec.frames.push({
        ...w, png: path.relative(ROOT, png),
        earth_studio_camera: cam,
        intended: intended ? { action: intended.action, place: intended.location_name, altitude_m: intended.altitude_m, tilt_deg: intended.tilt_deg,
          target_lat: intended.location.latitude, target_lng: intended.location.longitude } : null,
      });
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } catch (e) {
    rec.errors.push(e.message);
    console.error(`  ${canary.id} ERROR: ${e.message}`);
  } finally { try { chrome.kill('SIGKILL'); } catch (_) {} }
  return rec;
}


// ── CLI ───────────────────────────────────────────────────────────────────
function loadManifest(gateDir) {
  return JSON.parse(fs.readFileSync(path.join(gateDir, 'canary-manifest.json'), 'utf8'));
}

async function main() {
  const argv = process.argv.slice(2);
  // Which acceptance gate's canaries to import. Defaults to the journey
  // visual-acceptance gate; --gate <dir> points it at another (e.g. the director
  // acceptance gate), so one harness serves both.
  const gateArg = argv.indexOf('--gate') >= 0 ? argv[argv.indexOf('--gate') + 1] : null;
  const gateDir = gateArg
    ? (path.isAbsolute(gateArg) ? gateArg : path.join(ROOT, gateArg))
    : path.join(ROOT, 'package-runs/2026-08-19-earth-studio-journey-visual-acceptance');
  if (!fs.existsSync(path.join(gateDir, 'canary-manifest.json'))) {
    console.error(`No canary manifest at ${path.relative(ROOT, gateDir)} — nothing to import.`);
    process.exitCode = 2; return;
  }
  const manifest = loadManifest(gateDir);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: earth-studio-journey-import-gate.js [--gate <dir>] [--list | --all | --canary <id> ...]');
    return;
  }
  if (argv.includes('--list')) {
    manifest.canaries.forEach((c) => console.log(`${c.id.padEnd(32)} ${c.aspect.padEnd(6)} ${String(c.total_frames).padStart(6)}f  ${c.title}`));
    return;
  }
  const ids = argv.includes('--all')
    ? manifest.canaries.map((c) => c.id)
    : argv.filter((a, i) => argv[i - 1] === '--canary');
  if (!ids.length) { console.error('nothing selected — use --all or --canary <id>'); process.exitCode = 2; return; }
  const outRoot = path.join(gateDir, 'observations');
  fs.mkdirSync(outRoot, { recursive: true });
  let port = 9600;
  for (const id of ids) {
    const c = manifest.canaries.find((x) => x.id === id);
    if (!c) { console.error(`unknown canary: ${id}`); process.exitCode = 2; continue; }
    console.log(`\n=== ${c.id} (${c.aspect}, ${c.total_frames}f) ===`);
    const rec = await observe(c, path.join(outRoot, c.id), port += 1);
    fs.writeFileSync(path.join(outRoot, `${c.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
    const ok = rec.errors.length === 0 && rec.import && rec.import.duration === c.total_frames;
    console.log(`  import ${ok ? 'OK' : 'PROBLEM'}: duration=${rec.import && rec.import.duration} expected=${c.total_frames} fps=${rec.import && rec.import.frameRate} frames_observed=${rec.frames.length}${rec.errors.length ? ' :: ' + rec.errors.join('; ') : ''}`);
    if (!ok) process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('GATE ERROR:', e.message); process.exitCode = 1; });
}

module.exports = { launch, attach, newTab, importEsp, projectInfo, renderRect, gotoFrame, watchFrames, observe };
