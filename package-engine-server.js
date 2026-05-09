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
const SERVE_ROOT = ROOT;
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_THUMBNAIL_PROVIDER = 'placeholder';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_OPENAI_IMAGE_SIZE = '1536x1024';
const DEFAULT_OPENAI_IMAGE_QUALITY = 'auto';
const DEFAULT_OPENAI_IMAGE_FORMAT = 'png';

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
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const thumbnailResponse = await createThumbnailResponse(payload);
          send(res, 200, thumbnailResponse);
        } catch (error) {
          send(res, error.statusCode || 500, { error: error.message });
        }
      });
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
  STATUS_API,
  buildOpenAIImageRequest,
  buildOpenAIThumbnailPrompts,
  createCandidates,
  createOpenAIThumbnailCandidates,
  createServer,
  createStatusResponse,
  createThumbnailResponse,
  imageMimeType,
  makeDataUrl,
  providerConfig,
  safeJoin,
  slugify,
};
