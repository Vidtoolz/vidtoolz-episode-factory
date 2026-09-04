'use strict';
// EARTH STUDIO — NATIVE EXPORT ADAPTER (2026-09-04).
//
// Drives Google Earth Studio's OWN local render ("Image sequence (.jpeg) —
// renders locally on your computer") without a human, reusing the
// authenticated-profile CDP harness of scripts/earth-studio-journey-import-gate.js
// (launch, tab, .esp import, project inspection). This is a coordinator around
// the real application, not a second renderer: Earth Studio produces the
// frames at the project's dimensions with its own attribution.
//
// The one thing headless Chrome cannot do is show the OS folder chooser Earth
// Studio opens via window.showDirectoryPicker(). The adapter installs a page
// shim BEFORE the app loads that answers the picker with a directory in the
// origin-private file system (a real, structured-cloneable
// FileSystemDirectoryHandle — Earth Studio persists it in IndexedDB, so a
// Proxy will not do). Earth Studio writes its JPEGs there; the adapter copies
// each finished frame to the job's own frames directory (temp file + rename,
// never a partial frame), deletes it from OPFS, and reports progress from
// Earth Studio's "Rendered: x / y" text plus the arrival of files. Completion
// is Earth Studio's own end of render AND the expected file set; elapsed time
// never means complete.
//
// Authentication lives in the operator's Chrome profile (ES_PROFILE, default
// the gate's ~/.chrome-earthstudio-debug). No credential is stored here. An
// expired session is reported as AUTH_REQUIRED, never as a generic wait.
const fs = require('node:fs');
const path = require('node:path');
const gate = require('./scripts/earth-studio-journey-import-gate.js');

const EARTH_STUDIO_URL = 'https://earth.google.com/studio/';
const DEFAULTS = Object.freeze({
  gl: 'gpu', width: 1920, height: 1080,
  appReadyMs: 60000, importMs: 120000, dialogMs: 15000,
  // a stall = no new finished frame for this long (the app's own progress is
  // also watched); the adapter gives up and reports EXPORT_STALLED
  stallMs: 5 * 60 * 1000,
  pollMs: 700,
});
const delay = gate.delay;
const PULL_BATCH = 4; // ~2 MB JPEGs → ≤ ~11 MB base64 per CDP message

// One Chrome per profile at a time: Chrome itself refuses a second instance on
// the same user-data-dir, so exports are serialised in-process.
let CHAIN = Promise.resolve();
const LIVE_CHROMES = new Set();
function killChrome(chrome) { try { chrome.kill('SIGKILL'); } catch (_) {} LIVE_CHROMES.delete(chrome); }
process.on('exit', () => { for (const c of LIVE_CHROMES) { try { c.kill('SIGKILL'); } catch (_) {} } });

function fail(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }

// Page shim: real OPFS handle for the picker + prototype-level write tracking.
function pickerShim(exportDirName) {
  return `(() => {
  const state = { picked: null, opened: [], closed: [], events: [], errors: [] };
  window.__sfExport = state;
  const nameOf = new WeakMap();
  const origGetDir = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  FileSystemDirectoryHandle.prototype.getDirectoryHandle = async function (name, o) { const h = await origGetDir.call(this, name, o); nameOf.set(h, (nameOf.get(this) || '') + name + '/'); return h; };
  const origGetFile = FileSystemDirectoryHandle.prototype.getFileHandle;
  FileSystemDirectoryHandle.prototype.getFileHandle = async function (name, o) { const h = await origGetFile.call(this, name, o); nameOf.set(h, (nameOf.get(this) || '') + name); return h; };
  const origCreateWritable = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (o) {
    const w = await origCreateWritable.call(this, o); const n = nameOf.get(this) || '?'; state.opened.push(n);
    const origClose = w.close.bind(w); w.close = async () => { const r = await origClose(); state.closed.push(n); return r; }; return w;
  };
  window.showDirectoryPicker = async (opts) => {
    state.events.push('showDirectoryPicker:' + JSON.stringify(opts || {}));
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(${JSON.stringify(exportDirName)}, { recursive: true }); } catch (_) {}
    const dir = await origGetDir.call(root, ${JSON.stringify(exportDirName)}, { create: true });
    nameOf.set(dir, ''); state.picked = 'opfs:' + ${JSON.stringify(exportDirName)};
    return dir;
  };
})();`;
}

// In-page helpers (strings evaluated through CDP).
const JS = {
  appState: `(()=>{const t=document.body?document.body.innerText:'';return JSON.stringify({url:location.href,hasScene:Boolean(window.scene),importCard:/Import \\.esp file/i.test(t),signIn:/sign in|log in|choose an account/i.test(t)&&!/Import \\.esp file|Quick Start/i.test(t),hasFileMenu:Array.from(document.querySelectorAll('[role="button"]')).some(e=>(e.textContent||'').trim()==='File')});})()`,
  clickRender: `(()=>{const e=Array.from(document.querySelectorAll('button,[role=button]')).find(x=>/^Render$/i.test((x.textContent||'').trim()));if(!e)return false;e.click();return true;})()`,
  // The destination button (#output-dir-btn) reads "Choose folder" on a fresh
  // profile, or shows the REMEMBERED directory name of an earlier render (Earth
  // Studio persists the handle in IndexedDB) with an inner .clear-btn.
  dialogState: `(()=>{const local=document.querySelector('input[type=radio][value=local]');const name=document.querySelector('input[name=name]');const nums=Array.from(document.querySelectorAll('input[type=number]')).map(i=>i.value);const w=document.querySelector('input[name=width]');const h=document.querySelector('input[name=height]');const btn=document.getElementById('output-dir-btn')||Array.from(document.querySelectorAll('button')).find(x=>/Choose folder/i.test((x.textContent||'').trim()));const label=btn?(btn.querySelector('span')||btn).textContent.trim():null;return JSON.stringify({open:Boolean(local),local:local?local.checked:null,name:name?name.value:null,numbers:nums,width:w?Number(w.value):null,height:h?Number(h.value):null,hasDestinationButton:Boolean(btn),hasChoose:Boolean(btn)&&/Choose folder/i.test(label||''),remembered:Boolean(btn)&&!/Choose folder/i.test(label||'')?label:null,hasClear:Boolean(btn&&btn.querySelector('.clear-btn'))});})()`,
  clearRemembered: `(()=>{const btn=document.getElementById('output-dir-btn');const c=btn&&btn.querySelector('.clear-btn');if(!c)return false;for(const t of ['mousedown','mouseup','click'])c.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));return true;})()`,
  clickChoose: `(()=>{const e=document.getElementById('output-dir-btn')||Array.from(document.querySelectorAll('button')).find(x=>/Choose folder/i.test((x.textContent||'').trim()));if(!e)return false;e.click();return true;})()`,
  destinationText: `(()=>{const s=window.__sfExport;const e=Array.from(document.querySelectorAll('*')).find(e=>e.children.length===0&&s&&s.picked&&(e.textContent||'').includes(s.picked.slice(5)));return e?e.textContent.trim():null;})()`,
  startRect: `JSON.stringify((()=>{const e=Array.from(document.querySelectorAll('*')).find(e=>e.children.length===0&&(e.textContent||'').trim()==='Start');if(!e)return null;const b=e.closest('button,[role=button]')||e;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:!!b.disabled};})())`,
  progress: `(()=>{const s=window.__sfExport;const t=(document.body.innerText||'').replace(/\\s+/g,' ');const m=/Rendered:\\s*(\\d+)\\s*\\/\\s*(\\d+)/.exec(t);const rem=/(\\d\\d:\\d\\d(?::\\d\\d)?)\\s*remaining/.exec(t);return JSON.stringify({closed:s.closed,opened:s.opened.length,rendered:m?Number(m[1]):null,total:m?Number(m[2]):null,remaining:rem?rem[1]:null,rendering:/Rendering ‘|Rendering '|Loading ‘|Loading '/.test(t),text:t.slice(0,240)});})()`,
  // native base64 (FileReader) — the JS string-building variant moved ~1 frame/s
  pull: (rel) => `(async()=>{const root=await navigator.storage.getDirectory();const parts=${JSON.stringify(rel)}.split('/');let d=root;for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);const fh=await d.getFileHandle(parts[parts.length-1]);const f=await fh.getFile();const url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(f);});return url.slice(url.indexOf(',')+1);})()`,
  pullMany: (rels) => `(async()=>{const root=await navigator.storage.getDirectory();const out=[];for(const rel of ${JSON.stringify(rels)}){const parts=rel.split('/');let d=root;for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);const fh=await d.getFileHandle(parts[parts.length-1]);const f=await fh.getFile();const url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(f);});out.push([rel,url.slice(url.indexOf(',')+1)]);}return JSON.stringify(out);})()`,
  removeMany: (rels) => `(async()=>{const root=await navigator.storage.getDirectory();for(const rel of ${JSON.stringify(rels)}){const parts=rel.split('/');let d=root;for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);try{await d.removeEntry(parts[parts.length-1]);}catch(e){}}return true;})()`,
  remove: (rel) => `(async()=>{const root=await navigator.storage.getDirectory();const parts=${JSON.stringify(rel)}.split('/');let d=root;for(const p of parts.slice(0,-1))d=await d.getDirectoryHandle(p);await d.removeEntry(parts[parts.length-1]);return true;})()`,
  list: (dirRel) => `(async()=>{const root=await navigator.storage.getDirectory();let d=root;for(const p of ${JSON.stringify(dirRel)}.split('/').filter(Boolean))d=await d.getDirectoryHandle(p);const out=[];async function walk(d,prefix){for await (const [n,h] of d.entries()){if(h.kind==='directory')await walk(h,prefix+n+'/');else out.push(prefix+n);}}await walk(d,${JSON.stringify(dirRel)}+'/');return JSON.stringify(out);})()`,
  removeTree: (dirRel) => `(async()=>{const root=await navigator.storage.getDirectory();try{await root.removeEntry(${JSON.stringify(dirRel)},{recursive:true});}catch(e){}return true;})()`,
};

function writeAtomic(file, buffer) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);
}

async function pullFile(cdp, rel, target) {
  const b64 = await cdp.eval(JS.pull(rel), 60000);
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw fail('EMPTY_FRAME', `Earth Studio produced an empty file: ${rel}`);
  writeAtomic(target, buf);
  await cdp.eval(JS.remove(rel));
  return buf.length;
}

// Run one native export. Resolves with the observed convention and counts;
// rejects with .code ∈ PROFILE_BUSY | LAUNCH_FAILED | AUTH_REQUIRED |
// IMPORT_FAILED | PROJECT_MISMATCH | RENDER_DIALOG_FAILED | EXPORT_STALLED |
// EXPORT_INCOMPLETE | CHROME_EXITED.
function runNativeExport(params) {
  const run = () => runNativeExportNow(params);
  const p = CHAIN.then(run, run);
  CHAIN = p.catch(() => {});
  return p;
}

async function runNativeExportNow({ espPath, framesDir, metaDir, expected, jobId, profile, port, onEvent, gl, appReadyMs, importMs, dialogMs, stallMs, pollMs, keepChrome = false }) {
  const o = { ...DEFAULTS, gl: gl || DEFAULTS.gl, appReadyMs: appReadyMs || DEFAULTS.appReadyMs, importMs: importMs || DEFAULTS.importMs, dialogMs: dialogMs || DEFAULTS.dialogMs, stallMs: stallMs || DEFAULTS.stallMs, pollMs: pollMs || DEFAULTS.pollMs };
  const emit = (evt) => { try { if (onEvent) onEvent({ at: new Date().toISOString(), ...evt }); } catch (_) {} };
  if (!espPath || !fs.existsSync(espPath)) throw fail('IMPORT_FAILED', `.esp not found: ${espPath}`);
  if (!expected || !Number.isInteger(expected.last)) throw fail('PROJECT_MISMATCH', 'expected frame range missing');
  fs.mkdirSync(framesDir, { recursive: true });
  if (metaDir) fs.mkdirSync(metaDir, { recursive: true });
  const exportDirName = `super-focus-${String(jobId || 'job').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
  const t0 = Date.now();
  const result = { ok: false, job_id: jobId, gl: o.gl, profile: profile || gate.PROFILE, chrome_pid: null, opfs_dir: exportDirName, render_name: null, files: 0, bytes: 0, first_name: null, last_name: null, rendered_reported: null, total_reported: null, imagery_sources: null, meta_files: [], elapsed_s: null, app_exceptions: 0 };
  let chrome = null; let cdp = null; let cdpPort = port || 9600 + Math.floor(Math.random() * 300);
  emit({ type: 'launching', gl: o.gl });
  try {
    const launched = await gate.launch({ port: cdpPort, headless: true, gl: o.gl, width: DEFAULTS.width, height: DEFAULTS.height, profile: profile || gate.PROFILE });
    chrome = launched.chrome; cdpPort = launched.port || cdpPort;
  } catch (e) {
    const msg = String(e.message || e);
    throw fail(/in use|SingletonLock|already running|exited/i.test(msg) ? 'PROFILE_BUSY' : 'LAUNCH_FAILED', `Earth Studio browser could not start: ${msg.slice(0, 400)}`);
  }
  LIVE_CHROMES.add(chrome);
  result.chrome_pid = chrome.pid;
  emit({ type: 'launched', chrome_pid: chrome.pid, cdp_port: cdpPort, profile: result.profile });
  let chromeExited = false; chrome.on('exit', () => { chromeExited = true; LIVE_CHROMES.delete(chrome); });
  const assertChrome = () => { if (chromeExited) throw fail('CHROME_EXITED', 'the Earth Studio browser exited during the export'); };
  try {
    cdp = await gate.newTab(cdpPort, 'about:blank');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: pickerShim(exportDirName) });
    let exceptions = 0; cdp.on((m) => { if (m.method === 'Runtime.exceptionThrown') exceptions += 1; });
    await cdp.send('Page.bringToFront').catch(() => {});
    await cdp.send('Page.navigate', { url: EARTH_STUDIO_URL });
    // app ready or sign-in
    const tApp = Date.now(); let app = null;
    while (Date.now() - tApp < o.appReadyMs) {
      assertChrome();
      try { app = JSON.parse(await cdp.eval(JS.appState)); } catch (_) { app = null; }
      if (app && (/accounts\.google\.com/.test(app.url) || app.signIn)) { emit({ type: 'auth_required', url: app.url }); throw fail('AUTH_REQUIRED', 'Earth Studio needs a Google sign-in in the automation browser profile', { url: app.url }); }
      if (app && (app.importCard || app.hasScene || app.hasFileMenu)) break;
      await delay(1000);
    }
    if (!app || !(app.importCard || app.hasScene || app.hasFileMenu)) throw fail('LAUNCH_FAILED', `Earth Studio did not become ready within ${Math.round(o.appReadyMs / 1000)} s (${app ? app.url : 'no page'})`);
    emit({ type: 'app_ready', url: app.url });
    await delay(2500);
    // import
    emit({ type: 'importing', esp: espPath });
    try { await gate.importEsp(cdp, espPath); } catch (e) { throw fail('IMPORT_FAILED', `Earth Studio import failed: ${e.message}`); }
    const project = await gate.projectInfo(cdp);
    if (project.duration !== expected.last - expected.first) throw fail('PROJECT_MISMATCH', `Earth Studio project duration ${project.duration} ≠ planned ${expected.last - expected.first} frames`, { project });
    emit({ type: 'imported', project });
    // render dialog
    if (!(await cdp.eval(JS.clickRender))) throw fail('RENDER_DIALOG_FAILED', 'Render button not found');
    let dialog = null; const tDlg = Date.now();
    while (Date.now() - tDlg < o.dialogMs) { dialog = JSON.parse(await cdp.eval(JS.dialogState)); if (dialog.open && dialog.hasDestinationButton) break; await delay(300); }
    if (!dialog || !dialog.open) throw fail('RENDER_DIALOG_FAILED', 'Render dialog did not open');
    if (!dialog.hasDestinationButton) throw fail('RENDER_DIALOG_FAILED', 'destination button not found in the render dialog');
    if (dialog.remembered) {
      // never reuse another job's directory: clear it and pick ours
      emit({ type: 'destination_cleared', remembered: dialog.remembered });
      if (!(await cdp.eval(JS.clearRemembered))) throw fail('RENDER_DIALOG_FAILED', `Earth Studio remembers destination "${dialog.remembered}" and it could not be cleared`);
      const tClr = Date.now();
      while (Date.now() - tClr < o.dialogMs) { dialog = JSON.parse(await cdp.eval(JS.dialogState)); if (dialog.hasChoose) break; await delay(250); }
      if (!dialog.hasChoose) throw fail('RENDER_DIALOG_FAILED', `Earth Studio still shows destination "${dialog.remembered}" after clearing it`);
    }
    if (dialog.local !== true) throw fail('RENDER_DIALOG_FAILED', 'local image-sequence render is not selected');
    const range = dialog.numbers.slice(0, 2).map(Number);
    if (range[0] !== expected.first || range[1] !== expected.last) throw fail('PROJECT_MISMATCH', `Earth Studio offers frames ${range[0]}..${range[1]}, expected ${expected.first}..${expected.last}`, { dialog });
    if (expected.width && expected.height && (dialog.width !== expected.width || dialog.height !== expected.height)) throw fail('PROJECT_MISMATCH', `Earth Studio dimensions ${dialog.width}×${dialog.height} ≠ planned ${expected.width}×${expected.height}`, { dialog });
    result.render_name = dialog.name || 'earth-studio';
    if (!(await cdp.eval(JS.clickChoose))) throw fail('RENDER_DIALOG_FAILED', 'Choose folder button not found');
    const tPick = Date.now(); let dest = null;
    while (Date.now() - tPick < o.dialogMs) { dest = await cdp.eval(JS.destinationText); if (dest) break; await delay(250); }
    if (!dest) throw fail('RENDER_DIALOG_FAILED', 'Earth Studio did not accept the export destination');
    const start = JSON.parse(await cdp.eval(JS.startRect));
    if (!start || start.disabled) throw fail('RENDER_DIALOG_FAILED', 'Start button not available');
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: start.x, y: start.y, button: 'left', clickCount: 1 });
    emit({ type: 'export_started', render_name: result.render_name, destination: dest, first: expected.first, last: expected.last, expected_count: expected.last - expected.first + 1 });
    // pull loop
    const footagePrefix = `${result.render_name}/footage/`;
    const pulled = new Set(); let lastProgressAt = Date.now(); let lastReported = null; let finished = false;
    while (true) {
      assertChrome();
      const prog = JSON.parse(await cdp.eval(JS.progress));
      const closedFootage = prog.closed.filter((n) => n.startsWith(footagePrefix) && !pulled.has(n));
      // pull finished frames in batches (bounded payload per CDP message)
      for (let i = 0; i < closedFootage.length; i += PULL_BATCH) {
        const batch = closedFootage.slice(i, i + PULL_BATCH);
        const got = JSON.parse(await cdp.eval(JS.pullMany(batch.map((rel) => `${exportDirName}/${rel}`)), 120000));
        for (const [fullRel, b64] of got) {
          const rel = fullRel.slice(exportDirName.length + 1); const base = path.basename(rel);
          const buf = Buffer.from(b64, 'base64');
          if (!buf.length) throw fail('EMPTY_FRAME', `Earth Studio produced an empty file: ${rel}`);
          writeAtomic(path.join(framesDir, base), buf);
          pulled.add(rel); result.files += 1; result.bytes += buf.length; lastProgressAt = Date.now();
          if (!result.first_name) result.first_name = base; result.last_name = base;
          emit({ type: 'frame', name: base, files: result.files, bytes: buf.length, rendered_reported: prog.rendered, total_reported: prog.total, remaining_text: prog.remaining });
        }
        await cdp.eval(JS.removeMany(got.map(([fullRel]) => fullRel)));
      }
      if (prog.rendered != null && prog.rendered !== lastReported) { lastReported = prog.rendered; lastProgressAt = Date.now(); result.rendered_reported = prog.rendered; result.total_reported = prog.total; emit({ type: 'progress', rendered: prog.rendered, total: prog.total, remaining_text: prog.remaining, files: result.files }); }
      const expectedCount = expected.last - expected.first + 1;
      if (!prog.rendering && result.files >= expectedCount) { finished = true; break; }
      if (!prog.rendering && result.files > 0 && prog.closed.filter((n) => n.startsWith(footagePrefix)).length === pulled.size && Date.now() - lastProgressAt > 15000) {
        // the app left the render UI but produced fewer frames than expected
        throw fail('EXPORT_INCOMPLETE', `Earth Studio finished with ${result.files} of ${expectedCount} frames`, { files: result.files });
      }
      if (Date.now() - lastProgressAt > o.stallMs) throw fail('EXPORT_STALLED', `no Earth Studio progress for ${Math.round(o.stallMs / 1000)} s (${result.files} of ${expectedCount} frames on disk)`, { files: result.files });
      if (closedFootage.length < PULL_BATCH) await delay(o.pollMs); // keep draining while Earth Studio is ahead of us
    }
    // provenance: attribution + Earth Studio's own copies of the project/tracking data
    if (metaDir) {
      try {
        // ImagerySources.txt is written last; give Earth Studio a moment to flush it
        let names = JSON.parse(await cdp.eval(JS.list(exportDirName)));
        for (let i = 0; i < 10 && !names.some((n) => /ImagerySources\.txt$/i.test(n)); i += 1) { await delay(500); names = JSON.parse(await cdp.eval(JS.list(exportDirName))); }
        for (const rel of names) {
          if (rel.includes('/footage/')) continue;
          const target = path.join(metaDir, path.basename(rel));
          const b64 = await cdp.eval(JS.pull(rel), 30000);
          fs.writeFileSync(target, Buffer.from(b64, 'base64'));
          result.meta_files.push(path.basename(rel));
          if (/ImagerySources\.txt$/i.test(rel)) result.imagery_sources = fs.readFileSync(target, 'utf8').trim();
        }
      } catch (e) { emit({ type: 'meta_warning', message: e.message }); }
    }
    await cdp.eval(JS.removeTree(exportDirName)).catch(() => {});
    result.app_exceptions = exceptions;
    result.ok = finished;
    result.elapsed_s = Math.round((Date.now() - t0) / 100) / 10;
    emit({ type: 'export_finished', files: result.files, bytes: result.bytes, elapsed_s: result.elapsed_s, rendered_reported: result.rendered_reported });
    return result;
  } finally {
    if (cdp) cdp.close();
    if (chrome && !keepChrome) killChrome(chrome);
  }
}

module.exports = { EARTH_STUDIO_URL, DEFAULTS, runNativeExport, pickerShim, _internals: { JS, writeAtomic, pullFile, LIVE_CHROMES } };
