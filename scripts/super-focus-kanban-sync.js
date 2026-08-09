#!/usr/bin/env node
// Reconcile Super Focus qualifying evaluations with the Production Kanban.
//
// Replays the same idempotent upsert the evaluate-script route performs, for
// projects whose CURRENT persisted evaluation qualifies (verdict PRODUCE and
// not stale). Covers: Kanban downtime at evaluation time, EF restarts,
// transient HTTP errors, and historical scripts that passed before the bridge
// existed. Safe to run repeatedly — identical state is a no-op on the card.
//
// Usage:
//   node scripts/super-focus-kanban-sync.js --project <id> [--dry-run]
//   node scripts/super-focus-kanban-sync.js --all [--dry-run]
//
// Env: SUPER_FOCUS_ROOT (project store), KANBAN_PORT (default 8070).
// Exit codes: 0 = nothing failed; 1 = at least one sync failed; 2 = bad usage.

'use strict';

const path = require('path');
const superFocus = require(path.join(__dirname, '..', 'super-focus.js'));
const bridge = require(path.join(__dirname, '..', 'super-focus-kanban-bridge.js'));

function usage() {
  console.error('Usage: node scripts/super-focus-kanban-sync.js (--project <id> | --all) [--dry-run]');
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const pIdx = args.indexOf('--project');
  const projectId = pIdx >= 0 ? args[pIdx + 1] : null;
  if ((all && projectId) || (!all && !projectId)) usage();

  const root = process.env.SUPER_FOCUS_ROOT || undefined;
  const ids = all
    ? superFocus.listProjects({ root }).map((p) => p.project_id)
    : [projectId];

  let qualified = 0;
  let synced = 0;
  let failed = 0;
  for (const id of ids) {
    let evaluation = null;
    try {
      evaluation = superFocus.readScriptEvaluation(id, { root });
    } catch (err) {
      console.error(`SKIP    ${id} — unreadable (${err.message})`);
      continue;
    }
    if (!bridge.evaluationQualifies(evaluation)) {
      const why = !evaluation ? 'no evaluation'
        : evaluation.stale ? 'evaluation stale (script changed since pass)'
          : `verdict ${evaluation.verdict}`;
      console.log(`SKIP    ${id} — ${why}`);
      continue;
    }
    qualified += 1;
    if (dryRun) {
      const hash = bridge.computeEvaluationHash(evaluation);
      console.log(`WOULD-SYNC ${id} — ${evaluation.verdict} ${evaluation.total_score}/100, eval ${hash.slice(0, 12)}…`);
      continue;
    }
    const outcome = await bridge.syncProjectToKanban(id, {
      root,
      log: (msg) => console.error(`[super-focus-kanban-sync] ${msg}`),
    });
    if (outcome.status === 'synced') {
      synced += 1;
      console.log(`SYNCED  ${id} → card ${outcome.card_id} (${outcome.card_stage}${outcome.card_existing ? ', existing' : ', created'}) eval ${outcome.evaluation_hash.slice(0, 12)}…`);
    } else {
      failed += 1;
      console.error(`FAILED  ${id} — ${outcome.error ? outcome.error.message : outcome.reason}`);
    }
  }

  console.log(`\n${ids.length} project(s) scanned, ${qualified} qualified, ${dryRun ? '0 (dry-run)' : synced} synced, ${failed} failed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => { console.error(`FATAL: ${err.message}`); process.exit(1); });
