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
const http = require("node:http");
const https = require("node:https");

const contract = require("./music-render-brief.js");
const adapter = require("./adapters/minimax-caption-reference.js");
const scriptSnapshot = require("./script-snapshot.js");
const provenanceLib = require("./score-provenance.js");
const productionCandidates = require("./production-candidates.js");
const resourceRelease = require("./minimax-resource-release.js");

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
  runtime_port: 8189, // localhost-only on the worker; reached ONLY through the operator tunnel below
  // DOCTRINE (2026-08-22): Music3 CONTROL authority = the operator-established
  // local tunnel, NOT ambient SSH. Job submission, history/status polling,
  // runtime inspection, and model-cache release all travel over this HTTP base
  // (default 127.0.0.1:18189, the port ~/bin/vidtoolz-music3 binds). Tunnel
  // down → connection refused → honest fail-closed; there is no SSH control
  // fallback. DATA-plane artifact transfer (FLAC→WAV convert + scp retrieval)
  // remains SSH as a documented bounded exception until an HTTP artifact path
  // (ComfyUI /view) is wired — see DEFERRED note in the audit report.
  control_authority: "operator_tunnel",
  operator_tunnel_url: process.env.MUSIC3_TUNNEL_URL || "http://127.0.0.1:18189",
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
function musicCandidatesDir(projectDir) { return productionCandidates.root(projectDir); }

function nextMusicCandidateNumber(projectDir) {
  let existing = [];
  try { existing = fs.readdirSync(musicCandidatesDir(projectDir)); } catch { return 1; }
  const numbers = existing.map((name) => Number((name.match(/^music-candidate-(\d+)$/) || [])[1]) || 0);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

function updateCandidateMeta(projectDir, candidateId, patch) {
  return productionCandidates.update(projectDir, candidateId, patch);
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

  // v1.5: per-candidate interpretations → per-candidate briefs/captions, so
  // three Scorecraft concepts reach MiniMax as three genuinely different
  // requests instead of one collapsed caption. The canonical project brief
  // remains the approved-plan artifact; candidate briefs are derivations.
  const interpretations = require("./interpretations.js");
  const briefExporter = require("./brief-exporter.js");
  const contrast = interpretations.selectContrastSet(project, { script_text: scriptSnapshot.readScriptSnapshot(projectDir) });
  const concepts = [...contrast.concepts, ...contrast.spares];
  const planRevisionId = project.current_plan_revision_id || provenanceLib.cueSheetHash(project.cues || []);
  const generationJobId = `music-job-${crypto.randomUUID()}`;

  const startNumber = nextMusicCandidateNumber(projectDir);
  const workflowHash = sha256Text(canonicalJson(buildMusicWorkflow(caption.caption, 0, brief.target_duration_s)));
  const candidates = [];
  for (let i = 0; i < count; i += 1) {
    const candidateId = `music-candidate-${String(startNumber + i).padStart(3, "0")}`;
    const seed = baseSeed + i; // existing Scorecraft candidate-seed convention
    const concept = concepts[i % concepts.length];
    const overrides = interpretations.briefOverridesForConcept(concept);
    const candidateBrief = briefExporter.deriveMusicRenderBrief(project, project.cues, require("./score-schemas.js").DEFAULT_PALETTES, require("./score-schemas.js").INSTRUMENT_ROLES, overrides);
    const candidateCaption = adapter.renderMiniMaxCaption(candidateBrief);
    const candidateBriefHash = sha256Text(canonicalJson(candidateBrief));
    const captionHash = sha256Text(candidateCaption.caption);
    const meta = {
      candidate_id: candidateId,
      project_id: project.project_id,
      backend: productionCandidates.BACKEND,
      candidate_kind: productionCandidates.CANDIDATE_KIND,
      plan_revision_id: planRevisionId,
      generation_job_id: generationJobId,
      brief_id: brief.brief_id,
      brief_hash: briefHash,
      brief_file: exported.file,
      interpretation: concept ? { interpretation_id: concept.interpretation_id, label: concept.label, axes: concept.axes } : null,
      candidate_brief_hash: candidateBriefHash,
      caption: candidateCaption.caption,
      caption_hash: captionHash,
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
      human_verdict: "unreviewed",
      approval_status: "pending",
      candidate_input_hash: null,
      candidate_content_hash: null,
      provenance_schema_version: provenanceLib.PROVENANCE_SCHEMA_VERSION,
      generation_started_at: null,
      generation_completed_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    meta.candidate_input_hash = productionCandidates.inputIdentity(meta);
    productionCandidates.create(projectDir, meta);
    candidates.push(meta);
  }
  return {
    project_id: projectId,
    generation_job_id: generationJobId,
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
function defaultTransport(host, deps = {}) {
  const run = (argv, timeoutMs) => new Promise((resolve) => {
    childProcess.execFile(argv[0], argv.slice(1), { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code === undefined ? 1 : err.code) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
  const ssh = (remoteCmd, timeoutMs) => run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, remoteCmd], timeoutMs);
  // CONTROL PLANE: operator tunnel (HTTP), never ambient SSH. Injectable for tests.
  const req = deps.httpRequestImpl || tunnelRequest;
  const base = deps.tunnelBase || EXECUTION_CONTRACT.operator_tunnel_url;
  const unreachable = (error) => httpError(
    `music runtime is not reachable over the operator tunnel (${base}) — start it on the worker with vidtoolz-music3 and retry (Scorecraft never auto-starts it): ${error.message}`, 503);
  return {
    resourceLifecycle: "comfyui-real",
    async submitPrompt(graph, clientId) {
      // Control payload goes straight over the tunnel — no scp, no shell.
      let resp;
      try { resp = await req(base, "POST", "/prompt", { prompt: graph, client_id: clientId }, SUBMIT_TIMEOUT_MS); }
      catch (error) { throw unreachable(error); }
      if (resp.status !== 200) throw httpError(`music runtime rejected submission (HTTP ${resp.status}): ${String(resp.body).slice(0, 200)}`, 502);
      let parsed;
      try { parsed = JSON.parse(resp.body); } catch { throw httpError("music runtime returned a non-JSON submission response", 502); }
      if (!parsed.prompt_id) throw httpError("music runtime returned no prompt_id", 502);
      // Untrusted runtime output: validate to a strict shape before it is stored
      // or used to build any later request path. Reject, never sanitize.
      return safePromptId(parsed.prompt_id);
    },
    async fetchHistory(promptId) {
      // Defense in depth: validate before the id is placed in a request path.
      safePromptId(promptId);
      let resp;
      try { resp = await req(base, "GET", `/history/${encodeURIComponent(promptId)}`, null, SUBMIT_TIMEOUT_MS); }
      catch { return null; } // transport blip → "still rendering"; poll loop bounds this
      if (resp.status !== 200) return null;
      try { const parsed = JSON.parse(resp.body); return parsed[promptId] || null; } catch { return null; }
    },
    async convertToWav(remoteFlac, remoteWav) {
      const resp = await ssh(`${EXECUTION_CONTRACT.remote_ffmpeg} -hide_banner -loglevel error -y -i ${remoteFlac} -c:a pcm_s16le ${remoteWav}`, 120000);
      if (resp.code !== 0) throw httpError(`FLAC→WAV conversion failed: ${(resp.stderr || resp.stdout).slice(0, 200)}`, 502);
    },
    async ensureRemoteDir(remoteDir) {
      // The remote ffmpeg refuses to create missing parent directories, and
      // a brand-new install has no output/scorecraft folder yet. mkdir is
      // idempotent with `2>nul`, so calling it on every conversion is safe.
      const resp = await ssh(`cmd /c "mkdir ${remoteDir} 2>nul & exit /b 0"`, SUBMIT_TIMEOUT_MS);
      if (resp.code !== 0) throw httpError(`remote output dir preparation failed: ${(resp.stderr || resp.stdout).slice(0, 200)}`, 502);
    },
    async retrieve(remoteFile, localFile) {
      const down = await run(["scp", "-q", "-o", "BatchMode=yes", `${host}:${remoteFile.replace(/\\/g, "/")}`, localFile], 300000);
      if (down.code !== 0) throw httpError(`music deliverable download failed: ${(down.stderr || down.stdout).slice(0, 200)}`, 502);
    },
    async sha256(remoteFile) {
      const resp = await ssh(`cmd /c certutil -hashfile ${remoteFile} SHA256`, 60000);
      const match = resp.stdout.replace(/ /g, "").match(/^[0-9a-fA-F]{64}$/m);
      return match ? match[0].toLowerCase() : null;
    },
    async inspectRuntime() {
      let queueResponse;
      let statsResponse;
      try {
        queueResponse = await req(base, "GET", "/queue", null, SUBMIT_TIMEOUT_MS);
        statsResponse = await req(base, "GET", "/system_stats", null, SUBMIT_TIMEOUT_MS);
      } catch (error) {
        throw new Error(`MiniMax runtime inspection failed over the operator tunnel (${base}): ${error.message}`);
      }
      if (queueResponse.status !== 200 || statsResponse.status !== 200) {
        throw new Error(`MiniMax runtime inspection failed: HTTP ${queueResponse.status}/${statsResponse.status}`);
      }
      let queue;
      let stats;
      try {
        queue = JSON.parse(queueResponse.body);
        stats = JSON.parse(statsResponse.body);
      } catch (error) {
        throw new Error(`MiniMax runtime inspection returned malformed JSON: ${error.message}`);
      }
      if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) {
        throw new Error("MiniMax runtime queue response has no authoritative running/pending arrays");
      }
      const cuda = Array.isArray(stats.devices) ? stats.devices.find((device) => device && device.type === "cuda") : null;
      if (!cuda || !Number.isFinite(Number(cuda.vram_free))) {
        throw new Error("MiniMax runtime stats response has no authoritative CUDA free-VRAM value");
      }
      const freeVramMiB = Math.round(Number(cuda.vram_free) / (1024 * 1024));
      return {
        healthy: true,
        queue_running: queue.queue_running.length,
        queue_pending: queue.queue_pending.length,
        free_vram_mib: freeVramMiB,
      };
    },
    async freeResources() {
      // Model-cache release is a control action → operator tunnel, not ssh+powershell.
      let response;
      try { response = await req(base, "POST", "/free", { unload_models: true, free_memory: true }, SUBMIT_TIMEOUT_MS); }
      catch (error) { throw new Error(`MiniMax /free request failed over the operator tunnel (${base}): ${error.message}`); }
      if (response.status !== 200) throw new Error(`MiniMax /free returned HTTP ${response.status}`);
      return { status: 200 };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

// Control-plane HTTP over the operator tunnel. Resolves/rejects with a plain
// {status, body}; connection failure (tunnel down) rejects so callers can
// fail closed. Injectable in tests via options.httpRequestImpl.
function tunnelRequest(base, method, pathname, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(pathname, base); } catch (error) { reject(error); return; }
    const lib = url.protocol === "https:" ? https : http;
    const payload = bodyObj == null ? null : Buffer.from(JSON.stringify(bodyObj));
    const req = lib.request(url, {
      method,
      timeout: timeoutMs,
      headers: payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// A ComfyUI prompt id is a UUID-shaped token, but it arrives from the remote
// runtime's JSON response and is later interpolated into a remote `ssh` command
// (fetchHistory). Treat it as untrusted: validate to a strict shape and REJECT
// anything else — never sanitize a malicious value into a usable one — before
// it can reach a shell/argv/URL boundary. Fail closed.
const PROMPT_ID_RE = /^[0-9a-f-]{8,64}$/i;
function safePromptId(value) {
  if (typeof value !== "string" || !PROMPT_ID_RE.test(value)) {
    // Do not echo the raw value: it could itself be command text in a log
    // scraped by another tool. Report only its length.
    throw httpError(`music runtime returned an invalid prompt_id (length ${value == null ? 0 : String(value).length}); refusing to use it`, 502);
  }
  return value;
}

function safePathToken(token) {
  if (/[\s"'`;|&<>$%^()\[\]{}*?]/.test(token)) throw httpError(`unsafe remote path token '${token.slice(0, 60)}'`, 500);
  // Remote paths are assembled from ComfyUI's returned filename/subfolder.
  // Keep the Windows path syntax needed by the worker, but do not allow a
  // returned output to escape the worker-owned workspace.
  const segments = token.replace(/\//g, "\\").split("\\");
  if (segments.some((segment) => segment === "..")) {
    throw httpError(`unsafe remote path token '${token.slice(0, 60)}'`, 500);
  }
  return token;
}

async function executeMusicCandidate(projectDir, candidate, caption, host, transport) {
  const briefSlug = candidate.brief_id.replace(/[^a-z0-9-]/g, "").slice(0, 60);
  const prefix = `scorecraft/${briefSlug}/${candidate.candidate_id}`;
  const graph = buildMusicWorkflow(caption, candidate.seed, candidate.requested_duration_s);
  graph[9].inputs.filename_prefix = prefix;

  updateCandidateMeta(projectDir, candidate.candidate_id, {
    status: "submitting", selected_host: host, generation_started_at: nowIso(), failure: null,
  });
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
  await transport.ensureRemoteDir(`${EXECUTION_CONTRACT.remote_workspace}\\output\\scorecraft`);
  await transport.convertToWav(remoteFlac, remoteWav);
  const wavHash = await transport.sha256(remoteWav);
  if (typeof wavHash !== "string" || !/^[0-9a-f]{64}$/i.test(wavHash)) {
    throw httpError(`music runtime returned no usable SHA-256 for ${candidate.candidate_id}`, 502);
  }
  // Retrieve the deliverable so it is playable from this machine without
  // touching the worker filesystem (GUI file API serves project-local files).
  const localWav = path.join(projectDir, "music-candidates", candidate.candidate_id, "production.wav");
  await transport.retrieve(remoteWav, localWav);
  if (!fs.existsSync(localWav) || !fs.statSync(localWav).isFile()) {
    throw httpError(`music deliverable retrieval produced no local artifact for ${candidate.candidate_id}`, 502);
  }
  const localHash = provenanceLib.sha256File(localWav);
  if (localHash !== wavHash) {
    throw httpError(`music deliverable hash mismatch after retrieval for ${candidate.candidate_id}`, 502);
  }
  const candidateContentHash = productionCandidates.contentIdentity(candidate.candidate_input_hash, localHash);
  return updateCandidateMeta(projectDir, candidate.candidate_id, {
    status: "completed",
    native_output_path: remoteFlac,
    converted_output_path: remoteWav,
    local_deliverable_path: localWav,
    output_sha256: wavHash,
    candidate_content_hash: candidateContentHash,
    generation_completed_at: nowIso(),
  });
}

// ── the bridge operation ────────────────────────────────────────────────────
// One music-generation request at a time per cockpit (Earth Studio lane
// pattern); estate-wide worker exclusivity beyond this remains with the
// compute admission (VRAM/runtime gates) and is noted as an open item.
const STATE = { active: null, active_candidates: new Set(), jobs: new Map(), release_jobs: new Map() };

function candidateActivityKey(projectId, candidateId) {
  return `${projectId}:${candidateId}`;
}

function isCandidateActive(projectId, candidateId) {
  return STATE.active_candidates.has(candidateActivityKey(projectId, candidateId));
}

async function admitPrepared(prepared, options) {
  const gateResult = await selectMusicLane(options);
  const verdict = musicLaneVerdict(gateResult);
  if (!verdict.allow) {
    for (const candidate of prepared.candidates) {
      updateCandidateMeta(prepared.project_dir, candidate.candidate_id, {
        status: "blocked",
        failure: verdict.reason,
        generation_completed_at: nowIso(),
        admission: gateResult && gateResult.checks ? gateResult : null,
      });
    }
    throw httpError(
      `music_generation is not admitted — ${verdict.reason}. `
      + "The host stays capable; if the reason is the manual-start MiniMax runtime, "
      + "start it on the worker and retry (Scorecraft never auto-starts it).", 503,
    );
  }
  return { gateResult, host: verdict.host };
}

async function executePrepared(prepared, admission, options = {}) {
  const { gateResult, host } = admission;
  const transport = options.transportFn ? options.transportFn(host) : defaultTransport(host);
  const results = [];
  let response;
  try {
    for (const candidate of prepared.candidates) {
      updateCandidateMeta(prepared.project_dir, candidate.candidate_id, { admission: gateResult });
      try {
        results.push(await executeMusicCandidate(
          prepared.project_dir, candidate, candidate.caption || prepared.caption, host, transport,
        ));
        STATE.active_candidates.delete(candidateActivityKey(prepared.project_id, candidate.candidate_id));
      } catch (error) {
        updateCandidateMeta(prepared.project_dir, candidate.candidate_id, {
          status: "failed",
          failure: String(error.message || error).slice(0, 300),
          generation_completed_at: nowIso(),
        });
        STATE.active_candidates.delete(candidateActivityKey(prepared.project_id, candidate.candidate_id));
        for (const remaining of prepared.candidates) {
          const remainingKey = candidateActivityKey(prepared.project_id, remaining.candidate_id);
          if (!STATE.active_candidates.has(remainingKey)) continue;
          updateCandidateMeta(prepared.project_dir, remaining.candidate_id, {
            status: "failed",
            failure: `Generation stopped after ${candidate.candidate_id} failed. Retry this candidate.`,
            generation_completed_at: nowIso(),
          });
          STATE.active_candidates.delete(remainingKey);
        }
        throw error;
      }
    }
    response = { ...summarize(prepared), dispatch_status: "dispatched", admission: gateResult, selected_host: host, results };
  } finally {
    const release = await resourceRelease.releaseWhenIdle({
      transport,
      isLocallyIdle: () => STATE.active_candidates.size === 0,
      ...(options.resourceReleaseOptions || {}),
    });
    for (const candidate of prepared.candidates) {
      try { updateCandidateMeta(prepared.project_dir, candidate.candidate_id, { resource_release: release }); }
      catch (error) { console.warn(`[music-dispatch] resource-release record failed for ${candidate.candidate_id}: ${error.message}`); }
    }
    const log = release.status === "failed" ? console.warn : console.info;
    log(`[music-dispatch] MiniMax resource release ${JSON.stringify({ job_id: prepared.generation_job_id, host, ...release })}`);
  }
  return { ...response, resource_release: prepared.candidates.length
    ? productionCandidates.findRecord(prepared.project_dir, prepared.candidates[0].candidate_id).meta.resource_release : null };
}

function scheduleReconciledResourceRelease(projectDir, meta, options = {}) {
  const jobId = meta && meta.generation_job_id;
  const host = meta && meta.selected_host;
  if (!jobId || !host || meta.backend !== productionCandidates.BACKEND
    || meta.resource_release && ["released", "skipped"].includes(meta.resource_release.status)) return null;
  if (STATE.release_jobs.has(jobId)) return STATE.release_jobs.get(jobId);
  const transport = options.transportFn ? options.transportFn(host) : defaultTransport(host);
  const promise = resourceRelease.releaseWhenIdle({
    transport,
    isLocallyIdle: () => !STATE.active && STATE.active_candidates.size === 0,
    idleWaitMs: GENERATION_TIMEOUT_MS,
    ...(options.resourceReleaseOptions || {}),
  }).then((release) => {
    try { updateCandidateMeta(projectDir, meta.candidate_id, { resource_release: release }); }
    catch (error) { console.warn(`[music-dispatch] reconciled resource-release record failed for ${meta.candidate_id}: ${error.message}`); }
    return release;
  }).catch((error) => ({ status: "failed", attempted: false, reason: "release_coordinator_failed", detail: String(error.message || error).slice(0, 300) }))
    .finally(() => STATE.release_jobs.delete(jobId));
  STATE.release_jobs.set(jobId, promise);
  return promise;
}

async function requestMusicGeneration(projectId, input = {}, options = {}) {
  if (STATE.active || STATE.release_jobs.size) throw httpError(`A music generation request or recovery cleanup is already running (${STATE.active || "resource release"}).`, 409);
  const prepared = prepareMusicGeneration(projectId, input, options);
  if (input.prepare_only) {
    return { ...summarize(prepared), dispatch_status: "prepared_only", admission: null };
  }
  STATE.active = projectId;
  try {
    const admission = await admitPrepared(prepared, options);
    for (const candidate of prepared.candidates) STATE.active_candidates.add(candidateActivityKey(prepared.project_id, candidate.candidate_id));
    return await executePrepared(prepared, admission, options);
  } finally {
    for (const candidate of prepared.candidates) STATE.active_candidates.delete(candidateActivityKey(prepared.project_id, candidate.candidate_id));
    STATE.active = null;
  }
}

async function startMusicGeneration(projectId, input = {}, options = {}) {
  if (STATE.active || STATE.release_jobs.size) throw httpError(`A music generation request or recovery cleanup is already running (${STATE.active || "resource release"}).`, 409);
  const prepared = prepareMusicGeneration(projectId, input, options);
  STATE.active = projectId;
  let admission;
  try {
    admission = await admitPrepared(prepared, options);
  } catch (error) {
    STATE.active = null;
    throw error;
  }
  for (const candidate of prepared.candidates) {
    STATE.active_candidates.add(candidateActivityKey(prepared.project_id, candidate.candidate_id));
    updateCandidateMeta(prepared.project_dir, candidate.candidate_id, {
      status: "queued", admission: admission.gateResult,
    });
  }
  const job = executePrepared(prepared, admission, options)
    .catch(() => null)
    .finally(() => {
      for (const candidate of prepared.candidates) STATE.active_candidates.delete(candidateActivityKey(prepared.project_id, candidate.candidate_id));
      STATE.jobs.delete(prepared.generation_job_id);
      STATE.active = null;
    });
  STATE.jobs.set(prepared.generation_job_id, job);
  return {
    ...summarize(prepared),
    generation_job_id: prepared.generation_job_id,
    dispatch_status: "queued",
    candidates: prepared.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      backend: productionCandidates.BACKEND,
      generation_status: "queued",
      status: "queued",
    })),
    admission: admission.gateResult,
    selected_host: admission.host,
  };
}

function summarize(prepared) {
  return {
    project_id: prepared.project_id,
    generation_job_id: prepared.generation_job_id,
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
  startMusicGeneration,
  scheduleReconciledResourceRelease,
  isCandidateActive,
  updateCandidateMeta,
  defaultTransport,
  safePromptId,
  tunnelRequest,
  _STATE: STATE,
};
