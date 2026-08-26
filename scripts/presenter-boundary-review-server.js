'use strict';

/* Local-only operator surface. A random in-memory nonce protects writes; it is
 * never persisted. The configured human identity is still verified by the
 * estate verifier on every confirmation. */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const review = require('./presenter-boundary-review.js');

function atomicJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function send(res, status, value, type = 'application/json') {
  const body = type === 'application/json' ? JSON.stringify(value) : value;
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' }); res.end(body);
}
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', (c) => { body += c; if (body.length > 65536) reject(new Error('request too large')); }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function streamMedia(req, res, file) {
  const stat = fs.statSync(file); const range = req.headers.range;
  if (!range) { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': stat.size, 'accept-ranges': 'bytes' }); fs.createReadStream(file).pipe(res); return; }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) return send(res, 416, { error: 'invalid range' });
  const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (start > end || start >= stat.size) return send(res, 416, { error: 'range outside media' });
  res.writeHead(206, { 'content-type': 'video/mp4', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes' }); fs.createReadStream(file, { start, end }).pipe(res);
}

function createServer(options) {
  const sessionFile = path.resolve(options.sessionFile); const pageFile = path.join(__dirname, '..', 'presenter-boundary-review.html');
  let session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const initial = review.validateSession(session); if (!initial.ok) throw new Error(`invalid boundary session: ${JSON.stringify(initial.errors)}`);
  const nonce = options.nonce || crypto.randomBytes(24).toString('hex');
  const actor = { type: 'HUMAN', id: options.humanId };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(pageFile, 'utf8'), 'text/html');
      if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { ...session, write_nonce: nonce });
      if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
        const id = decodeURIComponent(url.pathname.slice('/media/'.length)); const master = session.masters.find((m) => m.master_id === id);
        if (!master || !master.path || !fs.existsSync(master.path)) return send(res, 404, { error: 'bound master unavailable' });
        return streamMedia(req, res, master.path);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['x-boundary-review-nonce'] !== nonce) return send(res, 403, { error: 'operator nonce required' });
        const body = await readBody(req);
        if (url.pathname === '/api/adjust') session = review.adjustBoundary(session, body);
        else if (url.pathname === '/api/reset') session = review.resetProposal(session, body.section_id);
        else if (url.pathname === '/api/confirm') session = review.confirmSection(session, { section_id: body.section_id, actor });
        else return send(res, 404, { error: 'unknown action' });
        atomicJson(sessionFile, session);
        const status = review.validateSession(session);
        if (status.ok && status.confirmed === status.total && status.total > 0) {
          const successor = review.buildSuccessorReview(session);
          atomicJson(path.resolve(options.successorReviewFile || path.join(path.dirname(sessionFile), 'HUMAN-REVIEW-PERFORMANCE-V2.json')), successor);
        }
        return send(res, 200, session);
      }
      return send(res, 404, { error: 'not found' });
    } catch (error) { return send(res, 400, { error: error.code || 'BOUNDARY_REVIEW_ERROR', detail: error.message }); }
  });
  return { server, nonce, getSession: () => session };
}

function main(argv = process.argv.slice(2)) {
  const sessionFile = argv[0]; let humanId = null; let port = 8787; let successorReviewFile = null;
  for (let i = 1; i < argv.length; i++) { if (argv[i] === '--human-id') humanId = argv[++i]; else if (argv[i] === '--port') port = Number(argv[++i]); else if (argv[i] === '--successor-review') successorReviewFile = argv[++i]; }
  if (!sessionFile || !humanId) { console.error('usage: presenter-boundary-review-server.js <session.json> --human-id <canonical-human-id> [--port 8787]'); return 2; }
  const local = createServer({ sessionFile, humanId, successorReviewFile });
  local.server.listen(port, '127.0.0.1', () => {
    console.log(`Boundary review: http://127.0.0.1:${port}/`);
    console.log('Local-only session ready. The write nonce remains in memory and is not logged.');
  });
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { atomicJson, createServer };
