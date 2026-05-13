#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8010);
const HOST = process.env.HOST || '127.0.0.1';
const API_PREFIX = '/api/package-engine/thumbnails';
const STATUS_API = '/api/package-engine/status';
const CAPTURE_EVIDENCE_PREVIEW_API = '/api/package-runs/capture-evidence/preview';
const CAPTURE_EVIDENCE_APPLY_API = '/api/package-runs/capture-evidence/apply';
const SERVE_ROOT = ROOT;
const PACKAGE_RUNS_DIR = 'package-runs';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_THUMBNAIL_PROVIDER = 'placeholder';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_OPENAI_IMAGE_SIZE = '1536x1024';
const DEFAULT_OPENAI_IMAGE_QUALITY = 'auto';
const DEFAULT_OPENAI_IMAGE_FORMAT = 'png';
const CAPTURE_EVIDENCE_TARGETS = [
  'takes-log.md',
  'screen-recording-checklist.md',
  'audio-capture-checklist.md',
];
const CAPTURE_EVIDENCE_AUDIT_FILE = 'capture-evidence-intake-log.md';
const CAPTURE_EVIDENCE_SECTION_START = '<!-- capture-evidence-intake:start -->';
const CAPTURE_EVIDENCE_SECTION_END = '<!-- capture-evidence-intake:end -->';
const LOCAL_WRITE_NONCE = crypto.randomBytes(24).toString('hex');
const LOCAL_WRITE_NONCE_HEADER = 'x-vidtoolz-local-write-nonce';

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadPackageCandidates() {
  const candidatesPath = path.join(ROOT, 'package-candidates.json');
  if (fs.existsSync(candidatesPath)) {
    return readJsonFile(candidatesPath);
  }
  return null;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const normalized = path.posix.normalize(decoded).replace(/^([.]{2}[\/])+/, '');
  const joined = path.join(root, normalized);
  if (!joined.startsWith(root)) return null;
  return joined;
}

function inferMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function slugify(value) {
  return String(value || 'thumbnail')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'thumbnail';
}

function makeDataUrl(label, idx) {
  const seed = crypto.createHash('sha1').update(`${label}:${idx}`).digest('hex').slice(0, 10);
  const hue = parseInt(seed.slice(0, 2), 16) % 360;
  const hue2 = (hue + 40) % 360;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="hsl(${hue} 75% 18%)"/>
          <stop offset="100%" stop-color="hsl(${hue2} 78% 52%)"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#g)"/>
      <rect x="72" y="72" width="1136" height="576" rx="36" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.24)"/>
      <text x="96" y="190" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700">${escapeXml(label)}</text>
      <text x="96" y="270" fill="#dbeafe" font-family="Arial, Helvetica, sans-serif" font-size="30">Generated thumbnail ${idx + 1}</text>
      <text x="96" y="340" fill="#bfdbfe" font-family="Arial, Helvetica, sans-serif" font-size="24">gpt-image-2</text>
    </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownCell(value = '') {
  return String(value || '').trim().replace(/\r?\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ');
}

function captureEvidenceInputDefaults() {
  return {
    takeName: '',
    takeSource: '',
    takeReference: '',
    takeNotes: '',
    screenName: '',
    screenPurpose: '',
    screenReference: '',
    audioItem: '',
    audioRequirement: '',
    audioReference: '',
  };
}

function normalizeCaptureEvidenceFields(fields = {}) {
  const defaults = captureEvidenceInputDefaults();
  return Object.keys(defaults).reduce((result, key) => {
    result[key] = markdownCell(fields[key]);
    return result;
  }, {});
}

function missingRequiredCaptureFields(fields = {}) {
  const values = normalizeCaptureEvidenceFields(fields);
  const missing = [];
  if (!values.takeName) missing.push('take name');
  if (!values.takeReference) missing.push('take media reference');
  if (!values.screenName) missing.push('screen recording name');
  if (!values.screenReference) missing.push('screen recording file/reference');
  if (!values.audioItem) missing.push('audio item');
  if (!values.audioReference) missing.push('audio file/reference');
  return missing;
}

function formatCaptureEvidenceRows(fields = {}) {
  const input = normalizeCaptureEvidenceFields({ ...captureEvidenceInputDefaults(), ...fields });
  const missing = missingRequiredCaptureFields(input);
  const takeSource = input.takeSource || 'shot-list.md';
  const takeNotes = input.takeNotes || 'Human-reviewed captured take; add quality notes, timestamp, or issue.';
  const screenPurpose = input.screenPurpose || 'Capture proof for the approved production plan.';
  const audioRequirement = input.audioRequirement || 'Final script narration or A-roll audio.';
  return {
    valid: missing.length === 0,
    missing,
    targets: {
      'takes-log.md': `| ${input.takeName} | ${takeSource} | ${input.takeReference} | ${takeNotes} | captured |`,
      'screen-recording-checklist.md': `| ${input.screenName} | ${screenPurpose} | ${input.screenReference} | captured |`,
      'audio-capture-checklist.md': `| ${input.audioItem} | ${audioRequirement} | ${input.audioReference} | recorded |`,
    },
  };
}

function validateCaptureEvidenceRunId(runId) {
  const normalized = String(runId || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    const error = new Error('Invalid package-run id.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function validateCaptureEvidenceTargets(targets = CAPTURE_EVIDENCE_TARGETS) {
  const requested = Array.isArray(targets) && targets.length ? targets : CAPTURE_EVIDENCE_TARGETS;
  const unique = [...new Set(requested.map((target) => String(target || '').trim()))];
  const invalid = unique.filter((target) => !CAPTURE_EVIDENCE_TARGETS.includes(target));
  if (invalid.length) {
    const error = new Error(`Unapproved capture evidence target: ${invalid[0]}`);
    error.statusCode = 400;
    throw error;
  }
  return unique;
}

function resolvePackageRunDir(runId, options = {}) {
  const root = path.resolve(options.root || ROOT);
  const runsRoot = path.resolve(root, PACKAGE_RUNS_DIR);
  const safeRunId = validateCaptureEvidenceRunId(runId);
  const runDir = path.resolve(runsRoot, safeRunId);
  if (!runDir.startsWith(runsRoot + path.sep)) {
    const error = new Error('Package-run path escaped package-runs.');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    const error = new Error('Package-run folder does not exist.');
    error.statusCode = 404;
    throw error;
  }
  return { root, runsRoot, runId: safeRunId, runDir };
}

function conservativeHeadingForTarget(filename) {
  const titles = {
    'takes-log.md': 'Takes Log',
    'screen-recording-checklist.md': 'Screen Recording Checklist',
    'audio-capture-checklist.md': 'Audio Capture Checklist',
  };
  return `# ${titles[filename] || filename}\n\nGenerated intake rows are local notes only. They do not approve capture evidence.\n`;
}

function markedCaptureEvidenceSection(row) {
  return [
    CAPTURE_EVIDENCE_SECTION_START,
    '| item | source / purpose | file/reference | notes | status |',
    '| --- | --- | --- | --- | --- |',
    row,
    CAPTURE_EVIDENCE_SECTION_END,
    '',
  ].join('\n');
}

function replaceMarkedSection(existing, section) {
  const start = existing.indexOf(CAPTURE_EVIDENCE_SECTION_START);
  const end = existing.indexOf(CAPTURE_EVIDENCE_SECTION_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start).replace(/\s*$/, '\n\n');
    const after = existing.slice(end + CAPTURE_EVIDENCE_SECTION_END.length).replace(/^\s*/, '\n');
    return `${before}${section}${after}`.replace(/\n{4,}/g, '\n\n\n');
  }
  return `${existing.replace(/\s*$/, '')}\n\n${section}`;
}

function buildCaptureEvidencePreview(payload = {}, options = {}) {
  const { runId, runDir } = resolvePackageRunDir(payload.runId, options);
  const targets = validateCaptureEvidenceTargets(payload.targets);
  const fields = normalizeCaptureEvidenceFields(payload.fields || payload);
  const rows = formatCaptureEvidenceRows(fields);
  if (!rows.valid) {
    const error = new Error(`Missing required capture evidence fields: ${rows.missing.join(', ')}.`);
    error.statusCode = 400;
    error.missing = rows.missing;
    throw error;
  }
  const sections = targets.reduce((result, filename) => {
    result[filename] = markedCaptureEvidenceSection(rows.targets[filename]);
    return result;
  }, {});
  const previewToken = crypto
    .createHash('sha256')
    .update(JSON.stringify({ runId, fields, targets, sections }))
    .digest('hex');
  return {
    ok: true,
    mode: 'preview',
    runId,
    runPath: `${PACKAGE_RUNS_DIR}/${runId}`,
    runDir,
    targets,
    fields,
    sections,
    previewToken,
    warning: 'Preview only. No files were written. Applying rows does not approve capture evidence.',
  };
}

function applyCaptureEvidenceIntake(payload = {}, options = {}) {
  const preview = buildCaptureEvidencePreview(payload, options);
  if (payload.confirmApply !== true || payload.previewToken !== preview.previewToken) {
    const error = new Error('Apply requires confirmApply: true and the matching previewToken.');
    error.statusCode = 400;
    throw error;
  }
  const allowedPaths = new Set([
    ...CAPTURE_EVIDENCE_TARGETS.map((filename) => path.resolve(preview.runDir, filename)),
    path.resolve(preview.runDir, CAPTURE_EVIDENCE_AUDIT_FILE),
  ]);
  const written = [];
  preview.targets.forEach((filename) => {
    const targetPath = path.resolve(preview.runDir, filename);
    if (!allowedPaths.has(targetPath) || !targetPath.startsWith(preview.runDir + path.sep)) {
      const error = new Error('Resolved target is outside the approved write scope.');
      error.statusCode = 400;
      throw error;
    }
    const existing = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf8')
      : conservativeHeadingForTarget(filename);
    const next = replaceMarkedSection(existing, preview.sections[filename]);
    fs.writeFileSync(targetPath, next, 'utf8');
    written.push(filename);
  });
  const auditPath = path.resolve(preview.runDir, CAPTURE_EVIDENCE_AUDIT_FILE);
  if (!allowedPaths.has(auditPath)) {
    const error = new Error('Resolved audit path is outside the approved write scope.');
    error.statusCode = 400;
    throw error;
  }
  const timestamp = new Date().toISOString();
  const auditEntry = [
    `## ${timestamp}`,
    '',
    `- Run: ${preview.runId}`,
    `- Tool: package-runs dashboard capture evidence intake`,
    '- External APIs called: no',
    `- Target files: ${preview.targets.join(', ')}`,
    '- Approval written: no',
    '',
    '| field | value |',
    '| --- | --- |',
    ...Object.entries(preview.fields).map(([key, value]) => `| ${key} | ${value || 'not provided'} |`),
    '',
  ].join('\n');
  const auditExisting = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8').replace(/\s*$/, '\n\n')
    : '# Capture Evidence Intake Log\n\n';
  fs.writeFileSync(auditPath, `${auditExisting}${auditEntry}`, 'utf8');
  written.push(CAPTURE_EVIDENCE_AUDIT_FILE);
  return {
    ok: true,
    mode: 'apply',
    runId: preview.runId,
    runPath: preview.runPath,
    written,
    previewToken: preview.previewToken,
    warning: 'Rows were written locally. Capture evidence is not approved until the review gate passes.',
    nextCommands: [
      `node scripts/package-run-capture-evidence-review.js ${preview.runPath} --overwrite`,
      'node scripts/package-runs-index.js',
    ],
  };
}

function localWriteNonce() {
  return LOCAL_WRITE_NONCE;
}

function isAllowedLocalHost(value = '', port = PORT) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function isAllowedLocalOrigin(value = '', port = PORT) {
  if (!value) return true;
  try {
    const origin = new URL(value);
    return origin.protocol === 'http:' && isAllowedLocalHost(origin.host, port);
  } catch {
    return false;
  }
}

function validateLocalWriteRequest(req, payload = {}, options = {}) {
  const port = options.port || PORT;
  const nonce = options.writeNonce || LOCAL_WRITE_NONCE;
  const host = req && req.headers ? req.headers.host : '';
  const origin = req && req.headers ? req.headers.origin : '';
  if (!isAllowedLocalHost(host, port)) {
    const error = new Error('Capture evidence write API requires a local Host header.');
    error.statusCode = 403;
    throw error;
  }
  if (!isAllowedLocalOrigin(origin, port)) {
    const error = new Error('Capture evidence write API rejects non-local Origin headers.');
    error.statusCode = 403;
    throw error;
  }
  const providedNonce =
    (req && req.headers && req.headers[LOCAL_WRITE_NONCE_HEADER]) ||
    payload.localWriteNonce ||
    payload.writeNonce ||
    payload.nonce ||
    '';
  if (providedNonce !== nonce) {
    const error = new Error('Capture evidence write API requires a valid local write nonce.');
    error.statusCode = 403;
    throw error;
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function createCandidates(payload) {
  const title = payload.topic || payload.thumbnailConcept || payload.viewerPromise || 'VIDTOOLZ thumbnail';
  return Array.from({ length: Number(payload.count || 3) }, (_, idx) => {
    const label = `${title} variation ${idx + 1}`;
    return {
      id: `${slugify(title)}-${idx + 1}`,
      label,
      prompt: `${payload.thumbnailConcept || title} / ${payload.onThumbnailText || ''}`.trim(),
      creator: 'placeholder-svg',
      thumbnailImage: makeDataUrl(label, idx),
    };
  });
}

function providerConfig(env = process.env) {
  return {
    provider: String(env.THUMBNAIL_PROVIDER || DEFAULT_THUMBNAIL_PROVIDER).toLowerCase(),
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL,
    size: env.OPENAI_IMAGE_SIZE || DEFAULT_OPENAI_IMAGE_SIZE,
    quality: env.OPENAI_IMAGE_QUALITY || DEFAULT_OPENAI_IMAGE_QUALITY,
    outputFormat: env.OPENAI_IMAGE_FORMAT || DEFAULT_OPENAI_IMAGE_FORMAT,
  };
}

function createStatusResponse(env = process.env) {
  const config = providerConfig(env);
  return {
    ok: true,
    thumbnailProvider: config.provider,
    model: config.provider === 'openai' ? config.model : 'local-svg-placeholder',
    api: API_PREFIX,
    captureEvidenceWrite: {
      previewApi: CAPTURE_EVIDENCE_PREVIEW_API,
      applyApi: CAPTURE_EVIDENCE_APPLY_API,
      nonceHeader: LOCAL_WRITE_NONCE_HEADER,
      localWriteNonce: LOCAL_WRITE_NONCE,
      allowedHosts: [`127.0.0.1:${PORT}`, `localhost:${PORT}`],
      missingOriginAllowed: true,
    },
  };
}

function imageMimeType(format = DEFAULT_OPENAI_IMAGE_FORMAT) {
  const normalized = String(format || DEFAULT_OPENAI_IMAGE_FORMAT).toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  return 'image/png';
}

function buildOpenAIThumbnailPrompts(payload) {
  const topic = payload.topic || 'VIDTOOLZ thumbnail';
  const concept = payload.thumbnailConcept || topic;
  const onThumbnailText = payload.onThumbnailText || 'Clear creator decision';
  const viewerPromise = payload.viewerPromise || 'Help serious solo creators make better production decisions';
  const targetViewer = payload.targetViewer || 'serious solo creators using AI workflow tools';
  const baseRules = [
    '16:9 YouTube thumbnail composition, landscape frame.',
    'Bold readable title text, high contrast, one clear visual idea.',
    'Practical VIDTOOLZ style: serious solo creator, AI workflow, production decision-making.',
    'No fake logos, no celebrity or public figure likeness, no misleading screenshot claims.',
    'Make the image feel useful, grounded, and production-focused rather than hype-driven.',
  ].join(' ');
  const angles = [
    'Show a solo creator comparing competing video ideas before committing to production.',
    'Show a clear before/after decision board where weak AI suggestions become a stronger video package.',
    'Show a focused creator rejecting noisy AI outputs and choosing one practical thumbnail/title direction.',
  ];

  return angles.map((angle, idx) => [
    `${baseRules}`,
    `Topic: ${topic}.`,
    `Thumbnail concept: ${concept}.`,
    `On-thumbnail text: "${onThumbnailText}".`,
    `Viewer promise: ${viewerPromise}.`,
    `Target viewer: ${targetViewer}.`,
    `Variation ${idx + 1}: ${angle}`,
  ].join(' '));
}

function buildOpenAIImageRequest(prompt, config) {
  const body = {
    model: config.model,
    prompt,
    n: 1,
    size: config.size,
  };

  if (config.model.startsWith('gpt-image')) {
    body.quality = config.quality;
    body.output_format = config.outputFormat;
  } else {
    body.response_format = 'b64_json';
  }

  return body;
}

function normalizeOpenAIImageResponse(data, prompt, idx, config, payload) {
  const image = data && Array.isArray(data.data) ? data.data[0] : null;
  if (!image) {
    throw new Error('OpenAI image generation returned no image data.');
  }
  const b64 = image.b64_json || image.b64;
  const url = image.url || '';
  const thumbnailImage = b64 ? `data:${imageMimeType(config.outputFormat)};base64,${b64}` : url;
  if (!thumbnailImage) {
    throw new Error('OpenAI image generation returned an unsupported response shape.');
  }
  const title = payload.topic || payload.thumbnailConcept || 'VIDTOOLZ thumbnail';
  return {
    id: `${slugify(title)}-openai-${idx + 1}`,
    label: `${title} OpenAI draft ${idx + 1}`,
    prompt,
    creator: `OpenAI / ${config.model}`,
    thumbnailImage,
  };
}

async function createOpenAIThumbnailCandidates(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  if (!config.apiKey) {
    const error = new Error('OPENAI_API_KEY is required when THUMBNAIL_PROVIDER=openai.');
    error.statusCode = 400;
    throw error;
  }
  const fetchImpl = options.fetchImpl || fetch;
  const prompts = buildOpenAIThumbnailPrompts(payload).slice(0, Number(payload.count || 3));
  const candidates = [];

  // TODO: Persist generated image files under package-runs/<run-id>/thumbnail-candidates/.
  for (const [idx, prompt] of prompts.entries()) {
    const response = await fetchImpl(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildOpenAIImageRequest(prompt, config)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message ? data.error.message : `OpenAI image generation failed (${response.status}).`;
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }
    candidates.push(normalizeOpenAIImageResponse(data, prompt, idx, config, payload));
  }

  return candidates;
}

async function createThumbnailResponse(payload, options = {}) {
  const config = options.config || providerConfig(options.env || process.env);
  if (config.provider === 'placeholder') {
    return {
      provider: 'placeholder',
      model: 'local-svg-placeholder',
      candidates: createCandidates(payload),
    };
  }
  if (config.provider === 'openai') {
    return {
      provider: 'openai',
      model: config.model,
      candidates: await createOpenAIThumbnailCandidates(payload, { ...options, config }),
    };
  }
  const error = new Error(`Unsupported THUMBNAIL_PROVIDER: ${config.provider}`);
  error.statusCode = 400;
  throw error;
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === STATUS_API) {
      send(res, 200, createStatusResponse());
      return;
    }

    if (req.method === 'POST' && url.pathname === API_PREFIX) {
      readJsonBody(req).then(async (payload) => {
        try {
          const thumbnailResponse = await createThumbnailResponse(payload);
          send(res, 200, thumbnailResponse);
        } catch (error) {
          send(res, error.statusCode || 500, { error: error.message });
        }
      }).catch((error) => send(res, error.statusCode || 500, { error: error.message }));
      return;
    }

    if (req.method === 'POST' && url.pathname === CAPTURE_EVIDENCE_PREVIEW_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, buildCaptureEvidencePreview(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === CAPTURE_EVIDENCE_APPLY_API) {
      readJsonBody(req)
        .then((payload) => {
          validateLocalWriteRequest(req, payload);
          send(res, 200, applyCaptureEvidenceIntake(payload));
        })
        .catch((error) => send(res, error.statusCode || 500, { error: error.message, missing: error.missing || [] }));
      return;
    }

    const filePath = safeJoin(SERVE_ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!filePath) {
      send(res, 403, 'Forbidden');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err) {
        send(res, 404, 'Not found');
        return;
      }
      if (stats.isDirectory()) {
        const index = path.join(filePath, 'index.html');
        if (fs.existsSync(index)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          fs.createReadStream(index).pipe(res);
          return;
        }
        send(res, 404, 'Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': inferMime(filePath), 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

if (require.main === module) {
  const server = createServer();

  server.listen(PORT, HOST, () => {
    console.log(`VIDTOOLZ Episode Factory server running at http://${HOST}:${PORT}/`);
    console.log(`Package Engine running at http://${HOST}:${PORT}/package-engine.html`);
  });
}

module.exports = {
  API_PREFIX,
  CAPTURE_EVIDENCE_APPLY_API,
  CAPTURE_EVIDENCE_PREVIEW_API,
  CAPTURE_EVIDENCE_AUDIT_FILE,
  CAPTURE_EVIDENCE_TARGETS,
  LOCAL_WRITE_NONCE_HEADER,
  STATUS_API,
  applyCaptureEvidenceIntake,
  buildCaptureEvidencePreview,
  buildOpenAIImageRequest,
  buildOpenAIThumbnailPrompts,
  captureEvidenceInputDefaults,
  createCandidates,
  createOpenAIThumbnailCandidates,
  createServer,
  createStatusResponse,
  createThumbnailResponse,
  imageMimeType,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  localWriteNonce,
  makeDataUrl,
  missingRequiredCaptureFields,
  providerConfig,
  safeJoin,
  slugify,
  validateCaptureEvidenceRunId,
  validateCaptureEvidenceTargets,
  validateLocalWriteRequest,
};
