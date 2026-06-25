'use strict';

/**
 * Submitted Topics module — handles custom topic submissions from Mikko.
 *
 * Submissions are stored as individual JSON files in:
 *   package-runs/<active-ideation-run>/submitted-topics/
 *
 * Each submission gets a system review that evaluates it against the
 * Canonical Production Spec criteria. The review is a structured
 * assessment, not an approval — Mikko decides what enters the pipeline.
 */

const fs = require('fs');
const path = require('path');

const SUBMITTED_TOPICS_DIR = 'submitted-topics';

function getSubmittedTopicsDir(repoRoot, runId) {
  if (!runId) return null;
  const runDir = path.join(repoRoot, 'package-runs', runId);
  if (!fs.existsSync(runDir)) return null;
  const dir = path.join(runDir, SUBMITTED_TOPICS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

function listSubmittedTopics(repoRoot, runId) {
  const dir = getSubmittedTopicsDir(repoRoot, runId);
  if (!dir) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const topics = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const data = JSON.parse(raw);
      topics.push(data);
    } catch (err) {
      // skip corrupted files
    }
  }
  return topics;
}

function getSubmittedTopic(repoRoot, runId, topicId) {
  const dir = getSubmittedTopicsDir(repoRoot, runId);
  if (!dir) return null;
  const filePath = path.join(dir, `${topicId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function saveSubmittedTopic(repoRoot, runId, topicText) {
  const dir = getSubmittedTopicsDir(repoRoot, runId);
  if (!dir) {
    throw Object.assign(new Error('Run not found: ' + runId), { statusCode: 404 });
  }

  const text = String(topicText || '').trim();
  if (!text) {
    throw Object.assign(new Error('Topic text is required.'), { statusCode: 400 });
  }
  if (text.length < 5) {
    throw Object.assign(new Error('Topic text must be at least 5 characters.'), { statusCode: 400 });
  }
  if (text.length > 500) {
    throw Object.assign(new Error('Topic text must be under 500 characters.'), { statusCode: 400 });
  }

  const timestamp = new Date().toISOString();
  const id = `topic-${Date.now()}-${slugify(text).slice(0, 30)}`;
  const slug = slugify(text);

  // Check for duplicates
  const existing = listSubmittedTopics(repoRoot, runId);
  const dup = existing.find(t => t.topicText.toLowerCase() === text.toLowerCase());
  if (dup) {
    return { ...dup, duplicate: true };
  }

  const review = reviewTopic(text);

  const record = {
    id,
    slug,
    topicText: text,
    submittedAt: timestamp,
    status: 'submitted',
    review,
  };

  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');

  // Merge into package-candidates.json so submitted topics appear in the Package Engine
  mergeIntoCandidates(repoRoot, runId, record);

  return record;
}

/**
 * Merge a submitted topic into the run's package-candidates.json
 * so it appears as a candidate card in the Package Engine UI.
 */
function mergeIntoCandidates(repoRoot, runId, topic) {
  const candidatesFile = path.join(repoRoot, 'package-runs', runId, 'package-candidates.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
  } catch (err) {
    // If no candidates file, create one
    data = {
      project: 'VIDTOOLZ Package Engine',
      topic: 'AI + creator workflow',
      generatedAt: new Date().toISOString(),
      candidates: [],
    };
  }

  // Skip if already merged (by topicText)
  const existing = (data.candidates || []).find(c => c._submittedTopicId === topic.id);
  if (existing) return;

  // Build a candidate from the submitted topic
  const review = topic.review || {};
  const passRate = review.totalCount > 0 ? review.passedCount / review.totalCount : 0;
  const recommendation = passRate >= 0.85 ? 'Strong' : passRate >= 0.6 ? 'Maybe' : 'Weak';
  const nextNumber = (data.candidates || []).length + 1;
  const idStr = `submitted-${String(nextNumber).padStart(3, '0')}`;

  const candidate = {
    id: idStr,
    packageNumber: nextNumber,
    score: 0,
    recommendation,
    proposedTitle: topic.topicText,
    idea: topic.topicText + ' (Submitted by Mikko — system reviewed)',
    thumbnailConcept: 'To be determined during packaging',
    onThumbnailText: '',
    thumbnailImage: '',
    viewerPromise: 'To be developed during outline stage',
    targetViewer: 'Creators at the intersection of AI and professional craft',
    productionDifficulty: 'TBD',
    mainRisk: review.recommendation || 'Under review',
    shortsIdeas: ['', '', '', '', ''],
    why_this_matters_now: 'Submitted by creator — pending outline development',
    why_this_stays_relevant: 'Pending outline development',
    why_this_fits_vidtoolz: 'Submitted by Mikko',
    why_vidtoolz_can_make_it_better: 'Pending outline development',
    audience_demand_rationale: 'Creator-submitted topic',
    suggested_production_approach: 'Pending outline stage',
    _submittedTopicId: topic.id,
    _isUserSubmitted: true,
    _reviewPassedCount: review.passedCount || 0,
    _reviewTotalCount: review.totalCount || 0,
  };

  data.candidates = data.candidates || [];
  data.candidates.push(candidate);
  data.lastUpdatedAt = new Date().toISOString();

  fs.writeFileSync(candidatesFile, JSON.stringify(data, null, 2), 'utf8');
}

function reviewTopic(text) {
  const t = String(text || '').toLowerCase();
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Criteria checks
  const checks = [];

  // 1. AI/creator relevance
  const aiKeywords = ['ai', 'artificial intelligence', 'chatgpt', 'kling', 'comfyui', 'resolve', 'edit', 'cut', 'grade', 'color', 'audio', 'script', 'prompt', 'workflow', 'tool', 'automation', 'generate', 'pipeline'];
  const aiMatch = aiKeywords.filter(kw => t.includes(kw));
  checks.push({
    criterion: 'AI / Creator Workflow Relevance',
    passed: aiMatch.length > 0,
    detail: aiMatch.length > 0
      ? `Relevant keywords found: ${aiMatch.slice(0, 5).join(', ')}`
      : 'No AI/creator workflow keywords detected. Topic may not fit the channel focus.',
  });

  // 2. Professional production authority
  const proKeywords = ['editor', 'editing', 'professional', 'pro', 'years', 'experience', 'yle', 'production', 'craft', 'habit', 'skill', 'manual', 'timeline', 'cut', 'footage', 'take', 'shot', 'b-roll', 'a-roll', 'grade', 'audio'];
  const proMatch = proKeywords.filter(kw => t.includes(kw));
  checks.push({
    criterion: 'Professional Authority Fit',
    passed: proMatch.length > 0,
    detail: proMatch.length > 0
      ? `Authority signals found: ${proMatch.slice(0, 5).join(', ')}`
      : 'No professional production authority signals. Can Mikko speak to this from 20 years of experience?',
  });

  // 3. Visual potential (can it be shown on screen?)
  const visualKeywords = ['show', 'see', 'watch', 'look', 'compare', 'side', 'before', 'after', 'demo', 'demonstrate', 'screen', 'timeline', 'resolve', 'footage', 'clip', 'video', 'edit'];
  const visualMatch = visualKeywords.filter(kw => t.includes(kw));
  checks.push({
    criterion: 'Visual Potential (Can it be shown?)',
    passed: visualMatch.length > 0 || wordCount <= 15,
    detail: visualMatch.length > 0
      ? `Visual signals: ${visualMatch.slice(0, 5).join(', ')}`
      : wordCount <= 15
        ? 'Short enough to interpret visually during scripting.'
        : 'No explicit visual demonstration signals. Consider how this will be shown on screen.',
  });

  // 4. Specificity (not too vague/abstract)
  checks.push({
    criterion: 'Specificity (Not abstract)',
    passed: wordCount >= 4 && wordCount <= 80,
    detail: wordCount < 4
      ? 'Too short — may be too vague to evaluate.'
      : wordCount > 80
        ? 'Quite long — consider distilling to a single claim.'
        : 'Good specificity for a topic suggestion.',
  });

  // 5. One-claim pattern (brand alignment)
  checks.push({
    criterion: 'One Claim, One Example, One Point',
    passed: wordCount <= 50,
    detail: wordCount <= 50
      ? 'Concise enough for the one-claim brand pattern.'
      : 'May contain multiple claims — consider focusing on one.',
  });

  // 6. Trust risk (anti-AI vs specific)
  const antiAiPhrases = ['ai is bad', 'ai sucks', 'ai is terrible', 'ai will fail', 'ai is useless', 'ai is garbage'];
  const antiMatch = antiAiPhrases.some(phrase => t.includes(phrase));
  checks.push({
    criterion: 'Trust Risk (Specific, not blanket anti-AI)',
    passed: !antiMatch,
    detail: antiMatch
      ? 'Contains blanket anti-AI language. VIDTOOLZ is specific, not anti-AI.'
      : 'No blanket anti-AI language detected.',
  });

  // 7. Not echoing abandoned proof-plan topic
  const proofPlanKeywords = ['proof plan', 'proof-plan', 'plan ai videos', 'planning ai'];
  const proofMatch = proofPlanKeywords.some(kw => t.includes(kw));
  checks.push({
    criterion: 'Does Not Echo Abandoned Topic',
    passed: !proofMatch,
    detail: proofMatch
      ? 'Echoes the abandoned May 6 proof-plan topic. Consider a different angle.'
      : 'No overlap with abandoned topics detected.',
  });

  const passedCount = checks.filter(c => c.passed).length;
  const totalCount = checks.length;
  const passRate = passedCount / totalCount;

  let recommendation;
  if (passRate >= 0.85) recommendation = 'Strong candidate — consider for next package run';
  else if (passRate >= 0.6) recommendation = 'Promising — refine before selection';
  else if (passRate >= 0.4) recommendation = 'Weak — needs significant rework';
  else recommendation = 'Does not fit current channel direction';

  return {
    evaluatedAt: new Date().toISOString(),
    checks,
    passedCount,
    totalCount,
    recommendation,
    note: 'This is a structured assessment, not an approval. Mikko decides what enters the pipeline.',
  };
}

function updateTopicStatus(repoRoot, runId, topicId, status) {
  const record = getSubmittedTopic(repoRoot, runId, topicId);
  if (!record) return null;
  record.status = status;
  const dir = getSubmittedTopicsDir(repoRoot, runId);
  fs.writeFileSync(path.join(dir, `${topicId}.json`), JSON.stringify(record, null, 2), 'utf8');
  // Note: we do NOT remove from candidates file — it stays as a historical record
  return record;
}

/**
 * Re-merge all submitted topics into candidates file.
 * Useful for syncing when the server restarts.
 */
function syncAllSubmittedTopics(repoRoot, runId) {
  const topics = listSubmittedTopics(repoRoot, runId);
  for (const topic of topics) {
    mergeIntoCandidates(repoRoot, runId, topic);
  }
  return { synced: topics.length };
}

module.exports = {
  SUBMITTED_TOPICS_DIR,
  listSubmittedTopics,
  getSubmittedTopic,
  saveSubmittedTopic,
  reviewTopic,
  updateTopicStatus,
  syncAllSubmittedTopics,
};
