#!/usr/bin/env node
'use strict';

// Bounded operational entry point for one already-authored canonical Visual
// Plan. It is intentionally sequential: Generation Supervisor retains the one
// resource authority and the command adds no parallel dispatch policy.

const fs = require('node:fs');
const path = require('node:path');
const visualPlan = require('./visual-plan.js');
const policy = require('./draft-bespoke-still-policy.js');
const supervisor = require('./generation-supervisor.js');

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function parseArgs(argv) {
  const out = { run_dir: null, visual_plan: null, execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!out.run_dir && !token.startsWith('--')) out.run_dir = token;
    else if (token === '--visual-plan') out.visual_plan = argv[++index];
    else if (token === '--execute') out.execute = true;
    else fail('DRAFT_STILL_CANARY_ARGUMENT_INVALID', token);
  }
  if (!out.run_dir || !out.visual_plan) fail('DRAFT_STILL_CANARY_ARGUMENT_INVALID', 'run directory and --visual-plan are required');
  return out;
}

async function run(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const runDir = path.resolve(args.run_dir); const planPath = path.resolve(args.visual_plan);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) fail('DRAFT_STILL_RUN_MISSING', runDir);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const validation = visualPlan.validatePlan(plan);
  if (!validation.ok) fail('DRAFT_STILL_VISUAL_PLAN_INVALID', validation.reason_codes.join(', '));
  const checked = policy.validatePlanPolicy(plan);
  if (!checked.applicable || !checked.ok) fail(checked.code || 'DRAFT_STILL_POLICY_MISSING', checked.detail || planPath);
  const runId = path.basename(runDir);
  const base = { task_id: `draft-bespoke-canary:${plan.plan_id}`, project_id: plan.story.project_id, package_run_id: runId, run_dir: runDir };
  const tasks = checked.slots.map((slot) => policy.generationTaskForSlot(base, plan, slot));
  if (!args.execute) return {
    state: 'DRY_RUN', run_id: runId, visual_plan: planPath, planned_still_count: tasks.length,
    sequential: true, normal_generation_attempts_per_slot: 1, technical_retry_limit_per_slot: 1,
    estimated_image_generation_wall_clock_seconds: tasks.length * 51,
    dispatch_actions: tasks.map((task) => ({ task_id: task.task_id, slot_id: task.slot.slot_id, prompt_sha256: task.prompt.prompt_sha256 })),
  };
  const results = [];
  for (const task of tasks) {
    const result = await supervisor.run(task, options);
    results.push({ slot_id: task.slot.slot_id, state: result.state, reason: result.reason, attempts: result.attempts, output: result.outputs?.[0] || null });
    if (result.state !== 'COMPLETE') fail('DRAFT_STILL_CANARY_SLOT_FAILED', `${task.slot.slot_id}: ${result.reason}`);
  }
  const paths = policy.evidencePaths(runDir);
  return { state: 'COMPLETE', run_id: runId, visual_plan: planPath, sequential: true, results, registry: paths.registry, metrics: paths.metrics };
}

if (require.main === module) run().then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { parseArgs, run };
