#!/usr/bin/env node
'use strict';
// QUARANTINED 2026-09-08 (Resolve execution subsystem freeze, A2). This server writes a
// review store (HUMAN-EDITORIAL-VERDICTS.json) that is NOT a production review authority
// (vidtoolz.draftReview.v2 is). It must not start unless explicitly opted in.
if (process.env.VIDTOOLZ_EXPERIMENTAL_INSPECTOR !== '1') {
  console.error('directed-draft-inspector-server is QUARANTINED: experimental, non-authoritative review store. Set VIDTOOLZ_EXPERIMENTAL_INSPECTOR=1 to run deliberately.');
  process.exit(3);
}

/**
 * DIRECTED DRAFT REVIEW INSPECTOR SERVER
 * Local-only operator GUI on port 8095 (or PORT env).
 * Serves interactive inspection UI for all 6 generated directed drafts.
 * Supports:
 * - Full episode navigation across the 6 topics
 * - Side-by-side view: Script dialogue + Visual beat intent + Rendered 3D visual + Timing
 * - Full 1080x1920 mobile portrait preview with Shorts safe-zone overlay toggle
 * - Direct human editorial decision recording (KEEP / CHANGE / CUT / REWRITE)
 * - Timeline EDL inspection and Resolve track breakdown
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8095);
const HOST = '127.0.0.1';
const BATCH_ROOT = '/home/vidtoolz/outputs/autonomous-directed-draft-6-scripts-2026-09-05';
const VERDICTS_FILE = path.join(BATCH_ROOT, 'HUMAN-EDITORIAL-VERDICTS.json');

// Initialize verdicts file if absent
if (!fs.existsSync(VERDICTS_FILE)) {
  fs.writeFileSync(VERDICTS_FILE, JSON.stringify({
    recorded_at: new Date().toISOString(),
    evaluator: "Mikko Pakkala",
    verdicts: {}
  }, null, 2));
}

function loadBatchData() {
  const summaryPath = path.join(BATCH_ROOT, 'BATCH-METRICS.json');
  if (!fs.existsSync(summaryPath)) {
    return { episodes: [] };
  }
  const metrics = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const episodes = [];

  for (const ep of metrics.episodes) {
    const planPath = path.join(ep.package_path, 'VISUAL-PLAN.json');
    const timelinePath = path.join(ep.package_path, 'timeline', 'timeline.json');
    if (fs.existsSync(planPath)) {
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      const timeline = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, 'utf8')) : null;
      episodes.push({
        topic: ep.topic,
        title: ep.title,
        beats_count: ep.beats_count,
        estimated_duration_s: ep.estimated_duration_s,
        package_path: ep.package_path,
        plan: plan,
        timeline: timeline
      });
    }
  }
  return { metrics, episodes };
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.json') return 'application/json';
  if (ext === '.html') return 'text/html';
  if (ext === '.css') return 'text/css';
  if (ext === '.js') return 'application/javascript';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // API: Get batch manifest & state
  if (url.pathname === '/api/data') {
    const data = loadBatchData();
    const verdicts = fs.existsSync(VERDICTS_FILE) ? JSON.parse(fs.readFileSync(VERDICTS_FILE, 'utf8')) : { verdicts: {} };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...data, verdicts: verdicts.verdicts }));
    return;
  }

  // API: Record editorial verdict
  if (url.pathname === '/api/verdict' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { topic, beat_id, verdict, notes } = payload;
        const verdictsData = fs.existsSync(VERDICTS_FILE) ? JSON.parse(fs.readFileSync(VERDICTS_FILE, 'utf8')) : { verdicts: {} };
        const key = `${topic}_${beat_id}`;
        verdictsData.verdicts[key] = {
          topic,
          beat_id,
          verdict, // KEEP | CHANGE | CUT | REWRITE
          notes: notes || "",
          timestamp: new Date().toISOString()
        };
        fs.writeFileSync(VERDICTS_FILE, JSON.stringify(verdictsData, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, key, record: verdictsData.verdicts[key] }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Media asset serving
  if (url.pathname.startsWith('/video/')) {
    const filename = decodeURIComponent(url.pathname.slice('/video/'.length));
    const videoDir = '/home/vidtoolz/outputs/draft-videos-6-scripts-2026-09-05';
    const fullPath = path.join(videoDir, filename);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      fs.createReadStream(fullPath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end('Video Not Found');
    return;
  }

  // Media asset serving
  if (url.pathname.startsWith('/asset/')) {
    const relPath = decodeURIComponent(url.pathname.slice('/asset/'.length));
    const fullPath = path.resolve(BATCH_ROOT, relPath);
    if (!fullPath.startsWith(BATCH_ROOT + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      res.writeHead(200, { 'Content-Type': getMime(fullPath), 'Cache-Control': 'no-cache' });
      fs.createReadStream(fullPath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  // GUI HTML Page
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtmlContent());
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

function getHtmlContent() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>VIDTOOLZ Directed Draft Inspector — 6 Batch Episodes</title>
  <style>
    :root {
      --bg: #0c0e12;
      --card-bg: #14171f;
      --border: #222734;
      --border-focus: #3b82f6;
      --text: #e2e8f0;
      --text-muted: #8492a6;
      --accent: #38bdf8;
      --keep: #10b981;
      --change: #f59e0b;
      --cut: #ef4444;
      --rewrite: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    /* Sidebar */
    #sidebar {
      width: 320px;
      background: #10131a;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }
    #sidebar-header {
      padding: 18px 16px;
      border-bottom: 1px solid var(--border);
    }
    #sidebar-header h1 {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.2px;
      margin-bottom: 4px;
    }
    #sidebar-header p {
      font-size: 12px;
      color: var(--text-muted);
    }
    #episodes-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px 8px;
    }
    .ep-item {
      padding: 12px 14px;
      border-radius: 6px;
      margin-bottom: 6px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .ep-item:hover {
      background: #181d28;
    }
    .ep-item.active {
      background: #1a2233;
      border-color: var(--accent);
    }
    .ep-badge {
      font-size: 10px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .ep-title {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.35;
      margin-bottom: 6px;
    }
    .ep-meta {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      gap: 10px;
    }
    /* Main Content */
    #main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #top-bar {
      height: 60px;
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #10131a;
    }
    #ep-info h2 {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
    }
    #ep-info span {
      font-size: 12px;
      color: var(--text-muted);
      margin-left: 10px;
    }
    .toggle-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .toggle-bar input { cursor: pointer; }
    /* Beats Grid */
    #beats-container {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .beat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      display: grid;
      grid-template-columns: 260px 1fr 280px;
      gap: 24px;
      position: relative;
    }
    /* Visual Preview Box */
    .preview-box {
      width: 100%;
      height: 380px;
      background: #000;
      border-radius: 6px;
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .preview-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .placeholder-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      text-align: center;
      color: #94a3b8;
    }
    .placeholder-box .icon {
      font-size: 32px;
      margin-bottom: 10px;
      color: #64748b;
    }
    .placeholder-box .pill {
      background: #1e293b;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      color: #38bdf8;
      margin-bottom: 8px;
    }
    /* Safe Zone Overlay */
    .safe-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: none;
    }
    .safe-overlay.active { display: block; }
    .overlay-top {
      position: absolute;
      top: 0; left: 0; right: 0; height: 12%;
      background: rgba(239, 68, 68, 0.25);
      border-bottom: 1px dashed rgba(239, 68, 68, 0.6);
      font-size: 9px; color: #fca5a5; padding: 4px;
    }
    .overlay-bottom {
      position: absolute;
      bottom: 0; left: 0; right: 0; height: 15%;
      background: rgba(239, 68, 68, 0.25);
      border-top: 1px dashed rgba(239, 68, 68, 0.6);
      font-size: 9px; color: #fca5a5; padding: 4px;
    }
    .overlay-right {
      position: absolute;
      top: 40%; bottom: 10%; right: 0; width: 14%;
      background: rgba(239, 68, 68, 0.25);
      border-left: 1px dashed rgba(239, 68, 68, 0.6);
      font-size: 9px; color: #fca5a5; padding: 4px; writing-mode: vertical-rl;
    }
    /* Narrative Center */
    .narrative-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .beat-header {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .beat-tag {
      font-weight: 700;
      color: #fff;
      background: #1e293b;
      padding: 3px 8px;
      border-radius: 4px;
    }
    .time-tag {
      color: var(--accent);
      font-family: monospace;
      font-weight: 600;
    }
    .func-tag {
      background: #172554;
      color: #60a5fa;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .autonomy-tag {
      background: #064e3b;
      color: #34d399;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .dialogue-box {
      background: #0f1219;
      border: 1px solid #1c2331;
      border-radius: 6px;
      padding: 14px 16px;
      font-size: 14px;
      line-height: 1.5;
      color: #f8fafc;
    }
    .concept-box {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .concept-box strong { color: #cbd5e1; }
    /* Decision Panel */
    .decision-col {
      background: #0f131a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .decision-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .verdict-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .v-btn {
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: #181d28;
      color: var(--text);
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
    }
    .v-btn:hover { background: #222938; }
    .v-btn.active-keep { background: #065f46; border-color: var(--keep); color: #34d399; }
    .v-btn.active-change { background: #78350f; border-color: var(--change); color: #fbbf24; }
    .v-btn.active-cut { background: #7f1d1d; border-color: var(--cut); color: #f87171; }
    .v-btn.active-rewrite { background: #581c87; border-color: var(--rewrite); color: #c084fc; }
    .notes-input {
      width: 100%;
      height: 64px;
      background: #080a0f;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: #fff;
      font-size: 12px;
      padding: 8px;
      resize: none;
      font-family: inherit;
    }
    .notes-input:focus { outline: none; border-color: var(--accent); }
    .status-receipt {
      font-size: 11px;
      color: #10b981;
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 16px;
    }
  </style>
</head>
<body>

  <!-- Sidebar -->
  <div id="sidebar">
    <div id="sidebar-header">
      <h1>Directed Draft Inspector</h1>
      <p>Option B Stage 6 — 6-Episode Review</p>
    </div>
    <div id="episodes-list"></div>
  </div>

  <!-- Main Body -->
  <div id="main">
    <div id="top-bar">
      <div id="ep-info">
        <h2 id="top-title">Select an episode</h2>
        <span id="top-meta"></span>
      </div>
      <div class="toggle-bar">
        <label>
          <input type="checkbox" id="safe-toggle" onchange="toggleSafeZones(this.checked)">
          Show Shorts Mobile Safe Zone Overlay
        </label>
      </div>
    </div>
    <div id="beats-container"></div>
  </div>

  <script>
    let BATCH_DATA = null;
    let ACTIVE_TOPIC = null;
    let SAFE_ZONES_ENABLED = false;

    async function loadData() {
      const res = await fetch('/api/data');
      BATCH_DATA = await res.json();
      renderSidebar();
      if (BATCH_DATA.episodes.length > 0) {
        selectEpisode(BATCH_DATA.episodes[0].topic);
      }
    }

    function renderSidebar() {
      const container = document.getElementById('episodes-list');
      container.innerHTML = '';
      BATCH_DATA.episodes.forEach(ep => {
        const div = document.createElement('div');
        div.className = 'ep-item' + (ep.topic === ACTIVE_TOPIC ? ' active' : '');
        div.onclick = () => selectEpisode(ep.topic);

        let reviewedCount = 0;
        ep.plan.beats.forEach(b => {
          if (BATCH_DATA.verdicts[\`\${ep.topic}_\${b.beat_id}\`]) reviewedCount++;
        });

        div.innerHTML = \`
          <div class="ep-badge">\${ep.topic}</div>
          <div class="ep-title">\${ep.title}</div>
          <div class="ep-meta">
            <span>\${ep.estimated_duration_s}s</span>
            <span>\${ep.beats_count} beats</span>
            <span style="color: \${reviewedCount === ep.beats_count ? '#34d399' : '#94a3b8'}">\${reviewedCount}/\${ep.beats_count} reviewed</span>
          </div>
        \`;
        container.appendChild(div);
      });
    }

    function selectEpisode(topic) {
      ACTIVE_TOPIC = topic;
      renderSidebar();
      const ep = BATCH_DATA.episodes.find(e => e.topic === topic);
      if (!ep) return;

      document.getElementById('top-title').textContent = ep.title;
      const vidMap = {
        'TOPIC-406': '406_B_topic-406_DRAFT.mp4',
        'TOPIC-053': '053_B_topic-053_DRAFT.mp4',
        'TOPIC-401': '401_B_topic-401_DRAFT.mp4',
        'TOPIC-022': '022_A_topic-022_DRAFT.mp4',
        'TOPIC-002': '002_B_topic-002_DRAFT.mp4',
        'TOPIC-410': '410_B_topic-410_DRAFT.mp4'
      };
      const vidFile = vidMap[ep.topic];
      document.getElementById('top-meta').innerHTML = \`\${ep.plan.spine} • \${ep.estimated_duration_s}s total (~(Math.round(ep.estimated_duration_s/6)/10) min) • <a href="/video/\${vidFile}" target="_blank" style="color: #38bdf8; font-weight: bold; text-decoration: underline; margin-left: 10px;">▶ Play Full Draft MP4</a>\`;

      const container = document.getElementById('beats-container');
      container.innerHTML = '';

      ep.plan.beats.forEach(b => {
        const vKey = \`\${ep.topic}_\${b.beat_id}\`;
        const vRec = BATCH_DATA.verdicts[vKey] || {};
        const card = document.createElement('div');
        card.className = 'beat-card';

        // 1. Preview Column
        let previewHtml = '';
        const videoName = \`\${ep.topic.replace(/\\s+/g, '_')}_\${ep.topic.toLowerCase().replace(/[^a-z0-9]/g, '-')}_DRAFT.mp4\`;
        if (b.materialization_state === 'MATERIALIZED' && b.media_path) {
          const relMedia = b.media_path.replace(BATCH_ROOT + '/', '');
          previewHtml = \`
            <div class="preview-box">
              <img src="/asset/\${relMedia}" alt="Rendered Preview">
              <div class="safe-overlay \${SAFE_ZONES_ENABLED ? 'active' : ''}">
                <div class="overlay-top">TOP HEADER RISK (0-12%)</div>
                <div class="overlay-bottom">BOTTOM TITLE/AVATAR RISK (85-100%)</div>
                <div class="overlay-right">BUTTON STACK (40-90%)</div>
              </div>
            </div>
          \`;
        } else if (b.disposition === 'TALKING_HEAD') {
          previewHtml = \`
            <div class="preview-box">
              <div class="placeholder-box">
                <div class="icon">👤</div>
                <div class="pill">PRESENTER A-ROLL</div>
                <p style="font-size: 11px;">Reserved for on-camera delivery</p>
                <p style="font-size: 10px; color: #64748b; margin-top: 6px;">Right-third vertical framing</p>
              </div>
            </div>
          \`;
        } else {
          previewHtml = \`
            <div class="preview-box">
              <div class="placeholder-box">
                <div class="icon">🖥️</div>
                <div class="pill">SCREEN CAPTURE</div>
                <p style="font-size: 11px;">Reserved for real interface/terminal</p>
              </div>
            </div>
          \`;
        }

        // 2. Narrative Column
        const narrativeHtml = \`
          <div class="narrative-col">
            <div class="beat-header">
              <span class="beat-tag">\${b.beat_id}</span>
              <span class="time-tag">\${b.timeline.start_s}s - \${b.timeline.end_s}s (\${b.timeline.duration_s}s)</span>
              <span class="func-tag">\${b.visual_function}</span>
              <span class="autonomy-tag">\${b.autonomy_level}</span>
            </div>
            <div class="dialogue-box">\${b.dialogue}</div>
            <div class="concept-box">
              <strong>Visual Concept:</strong> \${b.section} — \${b.concept || b.visual_function}
            </div>
            <div style="font-size: 11px; color: #64748b;">
              Disposition: <strong>\${b.disposition}</strong> • QC: \${b.qc_passed ? '✓ PASSED' : 'N/A'}
            </div>
          </div>
        \`;

        // 3. Editorial Decision Column
        const activeV = vRec.verdict;
        const notesVal = vRec.notes || '';
        const decisionHtml = \`
          <div class="decision-col">
            <div class="decision-title">Mikko Editorial Verdict</div>
            <div class="verdict-buttons">
              <button class="v-btn \${activeV === 'KEEP' ? 'active-keep' : ''}" onclick="submitVerdict('\${ep.topic}', '\${b.beat_id}', 'KEEP')">KEEP</button>
              <button class="v-btn \${activeV === 'CHANGE' ? 'active-change' : ''}" onclick="submitVerdict('\${ep.topic}', '\${b.beat_id}', 'CHANGE')">CHANGE</button>
              <button class="v-btn \${activeV === 'CUT' ? 'active-cut' : ''}" onclick="submitVerdict('\${ep.topic}', '\${b.beat_id}', 'CUT')">CUT</button>
              <button class="v-btn \${activeV === 'REWRITE' ? 'active-rewrite' : ''}" onclick="submitVerdict('\${ep.topic}', '\${b.beat_id}', 'REWRITE')">REWRITE</button>
            </div>
            <textarea class="notes-input" id="notes_\${ep.topic}_\${b.beat_id}" placeholder="Editorial note / modification reason..." onchange="saveNotes('\${ep.topic}', '\${b.beat_id}')">\${notesVal}</textarea>
            <div class="status-receipt" id="receipt_\${ep.topic}_\${b.beat_id}">
              \${activeV ? \`✓ \${activeV} recorded\` : 'Pending human review'}
            </div>
          </div>
        \`;

        card.innerHTML = previewHtml + narrativeHtml + decisionHtml;
        container.appendChild(card);
      });
    }

    async function submitVerdict(topic, beat_id, verdict) {
      const notesEl = document.getElementById(\`notes_\${topic}_\${beat_id}\`);
      const notes = notesEl ? notesEl.value : '';
      const res = await fetch('/api/verdict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, beat_id, verdict, notes })
      });
      const data = await res.json();
      if (data.ok) {
        BATCH_DATA.verdicts[data.key] = data.record;
        selectEpisode(ACTIVE_TOPIC);
      }
    }

    async function saveNotes(topic, beat_id) {
      const vKey = \`\${topic}_\${beat_id}\`;
      const curVerdict = BATCH_DATA.verdicts[vKey]?.verdict || 'KEEP';
      const notes = document.getElementById(\`notes_\${topic}_\${beat_id}\`).value;
      await submitVerdict(topic, beat_id, curVerdict);
    }

    function toggleSafeZones(checked) {
      SAFE_ZONES_ENABLED = checked;
      document.querySelectorAll('.safe-overlay').forEach(el => {
        if (checked) el.classList.add('active');
        else el.classList.remove('active');
      });
    }

    loadData();
  </script>
</body>
</html>
  `;
}

server.listen(PORT, HOST, () => {
  console.log(`Directed Draft Inspector GUI running at: http://${HOST}:${PORT}/`);
});
