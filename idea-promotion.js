/*
 * VIDTOOLZ idea triage + promote-to-project.
 *
 * Ideas live in per-date daily-idea-scout archives (<archiveRoot>/<date>/ideas.json)
 * which are strictly validated and have NO stable id. So:
 *   - triage status (approve/reject/park/unpark/promote) is stored in a
 *     NON-DESTRUCTIVE sidecar (<archiveRoot>/<date>/idea-triage.json), keyed by
 *     the idea's array index. The validated ideas.json is never rewritten.
 *   - promote creates a minimal, convention-compatible script-package the project
 *     state resolver can read, and is idempotent (re-promoting returns the
 *     existing project rather than duplicating it).
 *
 * No external calls, no media generation. Read/write confined to the archive
 * sidecar and the new package folder.
 */

const fs = require('fs');
const path = require('path');

const dailyIdeaScout = require('./scripts/daily-idea-scout.js');

const ALLOWED_STATUSES = ['new', 'shortlisted', 'approved', 'rejected', 'parked', 'promoted'];
const TRIAGE_FILE = 'idea-triage.json';
const PROMOTED_MARKER = 'promoted-from-idea.json';

function slugifyTitle(title) {
  return String(title || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'idea';
}

function ideaUid(date, index) {
  return `${date}#${index}`;
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

function triagePath(archiveRoot, date) {
  return path.join(archiveRoot, date, TRIAGE_FILE);
}
function readTriage(archiveRoot, date) {
  return readJson(triagePath(archiveRoot, date), {});
}

function getIdea(archiveRoot, date, index) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    const e = new Error('A valid date (YYYY-MM-DD) is required.'); e.statusCode = 400; throw e;
  }
  const run = dailyIdeaScout.readArchive(archiveRoot, date);
  const ideas = run && Array.isArray(run.ideas) ? run.ideas : null;
  if (!ideas) { const e = new Error(`No idea archive for ${date}.`); e.statusCode = 404; throw e; }
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= ideas.length) {
    const e = new Error(`Idea index ${index} out of range for ${date}.`); e.statusCode = 404; throw e;
  }
  return ideas[i];
}

// Set an idea's triage status in the sidecar (non-destructive). Preserves any
// existing project_id so a status change after promotion doesn't lose the link.
function setIdeaStatus(opts = {}) {
  const { archiveRoot, date, index, status } = opts;
  if (!ALLOWED_STATUSES.includes(status)) {
    const e = new Error(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`); e.statusCode = 400; throw e;
  }
  const idea = getIdea(archiveRoot, date, index); // validates date/index, 404s otherwise
  const triage = readTriage(archiveRoot, date);
  const key = String(index);
  const prev = triage[key] || {};
  triage[key] = Object.assign({}, prev, {
    status,
    title: idea.title,
    updated_at: opts.now || new Date().toISOString(),
  });
  writeJsonAtomic(triagePath(archiveRoot, date), triage);
  return { ok: true, idea_uid: ideaUid(date, index), status, entry: triage[key] };
}

// Scan script-packages for a project already promoted from this idea uid.
function findPromotedProject(scriptPackagesRoot, uid) {
  let entries = [];
  try { entries = fs.readdirSync(scriptPackagesRoot, { withFileTypes: true }); } catch (e) { return ''; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const marker = readJson(path.join(scriptPackagesRoot, entry.name, PROMOTED_MARKER), null);
    if (marker && marker.idea_uid === uid) return entry.name;
  }
  return '';
}

function chooseProjectId(scriptPackagesRoot, title, date) {
  const slug = slugifyTitle(title);
  const stamp = String(date || '').replace(/-/g, '') || 'undated';
  let base = `${slug}-${stamp}`;
  let id = base;
  let n = 1;
  while (fs.existsSync(path.join(scriptPackagesRoot, id))) {
    n += 1;
    id = `${base}-${n}`;
  }
  return id;
}

// Shared project-creation used by BOTH daily and user-topic promotion so a
// promoted project has identical structure regardless of source. Writes a
// convention-compatible script-package the state resolver can read.
//   fields: { title, idea, score, thumbnailConcept, premise }
//   prov:   { source, idea_uid, date, marker }  (marker = extra provenance fields)
function createProjectFromIdea(scriptPackagesRoot, fields, prov, nowIso) {
  const projectId = chooseProjectId(scriptPackagesRoot, fields.title, prov.date);
  const pkgDir = path.join(scriptPackagesRoot, projectId);
  writeJsonAtomic(path.join(pkgDir, 'selected-package.json'), {
    selectedAt: nowIso,
    source: prov.source,
    package: {
      proposedTitle: fields.title,
      idea: fields.idea || '',
      score: fields.score || 0,
      thumbnailConcept: fields.thumbnailConcept || '',
    },
  });
  writeJsonAtomic(path.join(pkgDir, 'manifest.json'), {
    package_name: fields.title,
    slug: slugifyTitle(fields.title),
    created_at: nowIso,
    updated_at: nowIso,
    package_state: 'active',
    source: prov.source,
    source_idea_id: prov.idea_uid,
  });
  writeJsonAtomic(path.join(pkgDir, PROMOTED_MARKER), Object.assign({
    source: prov.source,
    idea_uid: prov.idea_uid,
    title: fields.title,
    premise: fields.premise || '',
    score: fields.score || 0,
    promoted_at: nowIso,
  }, prov.marker || {}));
  writeJsonAtomic(path.join(pkgDir, 'project-status.json'), {
    status: 'active',
    source: prov.source,
    source_idea_id: prov.idea_uid,
    updated_at: nowIso,
  });
  return projectId;
}

// Promote an idea to a project. Idempotent: if the idea was already promoted,
// returns the existing project_id with created:false.
function promoteIdea(opts = {}) {
  const { archiveRoot, scriptPackagesRoot, date, index } = opts;
  const idea = getIdea(archiveRoot, date, index);
  const uid = ideaUid(date, index);

  // Idempotency: sidecar link OR an existing marker file in any package.
  const triage = readTriage(archiveRoot, date);
  const linked = (triage[String(index)] || {}).project_id;
  const existing = (linked && fs.existsSync(path.join(scriptPackagesRoot, linked))) ? linked : findPromotedProject(scriptPackagesRoot, uid);
  if (existing) {
    return { ok: true, project_id: existing, created: false, already_promoted: true };
  }

  const nowIso = opts.now || new Date().toISOString();
  const premise = String(idea.description || '').split(/(?<=[.!?])\s/)[0] || '';
  const projectId = createProjectFromIdea(scriptPackagesRoot, {
    title: idea.title,
    idea: idea.description || '',
    score: idea.final_score || 0,
    thumbnailConcept: idea.thumbnail_prompt || '',
    premise,
  }, { source: 'daily_idea_scout', idea_uid: uid, date, marker: { date, index } }, nowIso);

  // Link the idea in the triage sidecar.
  triage[String(index)] = Object.assign({}, triage[String(index)] || {}, {
    status: 'promoted',
    title: idea.title,
    project_id: projectId,
    updated_at: nowIso,
  });
  writeJsonAtomic(triagePath(archiveRoot, date), triage);

  return { ok: true, project_id: projectId, created: true, already_promoted: false };
}

module.exports = {
  ALLOWED_STATUSES,
  TRIAGE_FILE,
  PROMOTED_MARKER,
  slugifyTitle,
  ideaUid,
  triagePath,
  readTriage,
  readJson,
  writeJsonAtomic,
  getIdea,
  setIdeaStatus,
  findPromotedProject,
  chooseProjectId,
  createProjectFromIdea,
  promoteIdea,
};
