'use strict';
// Minimal Chrome DevTools Protocol client for source-specific capture. Every
// browser session is an isolated headless Chrome with its own temporary
// profile (never a human's browser, never the operator's display).
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const CHROME_BIN = process.env.SCREEN_CAPTURE_CHROME_BIN || '/usr/bin/google-chrome';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function getJson(url) { return new Promise((res, rej) => { http.get(url, (s) => { let b = ''; s.on('data', (c) => { b += c; }); s.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
function freePort() { return new Promise((resolve, reject) => { const p = net.createServer(); p.on('error', reject); p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); }); }

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 1; this.pending = new Map(); this.handlers = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.method) this.handlers.forEach((h) => h(m)); if (!m.id) return; const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result || {}); }); }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}) { const id = this.id++; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async eval(expression, timeout = 10000) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout }); if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.text}`); return r.result ? r.result.value : undefined; }
  close() { try { this.ws.close(); } catch (_) {} }
}

// Launches an isolated headless Chrome (fresh temp profile under profileRoot).
async function launch({ profileRoot, width = 1280, height = 720, timeoutMs = 20000 }) {
  if (!fs.existsSync(CHROME_BIN)) throw Object.assign(new Error(`Chrome binary not found at ${CHROME_BIN}`), { code: 'SOURCE_UNAVAILABLE' });
  fs.mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
  const profile = fs.mkdtempSync(path.join(profileRoot, 'capture-profile-'));
  const port = await freePort();
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-features=Translate,MediaRouter,OptimizationHints', `--window-size=${width},${height}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', 'about:blank'];
  const chrome = childProcess.spawn(CHROME_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, HOME: profile, LANG: 'C.UTF-8' } });
  let stderr = ''; chrome.stderr.setEncoding('utf8'); chrome.stderr.on('data', (c) => { stderr += c.slice(0, 2000); });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { try { await getJson(`http://127.0.0.1:${port}/json/version`); break; } catch (_) { if (chrome.exitCode !== null) throw Object.assign(new Error(`chrome exited: ${stderr.slice(-400)}`), { code: 'CAPTURE_FAILED' }); await delay(100); } }
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw Object.assign(new Error('no page target'), { code: 'CAPTURE_FAILED' });
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  const close = () => { cdp.close(); try { chrome.kill('SIGKILL'); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} };
  return { cdp, chrome, port, profile, close };
}

module.exports = { CHROME_BIN, Cdp, launch, delay, getJson };
