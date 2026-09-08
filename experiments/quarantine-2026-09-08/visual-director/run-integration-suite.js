#!/usr/bin/env node
'use strict';

/**
 * EPISODE VISUAL PLANNER & QUALIFICATION ENGINE
 * Analyzes real VIDTOOLZ scripts, derives visual functions, evaluates Blender suitability,
 * emits Visual Plans & SceneSpecs, compiles Blender scenes, executes QC, and packages
 * assembly handoffs for the Directed Draft workflow.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateBlenderSuitability } = require('./blender-suitability-policy.js');
const { mapIntentToSceneSpec } = require('./blender-visual-mapper.js');
const { runBlenderQC } = require('./blender-qc-runner.js');

const EPISODE_CORPUS = [
  {
    episode_id: "EP01_PROMPT_HYPE",
    title: "Why Most AI Video Channels Will Become Invisible",
    project_id: "01KX5S2T7JS12SGR3WXACJ578Q",
    beats: [
      {
        beat_id: "B01_01",
        dialogue: "Here is the uncomfortable truth: 95% of AI video channels will vanish within six months.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        concept: "Presenter delivers direct candid warning to camera."
      },
      {
        beat_id: "B01_02",
        dialogue: "Because prompting an image generator is not a production system. It is a casino lever.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        concept: "Split comparison between chaotic unguided prompting and structured system."
      },
      {
        beat_id: "B01_03",
        dialogue: "When everybody has access to the exact same diffusion models, prompt skill rounds down to zero.",
        visual_function: "SHOW_METRIC",
        has_diagrammatic_content: true,
        candidate_primitives: ["metric", "stage"],
        concept: "Commoditization gauge showing prompt differentiation dropping to zero."
      },
      {
        beat_id: "B01_04",
        dialogue: "Watch what happens inside an actual production timeline when you rely on raw generations.",
        visual_function: "SHOW_INTERFACE",
        requires_real_ui: true,
        concept: "DaVinci Resolve timeline showing mismatched audio and corrupted clips."
      },
      {
        beat_id: "B01_05",
        dialogue: "A hyper-detailed 3D proxy of the automated rendering engine running in studio lighting.",
        visual_function: "ATMOSPHERE",
        requires_exact_topology: true,
        requires_cinematic_motion: true,
        candidate_primitives: ["stage"],
        concept: "Hero studio turnaround for Wan2.2 conditioning."
      }
    ]
  },
  {
    episode_id: "EP02_IDENTITY_OUTSOURCE",
    title: "Why I Refuse to Outsource My Creator Identity to AI",
    project_id: "01M0QR9DGP5RRFTPVDA7WQP2XM",
    beats: [
      {
        beat_id: "B02_01",
        dialogue: "Every part of your channel can be copied. Every part except one: a creator who actually means it.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        concept: "Presenter close framing on camera."
      },
      {
        beat_id: "B02_02",
        dialogue: "If you let the model choose your positions, you inherit the average of the internet.",
        visual_function: "SHOW_TRANSFORMATION",
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "transformation"],
        concept: "Transformation gateway: Raw generic generation filtered into an authentic stance."
      },
      {
        beat_id: "B02_03",
        dialogue: "Notice the difference in tone between an AI script and an Avid editor with twenty years of scar tissue.",
        visual_function: "CONTRAST",
        requires_human_emotion: true,
        concept: "Presenter reflection on lived broadcast editing experience."
      },
      {
        beat_id: "B02_04",
        dialogue: "The script must remain the immutable spine that anchors every visual and musical asset.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "hierarchy", "dependency"],
        continuity_group: "script_spine_system",
        concept: "Script spine at root with 3D visuals, Scorecraft, and timeline branching below."
      }
    ]
  },
  {
    episode_id: "EP03_SELF_NOT_BUILT",
    title: "AI Cannot Sound Like A Self You Have Not Built",
    project_id: "01M13R0X0F58MG8SC3JTTT8MH0",
    beats: [
      {
        beat_id: "B03_01",
        dialogue: "The root issue is that point of view depends on values and lived judgment.",
        visual_function: "NONE",
        concept: "Voiceover continuation over existing plate."
      },
      {
        beat_id: "B03_02",
        dialogue: "You are the director. The model is the actor.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage"],
        continuity_group: "governance_hierarchy",
        concept: "Director governance hierarchy: Human operator commanding model actor."
      },
      {
        beat_id: "B03_03",
        dialogue: "Here is what happens when work accumulates before an uncalibrated review gate.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        continuity_group: "pipeline_evolution",
        concept: "Backlog accumulation at constrained review bottleneck."
      },
      {
        beat_id: "B03_04",
        dialogue: "Let us inspect the terminal logs directly to see where the agent stalled.",
        visual_function: "SHOW_INTERFACE",
        requires_real_ui: true,
        concept: "Hermes CLI terminal output inspection."
      },
      {
        beat_id: "B03_05",
        dialogue: "A moody cinematic anchor shot of the mechanical editing terminal in ambient darkness.",
        visual_function: "ATMOSPHERE",
        requires_exact_topology: true,
        requires_cinematic_motion: true,
        candidate_primitives: ["stage"],
        concept: "Hard-surface editing terminal with rim lights for Kling."
      }
    ]
  },
  {
    episode_id: "EP04_LIFECYCLE_CANARY",
    title: "Lifecycle Integration Test Package",
    project_id: "01M0W30GA5ZAXXQPX9SS0R2N29",
    beats: [
      {
        beat_id: "B04_01",
        dialogue: "Automating production requires three distinct stages: Draft, Review, and Production Lock.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        concept: "Three-stage linear progression: Draft Exploration -> Gate Review -> Production Canon."
      },
      {
        beat_id: "B04_02",
        dialogue: "Quality control is not an afterthought. It is a binary gate that rejects non-compliant assets.",
        visual_function: "SHOW_FAILURE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["split", "stage", "blockage"],
        concept: "QC branching gate directing defective outputs into reject bin."
      },
      {
        beat_id: "B04_03",
        dialogue: "A cinematic establishing shot of the central processing facility under atmospheric lighting.",
        visual_function: "ATMOSPHERE",
        requires_exact_topology: true,
        requires_cinematic_motion: true,
        candidate_primitives: ["stage"],
        concept: "Stylized monolithic server facility with rim lighting for Wan2.2 continuation."
      }
    ]
  },
  {
    episode_id: "EP05_AUTONOMOUS_CANARY",
    title: "Authorship Is Not Manual Execution",
    project_id: "01M18BNHH8AY0YESV6FK4BZXRC",
    beats: [
      {
        beat_id: "B05_01",
        dialogue: "Authorship is not manual execution. Authorship is knowing what to keep and what to cut.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        concept: "Presenter candid statement to camera."
      },
      {
        beat_id: "B05_02",
        dialogue: "Watch how a single constrained token budget creates pressure across the entire context window.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "pressure", "metric"],
        concept: "Context window reservoir compressed by boundary vice-plates with saturation gauge."
      },
      {
        beat_id: "B05_03",
        dialogue: "When the system clears the gate, work flows smoothly into final delivery.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "pipeline_evolution",
        concept: "Bottleneck resolved: Barrier removed and pipeline flowing cleanly."
      },
      {
        beat_id: "B05_04",
        dialogue: "Notice the exact code diff on GitHub that proved the repair.",
        visual_function: "SHOW_INTERFACE",
        requires_real_ui: true,
        concept: "GitHub PR diff viewer on screen."
      }
    ]
  }
];

function runIntegrationSuite() {
  const outDir = '/home/vidtoolz/outputs/episode-factory-blender-integration-v1-2026-09-04';
  const plansDir = path.join(outDir, 'plans');
  const specsDir = path.join(outDir, 'specs');
  const rendersDir = path.join(outDir, 'renders');
  const qcDir = path.join(outDir, 'qc');
  const handoffsDir = path.join(outDir, 'handoffs');

  [plansDir, specsDir, rendersDir, qcDir, handoffsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  const globalMetrics = {
    total_episodes_processed: EPISODE_CORPUS.length,
    total_beats_evaluated: 0,
    dispositions: {
      BLENDER_DIRECT: 0,
      BLENDER_AI_VIDEO_ANCHOR: 0,
      TALKING_HEAD: 0,
      SCREEN_CAPTURE: 0,
      NONE: 0
    },
    blender_jobs_compiled: 0,
    blender_jobs_rendered: 0,
    blender_qc_passed: 0,
    continuity_groups_verified: 0
  };

  const humanReviewRows = [];

  for (const ep of EPISODE_CORPUS) {
    const visualPlan = {
      episode_id: ep.episode_id,
      title: ep.title,
      project_id: ep.project_id,
      created_at: new Date().toISOString(),
      beats: []
    };

    for (const b of ep.beats) {
      globalMetrics.total_beats_evaluated++;
      const suitability = evaluateBlenderSuitability(b);
      const disposition = suitability.recommended_disposition;
      globalMetrics.dispositions[disposition] = (globalMetrics.dispositions[disposition] || 0) + 1;

      const planBeat = {
        beat_id: b.beat_id,
        dialogue: b.dialogue,
        visual_function: b.visual_function,
        disposition: disposition,
        suitability_score: suitability.score,
        reason: suitability.reason,
        continuity_group: b.continuity_group || null,
        execution_spec: null,
        qc_result: null,
        assembly_artifact: null
      };

      const reviewRow = {
        episode: ep.episode_id,
        beat: b.beat_id,
        dialogue_snippet: b.dialogue.slice(0, 60) + "...",
        visual_function: b.visual_function,
        disposition: disposition,
        reason: suitability.reason,
        blender_render: null
      };

      // If disposition is Blender, generate SceneSpec, compile, render, and QC
      if (disposition === 'BLENDER_DIRECT' || disposition === 'BLENDER_AI_VIDEO_ANCHOR') {
        const spec = mapIntentToSceneSpec({
          scene_id: `${ep.episode_id}_${b.beat_id}`,
          visual_function: b.visual_function,
          visual_concept: b.concept,
          disposition: disposition,
          continuity_group: b.continuity_group,
          style_profile: disposition === 'BLENDER_AI_VIDEO_ANCHOR' ? 'AI_VIDEO_ANCHOR_V1' : 'VIDTOOLZ_EXPLAINER_V1'
        });

        const specFile = path.join(specsDir, `${spec.scene_id}.json`);
        fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
        planBeat.execution_spec = specFile;

        // Compile .blend
        const blendFile = path.join(rendersDir, `${spec.scene_id}.blend`);
        const pngFile = path.join(rendersDir, `${spec.scene_id}.png`);
        const compilerScript = '/home/vidtoolz/vidtoolz-blender/primitives/v1/builders/scene_compiler.py';

        try {
          execFileSync('blender', ['--background', '--python', compilerScript, '--', specFile, blendFile], { stdio: 'pipe' });
          globalMetrics.blender_jobs_compiled++;

          // Render via blender_control dispatcher (local vidnux)
          const jobJsonPath = `/tmp/job_${spec.scene_id}.json`;
          fs.writeFileSync(jobJsonPath, JSON.stringify({
            job_id: `job-${spec.scene_id}`,
            competency: "blender_render",
            machine_preference: "vidnux",
            template_path: blendFile,
            output_path: pngFile,
            render_options: {
              engine: "CYCLES",
              device: "GPU",
              samples: 64,
              resolution: [1080, 1920]
            }
          }));

          execFileSync('python3', ['/home/vidtoolz/vidtoolz-blender/scripts/blender_control.py', 'dispatch', `--job=${jobJsonPath}`], { stdio: 'pipe' });
          globalMetrics.blender_jobs_rendered++;

          // Execute QC
          const qcResult = runBlenderQC(specFile, blendFile, pngFile);
          const qcFile = path.join(qcDir, `${spec.scene_id}-qc.json`);
          fs.writeFileSync(qcFile, JSON.stringify(qcResult, null, 2));
          planBeat.qc_result = qcFile;

          if (qcResult.qc_passed) {
            globalMetrics.blender_qc_passed++;
            const handoffManifest = {
              schema: "vidtoolz.directedDraftBlenderAssetHandoff.v1",
              episode_id: ep.episode_id,
              beat_id: b.beat_id,
              disposition: disposition,
              media_path: pngFile,
              scene_spec_path: specFile,
              qc_receipt: qcFile,
              continuity_group: b.continuity_group || null,
              provenance: {
                script_project_id: ep.project_id,
                blender_version: "4.5.13 LTS",
                compiler: "SceneCompilerV1",
                timestamp: new Date().toISOString()
              }
            };
            const handoffFile = path.join(handoffsDir, `${spec.scene_id}-handoff.json`);
            fs.writeFileSync(handoffFile, JSON.stringify(handoffManifest, null, 2));
            planBeat.assembly_artifact = handoffFile;
            reviewRow.blender_render = pngFile;
          }
        } catch (err) {
          planBeat.error = err.message;
        }
      }

      visualPlan.beats.push(planBeat);
      humanReviewRows.push(reviewRow);
    }

    fs.writeFileSync(path.join(plansDir, `${ep.episode_id}-visual-plan.json`), JSON.stringify(visualPlan, null, 2));
  }

  // Record metrics and review package
  fs.writeFileSync(path.join(outDir, 'metrics-summary.json'), JSON.stringify(globalMetrics, null, 2));
  fs.writeFileSync(path.join(outDir, 'human-review-rows.json'), JSON.stringify(humanReviewRows, null, 2));

  console.log("=== EPISODE FACTORY BLENDER INTEGRATION SUITE COMPLETE ===");
  console.log(JSON.stringify(globalMetrics, null, 2));
}

runIntegrationSuite();