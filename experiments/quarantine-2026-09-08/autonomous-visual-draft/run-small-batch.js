#!/usr/bin/env node
'use strict';

/**
 * SMALL-BATCH AUTONOMOUS DIRECTED DRAFT RUNNER
 * Processes Topic 01, Topic 04, and Topic 10 fresh from canonical Script Builder/Mindmap authorities.
 * Enforces:
 * - A1 Opening Hook Governance
 * - Strict Visual Necessity (New, Hold, Evolve, Presenter)
 * - Anti-Bias Media Selection (Blender Direct, Talking Head, Screen Capture, None)
 * - Exact Materialization Separation (MATERIALIZED, RESERVED_PLACEHOLDER, NOT_REQUIRED)
 * - Multi-tier QC & Render-space Mobile Safety Verification
 * - Edit Decision List & Resolve Timeline Construction
 * - Actual Review Instrumentation & Metrics Logging
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateBlenderSuitability } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-suitability-policy.js');
const { mapIntentToSceneSpec } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-visual-mapper.js');
const { runBlenderQC } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-qc-runner.js');

const BATCH_EPISODES = [
  {
    topic_dir: "TOPIC-01",
    episode_id: "TOPIC_01_TOOLS_NOT_SYSTEMS",
    title: "Topic 01 — Powerful AI Tools Do Not Give You a Production System",
    project_id: "topic-001",
    script_label: "A",
    spine: "Contradiction → Diagnosis → Reframe → Action",
    word_count: 418,
    beats: [
      {
        beat_id: "T01_B01",
        section: "Contradiction Hook",
        dialogue: "You know ten powerful AI tools. You can make Midjourney sing, you can coax FLUX into photorealism. And yet — be honest — how many finished videos came out the other end this month? One? Half? That's the contradiction: maximum capability, minimum output.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 47,
        concept: "Presenter candid direct address calling out the output paradox."
      },
      {
        beat_id: "T01_B02",
        section: "Diagnosis: Tools Pile vs System",
        dialogue: "Every video you make is a fresh improvisation. Decisions live in your head. Repeatability is the only thing that separates capability from luck, and repeatability is exactly what a pile of disconnected tools cannot give you.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 39,
        concept: "Side-by-side comparison: Disconnected tool islands vs integrated production pipeline."
      },
      {
        beat_id: "T01_B03",
        section: "Reframe: Parts vs Car",
        dialogue: "Owning a garage full of racing parts is not the same as owning a car that starts every morning. Your tools are the parts. The system is the car: a visible path from script to approved final that you can walk again tomorrow.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "production_system_pipeline",
        duration_words: 46,
        concept: "6-stage linear pipeline: Script -> Visual Plan -> Generate -> Approve -> Edit -> Deliver."
      },
      {
        beat_id: "T01_B04",
        section: "The Bottleneck Appears",
        dialogue: "If only you can operate your process, you haven't built a system; you've built a personal ritual. Rituals don't delegate, and rituals never tell you where the bottleneck is, because nothing is written down to compare.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        continuity_group: "production_system_pipeline",
        duration_words: 42,
        concept: "State evolution: Review stage blocked by barrier, backlog queue accumulating."
      },
      {
        beat_id: "T01_B05",
        section: "Action: The Standardized Sequence",
        dialogue: "Write down your stages. For each stage, define what goes in, what comes out, and what done means. What you actually need is a repeatable sequence of decisions and acceptance checks.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage"],
        duration_words: 36,
        concept: "Governance hierarchy: Explicit input/output contracts governing production stages."
      },
      {
        beat_id: "T01_B06",
        section: "Visible Bottlenecks & Handoffs",
        dialogue: "Do this and something changes immediately. Bottlenecks become visible because comparable projects can finally be measured. Handoffs become possible because inputs and outputs are explicit.",
        visual_function: "SHOW_TRANSFORMATION",
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "transformation"],
        duration_words: 34,
        concept: "Transformation gateway: Chaos transformed into explicit measurable handoffs."
      },
      {
        beat_id: "T01_B07",
        section: "The Filing System Distress Signal",
        dialogue: "And a folder named FINAL_final_v7 stops being your filing system. Because that folder is not a workflow. It's a distress signal.",
        visual_function: "SHOW_INTERFACE",
        requires_real_ui: true,
        duration_words: 23,
        concept: "Screen capture: Messy desktop folder full of 'FINAL_v7_final' filenames."
      },
      {
        beat_id: "T01_B08",
        section: "Closing Directive",
        dialogue: "Tools create outputs. Systems create dependable production. Build the system.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 13,
        concept: "Presenter closing punchline delivered directly to camera."
      }
    ]
  },
  {
    topic_dir: "TOPIC-04",
    episode_id: "TOPIC_04_SCRIPT_MUST_CONTROL",
    title: "Topic 04 — The Script Must Control the AI Video",
    project_id: "topic-004",
    script_label: "C",
    spine: "Contradiction → Diagnosis → Reframe → Action",
    word_count: 312,
    beats: [
      {
        beat_id: "T04_B01",
        section: "The Generation Drift Trap",
        dialogue: "There exists a temptation to view generation-led drift as progress, but it feels like advancement while comprehension quietly collapses. Consider when you generate a dramatic neon city render for a segment on version control.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 37,
        concept: "Presenter candid warning against seductive model hallucinations."
      },
      {
        beat_id: "T04_B02",
        section: "The Oscar Campaign Clip",
        dialogue: "The shot arrives with rain and reflective puddles executing an invisible Oscar campaign before you have finished typing your first line of narration. You place this asset under that topic heading, assuming its visual weight justifies its presence.",
        visual_function: "ATMOSPHERE",
        requires_exact_topology: true,
        requires_cinematic_motion: true,
        candidate_primitives: ["stage"],
        duration_words: 41,
        concept: "Atmospheric 3D studio plate with dramatic lighting designed for AI-video conditioning."
      },
      {
        beat_id: "T04_B03",
        section: "The Casualty of Drift",
        dialogue: "Because it lacks narrative purpose beyond aesthetics, the script becomes a casualty. The editor trims explanatory beats to accommodate the shot, and motion designers build camera moves designed to justify the neon instead of data flow.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        duration_words: 39,
        concept: "Bottleneck explainer: Argument structure compressed and blocked by unguided visual weight."
      },
      {
        beat_id: "T04_B04",
        section: "Surrendering Editorial Control",
        dialogue: "Many creators let whatever the model happened to make attractive this afternoon negotiate their story. When generation starts directing the script, the AI has taken over as editor while you remain an executor of its impulses.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 37,
        concept: "Presenter direct challenge to creator authority."
      },
      {
        beat_id: "T04_B05",
        section: "Reframe: Narrative Primacy",
        dialogue: "Authority belongs solely to the narrative structure governing every decision. If a generated image reveals a clearer analogy than your text had, you must update the script first before approving that asset.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage", "dependency"],
        duration_words: 35,
        concept: "Script authority hierarchy: Script at the crown governing visual and edit dependencies."
      },
      {
        beat_id: "T04_B06",
        section: "Action: Strict Traceability",
        dialogue: "Strict traceability is required for every visual, motion, and edit decision. Make every asset answer one question: what part of the script does this serve?",
        visual_function: "SHOW_TRANSFORMATION",
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "transformation"],
        duration_words: 27,
        concept: "Transformation gateway: Unassigned media transformed into cited, script-bound assets."
      }
    ]
  },
  {
    topic_dir: "TOPIC-10",
    episode_id: "TOPIC_10_DONT_LET_AI_CHANGE_TRUTH",
    title: "Topic 10 — Do Not Let AI Silently Change the Production Truth",
    project_id: "topic-010",
    script_label: "C",
    spine: "Contradiction → Diagnosis → Reframe → Action",
    word_count: 289,
    beats: [
      {
        beat_id: "T10_B01",
        section: "The Harmless Command Illusion",
        dialogue: "An action feels harmless because the system offers an undo button next to every destructive command. We assume that if we can reverse it, the damage never happened.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 30,
        concept: "Presenter hook delivered directly to camera."
      },
      {
        beat_id: "T10_B02",
        section: "Silent File Swapping",
        dialogue: "When an agent regenerates an approved image and decides the new one looks cleaner, replacing the file without warning seems helpful. But once motion clips are built and timeline edits adjust around them, continuity is shattered downstream.",
        visual_function: "SHOW_FAILURE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["split", "stage", "blockage"],
        duration_words: 41,
        concept: "QC failure gate: Silent unapproved replacement detected and rejected by verification gate."
      },
      {
        beat_id: "T10_B03",
        section: "Preparation vs Commitment",
        dialogue: "We cannot treat preparation as one thing and commitment as another based on whether a file was swapped. The system must mark the difference between generating alternatives freely and altering authoritative project state.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage", "focus"],
        duration_words: 37,
        concept: "Split comparison: Free exploratory preparation space vs immutable locked commitment space."
      },
      {
        beat_id: "T10_B04",
        section: "Risk-Based Gating",
        dialogue: "Low-impact operations remain automatic. But when the agent proposes a replacement with downstream impact visible on screen, it must pause for human commitment.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage"],
        duration_words: 27,
        concept: "Tiered authority hierarchy: Automatic preparation below human commitment gate."
      },
      {
        beat_id: "T10_B05",
        section: "Audit Lineage",
        dialogue: "Let us inspect the live provenance log recording who committed the change and exactly when before publication proceeds.",
        visual_function: "SHOW_INTERFACE",
        requires_real_ui: true,
        duration_words: 20,
        concept: "Screen capture: Real cryptographic commit log / provenance manifest on screen."
      },
      {
        beat_id: "T10_B06",
        section: "Closing Principle",
        dialogue: "By drawing a line between preparation freedom and commitment responsibility, you ensure no AI agent can quietly rewrite history. Automate preparation freely; protect commitment deliberately.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 30,
        concept: "Presenter closing thesis delivered directly to camera."
      }
    ]
  }
];

function runBatchDeployment() {
  const baseOutDir = '/home/vidtoolz/outputs/autonomous-directed-draft-small-batch-2026-09-04';
  const WPM = 155;

  const batchDecisions = [];
  const batchManifest = [];
  const aggregateMetrics = {
    total_episodes: BATCH_EPISODES.length,
    total_beats: 0,
    autonomy: { A1: 0, A2: 0, A3: 0 },
    dispositions: {},
    asset_states: { MATERIALIZED: 0, RESERVED_PLACEHOLDER: 0, NOT_REQUIRED: 0 },
    blender: { selected: 0, compiled: 0, rendered: 0, qc_passed: 0 }
  };

  for (const ep of BATCH_EPISODES) {
    const epDir = path.join(baseOutDir, ep.topic_dir);
    const specsDir = path.join(epDir, 'SceneSpecs');
    const assetsDir = path.join(epDir, 'assets');
    const qcDir = path.join(epDir, 'QC');
    const timelineDir = path.join(epDir, 'timeline');
    const provDir = path.join(epDir, 'provenance');

    let cumulativeTime = 0.0;
    const visualPlan = {
      episode_id: ep.episode_id,
      title: ep.title,
      project_id: ep.project_id,
      script_label: ep.script_label,
      spine: ep.spine,
      word_count: ep.word_count,
      generated_at: new Date().toISOString(),
      beats: []
    };

    const timelineTracks = {
      V1_PRESENTER_A_ROLL: [],
      V2_EXPLAINER_VISUALS: [],
      A1_NARRATION: []
    };

    const reviewPackageRows = [];

    for (const b of ep.beats) {
      aggregateMetrics.total_beats++;
      const duration = Math.round((b.duration_words / WPM) * 60 * 10) / 10;
      const startTime = cumulativeTime;
      const endTime = Math.round((startTime + duration) * 10) / 10;
      cumulativeTime = endTime;

      const suitability = evaluateBlenderSuitability(b);
      let disposition = suitability.recommended_disposition;
      let autonomyLevel = b.is_opening ? "A1" : "A2";
      let ambiguity = b.is_opening ? "OPENING_HOOK_CREATIVE_WEIGHT" : "LOW";

      aggregateMetrics.autonomy[autonomyLevel]++;
      aggregateMetrics.dispositions[disposition] = (aggregateMetrics.dispositions[disposition] || 0) + 1;

      let assetState = "NOT_REQUIRED";
      let renderPath = null;
      let qcPassed = false;
      let specFile = null;
      let qcFile = null;

      if (disposition === "BLENDER_DIRECT" || disposition === "BLENDER_AI_VIDEO_ANCHOR") {
        aggregateMetrics.blender.selected++;
        const spec = mapIntentToSceneSpec({
          scene_id: `${ep.topic_dir}_${b.beat_id}`,
          visual_function: b.visual_function,
          visual_concept: b.concept,
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
          aggregateMetrics.blender.compiled++;

          // Dispatch locally via blender_control
          const jobJson = `/tmp/job_${spec.scene_id}.json`;
          fs.writeFileSync(jobJson, JSON.stringify({
            job_id: `smallbatch-${spec.scene_id}`,
            competency: "blender_render",
            machine_preference: "vidnux",
            template_path: blendFile,
            output_path: pngFile,
            render_options: { engine: "CYCLES", device: "GPU", samples: 64, resolution: [1080, 1920] }
          }));
          execFileSync('python3', ['/home/vidtoolz/vidtoolz-blender/scripts/blender_control.py', 'dispatch', `--job=${jobJson}`], { stdio: 'pipe' });
          aggregateMetrics.blender.rendered++;

          // QC evaluation
          const qcResult = runBlenderQC(specFile, blendFile, pngFile);
          qcFile = path.join(qcDir, `${spec.scene_id}-qc.json`);
          fs.writeFileSync(qcFile, JSON.stringify(qcResult, null, 2));

          if (qcResult.qc_passed) {
            aggregateMetrics.blender.qc_passed++;
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

      aggregateMetrics.asset_states[assetState] = (aggregateMetrics.asset_states[assetState] || 0) + 1;

      timelineTracks.A1_NARRATION.push({
        beat_id: b.beat_id,
        dialogue: b.dialogue,
        start_s: startTime,
        end_s: endTime,
        duration_s: duration
      });

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
        timeline: { start_s: startTime, end_s: endTime, duration_s: duration, status: "PROVISIONAL_CALIBRATED_ESTIMATE" },
        materialization_state: assetState,
        media_path: renderPath,
        qc_passed: qcPassed
      };

      visualPlan.beats.push(planBeat);
      batchDecisions.push({
        episode: ep.topic_dir,
        beat_id: b.beat_id,
        visual_function: b.visual_function,
        disposition: disposition,
        autonomy: autonomyLevel,
        materialization: assetState
      });

      reviewPackageRows.push({
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

    // Write Episode outputs
    fs.writeFileSync(path.join(epDir, 'VISUAL-PLAN.json'), JSON.stringify(visualPlan, null, 2));
    fs.writeFileSync(path.join(timelineDir, 'timeline.json'), JSON.stringify({
      schema: "vidtoolz.experimental.autonomousDirectedDraftTimeline.v1",
      project: ep.title,
      total_duration_s: cumulativeTime,
      tracks: timelineTracks
    }, null, 2));

    // Write Episode EDL
    let edlText = `# DIRECTED DRAFT TIMELINE — ${ep.topic_dir}\n`;
    edlText += `# Title: ${ep.title}\n`;
    edlText += `# Spine: ${ep.spine}\n`;
    edlText += `# Estimated Runtime: ${cumulativeTime.toFixed(1)}s (~${(cumulativeTime/60).toFixed(2)} min)\n\n`;
    edlText += `| Timecode | Beat | Track | Medium | Materialization | Status |\n`;
    edlText += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const b of visualPlan.beats) {
      const t = b.timeline;
      const track = b.disposition === "TALKING_HEAD" ? "V1 Presenter" : "V2 Cutaway";
      edlText += `| ${t.start_s.toFixed(1)}s - ${t.end_s.toFixed(1)}s | ${b.beat_id} | ${track} | ${b.disposition} | ${b.materialization_state} | ${b.autonomy_level} |\n`;
    }
    fs.writeFileSync(path.join(timelineDir, 'DIRECTED-DRAFT-TIMELINE.md'), edlText);
    fs.writeFileSync(path.join(epDir, 'HUMAN-REVIEW-PACKAGE.md'), generateReviewMarkdown(ep, reviewPackageRows));
  }

  // Write Batch Global outputs
  fs.writeFileSync(path.join(baseOutDir, 'BATCH-VISUAL-DECISIONS.json'), JSON.stringify(batchDecisions, null, 2));
  fs.writeFileSync(path.join(baseOutDir, 'batch-metrics.json'), JSON.stringify(aggregateMetrics, null, 2));

  console.log("=== SMALL BATCH DIRECTED DRAFTS GENERATED ===");
  console.log(JSON.stringify(aggregateMetrics, null, 2));
}

function generateReviewMarkdown(ep, rows) {
  let md = `# HUMAN REVIEW PACKAGE — ${ep.topic_dir}\n\n`;
  md += `**Episode:** ${ep.title}\n`;
  md += `**Spine:** ${ep.spine}\n`;
  md += `**Word Count:** ${ep.word_count} spoken words\n\n`;
  md += `| Beat & TC | Section | Visual Function | Disposition | Autonomy | Concept | Preview / Path | Editorial Verdict |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  for (const r of rows) {
    md += `| **${r.beat}**<br>${r.time} | ${r.section} | \`${r.visual_function}\` | **\`${r.disposition}\`** | \`${r.autonomy}\` | ${r.concept} | \`${r.preview}\` | **PENDING HUMAN REVIEW** |\n`;
  }
  return md;
}

runBatchDeployment();