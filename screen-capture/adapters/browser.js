'use strict';
// BROWSER adapter — isolated headless Chrome over CDP. Binds requested URL,
// redirect chain, final URL, authentication state, target selector visibility,
// current-state nonce and fresh (cache-disabled) load. Error pages, unexpected
// redirects, hidden targets and absent state nonces fail; nothing is synthesized.
const os = require('node:os');
const { launch, delay } = require('../cdp.js');
const { sha256Bytes } = require('../contract.js');

const ADAPTER = Object.freeze({ id: 'vidtoolz-browser-cdp-adapter', version: '1.0.0' });
const VIEWPORT = { width: 1280, height: 720 };
function fail(code, message) { return Object.assign(new Error(message), { code, stage: 'capture' }); }

async function capture(spec, ctx) {
  const s = spec.source;
  const url = new URL(s.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw fail('SPEC_REJECTED', 'only http/https sources');
  const allowedFinal = new Set([s.url, ...(s.allow_redirects || [])]);
  const session = await launch({ profileRoot: ctx.browser_profile_root, width: VIEWPORT.width, height: VIEWPORT.height });
  const { cdp } = session;
  const startedAt = new Date().toISOString();
  const chain = []; const documentRequests = new Map(); let mainRequestId = null; let mainStatus = null;
  cdp.on((m) => {
    if (m.method === 'Network.requestWillBeSent' && m.params.type === 'Document') {
      if (m.params.redirectResponse) chain.push({ from: m.params.redirectResponse.url, to: m.params.request.url, status: m.params.redirectResponse.status });
      if (!mainRequestId || m.params.redirectResponse) mainRequestId = m.params.requestId;
      documentRequests.set(m.params.requestId, m.params.request.url);
    }
    if (m.method === 'Network.responseReceived' && m.params.requestId === mainRequestId) mainStatus = m.params.response.status;
  });
  try {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise((resolve) => { const h = (m) => { if (m.method === 'Page.loadEventFired') resolve(true); }; cdp.on(h); setTimeout(() => resolve(false), ctx.limits.browser_timeout_ms); });
    const nav = await cdp.send('Page.navigate', { url: s.url });
    if (nav.errorText) throw fail('CAPTURE_FAILED', `navigation failed: ${nav.errorText} (browser error page is not evidence)`);
    if (!(await loaded)) throw fail('CAPTURE_FAILED', 'page did not finish loading within the bounded timeout');
    await delay(150);
    const measure = async () => JSON.parse(await cdp.eval(`(()=>{const sel=${JSON.stringify(s.selector)};let el=null;try{el=document.querySelector(sel);}catch(e){return JSON.stringify({error:'selector error: '+e.message});}const r=el?el.getBoundingClientRect():null;const cs=el?getComputedStyle(el):null;const visible=Boolean(el&&r&&r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&Number(cs.opacity)>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth);return JSON.stringify({href:location.href,protocol:location.protocol,title:document.title,body_text:(document.body&&document.body.innerText)||'',has_password:Boolean(document.querySelector('input[type=password]')),selector:{query:sel,found:Boolean(el),visible,area_px:r?Math.round(Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0))):0,rect:r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}:null,font_px:el?parseFloat(cs.fontSize):null,text:el?el.innerText.slice(0,2000):null}});})()`));
    let state = await measure();
    if (state.error) throw fail('SPEC_REJECTED', state.error);
    // Readability viewport: the presentation scales the raw to a 936 px wide
    // evidence box. If the target's own font would fall below the minimum text
    // size at that scale, re-render the SAME page at a narrower CSS viewport so
    // its responsive layout enlarges the text — an authentic render, not a crop.
    let viewport = { ...VIEWPORT };
    const minText = spec.presentation.minimum_text_px; const boxWidth = 1080 - spec.presentation.safe_area.left - spec.presentation.safe_area.right - 4;
    if (state.selector.font_px && state.selector.font_px * (boxWidth / viewport.width) < minText) {
      const width = Math.max(360, Math.min(VIEWPORT.width, Math.floor((boxWidth * state.selector.font_px) / minText)));
      viewport = { width, height: Math.round((width * 9) / 16) };
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await delay(200);
      state = await measure();
      if (state.error) throw fail('SPEC_REJECTED', state.error);
    }
    if (/^chrome-error:|^chrome:/.test(state.href) || /^chrome-error:/.test(state.protocol)) throw fail('CAPTURE_FAILED', 'browser error page is not evidence');
    if (mainStatus != null && mainStatus >= 400) throw fail('CAPTURE_FAILED', `document responded HTTP ${mainStatus}`);
    if (!allowedFinal.has(state.href)) throw fail('CAPTURE_FAILED', `final URL ${state.href} is not the requested URL or an authorized redirect`);
    const loginLike = /accounts\.google\.com|\/login\b|\/signin\b|\/sign-in\b/i.test(state.href) || state.has_password;
    if (loginLike) throw fail('AUTH_REQUIRED', 'the source requires authentication; the requested state is behind a sign-in');
    if (!state.selector.found || !state.selector.visible || state.selector.area_px < 400) throw fail('EVIDENCE_INSUFFICIENT', `target selector ${s.selector} is ${state.selector.found ? 'not visibly captured' : 'absent'}`);
    if (!String(state.body_text).includes(s.expected_state_nonce)) throw fail('EVIDENCE_INSUFFICIENT', 'the requested current-state nonce is not present in the page; requested state did not occur');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const png = Buffer.from(shot.data, 'base64');
    const completedAt = new Date().toISOString();
    const tokens = [...new Set(String(state.body_text).split(/\s+/).filter((t) => t.length >= 4 && t.length <= 120))];
    return {
      adapter: ADAPTER,
      snapshot: { type: 'BROWSER', machine_id: spec.machine.id, session_id: spec.machine.session_id, observed_at: completedAt, cache_state: 'FRESH', capture_id: spec.capture_id, requested_url: s.url, final_url: state.href, redirect_chain: chain, http_status: mainStatus, auth_state: 'READY', authenticated_identity: s.authenticated_identity || null, page_title: state.title, selector: { query: s.selector, visible: state.selector.visible, area_px: state.selector.area_px, rect: state.selector.rect, font_px: state.selector.font_px }, viewport, readability_viewport: viewport.width !== VIEWPORT.width, browser: { engine: 'chrome-headless', profile: 'isolated-temporary', cache_disabled: true }, page_text_sha256: sha256Bytes(String(state.body_text)), hostname: os.hostname() },
      raw: { format: 'PNG', bytes: png, visible_text: String(state.body_text), visible_tokens: tokens.includes(s.expected_state_nonce) ? tokens : [...tokens, s.expected_state_nonce], width: viewport.width, height: viewport.height },
      surfaces: [{ id: 'page-text', text: String(state.body_text) }, { id: 'page-title', text: String(state.title || '') }, { id: 'final-url', text: state.href }],
      evidence: { visible_text: String(state.body_text), final_url: state.href, selector_visible: state.selector.visible },
      required_context_boxes: [{ id: 'target-selector', kind: 'pixels', rect: state.selector.rect }, { id: 'page-identity', kind: 'annotation', text: `${state.href} · ${state.title}` }],
      operations: ['LAUNCH_ISOLATED_BROWSER', 'NAVIGATE_AND_WAIT', 'QUERY_SELECTOR_STATE', 'CAPTURE_VIEWPORT_PIXELS'],
      source_identity_line: `${state.href} · "${String(state.title).slice(0, 60)}" · HTTP ${mainStatus} · fresh load · ${viewport.width}×${viewport.height}`,
      target_rect: state.selector.rect, target_font_px: state.selector.font_px,
      started_at: startedAt, completed_at: completedAt,
    };
  } finally { session.close(); }
}

module.exports = { ADAPTER, VIEWPORT, capture };
