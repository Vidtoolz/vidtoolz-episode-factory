#!/usr/bin/env node
'use strict';

/**
 * 10-EPISODE CONTROLLED PRODUCTION PILOT RUNNER
 * Processes Topics 002, 007, 031, 091, 121, 181, 211, 241, 271, 331 end-to-end:
 * 1. Narrative Beat Analysis & Necessity Gating
 * 2. Visual Function & Autonomy Assignment (Mandatory A1 Opening Hooks)
 * 3. Anti-Bias Media Selection (Blender Direct, Talking Head, Screen Capture, None)
 * 4. Procedural SceneSpec Generation & State Evolution Continuity
 * 5. Headless OptiX Rendering on vidnux & Multi-Tier Independent QC
 * 6. DaVinci Resolve 3-Track Timeline & EDL Manifest Assembly
 * 7. Logging to Consolidated Pilot Dataset
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateBlenderSuitability } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-suitability-policy.js');
const { mapIntentToSceneSpec } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-visual-mapper.js');
const { runBlenderQC } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-qc-runner.js');

const PILOT_EPISODES = [
  {
    topic_id: "topic-002",
    ep_num: "EP01",
    title: "Topic 02 — Stop Solving System Problems With Better AI Tools",
    category: "production-systems",
    word_count: 400,
    beats: [
      { beat_id: "P01_B01", dialogue: "Most creators try to repair system failures by subscribing to another tool. The image generator made something sharp, but the finished video still never ships.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 32 },
      { beat_id: "P01_B02", dialogue: "Upgrading individual tools without fixing the pipeline is like buying a faster engine for a car with square wheels. You spend more money and stay stuck in place.", visual_function: "COMPARE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["comparison", "blockage"], duration_words: 36 },
      { beat_id: "P01_B03", dialogue: "A real production system connects your stages: idea, script, asset generation, review, and final assembly in one visible, repeatable path.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], continuity_group: "system_architecture_02", duration_words: 34 },
      { beat_id: "P01_B04", dialogue: "When you rely on tool upgrades alone, the bottleneck simply shifts down the line, piling unreviewed assets outside an overwhelmed timeline.", visual_function: "SHOW_CONSTRAINT", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "blockage", "queue"], continuity_group: "system_architecture_02", duration_words: 35 },
      { beat_id: "P01_B05", dialogue: "Stop shopping for plugins. Standardize your handoffs and acceptance criteria. Build the system.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 18 }
    ]
  },
  {
    topic_id: "topic-007",
    ep_num: "EP02",
    title: "Topic 07 — One AI Video Generator Is a Single Point of Failure",
    category: "production-systems",
    word_count: 426,
    beats: [
      { beat_id: "P02_B01", dialogue: "If your entire production pipeline hangs on one cloud API, you don't have a workflow. You have a hostage situation.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 26 },
      { beat_id: "P02_B02", dialogue: "The moment that single service experiences downtime, rate limits, or a silent model deprecation, every dependent stage halts immediately.", visual_function: "SHOW_FAILURE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["split", "stage", "blockage"], duration_words: 33 },
      { beat_id: "P02_B03", dialogue: "A resilient multi-worker stack routes tasks across redundant hosts—dispatching heavy passes to worker rigs and fast jobs to local machines.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], continuity_group: "dual_worker_stack", duration_words: 34 },
      { beat_id: "P02_B04", dialogue: "Observe the live GPU telemetry on the secondary render worker absorbing the queue when the cloud endpoint stalls.", visual_function: "SHOW_INTERFACE", requires_real_ui: true, duration_words: 24 },
      { beat_id: "P02_B05", dialogue: "Never let one vendor hold your deadline hostage. Decouple your execution layer.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 16 }
    ]
  },
  {
    topic_id: "topic-031",
    ep_num: "EP03",
    title: "Topic 01 — Your Automation Is Fake If You Still Own the Whole Job",
    category: "automation",
    word_count: 392,
    beats: [
      { beat_id: "P03_B01", dialogue: "Your new automation gives you more buttons, more dashboards, and exactly the same mental exhaustion you had before. That's fake automation.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 27 },
      { beat_id: "P03_B02", dialogue: "Babysitting an automated script is not delegation. If every step requires you to click confirm, you haven't automated anything; you've built a faster leash.", visual_function: "COMPARE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["comparison", "blockage"], duration_words: 34 },
      { beat_id: "P03_B03", dialogue: "Real delegation establishes bounded autonomy: low-risk operations execute automatically, while high-risk gates escalate for human sign-off.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage"], duration_words: 28 },
      { beat_id: "P03_B04", dialogue: "Delegate the mechanical compilation. Guard the editorial commitment. That is where real leverage begins.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 19 }
    ]
  },
  {
    topic_id: "topic-091",
    ep_num: "EP04",
    title: "Topic 01 — AI Is Moving Creative Careers From Maker to Director",
    category: "careers",
    word_count: 419,
    beats: [
      { beat_id: "P04_B01", dialogue: "Here is the contradiction in your career right now: the machine can execute almost anything, and yet clients still pay you. For what?", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 27 },
      { beat_id: "P04_B02", dialogue: "They are not paying for your keystrokes. They are paying for your taste, your curation, and your willingness to reject 90% of the machine's candidates.", visual_function: "SHOW_TRANSFORMATION", has_diagrammatic_content: true, candidate_primitives: ["stage", "transformation"], duration_words: 31 },
      { beat_id: "P04_B03", dialogue: "The creative role is migrating from solo craft worker to directing a specialist ensemble of tools, agents, and pipelines.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage"], duration_words: 26 },
      { beat_id: "P04_B04", dialogue: "Stop measuring your worth by how tired your hands are. Start measuring it by the precision of your direction.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 21 }
    ]
  },
  {
    topic_id: "topic-121",
    ep_num: "EP05",
    title: "Topic 01 — AI Is Not a Tool — It Is a Collaborator You Must Direct",
    category: "collaboration",
    word_count: 397,
    beats: [
      { beat_id: "P05_B01", dialogue: "You would never brief a human editor with a vague prompt and expect a finished video. Yet creators do exactly that with AI.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 26 },
      { beat_id: "P05_B02", dialogue: "When you treat AI as an appliance, it returns generic internet consensus. When you treat it as a collaborator, you provide explicit constraints, context, and rules.", visual_function: "COMPARE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["comparison", "focus"], duration_words: 34 },
      { beat_id: "P05_B03", dialogue: "A structured brief feeds the engine: clear constraints enter, candidate assets emerge, and the director chooses the keeper.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], duration_words: 26 },
      { beat_id: "P05_B04", dialogue: "Direct with precision, evaluate with honesty, and never confuse generating with finishing.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 16 }
    ]
  },
  {
    topic_id: "topic-181",
    ep_num: "EP06",
    title: "Topic 01 — Prompting Is Temporary — Specification Is the Real Skill",
    category: "prompt-craft",
    word_count: 436,
    beats: [
      { beat_id: "P06_B01", dialogue: "The prompt that works miracles today will fail the moment the model updates tomorrow. What lasting skill are you actually building?", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 25 },
      { beat_id: "P06_B02", dialogue: "Prompt hacking is brittle superstition. A specification is durable engineering: inputs, constraints, schemas, and verifiable invariants.", visual_function: "SHOW_TRANSFORMATION", has_diagrammatic_content: true, candidate_primitives: ["stage", "transformation"], duration_words: 24 },
      { beat_id: "P06_B03", dialogue: "When you formalize a scene specification in structured data, the underlying renderer can be swapped without breaking your video.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage"], duration_words: 26 },
      { beat_id: "P06_B04", dialogue: "Inspect the raw SceneSpec JSON file: structured contracts survive while prompt tricks evaporate.", visual_function: "SHOW_INTERFACE", requires_real_ui: true, duration_words: 17 },
      { beat_id: "P06_B05", dialogue: "Stop collecting secret prompt keywords. Learn to write specifications.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 12 }
    ]
  },
  {
    topic_id: "topic-211",
    ep_num: "EP07",
    title: "Topic 01 — Review Is Not Cleanup. Review Is Production.",
    category: "qc-review",
    word_count: 392,
    beats: [
      { beat_id: "P07_B01", dialogue: "A creator can generate forty clips overnight. But review capacity—not generation speed—is the true ceiling of your production system.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 24 },
      { beat_id: "P07_B02", dialogue: "Without structured gates, work piles up at the review stage, turning the editor's timeline into an unmanageable salvage operation.", visual_function: "SHOW_CONSTRAINT", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "blockage", "queue"], duration_words: 25 },
      { beat_id: "P07_B03", dialogue: "Distributed quality control catches failures upstream: reject defects before they reach the timeline, keeping the pipeline clear.", visual_function: "SHOW_FAILURE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["split", "stage", "blockage"], duration_words: 24 },
      { beat_id: "P07_B04", dialogue: "Review is where quality is decided. Protect your review capacity.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 12 }
    ]
  },
  {
    topic_id: "topic-241",
    ep_num: "EP08",
    title: "Topic 01 — AI Can Generate Every Shot—Cannot Replace the Script",
    category: "scriptcraft",
    word_count: 412,
    beats: [
      { beat_id: "P08_B01", dialogue: "A model can generate breathtaking shots in seconds. But without a script, those shots are just visual noise looking for an excuse.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 25 },
      { beat_id: "P08_B02", dialogue: "The script is the immutable spine. Every camera move, 3D diagram, and music cue exists solely to serve the argument.", visual_function: "SHOW_HIERARCHY", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["hierarchy", "stage", "dependency"], duration_words: 25 },
      { beat_id: "P08_B03", dialogue: "When you generate shots before locking the script, your timeline bends around accidental eye-candy rather than narrative truth.", visual_function: "SHOW_CONSTRAINT", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "blockage", "queue"], duration_words: 22 },
      { beat_id: "P08_B04", dialogue: "Lock the script first. Let the narrative control the machine.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 12 }
    ]
  },
  {
    topic_id: "topic-271",
    ep_num: "EP09",
    title: "Topic 01 — When Everyone Can Generate, Taste Becomes the Moat",
    category: "taste",
    word_count: 384,
    beats: [
      { beat_id: "P09_B01", dialogue: "When everyone can make a polished 4K image with a single click, technical polish ceases to be an advantage. Taste is the only moat left.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 29 },
      { beat_id: "P09_B02", dialogue: "Taste is not what you like. Taste is what you have the discipline to refuse.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 18 },
      { beat_id: "P09_B03", dialogue: "An undisciplined generator produces endless variations. A creator with taste applies a strict editorial filter to select the one defensible frame.", visual_function: "SHOW_TRANSFORMATION", has_diagrammatic_content: true, candidate_primitives: ["stage", "transformation"], duration_words: 25 },
      { beat_id: "P09_B04", dialogue: "Your moat is not your toolchain. It is your editorial judgment.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 13 }
    ]
  },
  {
    topic_id: "topic-331",
    ep_num: "EP10",
    title: "Topic 01 — Every Visual Needs a Defined Communicative Job",
    category: "visual-planning",
    word_count: 414,
    beats: [
      { beat_id: "P10_B01", dialogue: "The better an AI image looks, the more confidently it can damage your video if it does not have an explicit communicative job.", visual_function: "SHOW_PERSON", requires_human_emotion: true, is_opening: true, duration_words: 26 },
      { beat_id: "P10_B02", dialogue: "Never ask: 'Is this shot beautiful?' Ask: 'What breaks in the viewer's understanding if this shot is replaced by a black frame?'", visual_function: "COMPARE", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["comparison", "blockage"], duration_words: 26 },
      { beat_id: "P10_B03", dialogue: "Every visual must perform a functional role: explain a mechanism, compare alternatives, demonstrate evidence, or show progression.", visual_function: "SHOW_FLOW", requires_exact_topology: true, has_diagrammatic_content: true, candidate_primitives: ["stage", "flow"], duration_words: 21 },
      { beat_id: "P10_B04", dialogue: "Assign the job first. Render the asset second.", visual_function: "SHOW_PERSON", requires_human_emotion: true, duration_words: 10 }
    ]
  }
];

function run10EpisodePilot() {
  const baseOutDir = '/home/vidtoolz/outputs/autonomous-directed-draft-10-episode-pilot-2026-09-04';
  const WPM = 155;

  const pilotVisualDecisions = [];
  const pilotMetrics = {
    total_episodes: PILOT_EPISODES.length,
    total_beats: 0,
    autonomy: { A1: 0, A2: 0, A3: 0 },
    dispositions: {},
    materialization: { MATERIALIZED: 0, RESERVED_PLACEHOLDER: 0, NOT_REQUIRED: 0 },
    blender: { selected: 0, compiled: 0, rendered: 0, qc_passed: 0 }
  };

  for (const ep of PILOT_EPISODES) {
    const epDir = path.join(baseOutDir, 'episodes', ep.ep_num);
    const specsDir = path.join(epDir, 'SceneSpecs');
    const assetsDir = path.join(epDir, 'assets');
    const qcDir = path.join(epDir, 'QC');
    const timelineDir = path.join(epDir, 'timeline');
    const provDir = path.join(epDir, 'provenance');

    [specsDir, assetsDir, qcDir, timelineDir, provDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

    let cumulativeTime = 0.0;
    const visualPlan = {
      episode_id: `${ep.ep_num}_${ep.topic_id}`,
      title: ep.title,
      category: ep.category,
      word_count: ep.word_count,
      generated_at: new Date().toISOString(),
      beats: []
    };

    const timelineTracks = {
      V1_PRESENTER_A_ROLL: [],
      V2_EXPLAINER_VISUALS: [],
      A1_NARRATION: []
    };

    for (const b of ep.beats) {
      pilotMetrics.total_beats++;
      const duration = Math.round((b.duration_words / WPM) * 60 * 10) / 10;
      const startTime = cumulativeTime;
      const endTime = Math.round((startTime + duration) * 10) / 10;
      cumulativeTime = endTime;

      const suitability = evaluateBlenderSuitability(b);
      let disposition = suitability.recommended_disposition;
      let autonomyLevel = b.is_opening ? "A1" : "A2";
      let ambiguity = b.is_opening ? "OPENING_HOOK_CREATIVE_WEIGHT" : "LOW";

      pilotMetrics.autonomy[autonomyLevel]++;
      pilotMetrics.dispositions[disposition] = (pilotMetrics.dispositions[disposition] || 0) + 1;

      let assetState = "NOT_REQUIRED";
      let renderPath = null;
      let qcPassed = false;
      let specFile = null;
      let qcFile = null;

      if (disposition === "BLENDER_DIRECT" || disposition === "BLENDER_AI_VIDEO_ANCHOR") {
        pilotMetrics.blender.selected++;
        const spec = mapIntentToSceneSpec({
          scene_id: `${ep.ep_num}_${b.beat_id}`,
          visual_function: b.visual_function,
          visual_concept: b.concept || b.dialogue,
          disposition: disposition,
          continuity_group: b.continuity_group,
          style_profile: disposition === "BLENDER_AI_VIDEO_ANCHOR" ? "AI_VIDEO_ANCHOR_V1" : "VIDTOOLZ_EXPLAINER_V1"
        });

        specFile = path.join(specsDir, `${spec.scene_id}.json`);
        fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));

        const blendFile = path.join(assetsDir, `${spec.scene_id}.blend`);
        const pngFile = path.join(assetsDir, `${spec.scene_id}.png`);
        const compilerScript = '/home/vidtoolz/vidtoolz-blender/primitives/v1/builders/scene_compiler.py';

        try {
          execFileSync('blender', ['--background', '--python', compilerScript, '--', specFile, blendFile], { stdio: 'pipe' });
          pilotMetrics.blender.compiled++;

          const jobJson = `/tmp/job_${spec.scene_id}.json`;
          fs.writeFileSync(jobJson, JSON.stringify({
            job_id: `pilot-${spec.scene_id}`,
            competency: "blender_render",
            machine_preference: "vidnux",
            template_path: blendFile,
            output_path: pngFile,
            render_options: { engine: "CYCLES", device: "GPU", samples: 64, resolution: [1080, 1920] }
          }));
          execFileSync('python3', ['/home/vidtoolz/vidtoolz-blender/scripts/blender_control.py', 'dispatch', `--job=${jobJson}`], { stdio: 'pipe' });
          pilotMetrics.blender.rendered++;

          const qcResult = runBlenderQC(specFile, blendFile, pngFile);
          qcFile = path.join(qcDir, `${spec.scene_id}-qc.json`);
          fs.writeFileSync(qcFile, JSON.stringify(qcResult, null, 2));

          if (qcResult.qc_passed) {
            pilotMetrics.blender.qc_passed++;
            qcPassed = true;
            renderPath = pngFile;
            assetState = "MATERIALIZED";

            timelineTracks.V2_EXPLAINER_VISUALS.push({
              clip_name: `${b.beat_id}_${b.visual_function}`,
              file_path: pngFile,
              start_s: startTime,
              end_s: endTime,
              duration_s: duration,
              type: "3D_PROCEDURAL_EXPLAINER"
            });
          } else {
            assetState = "QC_FAILED";
          }
        } catch (err) {
          assetState = "COMPILE_FAILED";
        }
      } else if (disposition === "TALKING_HEAD") {
        assetState = "RESERVED_PLACEHOLDER";
        timelineTracks.V1_PRESENTER_A_ROLL.push({
          clip_name: `${b.beat_id}_PRESENTER_CAMERA`,
          file_path: "[RECORDED_A_ROLL_PLACEHOLDER]",
          start_s: startTime,
          end_s: endTime,
          duration_s: duration,
          framing: "right-third-vertical"
        });
      } else if (disposition === "SCREEN_CAPTURE") {
        assetState = "RESERVED_PLACEHOLDER";
        timelineTracks.V2_EXPLAINER_VISUALS.push({
          clip_name: `${b.beat_id}_UI_SCREEN_CAPTURE`,
          file_path: "[OBS_SCREEN_CAPTURE_PLACEHOLDER]",
          start_s: startTime,
          end_s: endTime,
          duration_s: duration,
          type: "DESKTOP_UI_RECORDING"
        });
      }

      pilotMetrics.materialization[assetState] = (pilotMetrics.materialization[assetState] || 0) + 1;

      timelineTracks.A1_NARRATION.push({
        beat_id: b.beat_id,
        dialogue: b.dialogue,
        start_s: startTime,
        end_s: endTime,
        duration_s: duration
      });

      const planBeat = {
        beat_id: b.beat_id,
        dialogue: b.dialogue,
        visual_function: b.visual_function,
        disposition: disposition,
        autonomy_level: autonomyLevel,
        ambiguity: ambiguity,
        confidence: Math.round(suitability.score * 100) / 100,
        continuity_group: b.continuity_group || null,
        timeline: { start_s: startTime, end_s: endTime, duration_s: duration, status: "PROVISIONAL_CALIBRATED_ESTIMATE" },
        materialization_state: assetState,
        media_path: renderPath,
        qc_passed: qcPassed
      };

      visualPlan.beats.push(planBeat);
      pilotVisualDecisions.push({
        episode: ep.ep_num,
        topic_id: ep.topic_id,
        beat_id: b.beat_id,
        visual_function: b.visual_function,
        disposition: disposition,
        autonomy: autonomyLevel,
        materialization: assetState,
        is_opening: b.is_opening || false
      });
    }

    visualPlan.estimated_duration_s = cumulativeTime;

    fs.writeFileSync(path.join(epDir, 'VISUAL-PLAN.json'), JSON.stringify(visualPlan, null, 2));
    fs.writeFileSync(path.join(timelineDir, 'timeline.json'), JSON.stringify({
      schema: "vidtoolz.experimental.autonomousDirectedDraftTimeline.v1",
      project: ep.title,
      total_duration_s: cumulativeTime,
      tracks: timelineTracks
    }, null, 2));
  }

  fs.writeFileSync(path.join(baseOutDir, 'PILOT-VISUAL-DECISIONS.json'), JSON.stringify(pilotVisualDecisions, null, 2));
  fs.writeFileSync(path.join(baseOutDir, 'pilot-metrics.json'), JSON.stringify(pilotMetrics, null, 2));

  console.log("=== 10-EPISODE PILOT COMPLETED ===");
  console.log(JSON.stringify(pilotMetrics, null, 2));
}

run10EpisodePilot();