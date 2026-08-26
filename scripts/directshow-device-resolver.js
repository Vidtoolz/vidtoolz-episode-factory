'use strict';

/* Pure resolver: it consumes an explicit DirectShow enumeration and never
 * probes, ranks, or silently selects hardware. Stable identifiers win; a
 * friendly name is usable only when it identifies exactly one device of the
 * required media kind. */
const DEVICE_KINDS = Object.freeze(['video', 'audio']);

class DeviceResolutionError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

function normalizeDevice(device) {
  return {
    kind: String(device?.kind || '').toLowerCase(),
    stable_id: String(device?.stable_id || ''),
    alternative_id: String(device?.alternative_id || ''),
    friendly_name: String(device?.friendly_name || ''),
  };
}

function resolveDirectShowDevice(devices, request = {}) {
  const kind = String(request.kind || '').toLowerCase();
  if (!DEVICE_KINDS.includes(kind)) throw new DeviceResolutionError('DSHOW_DEVICE_KIND_INVALID', 'kind must be video or audio');
  const inventory = (Array.isArray(devices) ? devices : []).map(normalizeDevice);
  if (inventory.some((device) => !DEVICE_KINDS.includes(device.kind))) {
    throw new DeviceResolutionError('DSHOW_DEVICE_INVENTORY_INVALID', 'every enumerated device must declare video or audio');
  }
  const selectors = [
    ['stable_id', request.stable_id],
    ['alternative_id', request.alternative_id],
    ['friendly_name', request.friendly_name],
  ].filter(([, value]) => typeof value === 'string' && value.length > 0);
  if (!selectors.length) throw new DeviceResolutionError('DSHOW_DEVICE_CHOICE_REQUIRED', `explicit ${kind} device identity is required`);

  for (const [field, value] of selectors) {
    const wrongKind = inventory.filter((device) => device[field] === value && device.kind !== kind);
    const matches = inventory.filter((device) => device[field] === value && device.kind === kind);
    if (matches.length > 1) throw new DeviceResolutionError('DSHOW_DEVICE_AMBIGUOUS', `${field} identifies multiple ${kind} devices; operator choice required`);
    if (matches.length === 1) return { ...matches[0], resolved_by: field };
    if (wrongKind.length) throw new DeviceResolutionError('DSHOW_DEVICE_KIND_MISMATCH', `${field} identifies ${wrongKind[0].kind}, not ${kind}`);
  }
  throw new DeviceResolutionError('DSHOW_DEVICE_NOT_FOUND', `configured ${kind} device was not present; operator choice required`);
}

function resolveCaptureDevices(devices, request = {}) {
  const video = resolveDirectShowDevice(devices, { kind: 'video', ...(request.video || {}) });
  const audio = resolveDirectShowDevice(devices, { kind: 'audio', ...(request.audio || {}) });
  if (video.stable_id && audio.stable_id && video.stable_id === audio.stable_id) {
    throw new DeviceResolutionError('DSHOW_DEVICE_CROSS_SELECTION', 'camera and microphone identities must be distinct');
  }
  return { video, audio };
}

module.exports = { DEVICE_KINDS, DeviceResolutionError, resolveDirectShowDevice, resolveCaptureDevices };
