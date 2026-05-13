#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createServer } = require('../package-engine-server.js');

const ROOT = path.join(__dirname, '..');
const CHROME_BIN = process.env.CHROME_BIN || findChrome();
const STORAGE_KEY = 'vidtoolz-episode-factory-v1';
const ACTIVE_SESSION_KEY = 'vidtoolz-episode-factory-active-session-v1';
const BACKUP_STATUS_KEY = 'vidtoolz-episode-factory-backup-status-v1';

function findChrome() {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const command of candidates) {
    const result = childProcess.spawnSync('sh', ['-lc', `command -v ${command}`], {
      encoding: 'utf8',
    });
    const found = result.stdout.trim();
    if (found) return found;
  }
  return '';
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body}`));
          return;
        }
        resolve(body ? JSON.parse(body) : null);
      });
    });
    req.on('error', reject);
    req.end(options.body || null);
  });
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
    }
    return result.result ? result.result.value : undefined;
  }

  async waitFor(expression, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await this.evaluate(`Boolean(${expression})`);
      if (value) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  close() {
    try {
      this.socket.close();
    } catch (error) {
      // Best-effort cleanup only.
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openChrome(tempRoot, port) {
  if (!CHROME_BIN) throw new Error('No Chrome or Chromium binary found.');
  const userDataDir = path.join(tempRoot, 'chrome-profile');
  const downloadDir = path.join(tempRoot, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const chrome = childProcess.spawn(
    CHROME_BIN,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  chrome.stderr.setEncoding('utf8');
  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  for (let index = 0; index < 60; index += 1) {
    try {
      await requestJson(versionUrl);
      return { chrome, downloadDir, stderr: () => stderr };
    } catch (error) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited early: ${stderr}`);
      await delay(100);
    }
  }
  throw new Error(`Chrome did not expose DevTools: ${stderr}`);
}

async function connectToPage(port) {
  const targets = await requestJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) throw new Error('No Chrome page target available.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return new CdpSession(socket);
}

async function setFileInput(cdp, selector, filePath) {
  const documentResult = await cdp.send('DOM.getDocument', { depth: 1 });
  const queryResult = await cdp.send('DOM.querySelector', {
    nodeId: documentResult.root.nodeId,
    selector,
  });
  if (!queryResult.nodeId) throw new Error(`File input not found: ${selector}`);
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: queryResult.nodeId,
    files: [filePath],
  });
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`);
}

function js(value) {
  return JSON.stringify(value);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-factory-browser-smoke-'));
  const chromePort = 9222 + Math.floor(Math.random() * 1000);
  let chrome = null;
  let cdp = null;
  let server = null;
  try {
    server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const serverPort = server.address().port;
    const baseUrl = `http://127.0.0.1:${serverPort}/`;
    const browser = await openChrome(tempRoot, chromePort);
    chrome = browser.chrome;
    cdp = await connectToPage(chromePort);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: browser.downloadDir,
    }).catch(() => {});
    await cdp.send('Page.navigate', { url: baseUrl });
    await cdp.waitFor('document.readyState === "complete" && window.EpisodeFactoryModel && window.EpisodeFactoryStorage');

    const targetInfo = await cdp.evaluate(`(() => ({
      title: document.title,
      hasExport: Boolean(document.querySelector('#exportJsonBtn')),
      hasImport: Boolean(document.querySelector('#importJsonBtn')),
      hasRecentWorkSessions: document.body.textContent.includes('Recent Work Sessions'),
      hasReadiness: Boolean(document.querySelector('#readinessSummary')),
      hasChecklistUi: Boolean(document.querySelector('#checklistGroups')),
      path: location.pathname,
    }))()`);
    assert.equal(targetInfo.title, 'VIDTOOLZ Episode Factory');
    assert.equal(targetInfo.hasExport, true);
    assert.equal(targetInfo.hasImport, true);
    assert.equal(targetInfo.hasRecentWorkSessions, true);
    assert.equal(targetInfo.hasReadiness, true);
    assert.equal(targetInfo.hasChecklistUi, true);

    await cdp.evaluate(`(() => {
      localStorage.clear();
      const model = window.EpisodeFactoryModel;
      const main = model.normalizeEpisode({
        id: 'browser-smoke-main',
        status: 'Packaging',
        workingTitle: 'Browser Smoke Episode',
        topic: 'Browser verification',
        notes: 'original-note',
      });
      const unrelated = model.normalizeEpisode({
        id: 'browser-smoke-unrelated',
        status: 'Idea',
        workingTitle: 'Unrelated Browser Episode',
        topic: 'Must survive import',
        notes: 'preserve-me',
      });
      const task = model.generateNextActionTask(main);
      const active = model.startActiveSession(task, 0);
      localStorage.setItem(${js(STORAGE_KEY)}, JSON.stringify(model.normalizeState({
        selectedId: main.id,
        episodes: [main, unrelated],
      })));
      localStorage.setItem(${js(ACTIVE_SESSION_KEY)}, JSON.stringify(active));
      localStorage.setItem(${js(BACKUP_STATUS_KEY)}, JSON.stringify({ lastExportAt: new Date().toISOString(), lastImportAt: '' }));
    })()`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && document.querySelector("[data-active-control=\\"complete\\"]")');
    assert.equal(await cdp.evaluate('document.body.textContent.includes("Complete Session")'), true);
    assert.equal(await cdp.evaluate('document.body.textContent.includes("Recent Work Sessions")'), true);

    await cdp.evaluate(`document.querySelector('[data-active-control="complete"]').click()`);
    await cdp.waitFor('document.querySelector("#completionForm textarea[name=result]")');
    await cdp.evaluate(`(() => {
      document.querySelector('#completionForm textarea[name=result]').value = 'Browser smoke completed active work.';
      document.querySelector('#completionForm textarea[name=nextActionAfterSession]').value = 'Review browser smoke history.';
      document.querySelector('#completionForm').requestSubmit();
    })()`);
    await cdp.waitFor('document.querySelector("#workSessions") && document.querySelector("#workSessions").textContent.includes("Browser smoke completed active work.")');
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && document.querySelector("#workSessions")');
    const sessionProof = await cdp.evaluate(`(() => {
      const state = JSON.parse(localStorage.getItem(${js(STORAGE_KEY)}));
      const active = localStorage.getItem(${js(ACTIVE_SESSION_KEY)});
      const episode = state.episodes.find((item) => item.id === 'browser-smoke-main');
      const unrelated = state.episodes.find((item) => item.id === 'browser-smoke-unrelated');
      return {
        visible: document.querySelector('#workSessions').textContent,
        active,
        count: episode.workSessions.length,
        unrelatedCount: unrelated.workSessions.length,
        title: episode.workSessions[0].taskTitle,
        taskType: episode.workSessions[0].taskType,
        selectedId: state.selectedId,
      };
    })()`);
    assert.equal(sessionProof.active, null);
    assert.equal(sessionProof.count, 1);
    assert.equal(sessionProof.unrelatedCount, 0);
    assert.match(sessionProof.visible, /Browser smoke completed active work/);
    assert.ok(sessionProof.title);
    assert.equal(sessionProof.taskType, 'packagingBlocked');
    assert.equal(sessionProof.selectedId, 'browser-smoke-main');

    const readinessBefore = await cdp.evaluate(`document.querySelector('#readinessSummary').textContent`);
    await cdp.evaluate(`document.querySelector('input[data-checklist="productionChecklist"][data-item="Screen recording plan is clear"]').click()`);
    await cdp.waitFor(`document.querySelector('#readinessGrid').textContent.includes('Production')`);
    const readinessAfter = await cdp.evaluate(`document.querySelector('#readinessSummary').textContent`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && document.querySelector("#readinessSummary")');
    const readinessReloaded = await cdp.evaluate(`(() => ({
      summary: document.querySelector('#readinessSummary').textContent,
      grid: document.querySelector('#readinessGrid').textContent,
      checked: document.querySelector('input[data-checklist="productionChecklist"][data-item="Screen recording plan is clear"]').checked,
    }))()`);
    assert.notEqual(readinessAfter, readinessBefore);
    assert.equal(readinessReloaded.summary, readinessAfter);
    assert.equal(readinessReloaded.checked, true);
    assert.match(readinessReloaded.grid, /Production\s*5%/);

    await cdp.evaluate(`document.querySelector('#exportJsonBtn').click()`);
    await cdp.waitFor(`document.querySelector('#importExportStatus').textContent.includes('Exported')`);
    const exportProof = await cdp.evaluate(`(() => ({
      status: document.querySelector('#importExportStatus').textContent,
      backup: JSON.parse(localStorage.getItem(${js(BACKUP_STATUS_KEY)})),
    }))()`);
    assert.match(exportProof.status, /Exported 2 episodes/);
    assert.ok(exportProof.backup.lastExportAt);

    const importFixture = path.join(tempRoot, 'browser-import-fixture.json');
    fs.writeFileSync(
      importFixture,
      JSON.stringify(
        {
          app: 'VIDTOOLZ Episode Factory',
          schemaVersion: 1,
          selectedId: 'browser-smoke-new',
          episodes: [
            {
              id: 'browser-smoke-main',
              status: 'Packaging',
              workingTitle: 'Browser Smoke Episode',
              topic: 'Browser verification',
              notes: 'imported-note',
            },
            {
              id: 'browser-smoke-new',
              status: 'Idea',
              workingTitle: 'Imported Browser Episode',
              topic: 'Safe import fixture',
              notes: 'added-note',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );
    await setFileInput(cdp, '#importJsonInput', importFixture);
    await cdp.waitFor(`document.querySelector('#importPreviewPanel') && !document.querySelector('#importPreviewPanel').classList.contains('hidden')`);
    const previewProof = await cdp.evaluate(`document.querySelector('#importPreviewPanel').textContent`);
    assert.match(previewProof, /Changed matches/);
    assert.match(previewProof, /New episodes/);
    await cdp.evaluate(`document.querySelector('input[name="importMode"][value="merge-update"]').click()`);
    await cdp.evaluate(`window.confirm = () => true`);
    await cdp.evaluate(`document.querySelector('#confirmImportBtn').click()`);
    await cdp.waitFor(`document.querySelector('#importExportStatus').textContent.includes('Import complete')`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor('document.readyState === "complete" && document.querySelector("#board")');
    const importProof = await cdp.evaluate(`(() => {
      const state = JSON.parse(localStorage.getItem(${js(STORAGE_KEY)}));
      const main = state.episodes.filter((episode) => episode.id === 'browser-smoke-main');
      const unrelated = state.episodes.find((episode) => episode.id === 'browser-smoke-unrelated');
      const added = state.episodes.find((episode) => episode.id === 'browser-smoke-new');
      return {
        count: state.episodes.length,
        mainCount: main.length,
        mainNotes: main[0] && main[0].notes,
        unrelatedNotes: unrelated && unrelated.notes,
        addedTitle: added && added.workingTitle,
        visibleBoard: document.querySelector('#board').textContent,
        backup: JSON.parse(localStorage.getItem(${js(BACKUP_STATUS_KEY)})),
      };
    })()`);
    assert.equal(importProof.count, 3);
    assert.equal(importProof.mainCount, 1);
    assert.equal(importProof.mainNotes, 'imported-note');
    assert.equal(importProof.unrelatedNotes, 'preserve-me');
    assert.equal(importProof.addedTitle, 'Imported Browser Episode');
    assert.match(importProof.visibleBoard, /Imported Browser Episode/);
    assert.ok(importProof.backup.lastImportAt);

    const safetyProof = await cdp.evaluate(`(() => {
      const state = JSON.parse(localStorage.getItem(${js(STORAGE_KEY)}));
      return {
        statuses: state.episodes.map((episode) => episode.status),
        text: document.body.textContent,
      };
    })()`);
    assert.equal(safetyProof.statuses.includes('Ready to Shoot'), false);
    assert.equal(/Capture evidence accepted:\s*yes/i.test(safetyProof.text), false);
    assert.equal(/Evidence accepted:\s*yes/i.test(safetyProof.text), false);
    assert.equal(/Production readiness:\s*PASS/i.test(safetyProof.text), false);

    console.log(JSON.stringify({
      ok: true,
      url: baseUrl,
      page: targetInfo.path || '/',
      chrome: CHROME_BIN,
      checks: {
        visibleControls: true,
        activeSessionCompletionReload: true,
        readinessReload: true,
        exportStatus: true,
        importMergeUpdateReload: true,
        noProductionOrEvidenceApproval: true,
      },
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill('SIGTERM');
      await Promise.race([once(chrome, 'exit'), delay(2000)]);
      if (chrome.exitCode === null) {
        chrome.kill('SIGKILL');
        await Promise.race([once(chrome, 'exit'), delay(2000)]);
      }
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await delay(200);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
