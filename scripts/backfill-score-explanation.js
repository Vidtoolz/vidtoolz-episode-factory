#!/usr/bin/env node
/*
 * Backfill score_explanation onto a promoted project that was created before the
 * score-explanation system existed. NON-DESTRUCTIVE: reads the project's
 * promoted-from-idea.json, loads the ORIGINAL archived idea (daily or user-topic),
 * builds the explanation from real stored fields (never invents one), and writes
 * ONLY the missing score_explanation field back — preserving everything else.
 *
 * No LLM, no media, no package-runs. Confined to one resolved package under the
 * aigen script-packages root.
 *
 * Usage:
 *   node scripts/backfill-score-explanation.js --project <project-id> [--dry-run] [--force]
 */

const fs = require('fs');
const path = require('path');

const { buildScoreExplanation } = require('../score-explanation.js');

const DEFAULT_AIGEN_ROOT = process.env.AIGEN_VIDNAS_ROOT || '/mnt/vidnas_public/VIDTOOLZ/03_SHARED_MEDIA_LIBRARY/aigen';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function writeJsonAtomic(p, data) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

function resolvePackageDir(projectId, packagesRoot) {
  const id = String(projectId || '');
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) {
    return { error: 'Invalid project id (path traversal / bad characters rejected).' };
  }
  const root = path.resolve(packagesRoot);
  const dir = path.resolve(root, id);
  if (!dir.startsWith(root + path.sep)) return { error: 'Resolved path escaped script-packages.' };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: `Project not found: ${id}` };
  return { dir };
}

// Locate the original archived idea for a marker.
function loadSourceIdea(marker, aigenRoot) {
  const date = marker.date || marker.source_date || '';
  const index = Number.isInteger(marker.index) ? marker.index : marker.source_idea_index;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !Number.isInteger(Number(index))) {
    return { error: 'Marker lacks a usable source date/index.' };
  }
  let archivePath;
  if (marker.source === 'user_topic_scout') {
    const runId = String(marker.run_id || '');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(runId)) return { error: 'Marker lacks a usable run_id.' };
    archivePath = path.join(aigenRoot, 'topic-idea-scout', date, runId, 'ideas.json');
  } else if (marker.source === 'daily_idea_scout') {
    archivePath = path.join(aigenRoot, 'daily-idea-scout', date, 'ideas.json');
  } else {
    return { error: `Unsupported source: ${marker.source || '(none)'}` };
  }
  const run = readJson(archivePath);
  if (!run) return { error: `Source archive missing: ${archivePath}`, archivePath };
  const ideas = Array.isArray(run.ideas) ? run.ideas : [];
  const idea = ideas[Number(index)];
  if (!idea) return { error: `Idea index ${index} not in source archive.`, archivePath };
  return { idea, archivePath };
}

function usedFields(idea) {
  return ['score_summary', 'strengths', 'weaknesses', 'evaluation_criteria', 'rationale', 'ranking_rationale', 'audience_fit', 'production_fit', 'proof_plan', 'evidence', 'scores']
    .filter((k) => {
      const v = idea[k];
      return Array.isArray(v) ? v.length > 0 : (v && typeof v === 'object' ? Object.keys(v).length > 0 : Boolean(v));
    });
}

function backfillProject(opts = {}) {
  const aigenRoot = opts.aigenRoot || DEFAULT_AIGEN_ROOT;
  const packagesRoot = opts.packagesRoot || path.join(aigenRoot, 'script-packages');
  const resolved = resolvePackageDir(opts.projectId, packagesRoot);
  if (resolved.error) return { ok: false, status: 'invalid', message: resolved.error };

  const markerPath = path.join(resolved.dir, 'promoted-from-idea.json');
  const marker = readJson(markerPath);
  if (!marker) return { ok: false, status: 'not_promoted', message: 'No promoted-from-idea.json (not a promoted project).' };

  if (marker.score_explanation && typeof marker.score_explanation === 'object' && !opts.force) {
    return { ok: true, status: 'already', message: 'score_explanation already present (use --force to rebuild).', file: markerPath };
  }

  const src = loadSourceIdea(marker, aigenRoot);
  if (src.error) return { ok: false, status: 'no_archive', message: src.error, archive_path: src.archivePath || null };

  const explanation = buildScoreExplanation(src.idea, marker.source);
  if (!explanation.available) {
    return { ok: false, status: 'insufficient', message: 'Source idea has no scoring fields to explain; not invented.', archive_path: src.archivePath };
  }

  const result = {
    ok: true,
    status: 'backfilled',
    project_id: opts.projectId,
    archive_path: src.archivePath,
    fields_used: usedFields(src.idea),
    score_explanation: explanation,
    file: markerPath,
    dry_run: Boolean(opts.dryRun),
  };
  if (opts.dryRun) return result;

  writeJsonAtomic(markerPath, Object.assign({}, marker, { score_explanation: explanation }));
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.projectId = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--root') out.packagesRoot = argv[++i];
    else if (a === '--aigen-root') out.aigenRoot = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.projectId) {
    console.log('Usage: node scripts/backfill-score-explanation.js --project <project-id> [--dry-run] [--force]');
    process.exit(opts.help ? 0 : 1);
  }
  const r = backfillProject(opts);
  console.log(`[${r.status}] ${r.message || ''}`.trim());
  if (r.status === 'backfilled') {
    console.log(`  ${r.dry_run ? 'WOULD WRITE' : 'WROTE'}: ${r.file}`);
    console.log(`  source archive: ${r.archive_path}`);
    console.log(`  fields used: ${r.fields_used.join(', ')}`);
    console.log(`  summary: ${(r.score_explanation.summary || '').slice(0, 120)}`);
    console.log(`  succeeded: ${r.score_explanation.succeeded.length} | weaker: ${r.score_explanation.weaker_points.length} | criteria: ${r.score_explanation.criteria.length}`);
  }
  process.exit(r.ok ? 0 : 2);
}

if (require.main === module) main();

module.exports = { backfillProject, resolvePackageDir, loadSourceIdea, parseArgs };
