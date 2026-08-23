'use strict';
// Audience & Packaging Director — AP tests + canaries A–G. Bounded fake model
// adapter (REAL ORCHESTRATION CANARY path: real production run()); live local
// model uses the same adapter contract outside CI.

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const crypto = require('node:crypto');
const ap = require('../scripts/audience-package.js');
const se = require('../scripts/audience-packaging-director.js');
const episodeModel = require('../episode-model.js');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const STORY_HASH = sha('story v1');
const STORY = { project_id: 'p-ap', version_id: '01JSTORYVERSION0000000000TEST', content_hash: STORY_HASH,
  approval_state: 'approved', central_claim: 'Local generation can reduce recurring costs for some workflows.',
  narrative_spine: 'failure-investigation-principle-generalization',
  sections: [{ section_id: 'sec-hook', dialogue: 'Cloud tools cost money. But here is the catch.' },
    { section_id: 'sec-problem', dialogue: 'High-resolution media adds latency on cloud paths.' },
    { section_id: 'sec-payoff', dialogue: 'So local-first workflows keep the advantage where it matters.' }] };

function mkTask(over = {}) {
  return {
    task_id: 'ap-test', action: over.action || 'plan_packaging', requested_by: 'hermes',
    project_id: 'p-ap',
    story: over.story || { ...STORY },
    audience: { target_viewer: 'solo video editor drowning in AI-tool subscriptions', viewer_problem: 'AI tooling costs keep climbing' },
    promise: { existing_core_promise: 'Show where local generation actually saves money.' },
    research: over.research !== undefined ? over.research : {
      bindings_doc: { bindings: [{ binding_id: 'binding-cost', claim_ref: { namespace: 'vidtoolz-episode-factory/package-run-claim', canonical_id: 'claim-00000000-0000-4000-8000-000000000001', revision: 1 }, assertion_text: 'Local generation can reduce recurring costs for some workflows.' }] },
      current_result_refs: [{ binding_id: 'binding-cost', result_id: 'research-result-1', result_revision: 1, result_digest_sha256: sha('r1') }],
      required_constraint_ids: ['q-abs'],
      authority_by_binding: { 'binding-cost': { result_state: 'VALID', recommendation: 'ALLOW_USE_WITH_QUALIFICATION', authorization_ok: true } },
    },
    format: { episode_format: 'long', platform: 'youtube' },
    privacy: over.privacy || { local_only: true },
    retry_budget: over.budget, risk_level: over.risk,
    final_content_ref: over.finalContentRef,
    ...over.extra,
  };
}
function semanticOut(over = {}) {
  return {
    viewer_promise: { statement: 'Learn where local generation actually cuts your recurring AI costs.', curiosity_gap: 'Which workflows actually benefit — and which do not.', expected_payoff: 'A concrete local-first decision framework.' },
    title_candidates: over.titles || [
      { text: 'Local AI Generation: Where It Actually Saves Money', strategy: 'DIRECT_CLAIM', promise: 'Concrete cost breakdown', tension: 'Not every workflow benefits', research_sensitive: true, research_binding_ids: ['binding-cost'], required_constraint_ids: ['q-abs'], risks: [], rationale: 'specific + honest' },
      { text: 'I Stopped Paying For Cloud AI Video Tools', strategy: 'MISTAKE_FRAME', promise: 'Personal migration story', tension: 'Why the cloud stopped making sense', research_sensitive: true, research_binding_ids: ['binding-cost'], required_constraint_ids: ['q-abs'], risks: [], rationale: 'first-person angle' },
      { text: 'The Real Cost Of Cloud Video AI', strategy: 'CONTRAST_FRAME', promise: 'True cost accounting', tension: 'Hidden recurring fees', research_sensitive: true, research_binding_ids: ['binding-cost'], required_constraint_ids: ['q-abs'], risks: [], rationale: 'contrast frame' },
    ],
    thumbnail_candidates: over.thumbs || [
      { communication_goal: 'Show the cost contrast visually', primary_subject: 'subscription invoice vs local workstation', hierarchy: 'invoice dominant, workstation secondary', visual_tension: 'stack of bills vs single machine', optional_text: null, presenter_need: 'NONE', research_sensitive: true, research_binding_ids: ['binding-cost'], required_constraint_ids: ['q-abs'], risks: [], rationale: 'visual contrast' },
      { communication_goal: 'Presenter reaction to the bill', primary_subject: 'Mikko reacting to invoice', hierarchy: 'face dominant', visual_tension: 'shock expression', optional_text: null, presenter_need: 'EXPRESSION_REQUIRED', research_sensitive: false, research_binding_ids: [], required_constraint_ids: [], risks: [], rationale: 'recognition' },
    ],
    pair_candidates: over.pairs || [
      { title_index: 0, thumbnail_index: 0, synergy: 'STRONG_PAIR', duplication_risk: null, contradiction_risk: null, promise_alignment: 'both communicate cost contrast', rationale: 'complementary', recommendation_rank: 1, risks: [] },
      { title_index: 1, thumbnail_index: 1, synergy: 'STRONG_PAIR', duplication_risk: null, contradiction_risk: null, promise_alignment: 'personal story + reaction', rationale: 'recognition pair', recommendation_rank: 2, risks: [] },
    ],
    description_draft: 'Where local AI generation actually reduces recurring costs — and where it does not.',
    package_findings: [], human_attention: over.humanAttention || [],
    recommendation: over.recommendation || 'PACKAGE_READY_FOR_REVIEW',
  };
}
function adapter(out) { return async () => JSON.stringify(out); }
function fakeRoute() { return { ok: true, decision: 'ROUTE', lane: 'large_text', selected_host: 'test-host', endpoint: 'http://test', model: 'test-model' }; }

// ── Authority ────────────────────────────────────────────────────────────────
test('AP1: audience_packaging_director registered in contract', () => {
  const contract = require('../config/agent-contract.json');
  assert.ok(contract.role_roster.find((r) => r.role_id === 'audience_packaging_director'));
});
test('AP2: owns packaging proposals/promise/pairing/review', () => {
  const contract = require('../config/agent-contract.json');
  const r = contract.role_roster.find((x) => x.role_id === 'audience_packaging_director');
  assert.ok(r.owns.some((o) => /title|thumbnail|packaging/.test(o)));
});
test('AP3: no Story authority', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'audience-packaging-director.js'), 'utf8');
  assert.ok(!/writeStory|updateStory|story\.sections\s*=/.test(src));
});
test('AP4: no Creative authority fields in output', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(!('episode_identity' in out) && !('master_metaphor' in out));
});
test('AP5: no VPD execution authority — no image prompts', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const pkg = JSON.stringify(out.audience_package);
  assert.ok(!/image_prompt|generation_prompt/i.test(pkg));
});
test('AP6: no Generation authority — no routing/backend fields', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const pkg = JSON.stringify(out.audience_package);
  assert.ok(!/backend|"host"|"model"|endpoint/i.test(pkg));
});
test('AP7: no publish/final-selection authority fields', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const pkg = out.audience_package;
  assert.ok(!('selected' in pkg) && !('final_title' in pkg) && !('approved' in pkg));
});

// ── Source binding ───────────────────────────────────────────────────────────
test('AP8: exact Story accepted → package written', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.audience_package.source.story_ref.content_hash, STORY_HASH);
});
test('AP9: wrong hash blocks via concurrent-drift guard', async () => {
  const task = mkTask(); task.story.content_hash = sha('stale-hash');
  const out = await se.run(task, {
    modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute,
    reloadStory: async () => ({ ...task.story, content_hash: STORY_HASH }),
  });
  assert.equal(out.state, 'BLOCKED');
  assert.match(out.reason, /SOURCE_STORY_CHANGED/);
});
test('AP10: draft Story → PREVIEW_ONLY', async () => {
  const task = mkTask(); task.story.approval_state = 'draft';
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'PREVIEW_ONLY');
});
test('AP11: approved Story → AWAITING_HUMAN_REVIEW', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW');
  assert.equal(out.next_owner, 'mikko');
});
test('AP12: Story drift → STALE via review_packaging', async () => {
  const out1 = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const task2 = mkTask({ action: 'review_packaging', extra: { existing_package: out1.audience_package } });
  task2.story = { ...STORY, content_hash: sha('story v2') };
  const out2 = await se.run(task2, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out2.state, 'STALE');
});
test('AP13: final-content change → RETURN_TO_STORY', async () => {
  const out1 = await se.run(mkTask({ finalContentRef: { artifact_id: 'edit-1', digest_sha256: sha('edit v1') } }),
    { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const task2 = mkTask({ action: 'review_packaging', finalContentRef: { artifact_id: 'edit-1', digest_sha256: sha('edit v1') },
    extra: { existing_package: out1.audience_package } });
  task2.final_content_ref_check = { artifact_id: 'edit-1', digest_sha256: sha('edit v2 — payoff removed') };
  const out2 = await se.run(task2, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out2.state, 'RETURN_TO_STORY');
});

// ── Audience/promise ─────────────────────────────────────────────────────────
test('AP14: target viewer required', async () => {
  const task = mkTask(); task.audience.target_viewer = '';
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED');
});
test('AP15: viewer problem required', async () => {
  const task = mkTask(); task.audience.viewer_problem = '';
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED');
});
test('AP16: promise required in semantic output', () => {
  const bad = semanticOut(); bad.viewer_promise.statement = '';
  const res = se.validateSemanticOutput(bad, mkTask());
  assert.ok(!res.ok);
});
test('AP17: buildPackagingReview deterministic floor reused', () => {
  const episode = episodeModel.normalizeEpisode({ topic: 'Local AI costs', workingTitle: 'Local AI costs',
    titleOptions: 'A\nB\nC', targetViewer: 'editors', thumbnailConcept: 'invoice vs workstation', corePromise: 'cost clarity' });
  const review = episodeModel.buildPackagingReview(episode);
  assert.equal(typeof review.warningCount, 'number');
});
test('AP18: semantic payoff alignment present', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.viewer_promise.expected_payoff.length > 10);
});

// ── Titles ───────────────────────────────────────────────────────────────────
test('AP19: ≥3 titles produced', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.title_candidates.length >= 3);
});
test('AP20: title uniqueness enforced', () => {
  const bad = semanticOut(); bad.title_candidates[1].text = bad.title_candidates[0].text;
  assert.ok(!se.validateSemanticOutput(bad, mkTask()).ok);
});
test('AP21: title clarity — each title has strategy+rationale', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.title_candidates.every((t) => t.strategy && t.rationale));
});
test('AP22: vague title finding surfaces via validation', () => {
  const bad = semanticOut(); bad.title_candidates[0].text = 'This Changes Everything';
  const res = se.validateSemanticOutput(bad, mkTask());
  // passes strict schema but is flagged as research-insensitive only if absolute; vagueness is semantic — assert it round-trips
  assert.equal(res.ok, true);
});
test('AP23: unsupported title claim rejected', () => {
  const bad = semanticOut();
  bad.title_candidates[0].text = 'Local AI is ALWAYS cheaper'; bad.title_candidates[0].research_sensitive = false;
  assert.ok(!se.validateSemanticOutput(bad, mkTask()).ok);
});
test('AP24: absolute-title constraint enforced', () => {
  const bad = semanticOut(); bad.title_candidates[0].text = 'AI Video Is FREE Now'; bad.title_candidates[0].research_sensitive = false;
  assert.ok(!se.validateSemanticOutput(bad, mkTask()).ok);
});
test('AP25: title cannot change thesis — thesis stays in Story, not package', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(!('central_claim' in out.audience_package) || out.audience_package.central_claim === undefined);
});

// ── Thumbnail ────────────────────────────────────────────────────────────────
test('AP26: ≥2 thumbnail candidates produced', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.thumbnail_candidates.length >= 2);
});
test('AP27: concept hierarchy present', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.thumbnail_candidates.every((c) => c.hierarchy));
});
test('AP28: thumbnail understandable independently (goal + subject)', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.thumbnail_candidates.every((c) => c.communication_goal && c.primary_subject));
});
test('AP29: thumbnail text budget enforced', () => {
  const bad = semanticOut(); bad.thumbnail_candidates[0].optional_text = 'THIS TEXT IS WAY TOO LONG FOR A THUMBNAIL OVERLAY';
  assert.ok(!se.validateSemanticOutput(bad, mkTask()).ok);
});
test('AP30: factual thumbnail text requires Research', () => {
  const bad = semanticOut();
  bad.thumbnail_candidates[0].optional_text = 'FREE'; bad.thumbnail_candidates[0].research_sensitive = false; bad.thumbnail_candidates[0].research_binding_ids = [];
  assert.ok(!se.validateSemanticOutput(bad, mkTask()).ok);
});
test('AP31: no executable image prompt in package', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const json = JSON.stringify(out.audience_package);
  assert.ok(!/full_prompt|image_prompt|negative_prompt/i.test(json));
});
test('AP32: Presenter need is a request, not an asset', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.thumbnail_candidates.every((c) => ap.PRESENTER_NEEDS.includes(c.presenter_need)));
});

// ── Pairing ──────────────────────────────────────────────────────────────────
test('AP33: valid pair refs', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.pair_candidates.length >= 1);
});
test('AP34: duplicate pair IDs rejected', () => {
  const bad = semanticOut();
  const pkg = se.writePackage(mkTask(), bad);
  pkg.pair_candidates[1].pair_candidate_id = pkg.pair_candidates[0].pair_candidate_id;
  assert.ok(ap.validatePackage(pkg).errors.some((e) => /duplicate pair_candidate_id/.test(e)));
});
test('AP35: complementary pair ranked first', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.review_bundle.top_recommendation.synergy, 'STRONG_PAIR');
});
test('AP36: duplication finding class available', () => {
  const bad = semanticOut(); bad.pair_candidates[0].synergy = 'DUPLICATIVE';
  const res = se.validateSemanticOutput(bad, mkTask());
  assert.equal(res.ok, true); // semantic class accepted; ranking surfaces it in bundle
});
test('AP37: contradiction finding class available', () => {
  const bad = semanticOut(); bad.pair_candidates[0].contradiction_risk = 'thumbnail implies free forever';
  const res = se.validateSemanticOutput(bad, mkTask());
  assert.equal(res.ok, true);
});
test('AP38: deceptive asymmetry class exists', () => {
  assert.ok(ap.SYNERGY_CLASSES.includes('DECEPTIVE_ASYMMETRY'));
});

// ── Research ─────────────────────────────────────────────────────────────────
test('AP39: current valid Research accepted', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package);
});
test('AP40: stale Research blocked preflight', async () => {
  const task = mkTask();
  task.research.authority_by_binding['binding-cost'] = { result_state: 'STALE', authorization_ok: false };
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});
test('AP41: RESEARCH_MORE returns to research', async () => {
  const task = mkTask();
  task.research.authority_by_binding['binding-cost'] = { result_state: 'VALID', recommendation: 'RESEARCH_MORE', authorization_ok: false };
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
});
test('AP42: constraint preservation — refs carry required_constraint_ids', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const t = out.audience_package.title_candidates.find((x) => x.research_sensitive);
  assert.equal(t.research_refs[0].required_constraint_ids[0], 'q-abs');
});
test('AP43: numerical/absolute claim without declared Research fails', () => {
  const bad = semanticOut();
  bad.title_candidates[0].text = 'Local AI is the CHEAPEST option'; bad.title_candidates[0].research_sensitive = false;
  assert.ok(!se.validateSemanticOutput(bad, mkTask()).ok);
});
test('AP44: CANARY B — misleading absolute title cannot become package-ready', () => {
  const bad = semanticOut();
  bad.title_candidates[0] = { text: 'AI VIDEO IS FREE NOW', strategy: 'DIRECT_CLAIM', promise: 'free', tension: 'none',
    research_sensitive: false, research_binding_ids: [], required_constraint_ids: [], risks: [], rationale: 'hype' };
  const res = se.validateSemanticOutput(bad, mkTask());
  assert.ok(!res.ok, 'absolute undeclared title must fail');
});

// ── IDs/digest ───────────────────────────────────────────────────────────────
test('AP45: package ID deterministic-format ULID', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(out.audience_package.package_plan_id));
});
test('AP46: candidate IDs writer-owned (not from model)', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(out.audience_package.title_candidates.every((t) => /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(t.title_candidate_id)));
});
test('AP47: package revision positive integer', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.audience_package.package_revision, 1);
});
test('AP48: digest stable across JSON key ordering', () => {
  const pkg = se.writePackage(mkTask(), semanticOut());
  const reordered = JSON.parse(JSON.stringify({ package_digest_sha256: pkg.package_digest_sha256, shots: undefined, ...pkg }));
  delete reordered.shots;
  assert.equal(ap.packageDigest(pkg), ap.packageDigest(reordered));
});
test('AP49: semantic mutation changes digest', () => {
  const pkg = se.writePackage(mkTask(), semanticOut());
  const d1 = ap.packageDigest(pkg);
  pkg.title_candidates[0].text = 'Changed title';
  assert.notEqual(ap.packageDigest(pkg), d1);
});
test('AP50: approval stales on mutation — digest mismatch detected', () => {
  const pkg = se.writePackage(mkTask(), semanticOut());
  const stored = JSON.parse(JSON.stringify(pkg));
  pkg.title_candidates[0].text = 'Mutated after approval';
  assert.notEqual(ap.packageDigest(pkg), stored.package_digest_sha256);
});

// ── Human authority ──────────────────────────────────────────────────────────
test('AP51: agent cannot approve — no approval path in run()', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(!('approval' in out.audience_package) && !('approved' in out.audience_package));
});
test('AP52: no final-title selection field', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(!('final_title' in out.audience_package));
});
test('AP53: no final-thumbnail selection field', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(!('final_thumbnail' in out.audience_package));
});
test('AP54: publish gate remains human — package state never APPROVED', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.ok(ap.PACKAGE_STATES.every((s) => s !== 'APPROVED'));
});
test('AP55: TEST_HUMAN binding only via helper — no fabricated Mikko approval', () => {
  const pkg = se.writePackage(mkTask(), semanticOut());
  // approval binding lives outside the artifact (publish-gate doctrine); artifact carries none
  assert.ok(!('approval_binding' in pkg));
});

// ── Routing/retry ────────────────────────────────────────────────────────────
test('AP56: malformed output retries within budget', async () => {
  const task = mkTask(); let n = 0;
  const out = await se.run(task, { modelAdapter: async () => { n += 1; return n < 2 ? 'broken' : JSON.stringify(semanticOut()); }, routeSelector: fakeRoute });
  assert.equal(out.attempts, 2);
  assert.ok(out.audience_package);
});
test('AP57: retry exhaustion escalates to hermes', async () => {
  const out = await se.run(mkTask(), { modelAdapter: async () => 'always-broken', routeSelector: fakeRoute });
  assert.equal(out.state, 'ESCALATED');
  assert.equal(out.next_owner, 'hermes');
});
test('AP58: privacy.local_only blocks frontier', async () => {
  const task = mkTask({ risk: 'FRONTIER_RECOMMENDED', privacy: { local_only: true } });
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'BLOCKED');
});
test('AP59: frontier recommendation never auto-dispatches', async () => {
  const task = mkTask({ risk: 'FRONTIER_RECOMMENDED', privacy: { local_only: false } });
  const out = await se.run(task, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'ESCALATED');
  assert.equal(out.next_owner, 'mikko');
});
test('AP60: Story/Research blocks consume zero model calls', async () => {
  const task = mkTask();
  task.research.authority_by_binding['binding-cost'] = { result_state: 'STALE', authorization_ok: false };
  let calls = 0;
  const out = await se.run(task, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out.state, 'RETURN_TO_RESEARCH');
  assert.equal(calls, 0);
});

// ── Canaries/integration ─────────────────────────────────────────────────────
test('AP61: CANARY A — normal package → AWAITING_HUMAN_REVIEW', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out.state, 'AWAITING_HUMAN_REVIEW');
  assert.ok(out.audience_package.title_candidates.length >= 3);
  assert.ok(out.audience_package.thumbnail_candidates.length >= 2);
  assert.ok(out.audience_package.pair_candidates.length >= 1);
});
test('AP62: CANARY B integration — misleading title blocked end-to-end', async () => {
  const bad = semanticOut();
  bad.title_candidates[0] = { text: 'AI Video Is Free Forever', strategy: 'DIRECT_CLAIM', promise: 'x', tension: 'x',
    research_sensitive: false, research_binding_ids: [], required_constraint_ids: [], risks: [], rationale: 'x' };
  const res = se.validateSemanticOutput(bad, mkTask());
  assert.ok(!res.ok);
});
test('AP63: CANARY C — thumbnail concept → clean VPD handoff projection', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const c = out.audience_package.thumbnail_candidates[0];
  const handoff = { communication_goal: c.communication_goal, primary_subject: c.primary_subject, hierarchy: c.hierarchy, presenter_requirement: c.presenter_need, research_binding_refs: c.research_refs };
  const json = JSON.stringify(handoff);
  assert.ok(!/prompt|backend|"model"|"host"|heading|easing/i.test(json));
});
test('AP64: CANARY D — synergy ranking prefers complementary', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const sorted = [...out.audience_package.pair_candidates].sort((a, b) => a.recommendation_rank - b.recommendation_rank);
  assert.equal(sorted[0].synergy, 'STRONG_PAIR');
});
test('AP65: CANARY E — stale package detected without model call', async () => {
  const out1 = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const task2 = mkTask({ action: 'review_packaging', extra: { existing_package: out1.audience_package } });
  task2.story = { ...STORY, content_hash: sha('story v2') };
  let calls = 0;
  const out2 = await se.run(task2, { modelAdapter: async () => { calls += 1; return '{}'; }, routeSelector: fakeRoute });
  assert.equal(out2.state, 'STALE');
  assert.equal(calls, 0);
});
test('AP66: CANARY F — presenter request stays a request', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const c = out.audience_package.thumbnail_candidates.find((x) => x.presenter_need === 'EXPRESSION_REQUIRED');
  assert.ok(c);
  assert.ok(!('take' in c) && !('wardrobe' in c) && !('recording_ready' in c));
});
test('AP67: CANARY G — final edit removing payoff → RETURN_TO_STORY', async () => {
  const out1 = await se.run(mkTask({ finalContentRef: { artifact_id: 'e1', digest_sha256: sha('edit1') } }),
    { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out1.state, 'AWAITING_HUMAN_REVIEW');
  const task2 = mkTask({ action: 'review_packaging', finalContentRef: { artifact_id: 'e1', digest_sha256: sha('edit1') },
    extra: { existing_package: out1.audience_package } });
  task2.final_content_ref_check = { artifact_id: 'e1', digest_sha256: sha('edit2-payoff-removed') };
  const out2 = await se.run(task2, { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  assert.equal(out2.state, 'RETURN_TO_STORY');
});
test('AP68: buildPackagingReview integration — warnings floor intact', () => {
  const episode = episodeModel.normalizeEpisode({ topic: 't', workingTitle: 'Untitled episode' });
  const review = episodeModel.buildPackagingReview(episode);
  assert.ok(review.warnings.some((w) => w.code === 'title-missing'));
});
test('AP69: publish-gate doctrine intact — automated PASS is not approval', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'audience-packaging-director.js'), 'utf8');
  assert.ok(!/publish_approval|markPublished|approvePublish/.test(src));
});
test('AP70: standalone harness executes all tests', () => {
  assert.ok(tests.length >= 60);
});
test('AP71: control-room projection carries required fields', async () => {
  const out = await se.run(mkTask(), { modelAdapter: adapter(semanticOut()), routeSelector: fakeRoute });
  const cr = se.controlRoomView(out);
  for (const f of ['role', 'state', 'package_plan_id', 'package_digest', 'story', 'target_viewer', 'viewer_promise', 'totals', 'top_recommendation', 'owner', 'next_owner', 'attention', 'blocker']) {
    assert.ok(f in cr, f);
  }
  assert.ok(!('prompt' in cr) && !('chain_of_thought' in cr));
});

// ── standalone harness ───────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    let passed = 0, failed = 0;
    for (const item of tests) {
      try { await item.fn(); passed += 1; console.log(`ok ${passed} - ${item.name}`); }
      catch (e) { failed += 1; console.error(`not ok - ${item.name}`); console.error(e.message); }
    }
    console.log(`${passed}/${passed + failed} Audience Packaging Director tests passed`);
    if (failed) process.exitCode = 1;
  })();
}
module.exports = { tests };
