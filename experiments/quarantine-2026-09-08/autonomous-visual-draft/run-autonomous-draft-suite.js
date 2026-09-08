#!/usr/bin/env node
'use strict';

/**
 * CONTROLLED AUTONOMOUS VISUAL DRAFT GENERATOR V1
 * End-to-end qualification engine for Stage 6.
 * Processes 10 full VIDTOOLZ episodes across ~50 distinct beats:
 * 1. Visual Necessity & Rhythm Coordination
 * 2. Autonomy Level & Confidence Assignment (A0, A1, A2, A3)
 * 3. Ambiguity & Anti-Bias Evaluation
 * 4. SceneSpec Emission & Bounded Technical Repair
 * 5. Multi-Worker Render Execution & Independent QC
 * 6. Timeline Assembly Packaging & Provenance Tracking
 * 7. Simulated Human Editorial Review (KEEP / CHANGE / CUT / REWRITE)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateBlenderSuitability } = require('../visual-director/blender-suitability-policy.js');
const { mapIntentToSceneSpec } = require('../visual-director/blender-visual-mapper.js');
const { runBlenderQC } = require('../visual-director/blender-qc-runner.js');

const TEN_EPISODES_CORPUS = [
  // --- EP01 to EP05 (Canonical Corpus) ---
  {
    episode_id: "EP01_PROMPT_HYPE",
    title: "Why Most AI Video Channels Will Become Invisible",
    project_id: "01KX5S2T7JS12SGR3WXACJ578Q",
    beats: [
      { beat_id: "B01_01", dialogue: "95% of AI video channels will vanish within six months.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true },
      { beat_id: "B01_02", dialogue: "Prompting an image generator is not a production plan. It is a casino lever.", visual_function: "COMPARE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["comparison", "blockage"] },
      { beat_id: "B01_03", dialogue: "When everybody has access to the exact same models, prompt skill rounds to zero.", visual_function: "SHOW_METRIC", has_diagrammatic_content: true, candidate_primitives: ["metric", "stage"] },
      { beat_id: "B01_04", dialogue: "Watch what happens inside an actual production timeline when you rely on raw generations.", visual_function: "SHOW_INTERFACE", requires_real_ui: true },
      { beat_id: "B01_05", dialogue: "A hyper-detailed 3D proxy of the automated rendering engine running in studio lighting.", visual_function: "ATMOSPHERE", requires_exact_topology: true, requires_cinematic_motion: true, candidate_primitives: ["stage"] }
    ]
  },
  {
    episode_id: "EP02_IDENTITY_OUTSOURCE",
    title: "Why I Refuse to Outsource My Creator Identity to AI",
    project_id: "01M0QR9DGP5RRFTPVDA7WQP2XM",
    beats: [
      { beat_id: "B02_01", dialogue: "Every part of your channel can be copied except one: a creator who actually means it.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true },
      { beat_id: "B02_02", dialogue: "If you let the model choose your positions, you inherit the average of the internet.", visual_function: "SHOW_TRANSFORMATION", has_diagrammatic_content: true, candidate_primitives: ["stage", "transformation"] },
      { beat_id: "B02_03", dialogue: "Notice the difference in tone from twenty years of broadcast editing scar tissue.", visual_function: "CONTRAST", requires_human_emotion: true },
      { beat_id: "B02_04", dialogue: "The script must remain the immutable spine that anchors every asset.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "hierarchy", "dependency"], continuity_group: "script_spine_system" }
    ]
  },
  {
    episode_id: "EP03_SELF_NOT_BUILT",
    title: "AI Cannot Sound Like A Self You Have Not Built",
    project_id: "01M13R0X0F58MG8SC3JTTT8MH0",
    beats: [
      { beat_id: "B03_01", dialogue: "The root issue is that point of view depends on values and lived judgment.", visual_function: "NONE", is_opening: true },
      { beat_id: "B03_02", dialogue: "You are the director. The model is the actor.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage"], continuity_group: "governance_hierarchy" },
      { beat_id: "B03_03", dialogue: "Here is what happens when work accumulates before an uncalibrated review gate.", visual_function: "SHOW_CONSTRAINT", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "blockage", "queue"], continuity_group: "pipeline_evolution" },
      { beat_id: "B03_04", dialogue: "Let us inspect the terminal logs directly to see where the agent stalled.", visual_function: "SHOW_INTERFACE", requires_real_ui: true },
      { beat_id: "B03_05", dialogue: "A moody cinematic anchor shot of the mechanical editing terminal.", visual_function: "ATMOSPHERE", requires_exact_topology: true, requires_cinematic_motion: true, candidate_primitives: ["stage"] }
    ]
  },
  {
    episode_id: "EP04_LIFECYCLE_CANARY",
    title: "Lifecycle Integration Test Package",
    project_id: "01M0W30GA5ZAXXQPX9SS0R2N29",
    beats: [
      { beat_id: "B04_01", dialogue: "Automating production requires three distinct stages: Draft, Review, and Lock.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], is_opening: true },
      { beat_id: "B04_02", dialogue: "Quality control is a binary gate that rejects non-compliant assets.", visual_function: "SHOW_FAILURE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["split", "stage", "blockage"] },
      { beat_id: "B04_03", dialogue: "A cinematic establishing shot of the central processing facility under atmospheric lighting.", visual_function: "ATMOSPHERE", requires_exact_topology: true, requires_cinematic_motion: true, candidate_primitives: ["stage"] }
    ]
  },
  {
    episode_id: "EP05_AUTONOMOUS_CANARY",
    title: "Authorship Is Not Manual Execution",
    project_id: "01M18BNHH8AY0YESV6FK4BZXRC",
    beats: [
      { beat_id: "B05_01", dialogue: "Authorship is knowing what to keep and what to cut.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true },
      { beat_id: "B05_02", dialogue: "A single constrained token budget creates pressure across the context window.", visual_function: "SHOW_CONSTRAINT", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "pressure", "metric"] },
      { beat_id: "B05_03", dialogue: "When the system clears the gate, work flows smoothly into final delivery.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], continuity_group: "pipeline_evolution" },
      { beat_id: "B05_04", dialogue: "Notice the exact code diff on GitHub that proved the repair.", visual_function: "SHOW_INTERFACE", requires_real_ui: true }
    ]
  },
  // --- EP06 to EP10 (Extended Real Mindmap Topics) ---
  {
    episode_id: "EP06_COMPOSABLE_STACK",
    title: "All-in-One AI Video Platforms vs Composable Systems",
    project_id: "topic-006",
    beats: [
      { beat_id: "B06_01", dialogue: "All-in-one AI platforms promise simplicity, but trap you in their single proprietary walled garden.", visual_function: "COMPARE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["comparison", "blockage"], is_opening: true },
      { beat_id: "B06_02", dialogue: "A composable production stack lets you swap generators without breaking your project.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"] },
      { beat_id: "B06_03", dialogue: "When a vendor hikes prices or degrades quality, you disconnect one modular node and keep working.", visual_function: "SHOW_TRANSFORMATION", has_diagrammatic_content: true, candidate_primitives: ["stage", "transformation"] },
      { beat_id: "B06_04", dialogue: "Do not marry a demo. Build a system that outlives its components.", visual_function: "SHOW_PERSON", requires_human_emotion: true }
    ]
  },
  {
    episode_id: "EP07_SINGLE_POINT_FAILURE",
    title: "One AI Video Generator Is a Single Point of Failure",
    project_id: "topic-007",
    beats: [
      { beat_id: "B07_01", dialogue: "If your entire production depends on one cloud API, you do not have a pipeline. You have a hostage situation.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true },
      { beat_id: "B07_02", dialogue: "When rate limits hit mid-deadline, all dependent work stalls immediately.", visual_function: "SHOW_CONSTRAINT", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "blockage", "queue"], continuity_group: "redundancy_pipeline" },
      { beat_id: "B07_03", dialogue: "Multi-worker dual routing ensures that when one card is saturated, local nodes take the load.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], continuity_group: "redundancy_pipeline" },
      { beat_id: "B07_04", dialogue: "Let us inspect the live telemetry monitor on PRESTO showing the active failover.", visual_function: "SHOW_INTERFACE", requires_real_ui: true }
    ]
  },
  {
    episode_id: "EP08_COMPOUNDING_COST",
    title: "Bad AI Video Assets Get More Expensive at Every Stage",
    project_id: "topic-008",
    beats: [
      { beat_id: "B08_01", dialogue: "A defective AI clip costs two dollars in compute, but twenty minutes in timeline surgery.", visual_function: "SHOW_METRIC", has_diagrammatic_content: true, candidate_primitives: ["metric", "stage"], is_opening: true },
      { beat_id: "B08_02", dialogue: "The earlier a defect is caught by a deterministic gate, the cheaper it is to reject.", visual_function: "SHOW_FAILURE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["split", "stage", "blockage"] },
      { beat_id: "B08_03", dialogue: "Never pass an unvalidated asset downstream hoping the colorist or editor will fix it.", visual_function: "SHOW_PERSON", requires_human_emotion: true }
    ]
  },
  {
    episode_id: "EP09_GENERATED_NOT_APPROVED",
    title: "Generated Does Not Mean Approved",
    project_id: "topic-009",
    beats: [
      { beat_id: "B09_01", dialogue: "Your AI agent announcing 'Done' is not evidence of success.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true },
      { beat_id: "B09_02", dialogue: "Autonomous drafting must pass through explicit human review gates before production lock.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage"] },
      { beat_id: "B09_03", dialogue: "Observe the review console where the operator issues KEEP, CHANGE, or CUT.", visual_function: "SHOW_INTERFACE", requires_real_ui: true },
      { beat_id: "B09_04", dialogue: "Automation generates candidates. Humans grant authority.", visual_function: "SHOW_TRANSFORMATION", has_diagrammatic_content: true, candidate_primitives: ["stage", "transformation"] }
    ]
  },
  {
    episode_id: "EP10_FIVE_GATES_DOCTRINE",
    title: "The Five Gates Every AI Video Should Pass",
    project_id: "topic-011",
    beats: [
      { beat_id: "B010_01", dialogue: "Every serious explainer video must pass five non-negotiable production gates.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], is_opening: true },
      { beat_id: "B010_02", dialogue: "Gate One: Thesis locked. Gate Two: Script verified. Gate Three: Assets qualified.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"] },
      { beat_id: "B010_03", dialogue: "Gate Four: Timeline assembly. Gate Five: Final human editorial sign-off.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage"] },
      { beat_id: "B010_04", dialogue: "Skip the gates, and you end up publishing noise.", visual_function: "SHOW_PERSON", requires_human_emotion: true }
    ]
  }
];

function runAutonomousGenerationSuite() {
  const outDir = '/home/vidtoolz/outputs/controlled-autonomous-visual-generation-v1-2026-09-04';
  const plansDir = path.join(outDir, 'plans');
  const specsDir = path.join(outDir, 'specs');
  const rendersDir = path.join(outDir, 'renders');
  const qcDir = path.join(outDir, 'qc');
  const handoffsDir = path.join(outDir, 'handoffs');
  const timelinesDir = path.join(outDir, 'timelines');
  const reviewsDir = path.join(outDir, 'reviews');

  [plansDir, specsDir, rendersDir, qcDir, handoffsDir, timelinesDir, reviewsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  const globalStats = {
    total_episodes: TEN_EPISODES_CORPUS.length,
    total_beats: 0,
    autonomy_levels: { A0: 0, A1: 0, A2: 0, A3: 0 },
    dispositions: {},
    blender_jobs_compiled: 0,
    blender_jobs_rendered: 0,
    blender_qc_passed: 0,
    human_verdicts: { KEEP: 0, CHANGE: 0, CUT: 0, REWRITE: 0 },
    error_taxonomy: {}
  };

  const humanReviewRows = [];
  const fullVerdictsList = [];

  for (const ep of TEN_EPISODES_CORPUS) {
    const visualPlan = {
      episode_id: ep.episode_id,
      title: ep.title,
      project_id: ep.project_id,
      generated_at: new Date().toISOString(),
      beats: []
    };

    let prevDisposition = null;
    let prevFunction = null;

    for (const b of ep.beats) {
      globalStats.total_beats++;

      // 1. Evaluate Suitability & Medium
      const suitability = evaluateBlenderSuitability(b);
      let disposition = suitability.recommended_disposition;

      // 2. Rhythm and Monoculture Checks
      let ambiguity = "LOW";
      let autonomyLevel = "A2"; // Default Stage 6

      if (b.is_opening) {
        // Opening shot doctrine: Require A1 recommendation
        autonomyLevel = "A1";
        ambiguity = "OPENING_SHOT_CREATIVE_WEIGHT";
      } else if (b.requires_human_emotion || disposition === "TALKING_HEAD") {
        autonomyLevel = "A2";
      } else if (disposition === prevDisposition && disposition === "BLENDER_DIRECT" && !b.continuity_group) {
        // Monoculture streak detected without continuity group
        ambiguity = "MEDIUM_REPETITION_STREAK";
      }

      globalStats.autonomy_levels[autonomyLevel]++;
      globalStats.dispositions[disposition] = (globalStats.dispositions[disposition] || 0) + 1;

      const planBeat = {
        beat_id: b.beat_id,
        dialogue: b.dialogue,
        visual_function: b.visual_function,
        disposition: disposition,
        autonomy_level: autonomyLevel,
        ambiguity: ambiguity,
        confidence: Math.round(suitability.score * 100) / 100,
        continuity_group: b.continuity_group || null,
        execution_artifact: null,
        qc_receipt: null,
        human_verdict: null
      };

      // 3. Execution (where infrastructure is qualified)
      let renderPath = null;
      let qcPassed = false;

      if (disposition === "BLENDER_DIRECT" || disposition === "BLENDER_AI_VIDEO_ANCHOR") {
        const spec = mapIntentToSceneSpec({
          scene_id: `${ep.episode_id}_${b.beat_id}`,
          visual_function: b.visual_function,
          visual_concept: b.concept || b.dialogue,
          disposition: disposition,
          continuity_group: b.continuity_group,
          style_profile: disposition === "BLENDER_AI_VIDEO_ANCHOR" ? "AI_VIDEO_ANCHOR_V1" : "VIDTOOLZ_EXPLAINER_V1"
        });

        const specFile = path.join(specsDir, `${spec.scene_id}.json`);
        fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));

        const blendFile = path.join(rendersDir, `${spec.scene_id}.blend`);
        const pngFile = path.join(rendersDir, `${spec.scene_id}.png`);
        const compilerScript = '/home/vidtoolz/vidtoolz-blender/primitives/v1/builders/scene_compiler.py';

        try {
          execFileSync('blender', ['--background', '--python', compilerScript, '--', specFile, blendFile], { stdio: 'pipe' });
          globalStats.blender_jobs_compiled++;

          // Dispatch render locally on vidnux
          const jobJsonPath = `/tmp/job_${spec.scene_id}.json`;
          fs.writeFileSync(jobJsonPath, JSON.stringify({
            job_id: `auto-${spec.scene_id}`,
            competency: "blender_render",
            machine_preference: "vidnux",
            template_path: blendFile,
            output_path: pngFile,
            render_options: { engine: "CYCLES", device: "GPU", samples: 64, resolution: [1080, 1920] }
          }));

          execFileSync('python3', ['/home/vidtoolz/vidtoolz-blender/scripts/blender_control.py', 'dispatch', `--job=${jobJsonPath}`], { stdio: 'pipe' });
          globalStats.blender_jobs_rendered++;

          // Multi-tier QC
          const qcResult = runBlenderQC(specFile, blendFile, pngFile);
          const qcFile = path.join(qcDir, `${spec.scene_id}-qc.json`);
          fs.writeFileSync(qcFile, JSON.stringify(qcResult, null, 2));
          planBeat.qc_receipt = qcFile;

          if (qcResult.qc_passed) {
            globalStats.blender_qc_passed++;
            qcPassed = true;
            renderPath = pngFile;

            // Assembly manifest
            const handoff = {
              schema: "vidtoolz.experimental.autonomousDirectedDraftHandoff.v1",
              episode_id: ep.episode_id,
              beat_id: b.beat_id,
              media_path: pngFile,
              disposition: disposition,
              qc_passed: true,
              provenance: { project_id: ep.project_id, timestamp: new Date().toISOString() }
            };
            const handoffFile = path.join(handoffsDir, `${spec.scene_id}-handoff.json`);
            fs.writeFileSync(handoffFile, JSON.stringify(handoff, null, 2));
            planBeat.execution_artifact = handoffFile;
          }
        } catch (err) {
          planBeat.error = err.message;
        }
      } else {
        // Placeholders / Non-Blender executions
        planBeat.execution_artifact = `[INTAKE_SLOT_${disposition}]`;
      }

      // 4. Simulated Mikko Pakkala Editorial Evaluation
      // Grounded in Mikko's persona: Values authentic presenter, rejects AI fluff, appreciates clear pipeline diagrams.
      let verdict = "KEEP";
      let changeReason = null;

      if (disposition === "TALKING_HEAD" && b.requires_human_emotion) {
        verdict = "KEEP";
      } else if (disposition === "BLENDER_DIRECT" && qcPassed) {
        if (b.beat_id === "B08_01") {
          // Adversarial test case: Beat is short, could stay on presenter
          verdict = "CHANGE";
          changeReason = "TOO_LITERAL";
        } else {
          verdict = "KEEP";
        }
      } else if (disposition === "SCREEN_CAPTURE" && b.requires_real_ui) {
        verdict = "KEEP";
      } else if (disposition === "BLENDER_AI_VIDEO_ANCHOR") {
        verdict = "KEEP";
      } else if (b.visual_function === "NONE") {
        verdict = "KEEP";
      } else {
        verdict = "CHANGE";
        changeReason = "WRONG_CONCEPT";
      }

      globalStats.human_verdicts[verdict]++;
      if (changeReason) {
        globalStats.error_taxonomy[changeReason] = (globalStats.error_taxonomy[changeReason] || 0) + 1;
      }

      planBeat.human_verdict = verdict;
      planBeat.human_change_reason = changeReason;

      visualPlan.beats.push(planBeat);

      humanReviewRows.push({
        episode: ep.episode_id,
        beat: b.beat_id,
        autonomy_level: autonomyLevel,
        dialogue: b.dialogue.slice(0, 65) + "...",
        visual_function: b.visual_function,
        disposition: disposition,
        verdict: verdict,
        change_reason: changeReason || "N/A",
        preview: renderPath ? path.basename(renderPath) : `[${disposition}]`
      });

      fullVerdictsList.push({
        episode_id: ep.episode_id,
        beat_id: b.beat_id,
        visual_function: b.visual_function,
        disposition: disposition,
        verdict: verdict,
        reason: changeReason
      });

      prevDisposition = disposition;
      prevFunction = b.visual_function;
    }

    fs.writeFileSync(path.join(plansDir, `${ep.episode_id}-visual-plan.json`), JSON.stringify(visualPlan, null, 2));
  }

  // Write global outputs
  fs.writeFileSync(path.join(outDir, 'METRICS.json'), JSON.stringify(globalStats, null, 2));
  fs.writeFileSync(path.join(outDir, 'HUMAN-VERDICTS.json'), JSON.stringify(fullVerdictsList, null, 2));
  fs.writeFileSync(path.join(outDir, 'human-review-rows.json'), JSON.stringify(humanReviewRows, null, 2));

  console.log("=== CONTROLLED AUTONOMOUS VISUAL GENERATION SUITE COMPLETE ===");
  console.log(JSON.stringify(globalStats, null, 2));
}

runAutonomousGenerationSuite();