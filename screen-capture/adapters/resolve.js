'use strict';
// DAVINCI_RESOLVE adapter — observation-only, feature-gated, fail-closed.
//
// V1 never clicks, seeks, switches, opens or dismisses anything. Capture is
// allowed only when an external state provider (the read-only Resolve API +
// window/session probes on PRESTO, deployed separately) proves the exact
// project/timeline/playhead/page, not playing, not rendering, no background job,
// no modal, correct machine UUID hash / console session, and the human-idle
// lease is held and re-checked immediately before pixels are taken. Any
// unknown field blocks. Without a deployed provider the source is UNAVAILABLE.
const { acquireLease, recheckLease } = require('../human-idle-lease.js');

const ADAPTER = Object.freeze({ id: 'vidtoolz-resolve-observe-adapter', version: '1.0.0' });
const OPERATIONS = Object.freeze(['OBSERVE_WINDOW', 'CAPTURE_PIXELS']);
function fail(code, message) { return Object.assign(new Error(message), { code, stage: 'preflight' }); }
const REQUIRED_STATE = ['application_id', 'process_executable', 'window_id', 'focused_window_id', 'window_title', 'session_id', 'monitor_id', 'visible', 'minimized', 'obscured_ratio', 'ready', 'modal_present', 'process_running', 'project_id', 'timeline_id', 'playhead_frame', 'page', 'rendering', 'playing', 'background_task_active'];

async function capture(spec, ctx) {
  const deps = ctx.resolve || {};
  if (!deps.stateProvider || !deps.pixelCapture) throw fail('SOURCE_UNAVAILABLE', 'no DaVinci Resolve state provider/pixel source is deployed for this machine (observation-only adapter has nothing to observe)');
  const s = spec.source;
  const lease = await acquireLease({ policy: ctx.idle, deps: deps.lease || {}, targetSessionId: spec.machine.session_id, targetWindowId: null });
  if (!lease.granted) throw fail(lease.code, lease.detail);
  const state = await deps.stateProvider();
  for (const key of REQUIRED_STATE) if (!state || state[key] === undefined || state[key] === null) throw fail('SOURCE_PREFLIGHT_FAILED', `Resolve state field ${key} is unknown; unknown blocks`);
  const m = state.machine || {};
  if (spec.machine.id === 'presto') {
    const expected = ctx.presto || {};
    if (!expected.machine_uuid_sha256 || m.uuid_sha256 !== expected.machine_uuid_sha256 || m.address_role !== expected.address_role || !m.user || !m.console_session_id) throw fail('SOURCE_PREFLIGHT_FAILED', 'remote machine identity (UUID hash/address role/user/console session) does not bind to PRESTO');
    if (m.collection_session_id === m.console_session_id) throw fail('SOURCE_PREFLIGHT_FAILED', 'collection session claims to be the interactive console session');
  }
  if (state.application_id !== s.application_id || state.window_title !== s.window_title || state.session_id !== spec.machine.session_id || !/resolve/i.test(state.process_executable)) throw fail('SOURCE_PREFLIGHT_FAILED', 'wrong application/window/session');
  if (!state.process_running) throw fail('SOURCE_UNAVAILABLE', 'Resolve is not running');
  if (state.project_id !== s.project_id || state.timeline_id !== s.timeline_id || state.playhead_frame !== s.playhead_frame) throw fail('SOURCE_PREFLIGHT_FAILED', 'Resolve project/timeline/playhead differ from the CaptureSpec');
  if (!state.visible || state.minimized || state.obscured_ratio > 0.02) throw fail('SOURCE_PREFLIGHT_FAILED', 'Resolve window is minimized or obscured');
  if (!state.ready || state.modal_present || state.focused_window_id !== state.window_id) throw fail('SOURCE_PREFLIGHT_FAILED', 'Resolve is not ready (modal present or not focused); capture will not steal focus');
  if (state.rendering || state.playing || state.background_task_active) throw fail('HUMAN_BUSY', 'Resolve is playing, rendering or running a background task');
  const recheck = recheckLease(lease, deps.lease || {});
  if (!recheck.ok) throw fail(recheck.code, recheck.detail);
  const startedAt = new Date().toISOString();
  const pixels = await deps.pixelCapture({ window_id: state.window_id, monitor_id: state.monitor_id });
  if (!pixels || !Buffer.isBuffer(pixels.png) || !pixels.png.length) throw fail('CAPTURE_FAILED', 'pixel source returned no image');
  const completedAt = new Date().toISOString();
  const appState = { application_id: state.application_id, process_executable: state.process_executable, window_id: state.window_id, focused_window_id: state.focused_window_id, window_title: state.window_title, session_id: state.session_id, monitor_id: state.monitor_id, visible: state.visible, minimized: state.minimized, obscured_ratio: state.obscured_ratio, ready: state.ready, modal_present: state.modal_present, process_running: state.process_running, project_id: state.project_id, timeline_id: state.timeline_id, playhead_frame: state.playhead_frame, page: state.page, rendering: state.rendering, playing: state.playing, background_task_active: state.background_task_active, human_activity_within_seconds: recheck.human_activity_within_seconds };
  const visibleText = `${state.project_id} ${state.timeline_id} playhead ${state.playhead_frame} ${state.window_title}`;
  return {
    adapter: ADAPTER,
    snapshot: { type: 'DAVINCI_RESOLVE', machine_id: spec.machine.id, session_id: spec.machine.session_id, observed_at: completedAt, cache_state: 'FRESH', capture_id: spec.capture_id, application_state: appState, remote_machine: m, lease: { lease_id: lease.lease_id, samples: lease.samples, minimum_idle_seconds: lease.minimum_idle_seconds } },
    raw: { format: 'PNG', bytes: pixels.png, visible_text: visibleText, visible_tokens: [state.project_id, state.timeline_id, `playhead-${state.playhead_frame}`], width: pixels.width, height: pixels.height },
    surfaces: [{ id: 'window-title', text: state.window_title }],
    evidence: { visible_text: visibleText },
    required_context_boxes: [{ id: 'resolve-identity', kind: 'annotation', text: `${state.project_id} / ${state.timeline_id} @ frame ${state.playhead_frame}` }],
    operations: [...OPERATIONS],
    source_identity_line: `DaVinci Resolve · ${state.project_id} / ${state.timeline_id} · frame ${state.playhead_frame} · ${state.page} page`,
    started_at: startedAt, completed_at: completedAt,
  };
}

module.exports = { ADAPTER, OPERATIONS, REQUIRED_STATE, capture };
