/*
 * VIDTOOLZ project-scoped script workspace helpers (pure fs).
 *
 * The script lives in the package using the canonical paths the state resolver
 * reads: draft = script/script-draft.md, final = script/script-final.md. The
 * resolver's hasScript looks at script/script-final.md first, so approving here
 * advances the project past the "script" stage.
 *
 * Confined to a single resolved package dir (the server resolves it under the
 * aigen script-packages root before calling these). No path traversal.
 */

const fs = require('fs');
const path = require('path');

const DRAFT_REL = path.join('script', 'script-draft.md');
const FINAL_REL = path.join('script', 'script-final.md');
const NOTES_REL = path.join('script', 'script-notes.md');

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}
function writeTextAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  const body = String(text).endsWith('\n') ? String(text) : `${String(text)}\n`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, p);
}

function fileInfo(packageDir, rel) {
  const abs = path.join(packageDir, rel);
  const text = readText(abs);
  return { exists: text !== null, path: rel, text: text || '' };
}

// A helpful starting scaffold from the chosen topic — NOT forced into the saved
// script; just a prefill when no draft/final exists yet.
function buildScaffold(ctx = {}) {
  const title = ctx.title || 'Untitled project';
  const premise = ctx.premise || '';
  const angle = ctx.angle || '';
  return [
    `# ${title}`,
    '',
    'Topic:',
    premise || '[The topic/premise you selected.]',
    '',
    'Angle:',
    angle || '[The angle from the source idea / rationale.]',
    '',
    'Opening:',
    '[Write the first spoken line.]',
    '',
    'Script:',
    '[Write the script here.]',
    '',
    'Visual notes:',
    '[Optional notes for A-roll, screen recording, AI visuals.]',
    '',
  ].join('\n');
}

function readScript(packageDir) {
  return {
    draft: fileInfo(packageDir, DRAFT_REL),
    final: fileInfo(packageDir, FINAL_REL),
    notes: fileInfo(packageDir, NOTES_REL),
  };
}

function saveDraft(packageDir, text, notes) {
  if (typeof text !== 'string' || !text.trim()) {
    const e = new Error('Draft text is required.'); e.statusCode = 400; throw e;
  }
  writeTextAtomic(path.join(packageDir, DRAFT_REL), text);
  if (typeof notes === 'string' && notes.trim()) writeTextAtomic(path.join(packageDir, NOTES_REL), notes);
  return { ok: true, draft: { exists: true, path: DRAFT_REL } };
}

function approveFinal(packageDir, text, confirmReplace) {
  if (typeof text !== 'string' || !text.trim()) {
    const e = new Error('Final script cannot be empty.'); e.statusCode = 400; throw e;
  }
  const finalAbs = path.join(packageDir, FINAL_REL);
  if (fs.existsSync(finalAbs) && !confirmReplace) {
    const e = new Error('A final script already exists. Re-submit with confirm_replace to overwrite it.');
    e.statusCode = 409; throw e;
  }
  writeTextAtomic(finalAbs, text);
  return { ok: true, final: { exists: true, path: FINAL_REL } };
}

module.exports = {
  DRAFT_REL,
  FINAL_REL,
  NOTES_REL,
  buildScaffold,
  readScript,
  saveDraft,
  approveFinal,
};
