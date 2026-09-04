'use strict';
// DESKTOP_APPLICATION — NOT a V1 authority. There is no generic desktop
// adapter, no fallback display, no primary-monitor or full-screen capture.
// Every request returns a typed SOURCE_UNAVAILABLE so the Visual Director can
// re-dispose the beat. This module never touches a display.
const ADAPTER = Object.freeze({ id: 'vidtoolz-desktop-disabled', version: '1.0.0' });
async function capture() {
  throw Object.assign(new Error('generic desktop capture is not a Screen Capture V1 authority (Codex readiness audit: NOT READY); only app-specific observe-only adapters with a human-idle lease may exist'), { code: 'SOURCE_UNAVAILABLE', stage: 'preflight' });
}
module.exports = { ADAPTER, capture };
