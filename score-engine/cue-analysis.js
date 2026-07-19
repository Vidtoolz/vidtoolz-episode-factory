// VIDTOOLZ Score Engine — cue-sheet analysis (Scorecraft v1.2).
// Pure functions that turn a project + cue sheet into what the operator needs
// to SEE: coverage, music gaps, dialogue-safety risks, and per-cue sanity
// warnings. Advisory by design — warnings inform the human, they never block
// (the schema validator owns hard failures). No I/O, fully deterministic.
"use strict";

const GAP_EPSILON = 0.25; // sub-quarter-second seams are layout noise, not gaps
const SHORT_CUE_SECONDS = 2;

function isNum(n) { return typeof n === "number" && Number.isFinite(n); }
function round1(n) { return Math.round(n * 10) / 10; }

/*
 * analyzeCueSheet(project, cues) → {
 *   duration_seconds, covered_seconds, coverage_pct,
 *   gaps: [{start_seconds, end_seconds, duration_seconds}],
 *   warnings: [{cue_id|null, kind, message}],
 *   cues: [{cue_id, start, end, duration, function, emotion, energy, density,
 *           dialogue_safe, dialogue_risk, hit_points}],
 * }
 * dialogue_risk grading (advisory):
 *   - project dialogue_density heavy|medium AND cue not dialogue_safe → risk
 *   - risk severity raised when energy>=4 or density>=3 (busy music under speech)
 */
function analyzeCueSheet(project = {}, cues = []) {
  const duration = isNum(project.duration_seconds) ? project.duration_seconds : 0;
  // Valid enum is low|medium|high (score-schemas): "heavy" never occurs — the
  // old check silently disabled dialogue-risk analysis on the DEFAULT
  // narration-heavy configuration, the exact case the feature exists for.
  const dialogueHeavy = ["high", "medium"].includes(project.dialogue_density);
  const warnings = [];
  const list = (Array.isArray(cues) ? cues : []).filter((c) => c && isNum(c.start_seconds) && isNum(c.end_seconds));

  const mapped = list.map((c) => {
    const busy = (c.energy || 0) >= 4 || (c.density || 0) >= 3;
    const risk = dialogueHeavy && !c.dialogue_safe ? (busy ? "high" : "medium") : "none";
    if (risk === "high") {
      warnings.push({ cue_id: c.cue_id, kind: "dialogue-risk", message: `${c.cue_id} "${c.name || ""}": energy ${c.energy}/density ${c.density} music NOT marked dialogue-safe on a dialogue-${project.dialogue_density} video — narration will fight the score. Lower energy/density, mark dialogue-safe, or accept deliberately.` });
    } else if (risk === "medium") {
      warnings.push({ cue_id: c.cue_id, kind: "dialogue-risk", message: `${c.cue_id} "${c.name || ""}": not marked dialogue-safe on a dialogue-${project.dialogue_density} video — check it against narration.` });
    }
    if (c.end_seconds - c.start_seconds < SHORT_CUE_SECONDS) {
      warnings.push({ cue_id: c.cue_id, kind: "short-cue", message: `${c.cue_id} is ${round1(c.end_seconds - c.start_seconds)}s — too short to register musically except as a hit/stinger.` });
    }
    for (const hp of c.hit_points || []) {
      if (isNum(hp) && (hp < c.start_seconds - 0.001 || hp > c.end_seconds + 0.001)) {
        warnings.push({ cue_id: c.cue_id, kind: "hit-point", message: `${c.cue_id} hit point at ${hp}s lies outside the cue (${c.start_seconds}–${c.end_seconds}s).` });
      }
    }
    return {
      cue_id: c.cue_id, name: c.name || "", start_seconds: c.start_seconds, end_seconds: c.end_seconds,
      duration_seconds: round1(c.end_seconds - c.start_seconds),
      function: c.function, emotion: c.emotion, energy: c.energy, density: c.density,
      dialogue_safe: Boolean(c.dialogue_safe), dialogue_risk: risk,
      hit_points: c.hit_points || [],
    };
  });

  // Gaps: uncovered time between 0 and duration. A gap is not an error —
  // silence is a scoring choice — but it must be VISIBLE, never accidental.
  const gaps = [];
  let cursor = 0;
  let covered = 0;
  const sorted = [...mapped].sort((a, b) => a.start_seconds - b.start_seconds);
  for (const c of sorted) {
    if (c.start_seconds > cursor + GAP_EPSILON) {
      gaps.push({ start_seconds: round1(cursor), end_seconds: round1(c.start_seconds), duration_seconds: round1(c.start_seconds - cursor) });
    }
    covered += Math.max(0, Math.min(c.end_seconds, duration) - Math.max(c.start_seconds, cursor));
    cursor = Math.max(cursor, c.end_seconds);
  }
  if (duration > 0 && cursor < duration - GAP_EPSILON) {
    gaps.push({ start_seconds: round1(cursor), end_seconds: round1(duration), duration_seconds: round1(duration - cursor) });
  }
  for (const g of gaps) {
    warnings.push({ cue_id: null, kind: "music-gap", message: `No music planned ${g.start_seconds}s → ${g.end_seconds}s (${g.duration_seconds}s). Fine if the silence is deliberate — this note exists so it is never accidental.` });
  }

  return {
    duration_seconds: duration,
    covered_seconds: round1(covered),
    coverage_pct: duration > 0 ? Math.round((covered / duration) * 100) : 0,
    gaps,
    warnings,
    cues: mapped,
  };
}

module.exports = { analyzeCueSheet, GAP_EPSILON, SHORT_CUE_SECONDS };
