// VIDTOOLZ Score Engine — readiness + approved-export verification (v1.2).
// Answers the operator's real questions: Can I render? What is missing? What
// is safe to import into Resolve? What command proves it? Two layers:
//   assessReadiness  — cheap staged status (fs existence only, no probing)
//   verifyApprovedExports — deep verifier: every expected file present, every
//     WAV ffprobe-verified against the provenance's own render contract
//     (sample rate, bit depth, channels, duration-exact), Resolve mirror
//     byte-identical. No false success: absence and damage both fail loudly.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { analyzeCueSheet } = require("./cue-analysis.js");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

/* ── staged readiness (cheap, UI-friendly) ── */

function assessReadiness({ project = {}, cueSheet = null, musicPlan = null, candidates = [], dir = "" }) {
  const cues = (cueSheet && cueSheet.cues) || [];
  const analysis = analyzeCueSheet(project, cues);
  const approvedDir = path.join(dir, "approved");
  const hasApproval = Boolean(dir) && fs.existsSync(path.join(approvedDir, "provenance.json"));
  const previewable = candidates.filter((c) => c.files && c.files.preview_mix);
  const reaperBuilt = candidates.some((c) => c.reaper_built);

  const stages = [
    {
      id: "cue_sheet", label: "Cue sheet",
      state: project.cue_sheet_approved ? "done" : cues.length ? "draft" : "todo",
      detail: cues.length ? `${cues.length} cue(s), ${analysis.coverage_pct}% of ${analysis.duration_seconds}s covered${analysis.gaps.length ? `, ${analysis.gaps.length} silence gap(s)` : ""}` : "no cues yet — generate or write the cue sheet",
    },
    {
      id: "palette", label: "Palette / music plan",
      state: musicPlan ? "done" : "todo",
      detail: musicPlan ? `${musicPlan.palette_id}` : "pick a palette to map cue roles to instruments",
    },
    {
      id: "candidates", label: "Music candidates",
      state: previewable.length ? "done" : "todo",
      detail: previewable.length ? `${candidates.length} candidate(s), ${previewable.length} auditionable` : "generate candidates to audition sketch mixes",
    },
    {
      id: "approval", label: "Approved export",
      state: hasApproval ? "done" : "todo",
      detail: hasApproval ? "mix + dialogue-safe mix + stems + resolve-import/ exported" : "audition, then approve ONE candidate to export",
    },
  ];

  const missing = stages.filter((s) => s.state !== "done").map((s) => `${s.label}: ${s.detail}`);
  const dialogueRisks = analysis.warnings.filter((w) => w.kind === "dialogue-risk");
  const readyToRender = Boolean(project.cue_sheet_approved && musicPlan);
  const nextAction = !cues.length ? "Generate the cue sheet (step 1)."
    : !project.cue_sheet_approved ? "Review the Score Map, then approve the cue sheet."
      : !musicPlan ? "Pick a palette (step 2)."
        : !previewable.length ? "Generate music candidates (step 3), then audition the sketch previews."
          : !hasApproval ? "Audition the previews (A/B compare) and approve one candidate to export."
            : "Run the deep verifier below, then import approved/resolve-import/ into Resolve.";

  return {
    analysis,
    stages,
    ready_to_render: readyToRender,
    reaper_built: reaperBuilt,
    approved_export_exists: hasApproval,
    // Resolve readiness is only ever CLAIMED by the deep verifier — the panel
    // reports "approved, verify to confirm", never a green Resolve light
    // without probed evidence.
    resolve_ready_requires: "node scripts/verify-score-package.js — PASS is the only Resolve-ready proof",
    dialogue_risk_count: dialogueRisks.length,
    missing,
    warnings: analysis.warnings,
    next_action: nextAction,
    verify_command: `node scripts/verify-score-package.js ${dir || "<score-dir>"}`,
  };
}

/* ── deep verifier (CLI + tests) ── */

function defaultProbe(file) {
  const r = spawnSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) return { ok: false, reason: `ffprobe failed: ${(r.stderr || "").slice(0, 200)}` };
  try {
    const data = JSON.parse(r.stdout);
    const a = (data.streams || []).find((s) => s.codec_type === "audio");
    if (!a) return { ok: false, reason: "no audio stream" };
    return {
      ok: true,
      sample_rate: Number(a.sample_rate),
      channels: a.channels,
      codec: a.codec_name, // pcm_s24le / pcm_s16le
      duration: Number(data.format && data.format.duration) || null,
    };
  } catch (e) { return { ok: false, reason: e.message }; }
}

function verifyApprovedExports(dir, options = {}) {
  const probe = options.probeImpl || defaultProbe;
  const failures = [];
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail: ok ? null : detail || null }); if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`); };

  const project = readJson(path.join(dir, "score-project.json"));
  if (!project) return { verified: false, failures: [`score-project.json unreadable in ${dir}`], checks };
  const approvedDir = path.join(dir, "approved");
  const provenance = readJson(path.join(approvedDir, "provenance.json"));
  if (!provenance) {
    return { verified: false, no_approved_export: true, failures: ["no approved export — approved/provenance.json missing. Approve a candidate first; there is nothing to verify."], checks };
  }
  const render = provenance.render || {};
  const wantRate = render.sample_rate || 48000;
  const wantCodec = render.bit_depth === 24 ? "pcm_s24le" : "pcm_s16le";
  const durationExact = render.duration_exact !== false;
  const wantDuration = project.duration_seconds;

  // 1. Expected files exist.
  const expected = ["mix.wav", "mix-dialogue-safe.wav", "provenance.json", "provenance.md",
    path.join("midi", "all-lanes.mid"),
    path.join("resolve-import", "mix.wav"), path.join("resolve-import", "mix-dialogue-safe.wav"),
    path.join("resolve-import", "cue-markers.csv"), path.join("resolve-import", "README.md")];
  for (const rel of expected) {
    check(`exists: approved/${rel}`, fs.existsSync(path.join(approvedDir, rel)), "missing");
  }
  const stems = fs.existsSync(path.join(approvedDir, "stems")) ? fs.readdirSync(path.join(approvedDir, "stems")).filter((f) => f.endsWith(".wav")) : [];
  check("stems present", stems.length > 0, "approved/stems/ has no WAVs");

  // 2. Resolve mirror is byte-identical (a diverged copy is a silent lie).
  for (const rel of ["mix.wav", "mix-dialogue-safe.wav", ...stems.map((s) => path.join("stems", s))]) {
    const a = path.join(approvedDir, rel);
    const b = path.join(approvedDir, "resolve-import", rel);
    if (fs.existsSync(a) && fs.existsSync(b)) {
      check(`resolve mirror byte-identical: ${rel}`, fs.statSync(a).size === fs.statSync(b).size && fs.readFileSync(a).equals(fs.readFileSync(b)), "differs from approved original");
    } else if (fs.existsSync(a)) {
      check(`resolve mirror present: ${rel}`, false, "missing in resolve-import/");
    }
  }

  // 3. Every WAV honors the provenance's own render contract.
  const wavs = ["mix.wav", "mix-dialogue-safe.wav", ...stems.map((s) => path.join("stems", s))];
  for (const rel of wavs) {
    const file = path.join(approvedDir, rel);
    if (!fs.existsSync(file)) continue; // already failed above
    const p = probe(file);
    if (!p.ok) { check(`probe: ${rel}`, false, p.reason); continue; }
    check(`sample rate ${wantRate}: ${rel}`, p.sample_rate === wantRate, `got ${p.sample_rate}`);
    check(`bit depth (${wantCodec}): ${rel}`, p.codec === wantCodec, `got ${p.codec}`);
    check(`stereo: ${rel}`, p.channels === 2, `got ${p.channels} channel(s)`);
    if (durationExact) {
      check(`duration exact ${wantDuration}s: ${rel}`, p.duration !== null && Math.abs(p.duration - wantDuration) <= 0.05, `got ${p.duration}s`);
    } else {
      check(`duration >= ${wantDuration}s (tail-preserving): ${rel}`, p.duration !== null && p.duration >= wantDuration - 0.05, `got ${p.duration}s`);
    }
  }

  // 4. Cue markers CSV covers the approved cue count.
  const markers = path.join(approvedDir, "resolve-import", "cue-markers.csv");
  if (fs.existsSync(markers)) {
    const rows = fs.readFileSync(markers, "utf8").trim().split("\n").length - 1;
    // Provenance stores the cue array as cue_sheet (buildCandidateProvenance);
    // the old keys made the strong row-count check dead code — a truncated
    // cue-markers.csv passed "deep" verification.
    const cueCount = (provenance.cue_sheet || provenance.cues || (provenance.generation && provenance.generation.cues) || []).length || null;
    if (cueCount) check(`cue markers rows = ${cueCount}`, rows === cueCount, `got ${rows}`);
    else check("cue markers non-empty", rows > 0, "no marker rows");
  }

  check("provenance names the approved candidate", Boolean(provenance.approved_candidate), "approved_candidate missing");
  return { verified: failures.length === 0, failures, checks, provenance_render: render, project_duration: wantDuration };
}

function formatVerifierReport(result, dir) {
  const lines = [`Score package verification — ${dir}`, ""];
  if (result.no_approved_export) {
    lines.push("NOT READY — no approved export exists (nothing to verify).",
      "Approve a candidate in the score workspace first. This is NOT a pass.");
    return lines.join("\n");
  }
  for (const c of result.checks) lines.push(`${c.ok ? "  ok  " : " FAIL "} ${c.name}${!c.ok && c.detail ? ` — ${c.detail}` : ""}`);
  lines.push("", result.verified
    ? `PASS — approved export verified against its own provenance (${result.provenance_render.sample_rate} Hz / ${result.provenance_render.bit_depth}-bit / ${result.provenance_render.duration_exact !== false ? `duration-exact ${result.project_duration}s` : "tail-preserving"}). Safe to import approved/resolve-import/ into Resolve.`
    : `FAIL — ${result.failures.length} problem(s):\n${result.failures.map((f) => `  - ${f}`).join("\n")}`);
  return lines.join("\n");
}

module.exports = { assessReadiness, verifyApprovedExports, formatVerifierReport };
