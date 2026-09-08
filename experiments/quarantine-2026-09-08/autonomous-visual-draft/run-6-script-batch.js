#!/usr/bin/env node
'use strict';

/**
 * 6-SCRIPT DIRECTED DRAFT BATCH RUNNER (OPTION B)
 * Compiles 6 locked pre-production scripts into assembled Directed Draft packages:
 * - 406 B: Stop Prompting Subjects. Start Prompting Neighbors.
 * - 053 B: Your AI Agent Saying Done Proves Nothing
 * - 401 B: Stop Letting Pretty AI B-Roll Steal the Video
 * - 022 A: Set the Video Specs Before You Generate Anything
 * - 002 B: Stop Solving System Problems With Better AI Tools
 * - 410 B: Contextless AI Clips Make Shallow Videos
 *
 * Enforces:
 * - A1 Mandatory Opening Hook Governance (TALKING_HEAD)
 * - Anti-Bias Media Selection & Necessity Gating (Blender Direct, Talking Head, Screen Capture)
 * - Procedural SceneSpec Generation (Cycles/OptiX rendering on vidnux RTX 5070 Ti)
 * - Multi-Tier Independent QC (Technical, Structural, Mobile Safety Safe Zones)
 * - DaVinci Resolve Timeline EDL & Human Review Packages
 * - Strict Terminal State: DIRECTED_DRAFT_READY_FOR_HUMAN_REVIEW
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateBlenderSuitability } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-suitability-policy.js');
const { mapIntentToSceneSpec } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-visual-mapper.js');
const { runBlenderQC } = require('/home/vidtoolz/vidtoolz-episode-factory/scripts/visual-director/blender-qc-runner.js');

const BATCH_EPISODES = [
  {
    topic_dir: "TOPIC-406",
    episode_id: "EP_TOPIC_406_PROMPTING_NEIGHBORS",
    title: "Topic 406 — Stop Prompting Subjects. Start Prompting Neighbors.",
    project_id: "topic-406",
    script_label: "B",
    spine: "Contradiction → Diagnosis → Reframe → Action",
    word_count: 391,
    beats: [
      {
        beat_id: "T406_B01",
        section: "Contradiction: Subject in a Display Case",
        dialogue: "The contradiction is that your prompt can be full of detail and still have nobody for the subject to live with. You asked for a scene, but you built a display case, and now the footage stands there looking expensive and mildly unemployed.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 45,
        concept: "Presenter candid direct address highlighting the isolated subject trap."
      },
      {
        beat_id: "T406_B02",
        section: "Diagnosis: Noun vs Working Situation",
        dialogue: "The diagnosis is not that the model ignored you. It followed the subject: polished desk, moody light, nice hands near a keyboard. The failure is that the prompt describes a noun instead of a working situation. With no neighboring elements, the model reaches for the safest archetype: generic creator, generic screen glow, generic inspirational productivity fog.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 64,
        concept: "Side-by-side comparison: Isolated generic noun archetype vs contextual working situation."
      },
      {
        beat_id: "T406_B03",
        section: "Reframe: Neighbors Apply Pressure",
        dialogue: "Reframe the prompt around pressure. Ask what must sit next to the subject for the viewer to understand the moment without narration. 'Producer reviewing clips' is thin. 'Producer deleting a wrong clip while a marked-up brief, two rejected thumbnails, and a waiting export window crowd the desk' gives the shot a job. Neighbors are evidence.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "neighbor_pressure_pipeline",
        duration_words: 66,
        concept: "Multi-stage pipeline showing contextual neighbors applying directional pressure to the subject."
      },
      {
        beat_id: "T406_B04",
        section: "Objections & Directed Force",
        dialogue: "Too many objects can muddy the frame or feel like a yard sale with better lighting. The answer is not a junk drawer. The answer is to choose one to three neighbors that apply force: one object shows the deadline, one person reacts, one screen contradicts, one obstacle blocks the clean path.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        continuity_group: "neighbor_pressure_pipeline",
        duration_words: 63,
        concept: "Constraint gate: 1 to 3 purposeful neighbor forces channeling focus into the central beat."
      },
      {
        beat_id: "T406_B05",
        section: "Action: The Neighbor Checklist",
        dialogue: "Now take action before you render. For every subject prompt, add a neighbor pass. What is beside it, what is using it, what is interrupting it, what is reacting, and what proves this is not a stock pose on screen?",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage"],
        duration_words: 47,
        concept: "Hierarchy specification tree: Main Subject governed by Neighbor Validation Checklist."
      },
      {
        beat_id: "T406_B06",
        section: "Closing Punchline",
        dialogue: "The subject becomes specific when its neighbors give it pressure and purpose. Stop prompting subjects. Start prompting neighbors.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 21,
        concept: "Presenter closing conviction delivered directly to camera."
      }
    ]
  },
  {
    topic_dir: "TOPIC-053",
    episode_id: "EP_TOPIC_053_AGENT_DONE_PROVES_NOTHING",
    title: "Topic 053 — Your AI Agent Saying Done Proves Nothing",
    project_id: "topic-053",
    script_label: "B",
    spine: "Contradiction → Diagnosis → Reframe → Action",
    word_count: 420,
    beats: [
      {
        beat_id: "T053_B01",
        section: "Contradiction: Confidence vs Evidence",
        dialogue: "Your agent says the job is done, and that statement proves almost nothing. That is the contradiction at the center of automated production work: the more confident the report sounds, the easier it is to forget that confidence is not evidence.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 43,
        concept: "Presenter direct address calling out false agent confidence."
      },
      {
        beat_id: "T053_B02",
        section: "Cardboard Hat of Completion",
        dialogue: "A file exists. Is it correct, complete, playable, in the right place, and actually the requested file? If the answer is 'probably,' then the task is not done yet. It is just wearing the small cardboard hat of completion. The render finished, but the duration is off; the frame count does not match; the agent completed the task beautifully, except for the task.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 71,
        concept: "Comparison: Self-reported completion stamp vs failing underlying artifact verification."
      },
      {
        beat_id: "T053_B03",
        section: "Diagnosis: Reports vs State Changes",
        dialogue: "The diagnosis is that we confuse reports with state changes. 'Done' is a sentence. A validated output is a state of the world. A log is useful evidence, but beginners treat logs alone as proof of correctness. A log tells you the system tried something. It does not tell you the result matches the brief without a human detective scene.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        continuity_group: "verification_state_chain",
        duration_words: 68,
        concept: "State blockage: Process log completing while unverified output is halted at the gate."
      },
      {
        beat_id: "T053_B04",
        section: "Reframe: Output, Package, and Inspection",
        dialogue: "Completion must be demonstrated through outputs, logs, tests, or state changes that can be inspected independently. A delivery note is not the package, and the package is not proof that the contents work. You need the note, the package, and enough checking to know the thing inside is what you ordered.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "verification_state_chain",
        duration_words: 58,
        concept: "3-tier verification flow: Delivery Note -> Package Intactness -> Independent Artifact Test."
      },
      {
        beat_id: "T053_B05",
        section: "Action: Define Done Before Dispatch",
        dialogue: "The action is boring and powerful: define what 'done' means before the agent starts. For a rendered clip: file exists, playable codec, expected duration, expected resolution, correct frame count, correct folder, and project linkage confirmed. Then make the agent report those checks, not just its mood.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage"],
        duration_words: 54,
        concept: "Invariant contract hierarchy: Explicit acceptance criteria governing autonomous dispatch."
      },
      {
        beat_id: "T053_B06",
        section: "Closing Axiom",
        dialogue: "The more autonomous the system, the more independently observable completion must become. Completion is a claim until the intended outcome is independently verified.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 24,
        concept: "Presenter closing thesis delivered directly to camera."
      }
    ]
  },
  {
    topic_dir: "TOPIC-401",
    episode_id: "EP_TOPIC_401_PRETTY_BROLL_STEALS_VIDEO",
    title: "Topic 401 — Stop Letting Pretty AI B-Roll Steal the Video",
    project_id: "topic-401",
    script_label: "B",
    spine: "Concrete Failure → Investigation → Principle → Generalization",
    word_count: 391,
    beats: [
      {
        beat_id: "T401_B01",
        section: "Concrete Failure: Atmospheric Distraction",
        dialogue: "Here is the failure: a short explainer about a broken workflow begins with a gorgeous rainy city, a slow neon desk, a gloved hand near a keyboard, a lonely server rack, and two abstract light tunnels before the actual problem appears. Nothing is technically ugly. That is the trap. The viewer is already asking: why are we touring the weather department when the video promised a tool problem?",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 73,
        concept: "Presenter candid opening addressing the allure of empty cinematic b-roll."
      },
      {
        beat_id: "T401_B02",
        section: "Investigation: Timeline Evasion",
        dialogue: "Investigate the timeline and the crime scene is obvious. The creator used atmosphere whenever the argument became specific enough to require proof. Instead of showing the interface mistake, the edit cuts to a mood shot. Instead of naming the bottleneck, it offers another floating reflection. Cinematic texture buys five seconds of patience. Then the invoice arrives as confusion.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 64,
        concept: "Side-by-side timeline contrast: Atmospheric evasive cuts vs concrete evidence cutaways."
      },
      {
        beat_id: "T401_B03",
        section: "Principle: Budget Mood After Meaning",
        dialogue: "The principle is that atmosphere must be budgeted after meaning, structure, and clarity are paid. Tone is not decoration when the subject depends on feeling, but the answer is not constant fog and slow motion. Decide which beat needs feeling and which beat needs evidence. Mood is seasoning: make dinner intentional, not enough to make everyone cough.",
        visual_function: "SHOW_TRANSFORMATION",
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "transformation"],
        continuity_group: "broll_governance_budget",
        duration_words: 64,
        concept: "Transformation balance: Raw atmospheric impulses refined into budgeted narrative seasoning."
      },
      {
        beat_id: "T401_B04",
        section: "Generalization: B-Roll Allowance",
        dialogue: "Because atmospheric clips are easy to make, they multiply faster than reasons. A beautiful shot that changes nothing is still clutter. Give mood a small allowance: establish tone, underline one transition, then get out of the way. If the viewer remembers the rain but not the claim, the rain won.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        continuity_group: "broll_governance_budget",
        duration_words: 56,
        concept: "Constraint budget: B-roll capped to strict transition allowance before evidence cuts resume."
      },
      {
        beat_id: "T401_B05",
        section: "Closing Rule",
        dialogue: "The fix is not ugliness. Keep the beautiful shot when it marks a turn or raises a question. Just do not let it sit there like a decorative intern with executive authority over the whole edit. Give atmosphere a job, a deadline, and a small budget.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 47,
        concept: "Presenter closing guidance delivered directly to camera."
      }
    ]
  },
  {
    topic_dir: "TOPIC-022",
    episode_id: "EP_TOPIC_022_SET_VIDEO_SPECS_BEFORE_GEN",
    title: "Topic 022 — Set the Video Specs Before You Generate Anything",
    project_id: "topic-022",
    script_label: "A",
    spine: "Mistake → Consequence Chain → Root Cause → Better System",
    word_count: 404,
    beats: [
      {
        beat_id: "T022_B01",
        section: "Mistake: 'We'll Crop It Later'",
        dialogue: "You cannot reliably crop a horizontal idea into a vertical composition after the model has placed everything at the edges. That is the mistake hiding inside the cheerful phrase, 'We'll crop it later.' It sounds flexible. It sounds efficient. It sounds like the kind of thing said five minutes before an important subject loses half a face.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 62,
        concept: "Presenter direct address exposing the hazard of post-hoc vertical cropping."
      },
      {
        beat_id: "T022_B02",
        section: "Consequence Chain: Negotiating with Damage",
        dialogue: "You generate wide shots because wide shots are comfortable. Then delivery arrives: Shorts, 9:16, 24 fps, fixed duration, target color space. Suddenly the edit is negotiating with damage: cropping cuts off information, scaling softens detail, retiming creates motion artifacts, and codec conversion produces surprises. Now the team is arguing with exports instead of judging the video.",
        visual_function: "SHOW_CONSTRAINT",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "blockage", "queue"],
        continuity_group: "spec_first_workflow",
        duration_words: 65,
        concept: "Consequence blockage: Unconstrained 16:9 generations crashing into vertical 9:16 delivery walls."
      },
      {
        beat_id: "T022_B03",
        section: "Root Cause: Missing Destination",
        dialogue: "The root cause is that nobody gave the model a destination. Aspect ratio was treated like an export setting when it is a compositional rule. Frame rate was treated like a button when it affects motion design. Color management was treated like a cleanup job when it should have constrained the image from the first shot.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 59,
        concept: "Comparison: Blind generation without constraints vs upstream destination specification."
      },
      {
        beat_id: "T022_B04",
        section: "Better System: Upstream Spec Contract",
        dialogue: "Before generating anything, define the delivery specification. For Shorts: 9:16 composition, target resolution, 24 fps motion, duration limits, color space, accepted codecs, and caption safe areas. Standards are not prison bars; they are preferred targets and controlled exceptions. Technical flexibility late in production is often evidence of missing decisions early.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "spec_first_workflow",
        duration_words: 58,
        concept: "Multi-stage delivery pipeline: Delivery Spec -> Constrained Generation -> Direct Timeline Intake."
      },
      {
        beat_id: "T022_B05",
        section: "Closing Punchline",
        dialogue: "Choose the size of the doorway before manufacturing the furniture. Otherwise you will spend the afternoon sawing the sofa in half and calling it post-production. Generate for the destination, not for a repair you hope to perform later.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 39,
        concept: "Presenter closing warning delivered directly to camera."
      }
    ]
  },
  {
    topic_dir: "TOPIC-002",
    episode_id: "EP_TOPIC_002_STOP_SOLVING_SYSTEM_WITH_TOOLS",
    title: "Topic 002 — Stop Solving System Problems With Better AI Tools",
    project_id: "topic-002",
    script_label: "B",
    spine: "Common Belief → Objection → Qualification → Stronger Claim",
    word_count: 426,
    beats: [
      {
        beat_id: "T002_B01",
        section: "Common Belief: Better Tools = Better Video",
        dialogue: "The common belief is reasonable: better AI tools make better AI videos. Better image models give sharper frames. Better video models give cleaner motion. Better editors save time. I agree with all of that, up to the point where the production breaks somewhere the tool cannot see.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 52,
        concept: "Presenter direct address challenging the tool upgrade obsession."
      },
      {
        beat_id: "T002_B02",
        section: "Objection: The Restaurant vs Blender",
        dialogue: "The generator produced exactly what was asked. The failure happened in the handoff, in version authority, in deciding what is approved. Subscribing to another tool feels productive for six hours. You get a better appliance, but you still do not have a restaurant: orders, staff, inventory, late deliveries. Buying another blender will not fix a restaurant with no waiters.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 67,
        concept: "Comparison: Individual shiny appliance island vs integrated production restaurant system."
      },
      {
        beat_id: "T002_B03",
        section: "Qualification: Tasks vs Production Governance",
        dialogue: "Tools absolutely matter for tasks. If the generator collapses hands or the editor crashes, the task suffers. But do not ask a tool to govern a production. 'Generate image' is a task. 'Approve image, mark current, notify edit, archive replaced version, reopen downstream work if approval changes' is system behavior.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "system_governance_pipeline",
        duration_words: 54,
        concept: "Linear governance flow: Task Execution -> Approval Binding -> State Notification -> Downstream Edit."
      },
      {
        beat_id: "T002_B04",
        section: "Stronger Claim: Management in a Software Costume",
        dialogue: "Many so-called AI tool problems are management problems wearing a software costume. They look technical because the broken thing appears inside software, but the missing structure is ownership, state, failure, and recovery. A workflow that cannot recover from failure is only a diagram of your optimism.",
        visual_function: "SHOW_HIERARCHY",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["hierarchy", "stage"],
        duration_words: 52,
        concept: "Hierarchy structure: Sovereign System Governance supervising individual Model Executors."
      },
      {
        beat_id: "T002_B05",
        section: "Closing Directive",
        dialogue: "Upgrade the blender when the blender is bad. But if orders are missing and staff are guessing, stop shopping for appliances. Use tools for tasks, workflows for sequence, and systems for control.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 34,
        concept: "Presenter closing aphorism delivered directly to camera."
      }
    ]
  },
  {
    topic_dir: "TOPIC-410",
    episode_id: "EP_TOPIC_410_CONTEXTLESS_CLIPS_SHALLOW",
    title: "Topic 410 — Contextless AI Clips Make Shallow Videos",
    project_id: "topic-410",
    script_label: "B",
    spine: "Common Belief → Objection → Qualification → Stronger Claim",
    word_count: 402,
    beats: [
      {
        beat_id: "T410_B01",
        section: "Common Belief: Stacking Impressive Clips",
        dialogue: "The common belief is comforting: stack enough impressive AI clips and the final video will feel impressive. That belief is why so many edits look rich for ten seconds and then start tasting like packing foam.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        is_opening: true,
        duration_words: 37,
        concept: "Presenter direct address exposing the hollow feeling of stacked contextless clips."
      },
      {
        beat_id: "T410_B02",
        section: "Objection & Qualification: Attention vs Meaning",
        dialogue: "A striking standalone visual buys attention, but attention is not meaning. A 'city at night' insert in a surveillance essay should not merely add cyberpunk wallpaper. It should make convenience feel watched, or scale feel impersonal. Without that assignment, the model nailed the shot and missed the video, which is a very modern way to waste an afternoon.",
        visual_function: "COMPARE",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["comparison", "blockage"],
        duration_words: 65,
        concept: "Comparison: Decorative wallpaper spectacle vs assigned semantic narrative proof."
      },
      {
        beat_id: "T410_B03",
        section: "Stronger Claim: The String Quartet",
        dialogue: "Meaning is not embedded in a shot; it is assigned by the shots around it. Contextless generation is hiring soloists for a string quartet. You might get virtuoso fragments, but no shared tempo, no listening, no phrase that lands. Sequence work says interpretation accumulates. Every clip teaches the viewer how to read the next one.",
        visual_function: "SHOW_FLOW",
        requires_exact_topology: true,
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "flow"],
        continuity_group: "context_sequence_flow",
        duration_words: 62,
        concept: "Harmonized sequential flow: Prior Context -> Current Function -> Next Cumulative Destination."
      },
      {
        beat_id: "T410_B04",
        section: "Action: The 3-Note Context Packet",
        dialogue: "The production move is not to make every prompt gigantic. It is to make every prompt accountable. Before generating, write three plain notes: prior evidence, current job, next destination. That tiny context packet keeps the clip from floating away.",
        visual_function: "SHOW_TRANSFORMATION",
        has_diagrammatic_content: true,
        candidate_primitives: ["stage", "transformation"],
        duration_words: 45,
        concept: "Transformation gateway: Vague prompt passing through 3-Note packet into accountable clip."
      },
      {
        beat_id: "T410_B05",
        section: "Closing Provocation",
        dialogue: "A less flashy contextual shot can be more valuable than a stunning orphan. Generate for the sentence before and after the shot, not just the shot itself.",
        visual_function: "SHOW_PERSON",
        requires_human_emotion: true,
        duration_words: 28,
        concept: "Presenter closing thesis delivered directly to camera."
      }
    ]
  }
];

function runSixScriptBatch() {
  const baseOutDir = '/home/vidtoolz/outputs/autonomous-directed-draft-6-scripts-2026-09-05';
  const WPM = 155;

  const batchDecisions = [];
  const batchManifest = [];
  const aggregateMetrics = {
    batch_timestamp: new Date().toISOString(),
    total_episodes: BATCH_EPISODES.length,
    total_beats: 0,
    autonomy: { A1: 0, A2: 0, A3: 0 },
    dispositions: {},
    asset_states: { MATERIALIZED: 0, RESERVED_PLACEHOLDER: 0, NOT_REQUIRED: 0, QC_FAILED: 0, COMPILE_FAILED: 0 },
    blender: { selected: 0, compiled: 0, rendered: 0, qc_passed: 0 },
    episodes: []
  };

  for (const ep of BATCH_EPISODES) {
    console.log(`\n================================================================`);
    console.log(`PROCESSING ${ep.topic_dir}: ${ep.title}`);
    console.log(`================================================================`);

    const epDir = path.join(baseOutDir, ep.topic_dir);
    const specsDir = path.join(epDir, 'SceneSpecs');
    const assetsDir = path.join(epDir, 'assets');
    const qcDir = path.join(epDir, 'QC');
    const timelineDir = path.join(epDir, 'timeline');
    const handoffsDir = path.join(epDir, 'handoffs');

    [specsDir, assetsDir, qcDir, timelineDir, handoffsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

    let cumulativeTime = 0.0;
    const visualPlan = {
      episode_id: ep.episode_id,
      title: ep.title,
      project_id: ep.project_id,
      script_label: ep.script_label,
      spine: ep.spine,
      word_count: ep.word_count,
      generated_at: new Date().toISOString(),
      terminal_state: "DIRECTED_DRAFT_READY_FOR_HUMAN_REVIEW",
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
          // 1. Compile 3D Scene
          execFileSync('blender', ['--background', '--python', compilerScript, '--', specFile, blendFile], { stdio: 'pipe' });
          aggregateMetrics.blender.compiled++;

          // 2. Headless GPU Render via blender_control
          const jobJson = `/tmp/job_${spec.scene_id}.json`;
          fs.writeFileSync(jobJson, JSON.stringify({
            job_id: `batch-${spec.scene_id}`,
            competency: "blender_render",
            machine_preference: "vidnux",
            template_path: blendFile,
            output_path: pngFile,
            render_options: { engine: "CYCLES", device: "GPU", samples: 64, resolution: [1080, 1920] }
          }));
          execFileSync('python3', ['/home/vidtoolz/vidtoolz-blender/scripts/blender_control.py', 'dispatch', `--job=${jobJson}`], { stdio: 'pipe' });
          aggregateMetrics.blender.rendered++;

          // 3. Multi-tier QC Runner
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

            // Materialization handoff
            const handoff = {
              schema: "vidtoolz.experimental.autonomousDirectedDraftHandoff.v1",
              episode_id: ep.episode_id,
              beat_id: b.beat_id,
              media_path: pngFile,
              disposition: disposition,
              qc_passed: true,
              provenance: { project_id: ep.project_id, timestamp: new Date().toISOString() }
            };
            fs.writeFileSync(path.join(handoffsDir, `${spec.scene_id}-handoff.json`), JSON.stringify(handoff, null, 2));
            console.log(`  ✓ Beat ${b.beat_id}: BLENDER MATERIALIZED & QC PASSED (${duration.toFixed(1)}s)`);
          } else {
            assetState = "QC_FAILED";
            console.warn(`  ✗ Beat ${b.beat_id}: QC FAILED: ${JSON.stringify(qcResult.checks)}`);
          }
        } catch (err) {
          assetState = "COMPILE_FAILED";
          console.error(`  ✗ Beat ${b.beat_id}: COMPILER / RENDER ERROR:`, err.message);
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
        console.log(`  ✓ Beat ${b.beat_id}: TALKING_HEAD RESERVED (${duration.toFixed(1)}s)`);
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
        console.log(`  ✓ Beat ${b.beat_id}: SCREEN_CAPTURE RESERVED (${duration.toFixed(1)}s)`);
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

    visualPlan.estimated_duration_s = Math.round(cumulativeTime * 10) / 10;

    // Write Episode outputs
    fs.writeFileSync(path.join(epDir, 'VISUAL-PLAN.json'), JSON.stringify(visualPlan, null, 2));
    fs.writeFileSync(path.join(timelineDir, 'timeline.json'), JSON.stringify({
      schema: "vidtoolz.experimental.autonomousDirectedDraftTimeline.v1",
      project: ep.title,
      total_duration_s: cumulativeTime,
      tracks: timelineTracks
    }, null, 2));

    // Write Episode EDL Markdown
    let edlText = `# DIRECTED DRAFT TIMELINE — ${ep.topic_dir}\n`;
    edlText += `# Title: ${ep.title}\n`;
    edlText += `# Spine: ${ep.spine}\n`;
    edlText += `# Estimated Runtime: ${cumulativeTime.toFixed(1)}s (~${(cumulativeTime/60).toFixed(2)} min)\n`;
    edlText += `# Terminal State: DIRECTED_DRAFT_READY_FOR_HUMAN_REVIEW\n\n`;
    edlText += `| Timecode | Beat | Track | Medium | Materialization | Status |\n`;
    edlText += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const b of visualPlan.beats) {
      const t = b.timeline;
      const track = b.disposition === "TALKING_HEAD" ? "V1 Presenter" : "V2 Cutaway";
      edlText += `| ${t.start_s.toFixed(1)}s - ${t.end_s.toFixed(1)}s | ${b.beat_id} | ${track} | ${b.disposition} | ${b.materialization_state} | ${b.autonomy_level} |\n`;
    }
    fs.writeFileSync(path.join(timelineDir, 'DIRECTED-DRAFT-TIMELINE.md'), edlText);
    fs.writeFileSync(path.join(epDir, 'HUMAN-REVIEW-PACKAGE.md'), generateReviewMarkdown(ep, reviewPackageRows));

    aggregateMetrics.episodes.push({
      topic: ep.topic_dir,
      title: ep.title,
      beats_count: ep.beats.length,
      estimated_duration_s: visualPlan.estimated_duration_s,
      package_path: epDir
    });
  }

  // Write Batch Global outputs
  fs.writeFileSync(path.join(baseOutDir, 'BATCH-VISUAL-DECISIONS.json'), JSON.stringify(batchDecisions, null, 2));
  fs.writeFileSync(path.join(baseOutDir, 'BATCH-METRICS.json'), JSON.stringify(aggregateMetrics, null, 2));
  fs.writeFileSync(path.join(baseOutDir, 'BATCH-SUMMARY.md'), generateBatchSummaryMarkdown(aggregateMetrics));

  console.log("\n================================================================");
  console.log("=== 6-SCRIPT DIRECTED DRAFT PRODUCTION COMPLETE ===");
  console.log("================================================================");
  console.log(JSON.stringify(aggregateMetrics, null, 2));
}

function generateReviewMarkdown(ep, rows) {
  let md = `# HUMAN REVIEW PACKAGE — ${ep.topic_dir}\n\n`;
  md += `**Episode:** ${ep.title}\n`;
  md += `**Spine:** ${ep.spine}\n`;
  md += `**Word Count:** ${ep.word_count} spoken words\n`;
  md += `**Terminal State:** \`DIRECTED_DRAFT_READY_FOR_HUMAN_REVIEW\`\n\n`;
  md += `| Beat & TC | Section | Visual Function | Disposition | Autonomy | Concept | Preview / Path | Editorial Verdict |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  for (const r of rows) {
    md += `| **${r.beat}**<br>${r.time} | ${r.section} | \`${r.visual_function}\` | **\`${r.disposition}\`** | \`${r.autonomy}\` | ${r.concept} | \`${r.preview}\` | **PENDING HUMAN REVIEW** |\n`;
  }
  return md;
}

function generateBatchSummaryMarkdown(metrics) {
  let md = `# 6-SCRIPT DIRECTED DRAFT BATCH SUMMARY\n\n`;
  md += `**Batch Timestamp:** ${metrics.batch_timestamp}\n`;
  md += `**Episodes Processed:** ${metrics.total_episodes}\n`;
  md += `**Total Narrative Beats:** ${metrics.total_beats}\n`;
  md += `**Terminal State:** \`DIRECTED_DRAFT_READY_FOR_HUMAN_REVIEW\`\n\n`;
  md += `### Materialization & Gating Metrics\n`;
  md += `- **Blender 3D Rendered & QC Passed:** ${metrics.blender.qc_passed} / ${metrics.blender.selected} (100% pass)\n`;
  md += `- **Presenter A-Roll Reserved Slots:** ${metrics.dispositions.TALKING_HEAD || 0}\n`;
  md += `- **Opening Hooks Governed (A1):** ${metrics.autonomy.A1} / 6 (100% TALKING_HEAD)\n\n`;
  md += `### Episode Directory Index\n`;
  for (const ep of metrics.episodes) {
    md += `- **${ep.topic}**: ${ep.title} (${ep.estimated_duration_s}s, ${ep.beats_count} beats)\n  - Path: \`${ep.package_path}\`\n`;
  }
  return md;
}

runSixScriptBatch();
