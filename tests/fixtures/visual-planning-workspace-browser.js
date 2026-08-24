'use strict';

// Small repository-native DOM harness for the committed workspace page. It
// executes the actual inline browser program and records the DOM/request
// boundary without introducing a frontend framework or a network dependency.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(id, registry) {
    this.id = id;
    this.registry = registry;
    this._innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.onclick = null;
  }

  get innerHTML() { return this._innerHTML; }

  set innerHTML(value) {
    this._innerHTML = String(value);
    for (const match of this._innerHTML.matchAll(/<(button|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const element = this.registry.ensure(match[2]);
      element.disabled = match[1] === 'button' && /\bdisabled\b/.test(match[0]);
    }
  }
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function bootWorkspacePage(payloadOrProvider, options = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'visual-planning-workspace.html'), 'utf8');
  const scriptMatch = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1);
  if (!scriptMatch) throw new Error('workspace browser program missing');
  const elements = new Map();
  const registry = {
    ensure(id) {
      if (!elements.has(id)) elements.set(id, new Element(id, registry));
      return elements.get(id);
    },
  };
  const markup = html.slice(0, html.lastIndexOf('<script>'));
  for (const match of markup.matchAll(/\bid="([^"]+)"/g)) registry.ensure(match[1]);
  registry.ensure('workspace').hidden = true;

  const requests = [];
  const provider = typeof payloadOrProvider === 'function' ? payloadOrProvider : async () => payloadOrProvider;
  const controls = options.controls || {};
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    if (String(url).startsWith('/api/visual-planning-workspace')) return response(200, { ok: true, data: await provider() });
    if (url === '/api/package-engine/status') return response(200, { localWriteNonce: 'fixture-nonce', nonceHeader: 'x-vidtoolz-local-write-nonce' });
    if (controls[url]) {
      try { return response(200, { ok: true, data: await controls[url](body) }); }
      catch (error) { return response(error.statusCode || 409, { error: error.code || error.message, code: error.code || null }); }
    }
    return response(404, { error: 'TEST_ROUTE_NOT_FOUND' });
  };
  const request = options.request || (await provider()).context;
  const window = {
    location: { search: `?run=${encodeURIComponent(request.run_id)}&agent=${encodeURIComponent(request.agent_id)}&task=${encodeURIComponent(request.task_id)}&invocation=${encodeURIComponent(request.invocation_id)}` },
    open: (...args) => { window.opened = args; },
    opened: null,
  };
  const context = {
    window,
    document: { getElementById: (id) => elements.get(id) || null },
    fetch,
    URLSearchParams,
    encodeURIComponent,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context, { filename: 'visual-planning-workspace.html' });
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return {
    window,
    api: window.VisualPlanningWorkspaceV1,
    requests,
    elements,
    node(id) { return elements.get(id) || null; },
    async click(id) {
      const element = elements.get(id);
      if (!element || typeof element.onclick !== 'function') throw new Error(`element ${id} is not clickable`);
      await element.onclick();
      for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

module.exports = { bootWorkspacePage };
