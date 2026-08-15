// Scorecraft → music_generation dispatch bridge.
//
// Wires the proven pieces together without collapsing their authorities:
//   Scorecraft (musical intent; the existing cue-sheet approval gate,
//   enforced inside the exporter — never re-implemented here)
//     → MusicRenderBrief v1 (frozen generator-neutral contract, exporter)
//     → EXPERIMENTAL MiniMax caption adapter (brief → caption, isolated)
//     → canonical `music_generation` compute lane (host choice, admission —
//       Resolve priority, GPU/VRAM/RAM floors, manual-start runtime probe)
//     → VIDLAP2 MiniMax Music 3 execution contract (this module).
//
// Fail-closed everywhere: an unapproved cue sheet, an invalid brief, a
// non-ROUTE lane decision, or an unreachable manual-start runtime each stop
// the request with a truthful reason. This module NEVER hard-codes the
// execution host (the lane decides), NEVER falls back to another host, and
// NEVER starts the remote runtime. MiniMax remains editorially unapproved:
// nothing here dispatches automatically from production flows.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const contract = require("./music-render-brief.js");
const adapter = require("./adapters/minimax-caption-reference.js");

function httpError(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; return e; }
function nowIso() { return new Date().toISOString(); }
function sha256Text(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── execution contract (worker-facing constants, NOT host routing) ──────────
// The proven VIDLAP2 MiniMax Music 3 configuration from the installation
// acceptance (2026-08-15). These are quality/identity constants of the
// execution contract; the HOST is always chosen by the compute lane. Any
// change to precision, tiled decode, or sampler values is a deliberate
// human decision — the bridge never adapts them to make a run pass.
const EXECUTION_CONTRACT = {
  lane: "music_generation",
  generator: "MiniMax Music 3",
  adapter: "minimax-caption-reference (EXPERIMENTAL)",
  workflow_id: "minimax-music3-t2m-v1",
  runtime_port: 8189, // mirrors the lane's runtime.port; localhost-only on the worker, reached via SSH
  models: {
    dit: "minimax_music3_dit_fp16.safetensors", // FP16 production synthesizer — never INT8
    text_encoder: "minimax_music3_text_encoder_pruned_int8_convrot.safetensors",
    vae: "minimax_music3_dav.safetensors",
  },
  sampler: { steps: 30, cfg: 1.7, sampler_name: "euler", scheduler: "simple", denoise: 1.0 },
  text_encode: { cfg_scale: 1.7, top_k: 50 },
  tiled_decode: false,
  audio: {
    native_output: "44.1 kHz stereo lossless FLAC (ComfyUI save node — not WAV)",
    production_deliverable: "16-bit PCM WAV via separate lossless ffmpeg conversion on the worker",
    resampling: "never (native 44.1 kHz is preserved)",
  },
  // Worker-side tool for the lossless FLAC→WAV step (8.3 path: no spaces).
  remote_ffmpeg: "C:\\PROGRA~1\\SHUTTE~1\\app\\Library\\ffmpeg.exe",
  remote_workspace: "C:\\VidtoolzMusic",
};

const MAX_CANDIDATES = 5;
const DEFAULT_CANDIDATES = 3;
const LYRICS_INSTRUMENTAL = "[intro]\n\n[instrumental]\n\n[outro]";
const SUBMIT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 10000;
const GENERATION_TIMEOUT_MS = 30 * 60 * 1000; // runaway bound; a cue renders in ~10 min

// ── ComfyUI workflow (API graph) ────────────────────────────────────────────
// Exact proven graph shape from the installation acceptance. The caption is
// produced ONLY by the experimental adapter — never rebuilt here.
function buildMusicWorkflow(caption, seed, durationSeconds) {
  const c = EXECUTION_CONTRACT;
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: c.models.dit, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: c.models.text_encoder, type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: c.models.vae } },
    4: { class_type: "MiniMaxMusic3TextEncode", inputs: {
      clip: ["2", 0], caption, lyrics: LYRICS_INSTRUMENTAL, seed,
      max_duration: durationSeconds, cfg_scale: c.text_encode.cfg_scale, top_k: c.text_encode.top_k } },
    5: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    6: { class_type: "EmptyMiniMaxMusic3LatentAudio", inputs: { seconds: durationSeconds, batch_size: 1 } },
    7: { class_type: "KSampler", inputs: {
      model: ["1", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0],
      seed, steps: c.sampler.steps, cfg: c.sampler.cfg,
      sampler_name: c.sampler.sampler_name, scheduler: c.sampler.scheduler, denoise: c.sampler.denoise } },
    // tiled decode OFF is the proven 16 GB quality configuration
    8: { class_type: "VAEDecodeAudio", inputs: { samples: ["7", 0], vae: ["3", 0] } },
    9: { class_type: "SaveAudioAdvanced", inputs: { audio: ["8", 0], filename_prefix: "scorecraft/pending", format: "flac" } },
  };
}

// ── canonical compute-lane admission ────────────────────────────────────────
const COMPUTE_SELECTOR = path.join(os.homedir(), "vidtoolz-compute", "vidtoolz-compute.py");
const COMPUTE_TIMEOUT_MS = 120000; // fresh admission runs a live worker-gate + RAM + runtime probe

function selectMusicLane(options = {}) {
  if (options.computeGateFn) return Promise.resolve().then(options.computeGateFn);
  return new Promise((resolve) => {
    childProcess.execFile("python3", [COMPUTE_SELECTOR, "select", EXECUTION_CONTRACT.lane, "--json"],
      { timeout: COMPUTE_TIMEOUT_MS }, (err, stdout, stderr) => {
        // The selector prints its full decision JSON and exits 1 for BLOCKED
        // lanes BY DESIGN — a non-zero exit with parseable stdout is a
        // truthful answer, not a selector failure. Only unparseable output
        // becomes a generic (still fail-closed) error.
        try { resolve(JSON.parse(stdout)); return; } catch {}
        resolve({ ok: false, decision: "BLOCKED",
          reason: `selector error: ${((err && (stderr || err.message)) || "no output").slice(0, 300)}`, checks: {} });
      });
  });
}

// Fail-closed verdict. Mirrors the wan_i2v gate style, EXCEPT the host is
// accepted FROM the authority instead of being pinned — Scorecraft never
// hard-codes which machine runs music.
function musicLaneVerdict(gateResult) {
  if (!gateResult || typeof gateResult !== "object") return { allow: false, reason: "selector returned no usable result" };
  if (gateResult.ok === false || gateResult.decision === "BLOCKED") {
    // checks.reason carries the admission's specific explanation (e.g. the
    // manual-start runtime being down); the lane-level reason is a terse
    // check summary — prefer the specific one for operators.
    const detail = (gateResult.checks && gateResult.checks.reason)
      || gateResult.reason || "blocked by compute authority";
    return { allow: false, reason: detail };
  }
  if (gateResult.decision !== "ROUTE") return { allow: false, reason: `unexpected selector decision '${String(gateResult.decision).slice(0, 40)}'` };
  if (gateResult.lane != null && gateResult.lane !== EXECUTION_CONTRACT.lane) {
    return { allow: false, reason: `selector answered for lane '${String(gateResult.lane).slice(0, 40)}'` };
  }
  if (gateResult.fallback_used === true) return { allow: false, reason: "selector used a fallback host — music generation has none" };
  const host = gateResult.selected_host;
  if (typeof host !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(host)) {
    return { allow: false, reason: "selector returned no usable host" };
  }
  return { allow: true, host, reason: `lane '${EXECUTION_CONTRACT.lane}' admitted on ${host}` };
}

// ── candidate preparation ───────────────────────────────────────────────────
function musicCandidatesDir(projectDir) { return path.join(projectDir, "music-candidates"); }

function nextMusicCandidateNumber(projectDir) {
  let existing = [];
  try { existing = fs.readdirSync(musicCandidatesDir(projectDir)); } catch { return 1; }
  const numbers = existing.map((name) => Number((name.match(/^music-candidate-(\d+)$/) || [])[1]) || 0);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temporary, file);
}

function updateCandidateMeta(projectDir, candidateId, patch) {
  const file = path.join(musicCandidatesDir(projectDir), candidateId, "music-candidate.json");
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  const next = { ...current, ...patch, updated_at: nowIso() };
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temporary, file);
  return next;
}

// Prepare one generation request: refresh the canonical brief through the
// existing exporter (which enforces the project's cue-sheet approval flag,
// the ONLY cue
// approval authority), render the caption through the isolated adapter, and
// create stable candidate identities + seeds BEFORE any dispatch. Execution
// metadata lives here, never inside the frozen brief.
function prepareMusicGeneration(projectId, input = {}, options = {}) {
  const lane = require("./score-lane.js"); // late require: score-lane ↛ music-dispatch cycle safety
  const exported = lane.exportMusicRenderBrief(projectId, options);
  const brief = exported.brief;
  const validationErrors = contract.validateMusicRenderBrief(brief);
  if (validationErrors.length) throw httpError(`MusicRenderBrief invalid — cannot dispatch: ${validationErrors.join("; ")}`, 500);
  const caption = adapter.renderMiniMaxCaption(brief);
  const briefHash = sha256Text(canonicalJson(brief));

  const projectDir = path.dirname(exported.file);
  const project = JSON.parse(fs.readFileSync(path.join(projectDir, "score-project.json"), "utf8"));
  const requested = Number(input.candidate_count);
  const count = Math.min(MAX_CANDIDATES, Math.max(1, Number.isInteger(requested) ? requested : DEFAULT_CANDIDATES));
  const baseSeed = Number.isInteger(input.seed) ? input.seed : (Number.isInteger(project.seed) ? project.seed : 1);

  const startNumber = nextMusicCandidateNumber(projectDir);
  const workflowHash = sha256Text(canonicalJson(buildMusicWorkflow(caption.caption, 0, brief.target_duration_s)));
  const candidates = [];
  for (let i = 0; i < count; i += 1) {
    const candidateId = `music-candidate-${String(startNumber + i).padStart(3, "0")}`;
    const seed = baseSeed + i; // existing Scorecraft candidate-seed convention
    const meta = {
      candidate_id: candidateId,
      brief_id: brief.brief_id,
      brief_hash: briefHash,
      brief_file: exported.file,
      seed,
      generator: EXECUTION_CONTRACT.generator,
      adapter: EXECUTION_CONTRACT.adapter,
      workflow_id: EXECUTION_CONTRACT.workflow_id,
      workflow_hash: workflowHash,
      models: EXECUTION_CONTRACT.models,
      sampler: EXECUTION_CONTRACT.sampler,
      text_encode: EXECUTION_CONTRACT.text_encode,
      tiled_decode: EXECUTION_CONTRACT.tiled_decode,
      requested_duration_s: brief.target_duration_s,
      audio_contract: EXECUTION_CONTRACT.audio,
      lane: EXECUTION_CONTRACT.lane,
      selected_host: null,     // filled by compute authority at admission
      admission: null,
      prompt_id: null,
      native_output_path: null,     // remote FLAC — filled by execution
      converted_output_path: null,  // remote WAV — filled by execution
      output_sha256: null,
      status: "prepared",
      failure: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    writeJsonAtomic(path.join(musicCandidatesDir(projectDir), candidateId, "music-candidate.json"), meta);
    candidates.push(meta);
  }
  return {
    project_id: projectId,
    project_dir: projectDir,
    brief,
    brief_id: brief.brief_id,
    brief_hash: briefHash,
    brief_file: exported.file,
    caption: caption.caption,
    caption_blocks: caption.blocks,
    candidates,
  };
}

// ── execution transport (real implementation; fully injectable in tests) ────
// The runtime is localhost-only on the worker, so every HTTP interaction and
// file movement goes over the estate's existing SSH trust to the host the
// LANE selected. The caption travels inside a JSON payload file (scp), never
// on a command line. Nothing here starts, stops, or reconfigures the runtime.
function defaultTransport(host) {
  const run = (argv, timeoutMs) => new Promise((resolve) => {
    childProcess.execFile(argv[0], argv.slice(1), { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code === undefined ? 1 : err.code) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
  const ssh = (remoteCmd, timeoutMs) => run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, remoteCmd], timeoutMs);
  const port = EXECUTION_CONTRACT.runtime_port;
  return {
    async submitPrompt(graph, clientId) {
      const payload = JSON.stringify({ prompt: graph, client_id: clientId });
      const local = path.join(os.tmpdir(), `music-job-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(local, payload);
      const remote = `C:/Users/mjp77/AppData/Local/Temp/${path.basename(local)}`;
      try {
        const up = await run(["scp", "-q", "-o", "BatchMode=yes", local, `${host}:${remote}`], SUBMIT_TIMEOUT_MS);
        if (up.code !== 0) throw httpError(`music job upload failed: ${up.stderr.slice(0, 200)}`, 502);
        const resp = await ssh(`curl.exe -s -m 15 -X POST http://127.0.0.1:${port}/prompt -H "Content-Type: application/json" -d @${remote.replace(/\//g, "\\\\")}`, SUBMIT_TIMEOUT_MS);
        if (resp.code !== 0) throw httpError(`music runtime rejected submission: ${(resp.stderr || resp.stdout).slice(0, 200)}`, 502);
        const parsed = JSON.parse(resp.stdout);
        if (!parsed.prompt_id) throw httpError(`music runtime returned no prompt_id: ${resp.stdout.slice(0, 200)}`, 502);
        return parsed.prompt_id;
      } finally {
        try { fs.unlinkSync(local); } catch {}
      }
    },
    async fetchHistory(promptId) {
      const resp = await ssh(`curl.exe -s -m 10 http://127.0.0.1:${port}/history/${promptId}`, SUBMIT_TIMEOUT_MS);
      if (resp.code !== 0) return null;
      try { const parsed = JSON.parse(resp.stdout); return parsed[promptId] || null; } catch { return null; }
    },
    async convertToWav(remoteFlac, remoteWav) {
      const resp = await ssh(`${EXECUTION_CONTRACT.remote_ffmpeg} -hide_banner -loglevel error -y -i ${remoteFlac} -c:a pcm_s16le ${remoteWav}`, 120000);
      if (resp.code !== 0) throw httpError(`FLAC→WAV conversion failed: ${(resp.stderr || resp.stdout).slice(0, 200)}`, 502);
    },
    async sha256(remoteFile) {
      const resp = await ssh(`cmd /c certutil -hashfile ${remoteFile} SHA256`, 60000);
      const match = resp.stdout.replace(/ /g, "").match(/^[0-9a-fA-F]{64}$/m);
      return match ? match[0].toLowerCase() : null;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function safePathToken(token) {
  if (/[\s"'`;|&<>$%^()\[\]{}*?]/.test(token)) throw httpError(`unsafe remote path token '${token.slice(0, 60)}'`, 500);
  return token;
}

async function executeMusicCandidate(projectDir, candidate, caption, host, transport) {
  const briefSlug = candidate.brief_id.replace(/[^a-z0-9-]/g, "").slice(0, 60);
  const prefix = `scorecraft/${briefSlug}/${candidate.candidate_id}`;
  const graph = buildMusicWorkflow(caption, candidate.seed, candidate.requested_duration_s);
  graph[9].inputs.filename_prefix = prefix;

  updateCandidateMeta(projectDir, candidate.candidate_id, { status: "submitting", selected_host: host });
  const promptId = await transport.submitPrompt(graph, `scorecraft-${candidate.candidate_id}`);
  updateCandidateMeta(projectDir, candidate.candidate_id, { status: "generating", prompt_id: promptId });

  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  let record = null;
  while (Date.now() < deadline) {
    record = await transport.fetchHistory(promptId);
    if (record && record.status && record.status.completed) break;
    if (record && record.status && record.status.status_str === "error") {
      throw httpError(`music runtime reported an execution error for ${candidate.candidate_id}`, 502);
    }
    await transport.sleep(POLL_INTERVAL_MS);
  }
  if (!record || !record.status || !record.status.completed) {
    throw httpError(`music generation timed out for ${candidate.candidate_id}`, 504);
  }
  const audioOutputs = Object.values(record.outputs || {}).flatMap((o) => o.audio || []);
  if (!audioOutputs.length) throw httpError(`music runtime completed without an audio output for ${candidate.candidate_id}`, 502);
  const flacName = audioOutputs[0].filename;
  const subfolder = audioOutputs[0].subfolder || "";
  const remoteFlac = safePathToken(`${EXECUTION_CONTRACT.remote_workspace}\\ComfyUI\\output\\${subfolder ? `${subfolder.replace(/\//g, "\\")}\\` : ""}${flacName}`);
  const remoteWav = safePathToken(`${EXECUTION_CONTRACT.remote_workspace}\\output\\scorecraft\\${candidate.candidate_id}.wav`);
  await transport.convertToWav(remoteFlac, remoteWav);
  const wavHash = await transport.sha256(remoteWav);
  return updateCandidateMeta(projectDir, candidate.candidate_id, {
    status: "completed",
    native_output_path: remoteFlac,
    converted_output_path: remoteWav,
    output_sha256: wavHash,
  });
}

// ── the bridge operation ────────────────────────────────────────────────────
// One music-generation request at a time per cockpit (Earth Studio lane
// pattern); estate-wide worker exclusivity beyond this remains with the
// compute admission (VRAM/runtime gates) and is noted as an open item.
const STATE = { active: null };

async function requestMusicGeneration(projectId, input = {}, options = {}) {
  if (STATE.active) throw httpError(`A music generation request is already running (${STATE.active}).`, 409);
  const prepared = prepareMusicGeneration(projectId, input, options);
  if (input.prepare_only) {
    return { ...summarize(prepared), dispatch_status: "prepared_only", admission: null };
  }
  STATE.active = projectId;
  try {
    // FRESH canonical admission immediately before dispatch — never cached.
    const gateResult = await selectMusicLane(options);
    const verdict = musicLaneVerdict(gateResult);
    if (!verdict.allow) {
      for (const candidate of prepared.candidates) {
        updateCandidateMeta(prepared.project_dir, candidate.candidate_id, {
          status: "blocked", failure: verdict.reason, admission: gateResult && gateResult.checks ? gateResult : null,
        });
      }
      throw httpError(
        `music_generation is not admitted — ${verdict.reason}. `
        + "The host stays capable; if the reason is the manual-start MiniMax runtime, "
        + "start it on the worker and retry (Scorecraft never auto-starts it).", 503);
    }
    const host = verdict.host;
    const transport = options.transportFn ? options.transportFn(host) : defaultTransport(host);
    const results = [];
    for (const candidate of prepared.candidates) {
      updateCandidateMeta(prepared.project_dir, candidate.candidate_id, { admission: gateResult });
      try {
        results.push(await executeMusicCandidate(prepared.project_dir, candidate, prepared.caption, host, transport));
      } catch (error) {
        updateCandidateMeta(prepared.project_dir, candidate.candidate_id, {
          status: "failed", failure: String(error.message || error).slice(0, 300),
        });
        throw error; // fail closed: no silent continuation past a broken runtime
      }
    }
    return { ...summarize(prepared), dispatch_status: "dispatched", admission: gateResult, selected_host: host, results };
  } finally {
    STATE.active = null;
  }
}

function summarize(prepared) {
  return {
    project_id: prepared.project_id,
    brief_id: prepared.brief_id,
    brief_hash: prepared.brief_hash,
    brief_file: prepared.brief_file,
    brief_valid: true,
    lane: EXECUTION_CONTRACT.lane,
    caption_preview: prepared.caption.slice(0, 200),
    candidates: prepared.candidates.map((c) => ({ candidate_id: c.candidate_id, seed: c.seed, status: c.status })),
  };
}

module.exports = {
  EXECUTION_CONTRACT,
  MAX_CANDIDATES,
  DEFAULT_CANDIDATES,
  buildMusicWorkflow,
  selectMusicLane,
  musicLaneVerdict,
  prepareMusicGeneration,
  executeMusicCandidate,
  requestMusicGeneration,
  _STATE: STATE,
};
