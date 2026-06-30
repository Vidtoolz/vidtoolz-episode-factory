/*
 * VIDTOOLZ score explanation builder.
 *
 * Turns a candidate idea (user-topic OR daily-scout shape, new or old) into a
 * structured score explanation so a promoted project can show WHY it scored
 * what it did — not just a bare number. Never invents data: if a field is
 * absent it is omitted, and `available:false` lets the UI show a clear fallback
 * for older ideas that stored no breakdown.
 */

function asList(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : (x && x.text ? String(x.text).trim() : ''))).filter(Boolean);
}

function pickScore(idea) {
  if (typeof idea.score === 'number') return idea.score;
  if (typeof idea.final_score === 'number') return idea.final_score;
  return null;
}

function buildScoreExplanation(idea = {}, source = '') {
  const score = pickScore(idea);
  const summary = String(idea.score_summary || idea.rationale || idea.ranking_rationale || '').trim();

  let succeeded = asList(idea.strengths);
  let weaker = asList(idea.weaknesses);

  // Criteria: explicit evaluation_criteria, else daily sub-scores, else derive
  // from the topic fields.
  let criteria = [];
  if (Array.isArray(idea.evaluation_criteria)) {
    criteria = idea.evaluation_criteria
      .map((c) => ({
        name: String((c && (c.name || c.criterion)) || '').trim(),
        result: String((c && (c.result || c.note || c.assessment)) || '').trim(),
        score: c && typeof c.score === 'number' ? c.score : undefined,
      }))
      .filter((c) => c.name);
  } else if (idea.scores && typeof idea.scores === 'object') {
    criteria = Object.entries(idea.scores)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({ name: k.replace(/_/g, ' '), result: '', score: v }));
  }
  if (!criteria.length) {
    if (idea.audience_fit) criteria.push({ name: 'Audience fit', result: String(idea.audience_fit).trim() });
    if (idea.production_fit) criteria.push({ name: 'Production fit', result: String(idea.production_fit).trim() });
    if (idea.proof_plan) criteria.push({ name: 'Proof / evidence plan', result: String(idea.proof_plan).trim() });
  }

  // Strengths: derive from topic fields / daily evidence when none stored.
  if (!succeeded.length) {
    if (idea.audience_fit) succeeded.push(`Audience fit: ${String(idea.audience_fit).trim()}`);
    if (idea.production_fit) succeeded.push(`Production path: ${String(idea.production_fit).trim()}`);
    if (Array.isArray(idea.evidence)) {
      idea.evidence.forEach((e) => { if (e && e.title) succeeded.push(`${e.type ? e.type + ': ' : ''}${e.title}`); });
    }
  }

  const raw_rationale = String(idea.rationale || idea.ranking_rationale || '').trim();
  const available = Boolean(summary || succeeded.length || weaker.length || criteria.length || raw_rationale);

  return {
    score,
    summary,
    succeeded,
    weaker_points: weaker,
    criteria,
    raw_rationale,
    source: source || '',
    available,
  };
}

module.exports = { buildScoreExplanation };
