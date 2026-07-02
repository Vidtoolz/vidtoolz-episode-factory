// VIDTOOLZ Score Engine — generic Standard MIDI File (format 1) writer.
// Hand-rolled because this repo is dependency-free. Successor to the fixed
// single-cue writer in music-cue-generator.js (v0.1), generalized to arbitrary
// note events, tempo maps, time signatures, and marker meta events.
"use strict";

const PPQ = 480;

function uint16(value) { return [(value >> 8) & 0xff, value & 0xff]; }
function uint32(value) { return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]; }

// MIDI variable-length quantity encoding.
function vlq(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function metaEvent(type, dataBytes) {
  return [0xff, type, ...vlq(dataBytes.length), ...dataBytes];
}

function textBytes(text) {
  return Array.from(Buffer.from(String(text), "utf8"));
}

// events: [{tick, bytes}] absolute ticks — sorted, converted to delta encoding,
// terminated with end-of-track.
function encodeTrack(events) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out = [];
  let lastTick = 0;
  for (const event of sorted) {
    out.push(...vlq(event.tick - lastTick), ...event.bytes);
    lastTick = event.tick;
  }
  out.push(...vlq(0), ...metaEvent(0x2f, []));
  return Buffer.from([...Array.from(Buffer.from("MTrk")), ...uint32(out.length), ...out]);
}

function tempoToMicroseconds(bpm) { return Math.round(60000000 / bpm); }

// Build the conductor track: tempo/time-signature changes + cue markers.
// tempoMap: [{tick, bpm, timeSignature: "4/4"}], markers: [{tick, name}]
function buildConductorTrack(tempoMap, markers = [], trackName = "conductor") {
  const events = [{ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(trackName)) }];
  tempoMap.forEach((entry, i) => {
    const micro = tempoToMicroseconds(entry.bpm);
    events.push({ tick: entry.tick, order: 1 + i, bytes: metaEvent(0x51, [(micro >> 16) & 0xff, (micro >> 8) & 0xff, micro & 0xff]) });
    const [num, den] = String(entry.time_signature || "4/4").split("/").map(Number);
    const denPow = Math.max(0, Math.round(Math.log2(den || 4)));
    events.push({ tick: entry.tick, order: 100 + i, bytes: metaEvent(0x58, [num || 4, denPow, 24, 8]) });
  });
  markers.forEach((m, i) => {
    events.push({ tick: m.tick, order: 200 + i, bytes: metaEvent(0x06, textBytes(m.name)) });
  });
  return encodeTrack(events);
}

// notes: [{tick, durTicks, note, velocity}] — one instrument track on `channel`.
function buildNoteTrack(trackName, notes, channel = 0) {
  const events = [{ tick: 0, order: 0, bytes: metaEvent(0x03, textBytes(trackName)) }];
  notes.forEach((n, i) => {
    const note = Math.max(0, Math.min(127, Math.round(n.note)));
    const velocity = Math.max(1, Math.min(127, Math.round(n.velocity)));
    events.push({ tick: Math.max(0, Math.round(n.tick)), order: 1000 + i * 2, bytes: [0x90 | channel, note, velocity] });
    events.push({ tick: Math.max(0, Math.round(n.tick + Math.max(1, n.durTicks))), order: 1001 + i * 2, bytes: [0x80 | channel, note, 0] });
  });
  return encodeTrack(events);
}

// Assemble a complete format-1 SMF from a conductor track + note tracks.
// laneTracks: [{name, channel, notes}]
function buildMidiFile({ tempoMap, markers = [], laneTracks = [], conductorName = "score" }) {
  const chunks = [buildConductorTrack(tempoMap, markers, conductorName)];
  for (const lane of laneTracks) chunks.push(buildNoteTrack(lane.name, lane.notes, lane.channel || 0));
  const header = Buffer.from([...Array.from(Buffer.from("MThd")), ...uint32(6), ...uint16(1), ...uint16(chunks.length), ...uint16(PPQ)]);
  return Buffer.concat([header, ...chunks]);
}

module.exports = { PPQ, vlq, uint16, uint32, metaEvent, buildConductorTrack, buildNoteTrack, buildMidiFile, tempoToMicroseconds };
