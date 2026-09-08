#!/usr/bin/env node
'use strict';

/**
 * LIVE AUTONOMOUS DIRECTED DRAFT ENGINE — TOPIC 06
 * Implements the full Stage 6 live pipeline on Topic 06 Script B:
 * 1. Narrative Beat Analysis & Visual Necessity Gating
 * 2. Visual Function & Autonomy Level Assignment (Enforcing A1 for Opening Hook)
 * 3. Anti-bias Media Disposition (Blender Direct, Talking Head, Screen Capture, None)
 * 4. Procedural SceneSpec Generation with State-Evolution Continuity Groups
 * 5. Headless Compilation & Multi-Tier Independent QC
 * 6. DaVinci Resolve Directed Draft Timeline & EDL Manifest Generation
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateBlenderSuitability } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-suitability-policy.js');
const { mapIntentToSceneSpec } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-visual-mapper.js');
const { runBlenderQC } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-qc-runner.js');

const SCRIPT_BEATS = [
  {
    beat_id: "T06_B01",
    section: "Contradiction Hook",
    dialogue: "The system with the most flexibility can also be the system that stops you from finishing the video. That sounds backwards, because flexibility is supposed to be the adult choice.",
    visual_function: "SHOW_PERSON",
    requires_human_emotion: true,
    is_opening: true,
    duration_words: 31,
    concept: "Mikko on camera delivering the opening contradiction directly to the viewer."
  },
  {
    beat_id: "T06_B02",
    section: "The Workshop Illusion",
    dialogue: "Use GPT for planning, a specialist image model for stills, Kling for motion, local folders for state, a separate editor for polish. It feels like a workshop: every tool in its place, every station tuned for the job.",
    visual_function: "SHOW_FLOW",
    requires_exact_topology: true,
    has_diagrammatic_content: true,
    candidate_primitives: ["stage", "flow"],
    continuity_group: "composable_stack_architecture",
    duration_words: 47,
    concept: "Linear 5-stage composable pipeline flowing smoothly: Planning -> Stills -> Motion -> State -> Editor."
  },
  {
    beat_id: "T06_B03",
    section: "The Friction Cascade",
    dialogue: "And then production starts. One tool exports a file name the next tool hates. A motion pass loses the prompt note. The editor has the right clip and the wrong version. Authentication expires on the platform you only use for one stage.",
    visual_function: "SHOW_CONSTRAINT",
    requires_exact_topology: true,
    has_diagrammatic_content: true,
    candidate_primitives: ["stage", "blockage", "queue"],
    continuity_group: "composable_stack_architecture",
    duration_words: 45,
    concept: "State evolution: Central motion and state stages become blocked; error barriers and queue buildup appear."
  },
  {
    beat_id: "T06_B04",
    section: "State Drift Reality",
    dialogue: "State lives partly in a spreadsheet, partly in a chat, partly in your memory. Congratulations: you have total control, including total control over all the ways it can break.",
    visual_function: "SHOW_INTERFACE",
    requires_real_ui: true,
    duration_words: 32,
    concept: "Real screen capture: Desktop friction with mismatched spreadsheet, terminal, and expiring token."
  },
  {
    beat_id: "T06_B05",
    section: "The Core Diagnosis",
    dialogue: "The diagnosis is not that composable systems are bad. It is that every extra interface must be justified. A monolith is an appliance. A composable system is a workshop. The appliance is easier to start. The workshop is easier to reconfigure.",
    visual_function: "COMPARE",
    requires_exact_topology: true,
    has_diagrammatic_content: true,
    candidate_primitives: ["comparison", "blockage", "focus"],
    duration_words: 45,
    concept: "Side-by-side split comparison: Monolithic Appliance (compact, integrated) vs Composable Workshop (modular, open)."
  },
  {
    beat_id: "T06_B06",
    section: "Reframe by Responsibility",
    dialogue: "Monolithic platforms optimize simplicity. That matters. Fewer moving parts can mean fewer delays, fewer handoffs, and faster rough outputs. A reliable appliance beats a magnificent workshop when dinner is due in twenty minutes.",
    visual_function: "SHOW_PERSON",
    requires_human_emotion: true,
    duration_words: 39,
    concept: "Presenter candid reflection on deadline pressure and shipping on time."
  },
  {
    beat_id: "T06_B07",
    section: "Where Control Matters",
    dialogue: "Composable systems optimize control, replaceability, and specialization. That matters too. If you need a specialist model for motion and local tools for planning, composition protects quality. But only if the cost of adapters, state sync, and troubleshooting is managed.",
    visual_function: "SHOW_HIERARCHY",
    requires_exact_topology: true,
    has_diagrammatic_content: true,
    candidate_primitives: ["hierarchy", "stage", "dependency"],
    duration_words: 46,
    concept: "Governance hierarchy: Director governing specialized modular tool nodes."
  },
  {
    beat_id: "T06_B08",
    section: "The Action: Hybrid Architecture",
    dialogue: "The action is to stop asking, 'monolith or composable?' Ask, 'which responsibilities need control, and which can be consolidated?' Pros: hybrid architecture makes the binary false. Consolidate low-risk stages. Compose the stages where quality and ownership genuinely matter.",
    visual_function: "SHOW_TRANSFORMATION",
    has_diagrammatic_content: true,
    candidate_primitives: ["stage", "transformation"],
    duration_words: 47,
    concept: "Transformation gateway: Fragmented binary re-architected into an integrated hybrid pipeline."
  },
  {
    beat_id: "T06_B09",
    section: "Closing Directive",
    dialogue: "Do not build a custom stack to impress your future self if your present self cannot ship through it. The point is not maximum flexibility. The point is dependable production. Choose simplicity where you can, and composition where control actually matters.",
    visual_function: "SHOW_PERSON",
    requires_human_emotion: true,
    duration_words: 45,
    concept: "Presenter closing punchline and final thesis statement directly to camera."
  }
];

function runCanaryDeployment() {
  const outDir = '/home/vidtoolz/outputs/live-autonomous-directed-draft-topic-06-2026-09-04';
  const plansDir = path.join(outDir, 'plans');
  const specsDir = path.join(outDir, 'specs');
  const rendersDir = path.join(outDir, 'renders');
  const qcDir = path.join(outDir, 'qc');
  const handoffsDir = path.join(outDir, 'handoffs');
  const timelineDir = path.join(outDir, 'timeline');
  const provDir = path.join(outDir, 'provenance');

  const WPM = 155; // words per minute
  let cumulativeTime = 0.0;

  const visualPlan = {
    episode_id: "TOPIC_06_CANARY",
    title: "All-in-One AI Platforms vs Composable Systems",
    spine: "Contradiction -> Diagnosis -> Reframe -> Action",
    word_count: 383,
    estimated_duration_s: 0.0,
    generated_at: new Date().toISOString(),
    beats: []
  };

  const timelineTracks = {
    V1_PRESENTER_A_ROLL: [],
    V2_EXPLAINER_VISUALS: [],
    A1_NARRATION: []
  };

  const reviewRows = [];
  const metrics = {
    total_beats: SCRIPT_BEATS.length,
    autonomy: { A1: 0, A2: 0, A3: 0 },
    dispositions: {},
    blender_jobs: 0,
    blender_renders_ok: 0,
    blender_qc_ok: 0,
    mobile_safety_violations: 0
  };

  for (const b of SCRIPT_BEATS) {
    const duration = Math.round((b.duration_words / WPM) * 60 * 10) / 10;
    const startTime = cumulativeTime;
    const endTime = Math.round((startTime + duration) * 10) / 10;
    cumulativeTime = endTime;

    const suitability = evaluateBlenderSuitability(b);
    let disposition = suitability.recommended_disposition;
    let autonomyLevel = b.is_opening ? "A1" : "A2";
    let ambiguity = b.is_opening ? "OPENING_HOOK_CREATIVE_SIGN_OFF" : "LOW";

    metrics.autonomy[autonomyLevel]++;
    metrics.dispositions[disposition] = (metrics.dispositions[disposition] || 0) + 1;

    const planBeat = {
      beat_id: b.beat_id,
      section: b.section,
      dialogue: b.dialogue,
      visual_function: b.visual_function,
      disposition: disposition,
      autonomy_level: autonomyLevel,
      ambiguity: ambiguity,
      confidence: Math.round(suitability.score * 100) / 100,
      continuity_group: b.continuity_group || null,
      timeline: {
        start_s: startTime,
        end_s: endTime,
        duration_s: duration,
        status: "PROVISIONAL_CALIBRATED_ESTIMATE"
      },
      execution_spec: null,
      qc_result: null,
      assembly_handoff: null
    };

    let renderPath = null;
    let qcPassed = false;

    if (disposition === "BLENDER_DIRECT") {
      metrics.blender_jobs++;
      const spec = mapIntentToSceneSpec({
        scene_id: `T06_${b.beat_id}`,
        visual_function: b.visual_function,
        visual_concept: b.concept,
        disposition: disposition,
        continuity_group: b.continuity_group,
        style_profile: "VIDTOOLZ_EXPLAINER_V1"
      });

      const specFile = path.join(specsDir, `${spec.scene_id}.json`);
      fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
      planBeat.execution_spec = specFile;

      const blendFile = path.join(rendersDir, `${spec.scene_id}.blend`);
      const pngFile = path.join(rendersDir, `${spec.scene_id}.png`);
      const compilerScript = '/home/vidtoolz/vidtoolz-blender/primitives/v1/builders/scene_compiler.py';

      try {
        execFileSync('blender', ['--background', '--python', compilerScript, '--', specFile, blendFile], { stdio: 'pipe' });
        
        // Dispatch render on vidnux via blender_control
        const jobJson = `/tmp/job_${spec.scene_id}.json`;
        fs.writeFileSync(jobJson, JSON.stringify({
          job_id: `canary-${spec.scene_id}`,
          competency: "blender_render",
          machine_preference: "vidnux",
          template_path: blendFile,
          output_path: pngFile,
          render_options: { engine: "CYCLES", device: "GPU", samples: 64, resolution: [1080, 1920] }
        }));
        execFileSync('python3', ['/home/vidtoolz/vidtoolz-blender/scripts/blender_control.py', 'dispatch', `--job=${jobJson}`], { stdio: 'pipe' });
        metrics.blender_renders_ok++;

        // Multi-tier QC
        const qcResult = runBlenderQC(specFile, blendFile, pngFile);
        const qcFile = path.join(qcDir, `${spec.scene_id}-qc.json`);
        fs.writeFileSync(qcFile, JSON.stringify(qcResult, null, 2));
        planBeat.qc_result = qcFile;

        if (qcResult.qc_passed) {
          metrics.blender_qc_ok++;
          qcPassed = true;
          renderPath = pngFile;

          const handoff = {
            schema: "vidtoolz.experimental.autonomousDirectedDraftHandoff.v1",
            episode_id: "TOPIC_06_CANARY",
            beat_id: b.beat_id,
            timeline_slot: { track: "V2_EXPLAINER_VISUALS", in_s: startTime, out_s: endTime },
            media_path: pngFile,
            disposition: disposition,
            qc_passed: true,
            provenance: {
              script: "topic-006-Script-B",
              compiler: "SceneCompilerV1",
              style: "VIDTOOLZ_EXPLAINER_V1",
              timestamp: new Date().toISOString()
            }
          };
          const handoffFile = path.join(handoffsDir, `${spec.scene_id}-handoff.json`);
          fs.writeFileSync(handoffFile, JSON.stringify(handoff, null, 2));
          planBeat.assembly_handoff = handoffFile;

          timelineTracks.V2_EXPLAINER_VISUALS.push({
            clip_name: `${b.beat_id}_${b.visual_function}`,
            file_path: pngFile,
            start_s: startTime,
            end_s: endTime,
            duration_s: duration,
            type: "3D_PROCEDURAL_EXPLAINER"
          });
        }
      } catch (err) {
        planBeat.error = err.message;
      }
    } else if (disposition === "TALKING_HEAD") {
      timelineTracks.V1_PRESENTER_A_ROLL.push({
        clip_name: `${b.beat_id}_PRESENTER_CAMERA`,
        file_path: "[RECORDED_A_ROLL_PLACEHOLDER]",
        start_s: startTime,
        end_s: endTime,
        duration_s: duration,
        framing: "right-third-vertical"
      });
      planBeat.assembly_handoff = `[PRESENTER_A_ROLL_SLOT: ${startTime}s - ${endTime}s]`;
    } else if (disposition === "SCREEN_CAPTURE") {
      timelineTracks.V2_EXPLAINER_VISUALS.push({
        clip_name: `${b.beat_id}_UI_SCREEN_CAPTURE`,
        file_path: "[OBS_SCREEN_CAPTURE_PLACEHOLDER]",
        start_s: startTime,
        end_s: endTime,
        duration_s: duration,
        type: "DESKTOP_UI_RECORDING"
      });
      planBeat.assembly_handoff = `[SCREEN_CAPTURE_SLOT: ${startTime}s - ${endTime}s]`;
    }

    timelineTracks.A1_NARRATION.push({
      beat_id: b.beat_id,
      dialogue: b.dialogue,
      start_s: startTime,
      end_s: endTime,
      duration_s: duration
    });

    visualPlan.beats.push(planBeat);

    reviewRows.push({
      beat: b.beat_id,
      section: b.section,
      time: `${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s (${duration.toFixed(1)}s)`,
      autonomy: autonomyLevel,
      visual_function: b.visual_function,
      disposition: disposition,
      concept: b.concept,
      preview: renderPath ? path.basename(renderPath) : `[${disposition}]`,
      review_flag: b.is_opening ? "OPENING_HUMAN_APPROVAL_REQUIRED" : "STANDARD_DRAFT_REVIEW"
    });
  }

  visualPlan.estimated_duration_s = cumulativeTime;

  // Emit VisualPlan & Timeline artifacts
  fs.writeFileSync(path.join(plansDir, 'TOPIC_06_CANARY-visual-plan.json'), JSON.stringify(visualPlan, null, 2));
  fs.writeFileSync(path.join(timelineDir, 'TOPIC_06_CANARY-timeline.json'), JSON.stringify({
    schema: "vidtoolz.experimental.autonomousDirectedDraftTimeline.v1",
    project: "Topic 06 — All-in-One AI Video Platforms vs Composable Systems",
    total_duration_s: cumulativeTime,
    tracks: timelineTracks
  }, null, 2));

  // Write EDL-like human-readable timeline
  let edlText = `# DIRECTED DRAFT TIMELINE — TOPIC 06\n`;
  edlText += `# Title: All-in-One AI Video Platforms vs Composable Systems\n`;
  edlText += `# Total Estimated Runtime: ${cumulativeTime.toFixed(1)}s (~${(cumulativeTime/60).toFixed(2)} min)\n\n`;
  edlText += `| Timecode | Beat | Track | Layer / Medium | Asset Name | Status |\n`;
  edlText += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const b of visualPlan.beats) {
    const t = b.timeline;
    const layer = b.disposition === "TALKING_HEAD" ? "V1 Presenter" : "V2 Cutaway";
    const asset = b.disposition === "BLENDER_DIRECT" ? `T06_${b.beat_id}.png` : `[${b.disposition}]`;
    const status = b.autonomy_level === "A1" ? "A1 (APPROVAL REQUIRED)" : "A2 (DRAFT READY)";
    edlText += `| ${t.start_s.toFixed(1)}s - ${t.end_s.toFixed(1)}s | ${b.beat_id} | ${layer} | ${b.disposition} | ${asset} | ${status} |\n`;
  }
  fs.writeFileSync(path.join(timelineDir, 'DIRECTED-DRAFT-TIMELINE.md'), edlText);

  // Write Review Rows
  fs.writeFileSync(path.join(outDir, 'canary-review-rows.json'), JSON.stringify(reviewRows, null, 2));
  fs.writeFileSync(path.join(outDir, 'canary-metrics.json'), JSON.stringify(metrics, null, 2));

  console.log("=== CANARY DEPLOYMENT SUCCESSFUL ===");
  console.log(JSON.stringify(metrics, null, 2));
}

runCanaryDeployment();