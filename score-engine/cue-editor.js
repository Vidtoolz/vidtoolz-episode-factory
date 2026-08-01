// Pure Scorecraft cue-editor transitions, shared by browser and Node tests.
(function exposeCueEditor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ScoreCueEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function cueEditorFactory() {
"use strict";

const DEFAULT_MINIMUM_DURATION_SECONDS = 0.5;

function round3(value) { return Math.round(value * 1000) / 1000; }

function nextCueId(cues = []) {
  const active = new Set(cues.map((cue) => String(cue && cue.cue_id || "")));
  let highest = 0;
  for (const id of active) {
    const match = /^C(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let next = highest + 1;
  let candidate;
  do { candidate = `C${String(next).padStart(3, "0")}`; next += 1; } while (active.has(candidate));
  return candidate;
}

function splitCue(cues, index, options = {}) {
  if (!Array.isArray(cues) || !Number.isInteger(index) || index < 0 || index >= cues.length) throw new Error("Select an existing cue to split.");
  const source = cues[index];
  const start = Number(source.start_seconds);
  const end = Number(source.end_seconds);
  const minimum = Number(options.minimum_duration_seconds) > 0 ? Number(options.minimum_duration_seconds) : DEFAULT_MINIMUM_DURATION_SECONDS;
  const split = options.split_seconds === undefined ? round3((start + end) / 2) : Number(options.split_seconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(split) || split - start < minimum || end - split < minimum) {
    throw new Error(`Split must leave the minimum duration of ${minimum}s on both sides.`);
  }
  const hitPoints = Array.isArray(source.hit_points) ? source.hit_points : [];
  const first = { ...source, end_seconds: round3(split), hit_points: hitPoints.filter((point) => point < split) };
  const second = {
    ...source,
    cue_id: nextCueId(cues),
    name: `${source.name || source.cue_id || "Cue"} (part 2)`,
    start_seconds: round3(split),
    hit_points: hitPoints.filter((point) => point >= split),
  };
  return [...cues.slice(0, index), first, second, ...cues.slice(index + 1)];
}

return { DEFAULT_MINIMUM_DURATION_SECONDS, nextCueId, splitCue };
});
