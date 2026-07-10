#!/usr/bin/env node
'use strict';

/*
 * Manual-upload provenance audit (READ-ONLY).
 *
 * Reports the evidence-based source classification of every image slot in one
 * caller-specified package directory (or fixture root). It NEVER moves, writes,
 * deletes, or migrates anything — full backward compatibility is provided by the
 * runtime classifier (package-media-index.classifyImageSource), so no data
 * migration is required. This tool exists only to make the current classification
 * inspectable (e.g. how many legacy flux-local files can be proven generated vs
 * are ambiguous) before any future, separately-authorized cleanup.
 *
 * Usage:
 *   node scripts/manual-upload-provenance-audit.js <packageDir>
 *
 * There is deliberately NO --apply / mutation mode.
 */

const fs = require('fs');
const path = require('path');
const idx = require('../package-media-index.js');

function auditPackage(packageDir) {
  if (!packageDir || !fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    const e = new Error(`Package directory not found: ${packageDir}`);
    e.statusCode = 404;
    throw e;
  }
  const root = path.resolve(packageDir);
  const evidence = idx.buildImageEvidence(root);
  const rows = [];
  const scanDir = (subdir, re) => {
    const dir = path.join(root, ...subdir.split('/'));
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isFile() || !re.test(entry.name)) continue;
      const rel = `${subdir}/${entry.name}`;
      // Path containment: never follow a name that escapes the scanned root.
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(root + path.sep)) continue;
      rows.push({
        path: rel,
        prompt_index: idx.promptIndexFromName(entry.name),
        source_type: idx.classifyImageSource(rel, evidence),
        exists: fs.existsSync(abs),
      });
    }
  };
  scanDir('images/flux-local', /\.(png|jpe?g)$/i);
  scanDir('images/manual-upload', /\.(png|jpe?g)$/i);
  const summary = { generated: 0, manual_upload: 0, legacy_unknown: 0, missing_file: 0 };
  for (const r of rows) {
    if (!r.exists) summary.missing_file += 1;
    summary[r.source_type] = (summary[r.source_type] || 0) + 1;
  }
  return {
    ok: true,
    mode: 'dry-run',            // read-only; no --apply exists
    package: path.basename(root),
    package_dir: root,
    total: rows.length,
    summary,
    images: rows.sort((a, b) => (a.prompt_index || 0) - (b.prompt_index || 0)),
  };
}

module.exports = { auditPackage };

if (require.main === module) {
  const target = process.argv[2];
  try {
    const report = auditPackage(target);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
