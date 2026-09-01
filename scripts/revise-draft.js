#!/usr/bin/env node
'use strict';

/*
 * revise-draft — the one canonical entry point for turning Mikko's submitted
 * Draft review into a new reviewable Draft.
 *
 *   node scripts/revise-draft.js --run-id <run-id>            # plan + execute
 *   node scripts/revise-draft.js --run-id <run-id> --plan-only
 *   node scripts/revise-draft.js --run-id <run-id> --status
 *
 * Hermes never supplies asset paths, review JSON, schema names, draft versions
 * or adapter internals: the run's current review, its exact reviewed Draft and
 * every upstream authority are resolved here. There is no caller path
 * authority and no fallback generation — an unwired domain refuses with its
 * exact open question.
 */

const path = require('node:path');

const directed = require('./directed-draft-assembly-handoff.js');
const planner = require('./draft-revision-plan.js');
const executor = require('./draft-revision-successor.js');
const adapters = require('./draft-revision-adapters.js');

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function parseArgs(argv) {
  const out = { repo: path.resolve(__dirname, '..'), planOnly: false, status: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = path.resolve(argv[++index]);
    else if (argv[index] === '--plan-only') out.planOnly = true;
    else if (argv[index] === '--status') out.status = true;
    else fail('REVISE_DRAFT_ARGUMENT_INVALID', argv[index]);
  }
  if (!out.runId) fail('REVISE_DRAFT_ARGUMENT_INVALID', '--run-id is required');
  return out;
}

async function reviseDraft(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const runDir = directed.resolveRunDir(args.repo, args.runId);
  if (args.status) return { command: 'status', ...planner.revisionStatus(runDir) };
  const planned = planner.buildRevisionPlan(runDir);
  const summary = {
    plan_state: planned.state, plan_id: planned.plan.plan_id, decision: planned.plan.decision,
    target_draft_version: planned.plan.target_draft_version,
    work_items: planned.plan.work_items.map((item) => ({ work_item_id: item.work_item_id, domain: item.domain, kind: item.kind, section_id: item.target.section_id, blocking: item.execution_blocking })),
    reuse_census: planned.plan.reuse_census,
    blocking: planned.plan.blocking,
    plan_path: planned.plan_path,
  };
  if (args.planOnly || planned.plan.decision !== 'REVISION_REQUIRED') {
    return { command: 'plan', ...summary, executed: null };
  }
  const executed = await executor.executeRevisionPlan(runDir, {
    adapters: options.adapters || adapters.liveAdapters(options.adapterDeps || {}),
    ...options.executorOptions,
  });
  return {
    command: 'revise', ...summary,
    executed: {
      state: executed.state,
      census: executed.successor?.census ?? null,
      successor_draft: executed.successor?.successor_draft ?? null,
      blocking: executed.blocking ?? null,
      adapter_wiring: adapters.wiringReport(),
    },
  };
}

async function main() {
  try {
    const result = await reviseDraft();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const state = result.executed?.state ?? result.decision ?? result.state;
    return ['REVISION_COMPLETE', 'ALREADY_COMPLETE', 'NO_REVISION_REQUIRED'].includes(state) ? 0 : 3;
  } catch (error) {
    process.stderr.write(`${error.code || 'REVISE_DRAFT_FAILED'}: ${error.message}\n`);
    return 1;
  }
}

module.exports = { parseArgs, reviseDraft, main };

if (require.main === module) main().then((code) => { process.exitCode = code; });
