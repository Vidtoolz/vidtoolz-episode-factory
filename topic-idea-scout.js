/*
 * VIDTOOLZ user-seeded topic idea scout.
 *
 * Lets Mikko seed his own topic and get 10 ranked candidate video ideas,
 * archived SEPARATELY from the automatic daily scout so the daily archive is
 * never touched:
 *   <aigen>/topic-idea-scout/<date>/<run-id>/ideas.json      (the run)
 *   <aigen>/topic-idea-scout/<date>/<run-id>/idea-triage.json (non-destructive triage)
 *
 * This module is pure fs + validation — it does NOT call the LLM (the server
 * does that via callOllamaChat with buildTopicPrompt, keeping local-first
 * routing + no cloud fallback). Triage + promote reuse the shared
 * idea-promotion helpers so a promoted project is identical in shape to a daily
 * promotion, just with user_topic provenance.
 */

const fs = require('fs');
const path = require('path');

const idea = require('./idea-promotion.js');

const KIND = 'user_seeded_topic_scout';
const MAX_TOPIC_LEN = 1000;
const DEFAULT_COUNT = 10;
const TRIAGE_FILE = 'idea-triage.json';

function validateTopic(topic) {
  const t = String(topic == null ? '' : topic).trim();
  if (!t) { const e = new Error('A topic is required.'); e.statusCode = 400; throw e; }
  if (t.length > MAX_TOPIC_LEN) {
    const e = new Error(`Topic is too long (max ${MAX_TOPIC_LEN} characters).`); e.statusCode = 400; throw e;
  }
  return t;
}

function safeDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    const e = new Error('A valid date (YYYY-MM-DD) is required.'); e.statusCode = 400; throw e;
  }
  return date;
}
function safeRunId(runId) {
  const id = String(runId || '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id.includes('..')) {
    const e = new Error('Invalid run_id.'); e.statusCode = 400; throw e;
  }
  return id;
}

// Stable, filesystem-safe run id from the seed topic + time.
function makeRunId(topic, nowIso) {
  const slug = idea.slugifyTitle(topic).slice(0, 40) || 'topic';
  const stamp = String(nowIso || new Date().toISOString()).replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${slug}-${stamp}`;
}

// ── Prompt (used by the server's Ollama call) ───────────────────────────────
function buildTopicPrompt(topic, count = DEFAULT_COUNT) {
  const system = [
    'You generate candidate YouTube video ideas for VIDTOOLZ.',
    'Channel: AI-native, local-first/supervised video production systems for serious solo creators — practical, evidence-first, non-hype. Topics: AI media generation, DaVinci Resolve, gates/review/proof, workflow discipline.',
    'Each idea must be a REAL, specific video topic (not a vague theme), follow the seed topic, and have a concrete production angle.',
    'Prefer ideas makeable with presenter A-roll, screen recordings, local AI visuals, or manual GPT/KlingAI media imports. Avoid generic AI-news recaps and tool-list videos unless the seed is about workflow/tool choice. Avoid legal/medical/financial certainty claims unless framed as a current signal.',
    'Return STRICT JSON only — no prose, no markdown fences.',
  ].join('\n');
  const user = [
    `Seed topic: ${topic}`,
    '',
    `Return exactly ${count} ideas, ranked strongest first, as JSON:`,
    '{"ideas":[{"title","premise","score","rationale","audience_fit","production_fit","difficulty","format","opening_hook","proof_plan","thumbnail_prompt"}]}',
    'score: number 0-10. difficulty: low|medium|high. format: Short|Long|Either.',
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' }, premise: { type: 'string' }, score: { type: 'number' },
            rationale: { type: 'string' }, audience_fit: { type: 'string' }, production_fit: { type: 'string' },
            difficulty: { type: 'string' }, format: { type: 'string' }, opening_hook: { type: 'string' },
            proof_plan: { type: 'string' }, thumbnail_prompt: { type: 'string' },
          },
          required: ['title', 'premise', 'score'],
        },
      },
    },
    required: ['ideas'],
  };
  return { system, user, schema };
}

function normScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

// Parse + validate provider output into exactly `count` ranked ideas.
function parseTopicIdeas(content, count = DEFAULT_COUNT) {
  let parsed;
  try { parsed = typeof content === 'string' ? JSON.parse(content) : content; } catch (e) {
    const err = new Error('Idea provider did not return valid JSON.'); err.statusCode = 502; throw err;
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.ideas) ? parsed.ideas : null);
  if (!list) { const e = new Error('Idea provider returned no ideas array.'); e.statusCode = 502; throw e; }
  const cleaned = list
    .filter((it) => it && typeof it.title === 'string' && it.title.trim() && typeof it.premise === 'string' && it.premise.trim())
    .map((it) => ({
      title: it.title.trim(),
      premise: it.premise.trim(),
      score: normScore(it.score),
      rationale: String(it.rationale || '').trim(),
      audience_fit: String(it.audience_fit || '').trim(),
      production_fit: String(it.production_fit || '').trim(),
      difficulty: String(it.difficulty || '').trim(),
      format: String(it.format || 'Either').trim(),
      opening_hook: String(it.opening_hook || '').trim(),
      proof_plan: String(it.proof_plan || '').trim(),
      thumbnail_prompt: String(it.thumbnail_prompt || '').trim(),
    }));
  if (cleaned.length < count) {
    const e = new Error(`Idea provider returned ${cleaned.length} valid idea(s); ${count} are required. Try again.`);
    e.statusCode = 502; throw e;
  }
  cleaned.sort((a, b) => b.score - a.score);
  return cleaned.slice(0, count).map((it, i) => Object.assign({ rank: i + 1 }, it));
}

// ── Archive ─────────────────────────────────────────────────────────────────
function runDir(topicRoot, date, runId) {
  return path.join(topicRoot, safeDate(date), safeRunId(runId));
}
function relPath(topicRoot, date, runId, file) {
  return path.join('topic-idea-scout', date, runId, file);
}

function writeTopicRun(opts = {}) {
  const { topicRoot, date, runId, seedTopic, ideas } = opts;
  const nowIso = opts.now || new Date().toISOString();
  const run = {
    kind: KIND,
    date: safeDate(date),
    run_id: safeRunId(runId),
    generated_at: nowIso,
    provider: opts.provider || 'ollama',
    provider_host: opts.providerHost || 'vidnux',
    seed_topic: seedTopic,
    requested_count: ideas.length,
    ideas,
  };
  const dir = runDir(topicRoot, date, runId);
  idea.writeJsonAtomic(path.join(dir, 'ideas.json'), run);
  return { dir, archive_path: relPath(topicRoot, date, runId, 'ideas.json'), run };
}

function readTopicRun(topicRoot, date, runId) {
  const run = idea.readJson(path.join(runDir(topicRoot, date, runId), 'ideas.json'), null);
  if (!run) { const e = new Error(`No topic run for ${date}/${runId}.`); e.statusCode = 404; throw e; }
  return run;
}

function listTopicRuns(topicRoot) {
  const out = [];
  let dates = [];
  try { dates = fs.readdirSync(topicRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return out; }
  for (const date of dates.sort().reverse()) {
    let runs = [];
    try { runs = fs.readdirSync(path.join(topicRoot, date), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { continue; }
    for (const runId of runs) {
      const run = idea.readJson(path.join(topicRoot, date, runId, 'ideas.json'), null);
      if (run) out.push({ date, run_id: runId, seed_topic: run.seed_topic || '', generated_at: run.generated_at || '', count: (run.ideas || []).length });
    }
  }
  out.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));
  return out;
}

function getTopicIdea(topicRoot, date, runId, index) {
  const run = readTopicRun(topicRoot, date, runId);
  const ideas = Array.isArray(run.ideas) ? run.ideas : [];
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= ideas.length) {
    const e = new Error(`Idea index ${index} out of range for ${date}/${runId}.`); e.statusCode = 404; throw e;
  }
  return { run, idea: ideas[i] };
}

function triagePath(topicRoot, date, runId) {
  return path.join(runDir(topicRoot, date, runId), TRIAGE_FILE);
}
function readTopicTriage(topicRoot, date, runId) {
  return idea.readJson(triagePath(topicRoot, date, runId), {});
}

function setTopicIdeaStatus(opts = {}) {
  const { topicRoot, date, runId, index, status } = opts;
  if (!idea.ALLOWED_STATUSES.includes(status)) {
    const e = new Error(`status must be one of: ${idea.ALLOWED_STATUSES.join(', ')}`); e.statusCode = 400; throw e;
  }
  const { idea: theIdea } = getTopicIdea(topicRoot, date, runId, index);
  const triage = readTopicTriage(topicRoot, date, runId);
  const key = String(index);
  triage[key] = Object.assign({}, triage[key] || {}, {
    status, title: theIdea.title, updated_at: opts.now || new Date().toISOString(),
  });
  idea.writeJsonAtomic(triagePath(topicRoot, date, runId), triage);
  return { ok: true, source: 'user_topic', run_id: runId, date, index: Number(index), status, entry: triage[key] };
}

function topicUid(date, runId, index) {
  return `topic:${date}:${runId}:${index}`;
}

// Promote a user-topic idea to a project. Idempotent; records user_topic provenance.
function promoteTopicIdea(opts = {}) {
  const { topicRoot, scriptPackagesRoot, date, runId, index } = opts;
  const { run, idea: theIdea } = getTopicIdea(topicRoot, date, runId, index);
  const uid = topicUid(date, runId, index);

  const triage = readTopicTriage(topicRoot, date, runId);
  const linked = (triage[String(index)] || {}).project_id;
  const existing = (linked && fs.existsSync(path.join(scriptPackagesRoot, linked))) ? linked : idea.findPromotedProject(scriptPackagesRoot, uid);
  if (existing) return { ok: true, project_id: existing, created: false, already_promoted: true };

  const nowIso = opts.now || new Date().toISOString();
  const projectId = idea.createProjectFromIdea(scriptPackagesRoot, {
    title: theIdea.title,
    idea: theIdea.premise || '',
    score: theIdea.score || 0,
    thumbnailConcept: theIdea.thumbnail_prompt || '',
    premise: theIdea.premise || '',
  }, {
    source: 'user_topic_scout',
    idea_uid: uid,
    date,
    marker: { date, index: Number(index), run_id: runId, seed_topic: run.seed_topic || '' },
  }, nowIso);

  triage[String(index)] = Object.assign({}, triage[String(index)] || {}, {
    status: 'promoted', title: theIdea.title, project_id: projectId, updated_at: nowIso,
  });
  idea.writeJsonAtomic(triagePath(topicRoot, date, runId), triage);

  return { ok: true, project_id: projectId, created: true, already_promoted: false };
}

module.exports = {
  KIND,
  MAX_TOPIC_LEN,
  DEFAULT_COUNT,
  validateTopic,
  safeDate,
  safeRunId,
  makeRunId,
  buildTopicPrompt,
  parseTopicIdeas,
  writeTopicRun,
  readTopicRun,
  listTopicRuns,
  getTopicIdea,
  readTopicTriage,
  triagePath,
  setTopicIdeaStatus,
  promoteTopicIdea,
};
